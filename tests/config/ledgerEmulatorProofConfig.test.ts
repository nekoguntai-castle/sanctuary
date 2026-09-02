import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const manifest = JSON.parse(
  readFileSync(
    path.join(repoRoot, "config/ledger-emulator/proof.json"),
    "utf8",
  ),
) as {
  schemaVersion: number;
  platform: string;
  model: string;
  speculos: { version: string; image: string };
  builder: { image: string };
  bitcoinApp: Record<string, string>;
  sdk: { ledgerBitcoin: string; webUsbTransport: string };
};
const dockerfile = readFileSync(
  path.join(repoRoot, "config/ledger-emulator/Dockerfile"),
  "utf8",
);
const automation = readFileSync(
  path.join(repoRoot, "config/ledger-emulator/automation.json"),
  "utf8",
);
const runner = readFileSync(
  path.join(repoRoot, "scripts/ci/run-ledger-emulator-proof.sh"),
  "utf8",
);
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/verify-vectors.yml"),
  "utf8",
);
const packageLock = JSON.parse(
  readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"),
) as {
  packages: Record<string, { version?: string }>;
};

function shellFunction(name: string): string {
  const lines = runner.split("\n");
  const start = lines.findIndex((line) => line === `${name}() {`);
  if (start < 0) throw new Error(`Missing shell function: ${name}`);
  const endOffset = lines.slice(start + 1).findIndex((line) => line === "}");
  if (endOffset < 0) throw new Error(`Unterminated shell function: ${name}`);
  return lines.slice(start, start + endOffset + 2).join("\n");
}

