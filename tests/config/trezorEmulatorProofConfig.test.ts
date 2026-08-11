import { readFileSync } from "node:fs";
import path from "node:path";
import TrezorConnectWeb, { asDeviceUniquePath } from "@trezor/connect-web";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
interface TrezorProofManifest {
  schemaVersion: number;
  image: string;
  imageDigest: string;
  imageIndexDigest: string;
  imageConfigDigest: string;
  platform: string;
  connect: string;
  connectIntegrity: string;
  connectWebIntegrity: string;
  runtimeCompatibility: {
    node: string;
    npm: string;
    runnerOs: string;
    runnerArchitecture: string;
    dockerClientMinimumApiVersion: string;
    dockerServerMinimumApiVersion: string;
    dockerServerOs: string;
    dockerServerArchitecture: string;
  };
  [key: string]: unknown;
}

const readManifest = (): TrezorProofManifest =>
  JSON.parse(
    readFileSync(
      path.join(repoRoot, "config/trezor-emulator-proof.json"),
      "utf8",
    ),
  ) as TrezorProofManifest;

describe("Trezor emulator proof test configuration", () => {
  it("uses a Node-only configuration without the browser setup file", () => {
    const config = readFileSync(
      path.join(repoRoot, "config/tooling/vitest.trezor-emulator.config.ts"),
      "utf8",
    );
    const browserConfig = readFileSync(
      path.join(repoRoot, "config/tooling/vitest.config.ts"),
      "utf8",
    );
    const runner = readFileSync(
      path.join(repoRoot, "scripts/ci/run-trezor-emulator-proof.sh"),
      "utf8",
    );
    const manifest = readManifest();
    const fixture = readFileSync(
      path.join(repoRoot, "tests/fixtures/trezorEmulatorProof.ts"),
      "utf8",
    );

    expect(config).toContain("environment: 'node'");
    expect(config).not.toContain("tests/setup.ts");
    expect(browserConfig).toContain(
      "import { configDefaults, defineConfig } from 'vitest/config'",
    );
    expect(browserConfig).toContain("...configDefaults.exclude");
    expect(browserConfig).toContain(
      "'tests/integration/trezorEmulator.integration.test.ts'",
    );
    expect(runner).toContain(
      "--config config/tooling/vitest.trezor-emulator.config.ts",
    );
    expect(runner).toContain(
      "proof_manifest='config/trezor-emulator-proof.json'",
    );
    for (const key of ["model", "firmware", "bridge", "connect"]) {
      expect(fixture).toContain(`${key}: '${String(manifest[key])}'`);
    }
  });

  it("pins an exact linux/amd64 child image and exact Connect package integrities", () => {
    const manifest = readManifest();
    const packageLock = JSON.parse(
      readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"),
    ) as { packages: Record<string, { version?: string; integrity?: string }> };

    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.platform).toBe("linux/amd64");
    expect(manifest.imageDigest).toBe(
      "sha256:de72f49d7db85f27d51c9f7a516363a701a0c4b5e554efa632ac89fe776f8db6",
    );
    expect(manifest.imageIndexDigest).toBe(
      "sha256:851b466b22dd7d46c20dc2b4bd6a3ee016f1a492dff7d1d153c85e271e0dff90",
    );
    expect(manifest.imageConfigDigest).toBe(
      "sha256:563dbece2e5237be00fca219be2ecf4683d3c3ad48676ac951176e42fe399b42",
    );
    expect(manifest.image).toBe(
      `ghcr.io/trezor/trezor-user-env@${manifest.imageDigest}`,
    );
    for (const digest of [
      manifest.imageDigest,
      manifest.imageIndexDigest,
      manifest.imageConfigDigest,
    ]) {
      expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(manifest.imageDigest).not.toBe(manifest.imageIndexDigest);
    expect(manifest.connectIntegrity).toMatch(/^sha512-[A-Za-z0-9+/]+={0,2}$/);
    expect(manifest.connectWebIntegrity).toMatch(
      /^sha512-[A-Za-z0-9+/]+={0,2}$/,
    );

    const connect = packageLock.packages["node_modules/@trezor/connect"];
    const connectWeb = packageLock.packages["node_modules/@trezor/connect-web"];
    expect(connect.version).toBe(manifest.connect);
    expect(connectWeb.version).toBe(manifest.connect);
    expect(connect.integrity).toBe(manifest.connectIntegrity);
    expect(connectWeb.integrity).toBe(manifest.connectWebIntegrity);
  });

  it("pins the Node toolchain and declares bounded runner compatibility", () => {
    const manifest = readManifest();
    const workflow = readFileSync(
      path.join(repoRoot, ".github/workflows/verify-vectors.yml"),
      "utf8",
    );
    const runner = readFileSync(
      path.join(repoRoot, "scripts/ci/run-trezor-emulator-proof.sh"),
      "utf8",
    );
    const nvmrc = readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim();
    const packageJson = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { packageManager: string };

    expect(manifest.runtimeCompatibility.node).toBe(nvmrc);
    expect(manifest.runtimeCompatibility.npm).toBe("11.19.0");
    expect(packageJson.packageManager).toBe(
      `npm@${manifest.runtimeCompatibility.npm}`,
    );
    expect(workflow).toContain(`NODE_VERSION: '${nvmrc}'`);
    expect(workflow).toContain(
      `NPM_VERSION: '${manifest.runtimeCompatibility.npm}'`,
    );
    expect(workflow).toContain("install-npm: 'false'");
    expect(workflow).toContain("verify-trezor-emulator:");
    expect(workflow).toMatch(
      /- name: Run pinned Trezor emulator proof\n(?:\s+#.*\n){3}\s+timeout-minutes: 40/,
    );
    expect(manifest.runtimeCompatibility).toMatchObject({
      runnerOs: "Linux",
      runnerArchitecture: "x86_64",
      dockerServerOs: "linux",
      dockerServerArchitecture: "amd64",
    });
    expect(manifest.runtimeCompatibility.dockerClientMinimumApiVersion).toMatch(
      /^[0-9]+[.][0-9]+$/,
    );
    expect(manifest.runtimeCompatibility.dockerServerMinimumApiVersion).toMatch(
      /^[0-9]+[.][0-9]+$/,
    );
    expect(runner).toContain("Trezor proof Node drift");
    expect(runner).toContain("Trezor proof npm drift");
    expect(runner).toContain("Unsupported Docker APIs");
    expect(runner).toContain("Unsupported Docker server");
  });

  it("isolates proof from failure diagnostics and redacts the test mnemonic", () => {
    const config = readFileSync(
      path.join(repoRoot, "config/tooling/vitest.trezor-emulator.config.ts"),
      "utf8",
    );
    const runner = readFileSync(
      path.join(repoRoot, "scripts/ci/run-trezor-emulator-proof.sh"),
      "utf8",
    );

    expect(runner).toContain('readonly proof_dir="${attempt_dir}/proof"');
    expect(runner).toContain(
      'readonly diagnostics_dir="${attempt_dir}/diagnostics"',
    );
    expect(runner).toContain('if ! mkdir "$attempt_dir"; then');
    expect(runner.indexOf('if ! mkdir "$attempt_dir"; then')).toBeLessThan(
      runner.indexOf("trap cleanup EXIT"),
    );
    expect(runner).toContain("ci_emit_env \\");
    expect(runner).toContain('"TREZOR_EMULATOR_PROOF_DIR=$proof_dir"');
    expect(runner).toContain(
      '"TREZOR_EMULATOR_DIAGNOSTICS_DIR=$diagnostics_dir"',
    );
    expect(config).toContain("process.env.TREZOR_EMULATOR_JUNIT_PATH");
    expect(runner).toContain(
      'export TREZOR_EMULATOR_JUNIT_PATH="$diagnostics_dir/junit-trezor-emulator.xml"',
    );
    expect(runner).not.toContain("cp junit-trezor-emulator.xml");
    expect(runner).toContain(
      'pull --platform "$TREZOR_PLATFORM" "$TREZOR_IMAGE"',
    );
    expect(runner).toContain("trezor_image_is_attested");
    expect(runner).toContain("Using preloaded Trezor User Env image");
    expect(runner).toContain("run_bounded_docker");
    expect(runner).toContain("start Trezor User Env container");
    expect(runner).toContain("docker_start_timeout_seconds=180");
    expect(runner).toContain("TREZOR_IMAGE_CONFIG_DIGEST");
    expect(runner).toContain("TREZOR_CONNECT_INTEGRITY");
    expect(runner).toContain("TREZOR_CONNECT_WEB_INTEGRITY");
    expect(runner).toContain("[REDACTED TEST MNEMONIC]");
    expect(runner).toContain("[REDACTED RUNNER]");
    expect(runner).toMatch(
      /controller_command '\{"type":"emulator-setup"[^\n]+>\/dev\/null/,
    );
    expect(runner).not.toMatch(
      /docker logs[^\n]+> "\$[^\n]+trezor-user-env\.log"/,
    );
  });

  it("self-binds proof provenance to the run, commit, lockfile, and critical sources", () => {
    const runner = readFileSync(
      path.join(repoRoot, "scripts/ci/run-trezor-emulator-proof.sh"),
      "utf8",
    );

    for (const field of [
      "commitSha",
      "runId",
      "runAttempt",
      "capturedAt",
      "packageLockSha256",
      "nodeVersion",
      "npmVersion",
      "runnerArchitecture",
      "dockerRuntime",
      "sourceManifest",
    ]) {
      expect(runner).toContain(field);
    }
    for (const source of [
      ".github/actions/setup-node-toolchain/action.yml",
      ".github/workflows/verify-vectors.yml",
      ".nvmrc",
      "package.json",
      "package-lock.json",
      "scripts/ci/ensure-node.sh",
      "scripts/ci/check-trezor-transport-provenance.sh",
      "scripts/ci/docker-exec-tcp-forwarder.mjs",
      "scripts/ci/images/go-runner.Dockerfile",
      "scripts/ci/provider-context.sh",
      "scripts/ci/resolve-trezor-publish-binding.sh",
      "scripts/ci/run-trezor-emulator-proof.sh",
      "tests/ci/dockerExecTcpForwarder.test.ts",
      "tests/ci/trezorEmulatorRunnerPreflight.test.ts",
      "config/trezor-emulator-proof.json",
      "config/tooling/vitest.trezor-emulator.config.ts",
      "tests/fixtures/trezorEmulatorProof.ts",
      "tests/config/trezorEmulatorProofBinding.test.ts",
      "tests/config/trezorEmulatorProofConfig.test.ts",
      "tests/integration/trezorEmulator.integration.test.ts",
      "tests/integration/trezorEmulator/proofReplay.ts",
      "src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts",
      "src/services/hardwareWallet/identity.ts",
      "src/services/hardwareWallet/psbtAccountBinding.ts",
    ]) {
      expect(runner).toContain(source);
    }
    expect(runner).toContain("Workflow commit differs from checked-out HEAD");
    const workflow = readFileSync(
      path.join(repoRoot, ".github/workflows/verify-vectors.yml"),
      "utf8",
    );
    expect(workflow).toContain(
      "SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE: ${{ github.run_attempt }}",
    );
  });

  it("loads the production Connect-Web entrypoint and locks its initialization contract", () => {
    const adapter = readFileSync(
      path.join(
        repoRoot,
        "src/services/hardwareWallet/adapters/trezor/trezorAdapter.ts",
      ),
      "utf8",
    );
    const sessionIdentity = readFileSync(
      path.join(
        repoRoot,
        "src/services/hardwareWallet/adapters/trezor/sessionIdentity.ts",
      ),
      "utf8",
    );

    expect(TrezorConnectWeb.init).toBeTypeOf("function");
    expect(TrezorConnectWeb.getAddress).toBeTypeOf("function");
    expect(TrezorConnectWeb.signTransaction).toBeTypeOf("function");
    expect(asDeviceUniquePath).toBeTypeOf("function");
    expect(adapter).toContain(
      "import TrezorConnect from '@trezor/connect-web'",
    );
    expect(adapter).toContain("coreMode: 'auto'");
    expect(sessionIdentity).toContain("from '@trezor/connect-web'");
  });
});
