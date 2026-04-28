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
