import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const expectedCommit = "a".repeat(40);
const otherCommit = "b".repeat(40);
const expectedImageDigest =
  "sha256:de72f49d7db85f27d51c9f7a516363a701a0c4b5e554efa632ac89fe776f8db6";
const expectedConfigDigest =
  "sha256:563dbece2e5237be00fca219be2ecf4683d3c3ad48676ac951176e42fe399b42";

let workspace = "";
let mockBin = "";

const writeExecutable = (name: string, contents: string): void => {
  const target = path.join(mockBin, name);
  writeFileSync(target, contents);
  chmodSync(target, 0o755);
};

const createWorkspace = (): void => {
  workspace = mkdtempSync(path.join(tmpdir(), "trezor-runner-preflight-"));
  mockBin = path.join(workspace, "mock-bin");
  mkdirSync(path.join(workspace, "config"), { recursive: true });
  mkdirSync(path.join(workspace, "scripts/ci"), { recursive: true });
  mkdirSync(mockBin);
  copyFileSync(
    path.join(repoRoot, "config/trezor-emulator-proof.json"),
    path.join(workspace, "config/trezor-emulator-proof.json"),
  );
  copyFileSync(
    path.join(repoRoot, "scripts/ci/resolve-trezor-publish-binding.sh"),
    path.join(workspace, "scripts/ci/resolve-trezor-publish-binding.sh"),
  );
  writeFileSync(path.join(workspace, ".nvmrc"), "24.19.0\n");
  writeFileSync(
    path.join(workspace, "package.json"),
    JSON.stringify({ packageManager: "npm@11.19.0" }),
  );
};

const installCommandMocks = (): void => {
  writeExecutable(
    "node",
    `#!/usr/bin/env bash
printf 'v%s\\n' "\${MOCK_NODE_VERSION:-24.19.0}"
`,
  );
  writeExecutable(
    "npm",
    `#!/usr/bin/env bash
printf '%s\\n' "\${MOCK_NPM_VERSION:-11.19.0}"
`,
  );
  writeExecutable(
    "git",
    `#!/usr/bin/env bash
printf '%s\\n' '${expectedCommit}'
`,
  );
  writeExecutable(
    "docker",
    `#!/usr/bin/env bash
set -euo pipefail
if [ "\${1:-}" = 'context' ]; then
  printf '%s\\n' 'unix:///var/run/docker.sock'
elif [ "\${1:-}" = 'version' ]; then
  if [ "\${MOCK_DOCKER_ENGINE:-docker}" = 'podman' ]; then
    printf '%s\\n' '{"Client":{"Version":"28.0.0","ApiVersion":"1.48","Os":"linux","Arch":"amd64"},"Server":{"Version":"5.4.2","ApiVersion":"1.41","MinAPIVersion":"1.24","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"5.4.2"}]}}'
  else
    printf '%s\\n' '{"Client":{"Version":"28.0.0","ApiVersion":"1.48","Os":"linux","Arch":"amd64"},"Server":{"Version":"28.0.0","ApiVersion":"1.48","MinAPIVersion":"1.24","Os":"linux","Arch":"amd64"}}'
  fi
elif [ "\${1:-}" = 'inspect' ]; then
  exit 1
elif [ "\${1:-}" = 'pull' ]; then
  exit 0
elif [ "\${1:-}" = 'run' ]; then
  printf 'PODMAN_RUN_ARGS:%s\\n' "$*" >&2
  exit 73
elif [ "\${1:-}" = 'image' ] && [ "\${2:-}" = 'inspect' ]; then
  case "$*" in
    *'join .RepoDigests'*)
      printf 'ghcr.io/trezor/trezor-user-env@%s\\n' "\${MOCK_IMAGE_DIGEST:-${expectedImageDigest}}"
      ;;
    *'{{.Id}}'*) printf '%s\\n' "\${MOCK_CONFIG_DIGEST:-${expectedConfigDigest}}" ;;
    *'{{.Os}}/{{.Architecture}}'*) printf '%s\\n' 'linux/amd64' ;;
    *) printf '[{"RepoDigests":["ghcr.io/trezor/trezor-user-env@%s"],"Id":"%s","Os":"linux","Architecture":"amd64"}]\\n' \\
         "\${MOCK_IMAGE_DIGEST:-${expectedImageDigest}}" \\
         "\${MOCK_CONFIG_DIGEST:-${expectedConfigDigest}}" ;;
  esac
else
  echo "Unexpected docker invocation: $*" >&2
  exit 91
fi
`,
  );
};

const runProof = (
  runId: string,
  overrides: NodeJS.ProcessEnv = {},
): { status: number | null; stderr: string } => {
  const result = spawnSync(
    "bash",
    [path.join(repoRoot, "scripts/ci/run-trezor-emulator-proof.sh")],
    {
      cwd: workspace,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH ?? ""}`,
        SANCTUARY_CI_WORKSPACE_OVERRIDE: workspace,
        SANCTUARY_CI_RUN_ID_OVERRIDE: runId,
        SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE: "1",
        SANCTUARY_CI_HEAD_SHA_OVERRIDE: expectedCommit,
        ...overrides,
      },
    },
  );
  return { status: result.status, stderr: result.stderr };
};

describe("Trezor emulator proof runner preflight", () => {
  beforeEach(() => {
    createWorkspace();
    installCommandMocks();
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it("fails closed on Node drift before contacting Docker", () => {
    const result = runProof("node-drift", { MOCK_NODE_VERSION: "24.19.1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Trezor proof Node drift");
  });

  it("fails closed on npm drift before contacting Docker", () => {
    const result = runProof("npm-drift", { MOCK_NPM_VERSION: "11.19.1" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Trezor proof npm drift");
  });

  it("refuses a stale attempt directory", () => {
    mkdirSync(
      path.join(workspace, ".tmp/ci-evidence/trezor-emulator/stale-attempt-1"),
      { recursive: true },
    );

    const result = runProof("stale-attempt");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Refusing stale Trezor evidence directory");
  });

  it("rejects a checked-out commit that differs from workflow provenance", () => {
    const result = runProof("commit-drift", {
      SANCTUARY_CI_HEAD_SHA_OVERRIDE: otherCommit,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Workflow commit differs from checked-out HEAD",
    );
  });

  it("rejects an image that does not attest the pinned child digest", () => {
    const result = runProof("image-drift", {
      MOCK_IMAGE_DIGEST: `sha256:${"0".repeat(64)}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Trezor User Env image does not attest");
  });

  it("rejects image config drift before starting a container", () => {
    const result = runProof("config-drift", {
      MOCK_CONFIG_DIGEST: `sha256:${"0".repeat(64)}`,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Trezor User Env config drift");
  });

  it("starts Podman without publishing or sharing host network ports", () => {
    const result = runProof("podman-private-transport", {
      MOCK_DOCKER_ENGINE: "podman",
    });

    expect(result.status).toBe(73);
    expect(result.stderr).toContain("PODMAN_RUN_ARGS:run --rm -d --platform");
    const runArguments = result.stderr.match(/PODMAN_RUN_ARGS:[^\n]*/)?.[0];
    expect(runArguments).not.toContain(" -p ");
    expect(runArguments).not.toContain("--network");
  });
});
