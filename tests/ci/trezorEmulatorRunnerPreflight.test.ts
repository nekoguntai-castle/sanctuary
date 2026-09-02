import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
state='${workspace}/mock-container-state'
labels_file='${workspace}/mock-container-labels'
name_file='${workspace}/mock-container-name'
container_id='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
if [ "\${1:-}" = 'context' ]; then
  printf '%s\\n' 'unix:///var/run/docker.sock'
elif [ "\${1:-}" = 'version' ]; then
  if [ "\${MOCK_DOCKER_ENGINE:-docker}" = 'podman' ]; then
    printf '%s\\n' '{"Client":{"Version":"28.0.0","ApiVersion":"1.48","Os":"linux","Arch":"amd64"},"Server":{"Version":"5.4.2","ApiVersion":"1.41","MinAPIVersion":"1.24","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"5.4.2"}]}}'
  else
    printf '%s\\n' '{"Client":{"Version":"28.0.0","ApiVersion":"1.48","Os":"linux","Arch":"amd64"},"Server":{"Version":"28.0.0","ApiVersion":"1.48","MinAPIVersion":"1.24","Os":"linux","Arch":"amd64"}}'
  fi
elif [ "\${1:-}" = 'inspect' ] || { [ "\${1:-}" = 'container' ] && [ "\${2:-}" = 'inspect' ]; }; then
  if [ ! -f "$state" ]; then exit 1; fi
  if [[ "$*" == *'{{.State.Running}}'* ]]; then
    exit "\${MOCK_STATE_INSPECT_STATUS:-1}"
  fi
  labels="$(jq -Rn '[inputs | capture("(?<key>[^=]+)=(?<value>.*)") | {(.key): .value}] | add' < "$labels_file")"
  container_name="$(cat "$name_file")"
  container_state="$(cat "$state")"
  jq -n --arg id "$container_id" --arg name "/$container_name" \
    --arg image '${expectedConfigDigest}' --arg status "$container_state" --argjson labels "$labels" \
    '[{Id:$id,Name:$name,Image:$image,Config:{Labels:$labels},State:{Status:$status,Running:($status == "started")}}]'
elif [ "\${1:-}" = 'pull' ]; then
  exit 0
elif [ "\${1:-}" = 'create' ]; then
  printf 'PODMAN_CREATE_ARGS:%s\\n' "$*" >&2
  if [ "\${MOCK_RUN_SUCCEEDS:-0}" = '1' ] || [ "\${MOCK_CREATE_RESPONSE_LOSS:-0}" = '1' ]; then
    : > "$labels_file"
    cidfile=''
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --cidfile) cidfile="$2"; shift 2 ;;
        --label) printf '%s\\n' "$2" >> "$labels_file"; shift 2 ;;
        --name) printf '%s\\n' "$2" > "$name_file"; shift 2 ;;
        *) shift ;;
      esac
    done
    printf 'created\\n' > "$state"
    printf '%s\\n' "$container_id" > "$cidfile"
    if [ "\${MOCK_CREATE_RESPONSE_LOSS:-0}" = '1' ]; then exit 74; fi
    printf '%s\\n' "$container_id"
    exit 0
  fi
  exit 73
elif [ "\${1:-}" = 'start' ]; then
  printf 'started\\n' > "$state"
  printf '%s\\n' "$container_id"
elif [ "\${1:-}" = 'container' ] && [ "\${2:-}" = 'ls' ]; then
  [ ! -f "$state" ] || printf '%s\\n' "$container_id"
elif [ "\${1:-}" = 'exec' ]; then
  exit 1
elif [ "\${1:-}" = 'logs' ]; then
  exit 0
elif [ "\${1:-}" = 'stop' ]; then
  printf '%s\\n' "$*" > '${workspace}/stop-invocation'
  if [ "\${MOCK_STOP_LEAVES_PRESENT:-0}" != '1' ]; then rm -f "$state"; fi
  if [ "\${MOCK_STOP_RESPONSE_LOSS:-0}" = '1' ]; then exit 74; fi
  printf '%s\\n' "$container_id"
