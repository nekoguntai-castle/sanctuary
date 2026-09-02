import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const read = (file: string): string =>
  readFileSync(path.join(repoRoot, file), "utf8");
const runnerSource = read("scripts/ci/run-jade-emulator-proof.sh");
const manifest = JSON.parse(read("config/jade-emulator-proof.json")) as {
  schemaVersion: number;
  platform: string;
  firmware: Record<string, string>;
  builder: { image: string };
  qemu: {
    configArgs: string;
    machine: string;
    serialPort: number;
    webDisplayPort: number;
  };
  sdk: { cborX: string; cborXIntegrity: string };
  runtimeCompatibility: Record<string, string>;
  submodules: Array<Record<string, string>>;
};

function shellFunction(name: string): string {
  const lines = runnerSource.split("\n");
  const start = lines.findIndex((line) => line === `${name}() {`);
  if (start < 0) throw new Error(`Missing shell function: ${name}`);
  const endOffset = lines.slice(start + 1).findIndex((line) => line === "}");
  if (endOffset < 0) throw new Error(`Unterminated shell function: ${name}`);
  return lines.slice(start, start + endOffset + 2).join("\n");
}

function runJadeMissingIdentityScenario(
  createStatus: number,
  recoveryStatus: number,
) {
  return spawnSync(
    "bash",
    [
      "-c",
      `set -u
recover_exact_created_container() { return "$RECOVERY_STATUS"; }
${shellFunction("resolve_jade_created_container")}
resolve_status=0
active_container_id="$(resolve_jade_created_container test-jade /nonexistent/cid "$CREATE_STATUS")" || resolve_status=$?
container_started=0
if [[ "$active_container_id" =~ ^[0-9a-f]{64}$ ]]; then container_started=1; fi
if [ "$container_started" -ne 1 ]; then
  [ "$resolve_status" -ne 0 ] && exit "$resolve_status"
  [ "$CREATE_STATUS" -ne 0 ] && exit "$CREATE_STATUS"
  exit 1
fi`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        CREATE_STATUS: String(createStatus),
        RECOVERY_STATUS: String(recoveryStatus),
      },
    },
  );
}

