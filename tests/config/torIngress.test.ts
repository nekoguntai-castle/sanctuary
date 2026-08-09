import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("Tor Payjoin ingress", () => {
  const compose = readRepositoryFile("docker/compose/tor.yml");
  const ingress = readRepositoryFile("docker/tor/payjoin-ingress.conf");

  it("routes the hidden service only through the dedicated ingress", () => {
    expect(compose).toContain("getent hosts tor-ingress");
    expect(compose).toContain(
      '/usr/bin/torproxy.sh -s "80;$${ingress_ip}:8080"',
    );
    expect(compose).not.toMatch(/torproxy\.sh[^\n]*backend/);
    expect(compose).not.toMatch(/getent hosts backend/);
    expect(compose).toContain("- ./docker/tor/payjoin-ingress.conf:/etc/nginx/conf.d/default.conf:ro");
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
    expect(compose).toContain('"80;$${ingress_ip}:8080"');
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
});
