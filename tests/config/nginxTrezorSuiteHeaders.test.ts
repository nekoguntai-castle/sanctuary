import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Trezor Connect 10 falls back to Suite Web when Suite desktop is not running.
// That channel needs the page to frame https://suite.trezor.io and to keep the
// popup's window.opener, so a same-origin COOP or a CSP without that origin
// breaks Trezor with a handshake timeout (docs/plans/trezor-connect-10-migration.md).
const nginxConfigPaths = [
  "docker/nginx/default.conf.template",
  "docker/nginx/default-ssl.conf.template",
];
const SUITE_WEB_ORIGIN = "https://suite.trezor.io";

function headerValues(config: string, header: string): string[] {
  const pattern = new RegExp(`add_header\\s+${header}\\s+"([^"]*)"`, "gi");
  return [...config.matchAll(pattern)].map((match) => match[1]);
}

describe("nginx headers keep the Trezor Suite Web channel open", () => {
  it.each(nginxConfigPaths)("does not sever the Suite Web popup in %s", (configPath) => {
    const config = readFileSync(join(process.cwd(), configPath), "utf8");

    for (const value of headerValues(config, "Cross-Origin-Opener-Policy")) {
      expect(value.trim()).not.toBe("same-origin");
    }

    for (const policy of headerValues(config, "Content-Security-Policy")) {
      const directives = policy.split(";").map((directive) => directive.trim());
      // Browsers take frame sources from frame-src, then child-src, then default-src.
      const frameDirective = ["frame-src", "child-src", "default-src"]
        .map((name) => directives.find((directive) => directive.startsWith(`${name} `)))
        .find((directive) => directive !== undefined);
      if (frameDirective) expect(frameDirective).toContain(SUITE_WEB_ORIGIN);
    }
  });

  it("recognizes the headers it guards", () => {
    const sample = [
      'add_header Cross-Origin-Opener-Policy "same-origin" always;',
      `add_header Content-Security-Policy "default-src 'self'; frame-src ${SUITE_WEB_ORIGIN}" always;`,
    ].join("\n");
    expect(headerValues(sample, "Cross-Origin-Opener-Policy")).toEqual(["same-origin"]);
    expect(headerValues(sample, "Content-Security-Policy")).toEqual([
      `default-src 'self'; frame-src ${SUITE_WEB_ORIGIN}`,
    ]);
  });
});