describe("pinned Jade QEMU proof configuration", () => {
  it("preserves create and recovery failures when no exact ID is recovered", () => {
    expect(runJadeMissingIdentityScenario(23, 42).status).toBe(23);
    expect(runJadeMissingIdentityScenario(0, 42).status).toBe(42);
  });

  it("pins the exact vendor source, Dockerfile, builder parent, platform, and QEMU contract", () => {
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      platform: "linux/amd64",
    });
    expect(manifest.firmware.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest.firmware.buildVersionTag).toBe(manifest.firmware.release);
    expect(manifest.firmware.runtimeVersion).toBe(manifest.firmware.release);
    expect(manifest.firmware.sourceTarball).toContain(
      manifest.firmware.sourceCommit,
    );
    expect(manifest.firmware.sourceTarball).toMatch(
      /^https:\/\/codeload\.github\.com\//,
    );
    expect(manifest.firmware.sourceTarballSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.firmware.dockerfileSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.builder.image).toMatch(
      /^blockstream\/jade_builder@sha256:[0-9a-f]{64}$/,
    );
    expect(manifest.submodules).toHaveLength(5);
    for (const submodule of manifest.submodules) {
      expect(submodule.path).toMatch(/^components\//);
      expect(submodule.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(submodule.sourceTarball).toContain(submodule.sourceCommit);
      expect(submodule.sourceTarball).toMatch(
        /^https:\/\/codeload\.github\.com\//,
      );
      expect(submodule.sourceTarballSha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.qemu).toEqual({
      configArgs: "--dev --ci --psram",
      machine: "esp32",
      serialPort: 30121,
      webDisplayPort: 30122,
    });
  });

  it("binds the production CBOR package and exact runner toolchain", () => {
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string; integrity?: string }>;
    };
    expect(lock.packages["node_modules/cbor-x"]).toMatchObject({
      version: manifest.sdk.cborX,
      integrity: manifest.sdk.cborXIntegrity,
    });
    expect(manifest.runtimeCompatibility.node).toBe(read(".nvmrc").trim());
    expect(JSON.parse(read("package.json")).packageManager).toBe(
      `npm@${manifest.runtimeCompatibility.npm}`,
    );
  });

  it("downloads and verifies source, builds without bind mounts, and attests runtime artifacts", () => {
    const runner = read("scripts/ci/run-jade-emulator-proof.sh");
    const workflow = read(".github/workflows/verify-vectors.yml");
    for (const required of [
      "sourceTarballSha256",
      "scripts/ci/download-verified-source.sh",
      "dockerfileSha256",
      "FROM $expected_builder",
      "GitHub source archives omit Git metadata",
      "docker buildx build",
      '--build-arg "QEMU_CONFIG_ARGS=$config_args"',
      "/jade/build/jade.bin /jade/build/jade.elf /flash_image.bin",
      "qemu-system-xtensa",
      "JADE_EMULATOR_PROOF=1",
      "config/tooling/vitest.jade-emulator.config.ts",
      "verify-jade-junit.mjs",
      "--slurpfile verifiedJunit",
      "($verifiedJunit[0] + {",
      "proof-sources.sha256",
      "network-${network}.json",
      "cleanBoot: true",
      "controller_ready=0",
      "Jade QEMU controller did not become ready",
      "cleanBootPerNetwork: true",
      "networkProofs: [$mainnetProof[0], $testnetProof[0]]",
      "hardware-emulator-source-inventory.mjs",
      "list --vendor jade --format lines --require-clean",
      "if ! proof_sources_text=",
      "Jade proof-source inventory resolved empty",
      "scripts/ci/verify-jade-junit.mjs",
      "ownership_label_args compose_container exact_delete",
      'retire_registered_transient "$active_container_id" "$network"',
      "postcondition: $postcondition",
      '"$evidence_name" absent',
      '"$evidence_name" already-absent',
      "container_absence_proven",
      "container ls -a --no-trunc",
      "|| stop_status=$?",
      "stop=$stop_status, inspect=$absence_status",
      "subjectExitCode: $subjectExitCode",
      "cleanupExitCode: $cleanupExitCode",
      'exit "$final_status"',
      'cleanup-ci-callsite.sh" auto-run',
      "--lane jade-emulator-proof",
    ])
      expect(runner).toContain(required);
    expect(runner).not.toMatch(/retire_registered_transient[^\n]+\|\| true/);
    expect(runner).not.toContain("trap cleanup EXIT INT TERM");
    expect(runner).toContain("docker create --rm");
    expect(runner).toContain(
      'readonly image="localhost/sanctuary-jade-qemu:proof-${run_identity}"',
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
    expect(runner).toContain('--cidfile "$active_cidfile"');
    expect(runner).toContain('docker start "$active_container_id"');
    expect(runner).toContain(
      "create output disagrees with its durable container ID",
    );
    expect(runner).toContain(
      'recover_exact_created_container "$container_name"',
    );
    expect(runner).toContain("|| resolve_status=$?");
    expect(runner).toContain(
      "Jade QEMU cidfile contains an invalid container ID",
    );
    expect(runner).toContain(
      "Jade QEMU cidfile disagrees with the exact created container",
    );
    expect(runner.indexOf("container_registered=1")).toBeLessThan(
      runner.indexOf('[ "$resolve_status" -eq 0 ] || exit "$resolve_status"'),
    );
    expect(
      runner.indexOf('recover_exact_created_container "$container_name"'),
    ).toBeLessThan(
      runner.indexOf('[ "$create_status" -eq 0 ] || exit "$create_status"'),
    );
    expect(runner).toContain('.[0].Name == ("/" + $name)');
    expect(runner).toContain(
      "register_owned_resource compose_container obsolete exact_delete engine_id",
    );
    expect(runner).not.toContain("docker rm");
    expect(runner).not.toContain("readonly -a proof_sources=(");
    expect(runner).not.toContain("curl --fail --location");
    expect(runner).not.toContain("testCount: 3");
    expect(runner).not.toMatch(/docker create[^\n]*(?:-v|--volume|--mount)/);
    expect(runner).not.toContain("docker build -v");
    expect(runner).not.toContain("--entrypoint qemu-system-xtensa");
    expect(runner).toContain('"$image" qemu-system-xtensa --version');
    expect(workflow).toContain("Verify Jade QEMU cleanup receipt");
    expect(workflow).toContain(
      "cleanup-jade-emulator-${{ github.run_id }}-${{ github.run_attempt }}",
    );
    expect(workflow).toContain(
      "uses: ./.github/actions/verify-cleanup-receipt",
    );
    expect(workflow).toContain(
      "root: ${{ runner.temp }}/sanctuary-cleanup-artifacts/${{ github.run_id }}-${{ github.run_attempt }}/jade-emulator-proof",
    );
  });

  it("runs the production protocol session proof on both Bitcoin coin families", () => {
    const integration = read(
      "tests/integration/jadeEmulator.integration.test.ts",
    );
    expect(integration).toContain(
      "from '../../src/services/hardwareWallet/adapters/jadeProtocol'",
    );
    expect(integration).toContain("session.authenticate");
    expect(integration).toContain("session.rpc('get_xpub'");
    expect(integration).toContain("session.rpc('get_receive_address'");
    expect(integration).toContain("session.signPsbt");
    expect(integration).toContain("masterFingerprintFromRootXpub");
    expect(integration).toContain("assertJadeAccountXpubChain");
    expect(integration).toContain("validatePsbtSigningRequest");
    expect(integration).toContain("validateJadeSignedPsbt");
    const runner = read("scripts/ci/run-jade-emulator-proof.sh");
    expect(runner).toContain("for network in mainnet testnet");
    expect(runner).toContain("junit-jade-${network}.xml");
    expect(runner).toContain("node scripts/ci/verify-jade-junit.mjs");
  });
});
