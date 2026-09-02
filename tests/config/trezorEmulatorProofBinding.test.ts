import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const bindingResolverPath = path.join(
  repoRoot,
  "scripts/ci/resolve-trezor-publish-binding.sh",
);
const transportPolicyPath = path.join(
  repoRoot,
  "scripts/ci/check-trezor-transport-provenance.sh",
);

const bindingEnvironment = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  ...process.env,
  SANCTUARY_DOCKER_PUBLISHED_HOST: "",
  SANCTUARY_DOCKER_PUBLISH_BIND_IP: "",
  SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND: "0",
  ...overrides,
});

const resolveBinding = (overrides: NodeJS.ProcessEnv = {}): string =>
  execFileSync(bindingResolverPath, {
    cwd: repoRoot,
    encoding: "utf8",
    env: bindingEnvironment(overrides),
  }).trim();

describe("Trezor emulator proof publish binding", () => {
  it("keeps endpoints private across Docker publishing and Podman loopback tunneling", () => {
    const runner = readFileSync(
      path.join(repoRoot, "scripts/ci/run-trezor-emulator-proof.sh"),
      "utf8",
    );
    const bindingResolver = readFileSync(bindingResolverPath, "utf8");
    const workflow = readFileSync(
      path.join(repoRoot, ".github/workflows/verify-vectors.yml"),
      "utf8",
    );

    expect(runner).toContain("resolve-trezor-publish-binding.sh");
    expect(runner).toContain('if [ -n "${DOCKER_HOST:-}" ]; then');
    expect(runner).toContain(
      "Remote Docker requires SANCTUARY_DOCKER_PUBLISHED_HOST",
    );
    expect(bindingResolver).toContain("getent ahostsv4");
    expect(bindingResolver).toContain(
      "must resolve to exactly one IPv4 address",
    );
    expect(bindingResolver).toContain(
      "Refusing wildcard Trezor proof port binding",
    );
    expect(bindingResolver).toContain("SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND=1");
    expect(workflow).toContain("SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND: '0'");
    expect(runner).toContain('-p "${publish_bind_ip}::9001/tcp"');
    expect(runner).toContain('-p "${publish_bind_ip}::21326/tcp"');
    expect(runner).toContain('componentNames | any(. == "Podman Engine")');
    expect(runner).toContain("docker-exec-tcp-forwarder.mjs");
    expect(runner).toContain("trezor_transport='docker-exec-loopback'");
    expect(runner).toContain('registered-collector-process.sh" register');
    expect(runner).toContain("--control-token");
    expect(runner).toContain("finish_forwarder");
    expect(runner).not.toContain("bounded-child-process.mjs");
    expect(runner).not.toContain('kill -KILL "$forwarder_pid"');
    expect(runner).toContain("check-trezor-transport-provenance.sh");
    expect(runner).not.toContain("-p 9001/tcp -p 21326/tcp");
  });

  it("defaults host runs to loopback and accepts private or link-local Docker gateways", () => {
    expect(resolveBinding()).toBe("127.0.0.1\t127.0.0.1");
    expect(
      resolveBinding({ SANCTUARY_DOCKER_PUBLISHED_HOST: "172.30.0.1" }),
    ).toBe("172.30.0.1\t172.30.0.1");
    expect(
      resolveBinding({ SANCTUARY_DOCKER_PUBLISHED_HOST: "169.254.1.2" }),
    ).toBe("169.254.1.2\t169.254.1.2");
  });

  it("rejects missing, malformed, wildcard, and implicit public binds", () => {
    for (const environment of [
      { SANCTUARY_DOCKER_PUBLISHED_HOST: "does-not-exist.invalid" },
      { SANCTUARY_DOCKER_PUBLISH_BIND_IP: "999.1.1.1" },
      { SANCTUARY_DOCKER_PUBLISH_BIND_IP: "0.0.0.0" },
      {
        SANCTUARY_DOCKER_PUBLISHED_HOST: "203.0.113.10",
        SANCTUARY_DOCKER_PUBLISH_BIND_IP: "203.0.113.10",
      },
    ]) {
      const result = spawnSync(bindingResolverPath, {
        cwd: repoRoot,
        encoding: "utf8",
        env: bindingEnvironment(environment),
      });
      expect(result.status).not.toBe(0);
    }
  });

  it("rejects an ambiguous published-host resolution", () => {
    const commandDirectory = mkdtempSync(
      path.join(tmpdir(), "trezor-binding-test-"),
    );
    const fakeGetent = path.join(commandDirectory, "getent");
    writeFileSync(
      fakeGetent,
      "#!/usr/bin/env bash\nprintf '%s\\n' '172.30.0.1 STREAM gateway' '172.31.0.1 STREAM gateway'\n",
    );
    chmodSync(fakeGetent, 0o755);

    try {
      const result = spawnSync(bindingResolverPath, {
        cwd: repoRoot,
        encoding: "utf8",
        env: bindingEnvironment({
          PATH: `${commandDirectory}:${process.env.PATH ?? ""}`,
          SANCTUARY_DOCKER_PUBLISHED_HOST: "gateway.internal",
        }),
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        "must resolve to exactly one IPv4 address",
      );
    } finally {
      rmSync(commandDirectory, { recursive: true, force: true });
    }
  });

  it("requires explicit opt-in for a specific public bind address", () => {
    expect(
      resolveBinding({
        SANCTUARY_DOCKER_PUBLISHED_HOST: "203.0.113.10",
        SANCTUARY_DOCKER_PUBLISH_BIND_IP: "203.0.113.10",
        SANCTUARY_TREZOR_ALLOW_PUBLIC_BIND: "1",
      }),
    ).toBe("203.0.113.10\t203.0.113.10");
  });

  it("binds provenance transport exactly to the detected container engine", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "trezor-transport-"));
    const provenancePath = path.join(directory, "provenance.json");
    const check = (
      componentNames: string[],
      trezorTransport: string,
    ): number | null => {
      writeFileSync(
        provenancePath,
        JSON.stringify({
          runtime: { docker: { server: { componentNames } }, trezorTransport },
        }),
      );
      return spawnSync(transportPolicyPath, [provenancePath], {
        cwd: repoRoot,
        encoding: "utf8",
      }).status;
    };

    try {
      expect(check(["Podman Engine"], "docker-exec-loopback")).toBe(0);
      expect(check(["Docker Engine"], "published-port")).toBe(0);
      expect(check(["Podman Engine"], "published-port")).not.toBe(0);
      expect(check(["Docker Engine"], "docker-exec-loopback")).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