function runLedgerResolveScenario(cidValue: string) {
  const testDir = mkdtempSync(path.join(os.tmpdir(), "ledger-resolve-"));
  const recoveredId = "a".repeat(64);
  try {
    const cidfile = path.join(testDir, "container.cid");
    writeFileSync(cidfile, `${cidValue}\n`);
    return spawnSync(
      "bash",
      [
        "-c",
        `set -u
recover_exact_created_container() { printf '%s\\n' "$RECOVERED_ID"; }
${shellFunction("resolve_created_container")}
resolve_status=0
container="$(resolve_created_container test-ledger "$CIDFILE" 0)" || resolve_status=$?
cleanup_container=''
if [[ "$container" =~ ^[0-9a-f]{64}$ ]]; then cleanup_container="$container"; fi
printf 'status=%s container=%s cleanup=%s\\n' "$resolve_status" "$container" "$cleanup_container"
exit "$resolve_status"`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, CIDFILE: cidfile, RECOVERED_ID: recoveredId },
      },
    );
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe("pinned Ledger emulator proof configuration", () => {
  it("rejects a valid foreign cidfile ID while arming exact recovered cleanup", () => {
    const result = runLedgerResolveScenario("b".repeat(64));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Ledger emulator cidfile disagrees with the exact created container",
    );
    expect(result.stdout).toBe(
      `status=1 container=${"a".repeat(64)} cleanup=${"a".repeat(64)}\n`,
    );
  });

  it("pins every executable input and both reproducible app binaries", () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      platform: "linux/amd64",
      model: "nanosp",
    });
    expect(manifest.speculos.image).toMatch(
      /^ghcr\.io\/ledgerhq\/speculos@sha256:[0-9a-f]{64}$/,
    );
    expect(manifest.builder.image).toMatch(/@sha256:[0-9a-f]{64}$/);
    expect(manifest.bitcoinApp.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    for (const field of [
      "sourceTarballSha256",
      "mainnetElfSha256",
      "testnetElfSha256",
    ]) {
      expect(manifest.bitcoinApp[field]).toMatch(/^[0-9a-f]{64}$/);
      expect(dockerfile).toContain(manifest.bitcoinApp[field]);
    }
    expect(dockerfile).toContain(manifest.speculos.image);
    expect(dockerfile).toContain(manifest.builder.image);
    expect(dockerfile).toContain(manifest.bitcoinApp.sourceCommit);
  });

  it("binds the production SDK lock and requires automated transaction approval", () => {
    expect(
      packageLock.packages["node_modules/@ledgerhq/ledger-bitcoin"]?.version,
    ).toBe(manifest.sdk.ledgerBitcoin);
    expect(
      packageLock.packages["node_modules/@ledgerhq/hw-transport-webusb"]
        ?.version,
    ).toBe(manifest.sdk.webUsbTransport);
    expect(automation).toContain("Sign transaction");
    expect(runner).toContain(
      "readonly manifest='config/ledger-emulator/proof.json'",
    );
    expect(runner).toContain("docker buildx build");
    expect(runner).toContain(
      'readonly image="localhost/sanctuary-ledger-emulator:proof-${run_identity}"',
    );
    expect(runner).toContain('--label "io.sanctuary.build-id=$run_identity"');
    expect(runner).toContain(
      'recover_exact_loaded_image "$image" "$run_identity"',
    );
    expect(runner).toContain(
      'register_exact_built_image "$image" "$proof_image_id"',
    );
    expect(runner).toContain(
      'retire_exact_built_image "$image" "$proof_image_id" "$run_identity"',
    );
    expect(runner).toMatch(/docker buildx build \\\n\s+--load \\/);
    expect(runner).toContain('docker create --rm --cidfile "$cidfile"');
    expect(runner).not.toContain(
      'container="$(resolve_created_container "$container_name" "$cidfile" "$create_status")" \\\n' +
        '    || exit "$create_status"',
    );
    expect(runner).toContain("|| resolve_status=$?");
    expect(runner.indexOf('cleanup_container="$container"')).toBeLessThan(
      runner.indexOf('[ "$resolve_status" -eq 0 ] || exit "$resolve_status"'),
    );
    expect(runner).toContain('docker start "$container"');
    expect(runner).toContain(
      "create output disagrees with its durable container ID",
    );
    expect(runner).toContain(
      'recover_exact_created_container "$container_name"',
    );
    expect(
      runner.indexOf('recover_exact_created_container "$container_name"'),
    ).toBeLessThan(
      runner.indexOf('[ "$create_status" -eq 0 ] || exit "$create_status"'),
    );
    expect(runner).toContain(
      "ownership_label_args compose_container exact_delete",
    );
    expect(runner).toContain('.[0].Name == ("/" + $name)');
    expect(runner).toContain(
      "register_owned_resource compose_container obsolete exact_delete engine_id",
    );
    expect(runner).toContain(
      'retire_registered_transient "$container" "$network"',
    );
    expect(runner).toContain("postcondition: $postcondition");
    expect(runner).toContain('"$evidence_name" absent');
    expect(runner).toContain('"$evidence_name" already-absent');
    expect(runner).toContain("container_absence_proven");
    expect(runner).toContain("container ls -a --no-trunc");
    expect(runner).toContain("|| stop_status=$?");
    expect(runner).toContain("stop=$stop_status, inspect=$absence_status");
    expect(runner).toContain("subjectExitCode: $subjectExitCode");
    expect(runner).toContain("cleanupExitCode: $cleanupExitCode");
    expect(runner).toContain('exit "$final_status"');
    expect(runner).not.toMatch(/retire_registered_transient[^\n]+\|\| true/);
    expect(runner).not.toContain("trap cleanup EXIT INT TERM");
    expect(runner).not.toContain('docker rm "$container"');
    expect(runner).not.toMatch(/docker create[^\n]*--publish/);
    expect(runner).toContain("LEDGER_EMULATOR_PROOF=1");
    expect(runner).toContain("proof-sources.sha256");
    expect(runner).toContain("sourceTreeState");
    expect(runner).toContain("hardware-emulator-source-inventory.mjs");
    expect(runner).toContain(
      "list --vendor ledger --format lines --require-clean",
    );
    expect(runner).toContain("if ! proof_sources_text=");
    expect(runner).toContain("Ledger proof-source inventory resolved empty");
    expect(runner).not.toContain("readonly -a proof_sources=(");
    expect(runner).toContain('cleanup-ci-callsite.sh" auto-run');
    expect(runner).toContain("--lane ledger-emulator-proof");
    expect(workflow).toContain("Verify Ledger emulator cleanup receipt");
    expect(workflow).toContain(
      "cleanup-ledger-emulator-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain(
      "uses: ./.github/actions/verify-cleanup-receipt",
    );
    expect(workflow).toContain(
      "root: ${{ runner.temp }}/sanctuary-cleanup-artifacts/${{ github.run_id }}-${{ github.run_attempt }}/ledger-emulator-proof",
    );
  });
});
