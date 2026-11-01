import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("Tor Payjoin ingress", () => {
  const compose = readRepositoryFile("docker/compose/tor.yml");
  const ingress = readRepositoryFile("docker/tor/payjoin-ingress.conf");

  it("routes the hidden service only through the dedicated ingress", () => {
    expect(compose).toContain("getent hosts tor-ingress");
    expect(compose).toContain(
      "printf 'HiddenServiceDir /var/lib/tor/hidden_service\\nHiddenServicePort 80 %s:8080\\n' \"$$ingress_ip\" >> /etc/tor/torrc",
    );
    expect(compose).not.toMatch(/HiddenServicePort[^\n]*backend/);
    expect(compose).not.toMatch(/getent hosts backend/);
    expect(compose).toContain(
      "- ${SANCTUARY_TOR_INGRESS_CONFIG:-./docker/tor/payjoin-ingress.conf}:/etc/nginx/templates/payjoin-ingress.conf.template:ro",
    );
    expect(compose).not.toContain("./docker/tor/payjoin-ingress.conf:/etc/nginx/conf.d/");
    expect(compose).toContain("tor_hidden_service:/var/lib/tor/hidden_service");
  });

  it("allows only the exact public Payjoin receiver route", () => {
    expect(ingress).toContain(
      'location ~ "^/api/v1/payjoin/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"',
    );
    expect(ingress).toContain("if ($request_method != POST)");
    expect(ingress).toContain("client_max_body_size 100k;");
    expect(ingress).toContain("error_page 413 = @payjoin_body_rejected;");
    expect(ingress).toContain('return 413 "original-psbt-rejected";');
    expect(ingress).toContain("location / {");
    expect(compose).toContain("http://127.0.0.1:8081/health");
    expect(compose).toContain("HiddenServicePort 80 %s:8080");
    expect(ingress).not.toContain("/status");
    expect(ingress).not.toContain("/attempt");
    expect(ingress).not.toContain("/parse-uri");
    expect(ingress).not.toContain("/auth");
    expect(ingress).not.toContain("/internal");
  });

  it("removes client forwarding identity at the trusted hop", () => {
    expect(ingress).toContain('proxy_set_header Forwarded "";');
    expect(ingress).toContain("proxy_set_header X-Forwarded-For $remote_addr;");
    expect(ingress).toContain("proxy_set_header X-Real-IP $remote_addr;");
    expect(ingress).toContain('proxy_set_header X-Forwarded-Host "";');
    expect(ingress).toContain("proxy_set_header X-Forwarded-Proto http;");
  });

  // D-17.C3: nginx drops a header whose value is empty, and Node's HTTP/1.1
  // parser (requireHostHeader) answers 400 before Express runs. The backend
  // must get a fixed Host that names neither the onion address nor the client.
  it("sends the backend a fixed Host that its HTTP server accepts", async () => {
    const hostLines = ingress
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("proxy_set_header Host "));
    expect(hostLines).toHaveLength(1);
    const host = hostLines[0]
      .replace(/^proxy_set_header Host /, "")
      .replace(/;$/, "")
      .replace(/^"(.*)"$/, "$1");

    expect(await backendStatusLine(host)).toBe("HTTP/1.1 200 OK");
    expect(hostLines[0]).toBe("proxy_set_header Host payjoin-ingress;");
    expect(ingress).not.toMatch(/proxy_set_header Host \$(?:host|http_host)\b/);
  });

  // D-17.C1a: the ingress re-resolves a recreated backend (as #967 did for
  // the frontend) instead of pinning the IP nginx saw at startup.
  it("re-resolves a recreated backend through the container DNS resolver", () => {
    const entrypoint = readRepositoryFile("docker/nginx/docker-entrypoint.sh");
    const ingressService = (parse(compose) as ComposeFile).services["tor-ingress"];

    expect(ingress).toContain("upstream payjoin_backend {");
    expect(ingress).toContain("zone payjoin_backend 64k;");
    expect(ingress).toContain("resolver ${NGINX_DNS_RESOLVER} valid=5s ipv6=off;");
    expect(ingress).toContain("resolver_timeout 2s;");
    expect(ingress).toContain("server ${BACKEND_HOST}:${BACKEND_PORT} resolve;");
    expect(ingress.match(/proxy_pass http:\/\/payjoin_backend;/g)).toHaveLength(1);
    expect(ingress).not.toMatch(/proxy_pass http:\/\/backend:/);
    expect(ingressService.entrypoint).toBeUndefined();
    expect(ingressService.command).toEqual(["nginx", "-g", "daemon off;"]);
    expect(ingressService.environment?.NGINX_CONFIG_TEMPLATE).toBe(
      "/etc/nginx/templates/payjoin-ingress.conf.template",
    );
    // The template branch is chosen before the SSL branch, which would
    // demand certificates the ingress does not have.
    expect(entrypoint.indexOf('if [ -n "${NGINX_CONFIG_TEMPLATE:-}" ]')).toBeGreaterThan(-1);
    expect(entrypoint.indexOf('if [ -n "${NGINX_CONFIG_TEMPLATE:-}" ]')).toBeLessThan(
      entrypoint.indexOf('elif [ "$ENABLE_SSL" = "true" ]'),
    );
    // Every placeholder in the template is one envsubst substitutes;
    // anything else would reach nginx as a literal ${...}.
    const substituted = new Set(
      [...(entrypoint.match(/envsubst '([^']+)'/)?.[1] ?? "").matchAll(/\$\{(\w+)\}/g)].map(
        (match) => match[1],
      ),
    );
    const placeholders = [...ingress.matchAll(/\$\{(\w+)\}/g)].map((match) => match[1]);
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders.filter((name) => !substituted.has(name))).toEqual([]);
  });

  // D-17.C1b: Tor needs an IP, so the tor service re-resolves tor-ingress and
  // reloads Tor when the ingress is recreated with a new address. The image
  // runs /sbin/tini as PID 1 with Tor as its child, so the watcher finds Tor by
  // scanning /proc/<pid>/comm; here the scan reads a fake proc root where PID 1
  // is tini and Tor runs under another PID.
  it("finds Tor under tini, moves the hidden service to a recreated ingress and reloads Tor once", () => {
    const command = (parse(compose) as ComposeFile).services.tor.command;
    const script = String(command?.[2] ?? "").replaceAll("$$", "$");
    const watcher = script.match(
      /<<'PAYJOIN_INGRESS_WATCH'\n([\s\S]*?)\nPAYJOIN_INGRESS_WATCH\n/,
    )?.[1];
    expect(watcher, "tor command must define the ingress watcher").toBeDefined();
    // The watcher starts before Tor and waits until a process named tor exists.
    const launch = 'sh /tmp/payjoin-ingress-watch.sh "$ingress_ip" &';
    expect(script).toContain(launch);
    expect(script.indexOf("payjoin-ingress-watch.sh \"$ingress_ip\" &")).toBeLessThan(
      script.indexOf("exec tor -f /etc/tor/torrc"),
    );

    const dir = mkdtempSync(join(tmpdir(), "tor-ingress-watch-"));
    try {
      const torrc = join(dir, "torrc");
      writeFileSync(
        torrc,
        "SocksPort 0.0.0.0:9050\nHiddenServiceDir /var/lib/tor/hidden_service\nHiddenServicePort 80 10.0.0.5:8080\n",
      );
      writeFileSync(join(dir, "watch.sh"), String(watcher));
      writeFileSync(join(dir, "ip"), "10.0.0.5 tor-ingress\n");
      // PID 1 is tini; a non-numeric entry is ignored. Tor's entry appears later.
      mkdirSync(join(dir, "proc", "1"), { recursive: true });
      writeFileSync(join(dir, "proc", "1", "comm"), "tini\n");
      mkdirSync(join(dir, "proc", "self"));
      writeFileSync(join(dir, "proc", "self", "comm"), "tor\n");
      writeExecutable(join(dir, "getent"), '#!/bin/sh\ncat "$WATCH_DIR/ip"\n');
      // Named `tor` so /proc/<pid>/comm reads "tor"; exits on SIGHUP or after 10 s.
      writeExecutable(
        join(dir, "tor"),
        '#!/bin/sh\ntrap \'echo hup >> "$WATCH_DIR/hups"; exit 0\' HUP\ni=0\nwhile [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done\n',
      );
      const harness = [
        // Bounded, so a watcher that never finds Tor fails the test (exit 124) instead of outliving it.
        'timeout 10 sh "$WATCH_DIR/watch.sh" 10.0.0.5 2> "$WATCH_DIR/stderr" & watch_pid=$!',
        '"$WATCH_DIR/tor" & tor_pid=$!',
        // Tor is not running yet as far as the watcher can see: it must not reload anything.
        'echo "10.0.0.7 tor-ingress" > "$WATCH_DIR/ip"',
        "sleep 0.4",
        'echo "10.0.0.5 tor-ingress" > "$WATCH_DIR/ip"',
        // Tor appears under its own PID; its comm follows the real process, so it vanishes when Tor exits.
        'mkdir "$WATCH_DIR/proc/$tor_pid" && ln -s "/proc/$tor_pid/comm" "$WATCH_DIR/proc/$tor_pid/comm"',
        "sleep 1.5",
        ': > "$WATCH_DIR/ip"',
        "sleep 0.4",
        'echo "10.0.0.9 tor-ingress" > "$WATCH_DIR/ip"',
        'wait "$tor_pid"; wait "$watch_pid"',
      ].join("\n");
      const result = spawnSync("sh", ["-c", harness], {
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH ?? ""}`,
          WATCH_DIR: dir,
          PAYJOIN_INGRESS_TORRC: torrc,
          PAYJOIN_INGRESS_PROC_ROOT: join(dir, "proc"),
          PAYJOIN_INGRESS_RECHECK_SECONDS: "0.05",
        },
      });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(torrc, "utf8")).toBe(
        "SocksPort 0.0.0.0:9050\nHiddenServiceDir /var/lib/tor/hidden_service\nHiddenServicePort 80 10.0.0.9:8080\n",
      );
      expect(readFileSync(join(dir, "hups"), "utf8")).toBe("hup\n");
      expect(readFileSync(join(dir, "stderr"), "utf8")).toBe(
        "Payjoin ingress moved from 10.0.0.5 to 10.0.0.9; reloaded Tor\n",
      );
      // No fixed Tor PID: PID 1 is tini, and entrypoint: [] would lose its reaping.
      expect(String(watcher)).not.toContain("PAYJOIN_INGRESS_TOR_PID");
      expect((parse(compose) as ComposeFile).services.tor.entrypoint).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // 2026-10: the Tor network began refusing Tor 0.4.3 ("missing protocols
  // Desc=3 Microdesc=3"), so the third-party image exited 1 on its first
  // consensus and the optional-profiles upgrade lane failed. Tor now runs from a
  // repo-owned image whose build refuses a Tor older than 0.4.8.
  it("runs Tor from the repo-owned image that refuses an obsolete Tor", () => {
    const tor = (parse(compose) as ComposeFile).services.tor;
    const dockerfile = readRepositoryFile("docker/tor/Dockerfile");
    const torrc = readRepositoryFile("docker/tor/torrc");

    expect(tor.image).toBe("sanctuary-tor:${SANCTUARY_IMAGE_TAG:-local}");
    expect(tor.pull_policy).toBe("never");
    expect(tor.build?.dockerfile).toBe("docker/tor/Dockerfile");
    expect(compose).not.toMatch(/dperson|torproxy/);
    expect(dockerfile).toMatch(/^FROM alpine:[0-9.]+@sha256:[0-9a-f]{64}$/m);
    expect(dockerfile).toContain("apk add --no-cache tor tini");
    expect(dockerfile).toContain("v[2] == 4 && v[3] >= 8");
    expect(dockerfile).toContain('ENTRYPOINT ["/sbin/tini", "--"]');
    expect(torrc).toContain("SocksPort 0.0.0.0:9050 IsolateDestAddr");
    expect(torrc).toContain("ExitPolicy reject *:*");
    expect(torrc).not.toMatch(/HiddenService|^User /m);
    // Tor runs unprivileged as uid 101, the uid the previous image wrote the
    // onion keys with, so existing hidden-service volumes need no chown.
    expect(dockerfile).toContain("s/^tor:x:100:101:/tor:x:101:101:/");
    expect(dockerfile).toContain('test "$(id -u tor)" = 101');
    expect(dockerfile).toContain("chown -R 101:101 /var/lib/tor /etc/tor");
    expect(dockerfile).toContain("chmod 0700 /var/lib/tor /var/lib/tor/hidden_service");
    expect(dockerfile).toMatch(/^USER 101:101$/m);
    expect(dockerfile.indexOf("USER 101:101")).toBeLessThan(dockerfile.indexOf("ENTRYPOINT"));
    expect(String(tor.command?.[2])).toContain(
      "must be owned by uid 101 (it is $$(stat -c %u /var/lib/tor/hidden_service))",
    );
    expect(String(tor.command?.[2])).not.toContain("chown");
  });

  it("enforces the Tor version floor the Dockerfile declares", () => {
    const dockerfile = readRepositoryFile("docker/tor/Dockerfile");
    const check = dockerfile.match(/awk '([^']+)'/)?.[1];
    expect(check, "Dockerfile must gate the Tor version with awk").toBeDefined();
    const accepts = (version: string) =>
      spawnSync("awk", [String(check)], { input: `Tor version ${version}.\n` }).status === 0;
    expect(accepts("0.4.3.5")).toBe(false);
    expect(accepts("0.4.7.16")).toBe(false);
    expect(accepts("0.4.8.0")).toBe(true);
    expect(accepts("0.4.9.15")).toBe(true);
    expect(accepts("0.5.0.1")).toBe(true);
    expect(accepts("1.0.0.0")).toBe(true);
  });
});

type ComposeService = {
  image?: string;
  pull_policy?: string;
  build?: { dockerfile?: string };
  command?: string[];
  entrypoint?: string[];
  environment?: Record<string, string>;
};
type ComposeFile = { services: Record<string, ComposeService> };

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

/** Sends the request line and headers nginx forwards (no Host when its value is empty). */
async function backendStatusLine(host: string): Promise<string> {
  const server = createServer((_request, response) => response.end("handler"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const headers = [
    "POST /api/v1/payjoin/00000000-0000-0000-0000-000000000000?v=1 HTTP/1.1",
    ...(host === "" ? [] : [`Host: ${host}`]),
    "Connection: close",
    "Content-Length: 0",
  ];
  try {
    return await new Promise<string>((resolve, reject) => {
      let received = "";
      const socket = connect(port, "127.0.0.1", () => socket.write(`${headers.join("\r\n")}\r\n\r\n`));
      socket.setTimeout(5_000, () => socket.destroy(new Error("backend did not answer")));
      socket.on("data", (chunk) => { received += chunk; });
      socket.on("error", reject);
      socket.on("close", () => resolve(received.split("\r\n")[0]));
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