elif [ "\${1:-}" = 'rm' ] && [ "\${2:-}" = '-f' ]; then
  exit 0
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
): { status: number | null; stderr: string; durationMs: number } => {
  const startedAt = Date.now();
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
        SANCTUARY_CLEANUP_COORDINATED: "1",
        SANCTUARY_OWNERSHIP_ROOT: path.join(workspace, "ownership"),
        ...overrides,
      },
    },
  );
  return {
    status: result.status,
    stderr: result.stderr,
    durationMs: Date.now() - startedAt,
  };
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

    expect(result.status, result.stderr).toBe(73);
    expect(result.stderr).toContain("PODMAN_CREATE_ARGS:create --rm --cidfile");
    const createArguments = result.stderr.match(/PODMAN_CREATE_ARGS:[^\n]*/)?.[0];
    expect(createArguments).not.toContain(" -p ");
    expect(createArguments).not.toContain("--network");
    expect(createArguments).toContain(
      ".venv/bin/python src/main.py",
    );
  });

  it("retires the durable exact ID when create loses its response", () => {
    const result = runProof("create-response-loss", {
      MOCK_DOCKER_ENGINE: "podman",
      MOCK_CREATE_RESPONSE_LOSS: "1",
    });

    expect(result.status).toBe(74);
    expect(readFileSync(path.join(workspace, "stop-invocation"), "utf8"))
      .toContain("stop --timeout 10 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const evidence = path.join(
      workspace,
      ".tmp/ci-evidence/trezor-emulator/create-response-loss-1/diagnostics/registered-transient.json",
    );
    expect(readFileSync(evidence, "utf8")).toContain('"postcondition": "absent"');
  });

  it("accepts a lost stop response only when exact absence is proven", () => {
    const result = runProof("stop-response-loss", {
      MOCK_DOCKER_ENGINE: "podman",
      MOCK_CREATE_RESPONSE_LOSS: "1",
      MOCK_STOP_RESPONSE_LOSS: "1",
    });

    expect(result.status).toBe(74);
    const evidence = path.join(
      workspace,
      ".tmp/ci-evidence/trezor-emulator/stop-response-loss-1/diagnostics/registered-transient.json",
    );
    expect(readFileSync(evidence, "utf8")).toContain('"postcondition": "absent"');
  });

  it("fails cleanup when a lost stop response leaves the container present", () => {
    const result = runProof("stop-response-ambiguous", {
      MOCK_DOCKER_ENGINE: "podman",
      MOCK_CREATE_RESPONSE_LOSS: "1",
      MOCK_STOP_RESPONSE_LOSS: "1",
      MOCK_STOP_LEAVES_PRESENT: "1",
    });

    expect(result.status).toBe(74);
    expect(result.stderr).toContain("removal is unproven");
    expect(result.stderr).toContain("stop=74");
  });

  it("preserves diagnostics and fails fast when the controller container exits", () => {
    writeExecutable(
      "docker",
      `#!/usr/bin/env bash
set -euo pipefail
state='${workspace}/container-state'
labels_file='${workspace}/container-labels'
name_file='${workspace}/container-name'
config_digest='${expectedConfigDigest}'
if [ "\${1:-}" = 'context' ]; then
  printf '%s\n' 'unix:///var/run/docker.sock'
elif [ "\${1:-}" = 'version' ]; then
  printf '%s\n' '{"Client":{"Version":"28.0.0","ApiVersion":"1.48","Os":"linux","Arch":"amd64"},"Server":{"Version":"5.4.2","ApiVersion":"1.41","MinAPIVersion":"1.24","Os":"linux","Arch":"amd64","Components":[{"Name":"Podman Engine","Version":"5.4.2"}]}}'
elif [ "\${1:-}" = 'image' ] && [ "\${2:-}" = 'inspect' ]; then
  printf '[{"RepoDigests":["ghcr.io/trezor/trezor-user-env@${expectedImageDigest}"],"Id":"%s","Os":"linux","Architecture":"amd64"}]\n' "$config_digest"
elif [ "\${1:-}" = 'create' ]; then
  printf 'created' > "$state"
  : > "$labels_file"
  while [ "$#" -gt 0 ]; do
      case "$1" in
        --cidfile) cidfile="$2"; shift 2 ;;
        --label) printf '%s\n' "$2" >> "$labels_file"; shift 2 ;;
        --name) printf '%s\n' "$2" > "$name_file"; shift 2 ;;
        *) shift ;;
    esac
  done
  printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' > "$cidfile"
  printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
elif [ "\${1:-}" = 'start' ]; then
  printf 'started' > "$state"
  printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
elif [ "\${1:-}" = 'inspect' ] || { [ "\${1:-}" = 'container' ] && [ "\${2:-}" = 'inspect' ]; }; then
  if [ ! -f "$state" ]; then exit 1; fi
  if [[ "$*" == *'{{.State.Running}}'* ]]; then
    printf '%s\n' 'false'
  elif [ "$(cat "$state")" = 'started' ]; then
    printf 'inspected' > "$state"
    printf '[{"Image":"%s","State":{"Running":true}}]\n' "$config_digest"
  else
    labels="$(jq -Rn '[inputs | capture("(?<key>[^=]+)=(?<value>.*)") | {(.key): .value}] | add' < "$labels_file")"
    jq -n --arg id 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
      --arg name "/$(cat "$name_file")" --arg image "$config_digest" --argjson labels "$labels" \
      '[{Id:$id,Name:$name,Image:$image,Config:{Labels:$labels},State:{Status:"created",Running:false,ExitCode:137,OOMKilled:true,Error:""}}]'
  fi
elif [ "\${1:-}" = 'container' ] && [ "\${2:-}" = 'ls' ]; then
  [ ! -f "$state" ] || printf '%s\n' 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
elif [ "\${1:-}" = 'exec' ]; then
  exit 1
elif [ "\${1:-}" = 'logs' ]; then
  printf '%s\n' 'controller process exited'
elif [ "\${1:-}" = 'stop' ]; then
  printf '%s\n' "$*" > '${workspace}/stop-invocation'
  rm -f "$state"
else
  echo "Unexpected docker invocation: $*" >&2
  exit 91
fi
`,
    );

    const result = runProof("early-container-exit", {
      MOCK_DOCKER_ENGINE: "podman",
    });

    expect(result.status).toBe(1);
    expect(result.durationMs).toBeLessThan(10_000);
    expect(result.stderr).toContain("Trezor User Env exited before readiness");
    const diagnostics = path.join(
      workspace,
      ".tmp/ci-evidence/trezor-emulator/early-container-exit-1/diagnostics",
    );
    expect(JSON.parse(readFileSync(
      path.join(diagnostics, "container-terminal-inspect.json"),
      "utf8",
    ))[0].State.OOMKilled).toBe(true);
    expect(
      readFileSync(path.join(diagnostics, "trezor-user-env.log"), "utf8"),
    ).toContain("controller process exited");
    expect(
      readFileSync(path.join(workspace, "stop-invocation"), "utf8"),
    ).toContain("stop --timeout 10 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(
      readFileSync(path.join(diagnostics, "registered-transient.json"), "utf8"),
    ).toContain('"postcondition": "absent"');
  });

  it("distinguishes a readiness inspect failure from a container exit", () => {
    const result = runProof("inspect-failure", {
      MOCK_DOCKER_ENGINE: "podman",
      MOCK_RUN_SUCCEEDS: "1",
      MOCK_STATE_INSPECT_STATUS: "125",
    });

    expect(result.status).toBe(1);
    expect(result.durationMs).toBeLessThan(10_000);
    expect(result.stderr).toContain(
      "Unable to inspect Trezor User Env readiness state (exit=125)",
    );
    expect(result.stderr).not.toContain("exited before readiness");
  });
});
