import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nginxTemplatePaths = [
  "docker/nginx/default.conf.template",
  "docker/nginx/default-ssl.conf.template",
];

function readTemplate(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("nginx proxy headers", () => {
  it.each(nginxTemplatePaths)(
    "re-resolves a replaced backend through Docker DNS in %s",
    (templatePath) => {
      const template = readTemplate(templatePath);

      expect(template).toContain(
        "resolver ${NGINX_DNS_RESOLVER} valid=5s ipv6=off;",
      );
      expect(template).toContain("resolver_timeout 2s;");
      expect(template).toContain("zone backend 64k;");
      expect(template).toContain(
        "server ${BACKEND_HOST}:${BACKEND_PORT} resolve;",
      );
      expect(template.match(/proxy_pass http:\/\/backend;/g)).toHaveLength(2);
      expect(template).not.toContain("server ${BACKEND_HOST}:${BACKEND_PORT};");
      expect(template).not.toContain("proxy_next_upstream non_idempotent");
    },
  );

  it("derives the resolver from the container runtime and substitutes it explicitly", () => {
    const entrypoint = readTemplate("docker/nginx/docker-entrypoint.sh");

    expect(entrypoint).toContain('$1 == "nameserver"');
    expect(entrypoint).toContain("octets[octet_index] !~ /^[0-9]+$/");
    expect(entrypoint).toContain("no valid IPv4 nameserver found");
    expect(entrypoint).toContain("NGINX_DNS_RESOLVER=$(resolve_dns_resolver)");
    expect(entrypoint).toContain("export NGINX_DNS_RESOLVER");
    expect(entrypoint).toContain("${NGINX_DNS_RESOLVER}'");
  });

  it.each(nginxTemplatePaths)(
    "preserves the external host header in %s",
    (templatePath) => {
      const template = readTemplate(templatePath);
      const hostHeaderLines = template
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("proxy_set_header Host "));

      expect(hostHeaderLines).toEqual([
        "proxy_set_header Host $http_host;",
        "proxy_set_header Host $http_host;",
      ]);
      expect(template).not.toContain("proxy_set_header Host $host;");
    },
  );

  it.each(nginxTemplatePaths)(
    "keeps API proxy reads above the Console timeout in %s",
    (templatePath) => {
      const template = readTemplate(templatePath);

      expect(template).toContain("proxy_connect_timeout 60s;");
      expect(template).toContain("proxy_send_timeout 310s;");
      expect(template).toContain("proxy_read_timeout 310s;");
    },
  );
});
