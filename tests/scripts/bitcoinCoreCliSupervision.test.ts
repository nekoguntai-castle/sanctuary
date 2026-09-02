import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BitcoinCoreImplementation } from "../../scripts/verify-psbt/implementations/bitcoincore";

const temporaryDirectories: string[] = [];

function executable(source: string): string {
  const directory = mkdtempSync(
    path.join(tmpdir(), "bitcoin-core-cli-supervision-"),
  );
  temporaryDirectories.push(directory);
  const script = path.join(directory, "bitcoin-cli");
  writeFileSync(script, `#!/usr/bin/env bash\nset -euo pipefail\n${source}\n`);
  chmodSync(script, 0o755);
  return script;
}

afterEach(() => {
  delete process.env.BITCOIN_CORE_CLOSE_MARKER;
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  temporaryDirectories.length = 0;
});

describe("Bitcoin Core CLI child supervision", () => {
  it("resolves successful output after the exact child closes", async () => {
    const cliPath = executable(
      `printf '%s\\n' '{"version":280000,"subversion":"/Satoshi:28.0/"}'`,
    );
    const implementation = new BitcoinCoreImplementation({
      cliPath,
      timeout: 1_000,
    });

    await expect(implementation.getNetworkInfo()).resolves.toEqual({
      version: 280000,
      subversion: "/Satoshi:28.0/",
    });
  });

  it("reports nonzero CLI status and stderr", async () => {
    const cliPath = executable(`printf '%s\\n' 'rpc refused' >&2\nexit 7`);
    const implementation = new BitcoinCoreImplementation({
      cliPath,
      timeout: 1_000,
    });

    await expect(implementation.getNetworkInfo()).rejects.toThrow(
      "Bitcoin Core CLI error (code 7): rpc refused",
    );
  });

  it("aborts on timeout but rejects only after the exact child close", async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "bitcoin-core-cli-marker-"),
    );
    temporaryDirectories.push(directory);
    const closeMarker = path.join(directory, "closed");
    process.env.BITCOIN_CORE_CLOSE_MARKER = closeMarker;
    const cliPath = executable(`
trap 'printf closed > "$BITCOIN_CORE_CLOSE_MARKER"; exit 0' TERM
while :; do sleep 0.01; done
`);
    const implementation = new BitcoinCoreImplementation({
      cliPath,
      timeout: 25,
    });

    await expect(implementation.getNetworkInfo()).rejects.toThrow(
      "Bitcoin Core CLI timeout after 25ms",
    );
    expect(existsSync(closeMarker)).toBe(true);
  });

  it("preserves spawn error semantics without a raw PID signal", async () => {
    const implementation = new BitcoinCoreImplementation({
      cliPath: "/definitely/missing/bitcoin-cli",
      timeout: 1_000,
    });

    await expect(implementation.getNetworkInfo()).rejects.toThrow(
      "Failed to execute bitcoin-cli:",
    );
  });
});
