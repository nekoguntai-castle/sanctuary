import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(__dirname, "../..");
const manifestPath = path.join(repoRoot, "config/jade-protocol-harness.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  schemaVersion: number;
  vendor: {
    repository: string;
    release: string;
    sourceCommit: string;
    sourceTarball: string;
    sourceTarballSha256: string;
    sourceFiles: Record<string, string>;
  };
  runtime: { pythonVersion: string; image: string };
  authBoundary: Record<string, unknown> & {
    mode: string;
    applicationRoute: string;
    upstreamOrigin: string;
    operations: string[];
  };
  protocolLimits: Record<string, number>;
  implementationAcceptance: string[];
};

const adr = readFileSync(
  path.join(repoRoot, "docs/adr/0003-jade-plus-authentication-boundary.md"),
  "utf8",
);
const runnerPath = path.join(repoRoot, "scripts/ci/run-jade-protocol-harness.sh");
const runner = readFileSync(runnerPath, "utf8");
const harness = readFileSync(
  path.join(repoRoot, "scripts/ci/jade-vendor-protocol-harness.py"),
  "utf8",
);
const workflow = readFileSync(
  path.join(repoRoot, ".github/workflows/verify-vectors.yml"),
  "utf8",
);
const backendDockerfile = readFileSync(
  path.join(repoRoot, "server/Dockerfile"),
  "utf8",
);
const manifestValidator = path.join(
  repoRoot,
  "scripts/ci/validate-jade-protocol-manifest.jq",
);

function shellFunction(name: string): string {
  const lines = runner.split("\n");
  const start = lines.findIndex((line) => line === `${name}() {`);
  if (start < 0) throw new Error(`Missing shell function: ${name}`);
  const endOffset = lines.slice(start + 1).findIndex((line) => line === "}");
  if (endOffset < 0) throw new Error(`Unterminated shell function: ${name}`);
  return lines.slice(start, start + endOffset + 2).join("\n");
}

function runResolveScenario(cidValue?: string): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const testDir = mkdtempSync(path.join(tmpdir(), "jade-protocol-resolve-"));
  const exactId = "a".repeat(64);
  try {
    if (cidValue !== undefined) {
      writeFileSync(path.join(testDir, "container.cid"), `${cidValue}\n`);
    }
    writeFileSync(
      path.join(testDir, "container.create-output"),
      `${exactId}\n`,
    );
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -u
cidfile="$TEST_DIR/container.cid"
create_output="$TEST_DIR/container.create-output"
container_name=test-jade
container_id=''
container_identity_verified=0
recover_exact_created_container() { printf '%s\\n' "$EXACT_ID"; }
${shellFunction("resolve_created_container")}
status=0
resolve_created_container 0 || status=$?
printf 'status=%s id=%s verified=%s cid=%s\\n' "$status" "$container_id" "$container_identity_verified" "$(tr -d '\\r\\n' < "$cidfile")"
exit "$status"`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, TEST_DIR: testDir, EXACT_ID: exactId },
      },
    );
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
}

function runRetirementScenario(removeStatus: number, absenceStatus: number) {
  const exactId = "a".repeat(64);
  return spawnSync(
    "bash",
    [
      "-c",
      `set -u
assert_registered_transient() { return 0; }
container_absence_proven() { return "$ABSENCE_STATUS"; }
timeout() { return "$REMOVE_STATUS"; }
${shellFunction("retire_registered_transient")}
retire_registered_transient "$EXACT_ID" 1`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        EXACT_ID: exactId,
        REMOVE_STATUS: String(removeStatus),
        ABSENCE_STATUS: String(absenceStatus),
      },
    },
  );
}

function runCreateRegistrationScenario(createStatus: number) {
  const exactId = "a".repeat(64);
  return spawnSync(
    "bash",
    [
      "-c",
      `set -u
container_id=''
SANCTUARY_OPERATION_RUN_ID=test-run
create_protocol_container() { container_id="$EXACT_ID"; return "$CREATE_STATUS"; }
assert_registered_transient() { printf 'attested=%s\\n' "$1"; }
register_owned_resource() { printf 'registered=%s\\n' "$5"; }
${shellFunction("create_and_register_protocol_container")}
create_and_register_protocol_container`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        EXACT_ID: exactId,
        CREATE_STATUS: String(createStatus),
      },
    },
  );
}

function validateManifest(candidate: unknown): boolean {
  const result = spawnSync("jq", ["-e", "-f", manifestValidator], {
    input: JSON.stringify(candidate),
    encoding: "utf8",
  });
  return validationSucceeded(result);
}

function validationSucceeded(result: {
  error?: Error;
  status: number | null;
}): boolean {
  if (result.error || result.status === null) {
    throw result.error ?? new Error("Jade manifest validator did not exit");
  }
  return result.status === 0;
}

describe("Jade Plus authentication decision and vendor harness", () => {
  it("keeps the supervised CI harness executable", () => {
    expect(() => accessSync(runnerPath, constants.X_OK)).not.toThrow();
  });

  it("reconciles a lost remove response only through exact absence", () => {
    expect(runRetirementScenario(74, 0).status).toBe(0);

    const ambiguous = runRetirementScenario(74, 1);
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain("removal is unproven");
  });

  it("registers a recovered ID before returning a lost-create status", () => {
    const exactId = "a".repeat(64);
    const result = runCreateRegistrationScenario(74);
    expect(result.status).toBe(74);
    expect(result.stdout).toBe(`attested=${exactId}\nregistered=${exactId}\n`);
  });

  it("ships the reviewed relay boundary manifest into the backend build", () => {
    expect(backendDockerfile).toContain(
      "COPY config/jade-protocol-harness.json ./config/",
    );
  });

  it("pins the official release, every executed source, and exact Python image", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.vendor).toMatchObject({
      repository: "https://github.com/Blockstream/Jade",
      release: "1.0.40",
      sourceCommit: "6f858f39a19f89ff7fd4580c5b2db72cfe1dc0af",
    });
    expect(manifest.vendor.sourceTarball).toContain(
      manifest.vendor.sourceCommit,
    );
    expect(manifest.vendor.sourceTarball).toMatch(
      /^https:\/\/codeload\.github\.com\//,
    );
    expect(manifest.vendor.sourceTarballSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(manifest.vendor.sourceFiles)).toEqual(
      expect.arrayContaining([
        "jadepy/jade.py",
        "jadepy/jade_error.py",
        "jadepy/jade_serial.py",
        "jadepy/jade_tcp.py",
        "main/process/auth_user.c",
        "main/process/pinclient.c",
        "Dockerfile.qemu",
      ]),
    );
    for (const digest of Object.values(manifest.vendor.sourceFiles)) {
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(manifest.runtime).toEqual({
      pythonVersion: "3.13.5",
      image:
        "python:3.13.5-slim-bookworm@sha256:4c2cf9917bd1cbacc5e9b07320025bdb7cdf2df7b0ceaccb55e9dd7e30987419",
    });
  });

  it("chooses a fixed fail-closed relay instead of a device-selected proxy", () => {
    expect(manifest.authBoundary).toMatchObject({
      mode: "same-origin-fixed-relay",
      applicationRoute: "/api/v1/hardware/jade/pin",
      upstreamOrigin: "https://j8d.io",
      operations: ["get_pin", "set_pin"],
      method: "POST",
      accept: "json",
      onReply: "pin",
      maxRedirects: 0,
      automaticRetries: 0,
      requiresApplicationAuth: true,
      requiresCsrf: true,
      logBodies: false,
      customPinserver: "blocked",
      onion: "blocked",
      offline: "blocked",
    });
    expect(manifest.authBoundary).not.toHaveProperty("upstreamUrlFromDevice");
    expect(manifest.protocolLimits).toMatchObject({
      maxFrameBytes: 1_048_576,
      maxBufferedBytes: 2_097_152,
      maxExtendedDataChunks: 256,
    });
    expect(adr).toContain("Device URLs are validation input only");
    expect(adr).toContain(
      "No body, URL query, device ID, fingerprint, xpub, or PSBT logging",
    );
  });

  it("fails closed when a funds-critical relay or protocol limit drifts", () => {
    expect(validateManifest(manifest)).toBe(true);
    const mutations: Array<{
      label: string;
      apply: (candidate: typeof manifest) => void;
    }> = [
      {
        label: "schema version",
        apply: (candidate) => {
          candidate.schemaVersion = 2;
        },
      },
      {
        label: "vendor repository",
        apply: (candidate) => {
          candidate.vendor.repository = "https://example.invalid/Jade";
        },
      },
      {
        label: "vendor release",
        apply: (candidate) => {
          candidate.vendor.release = "1.0.41";
        },
      },
      {
        label: "vendor commit",
        apply: (candidate) => {
          candidate.vendor.sourceCommit = "0".repeat(40);
        },
      },
      {
        label: "vendor tarball",
        apply: (candidate) => {
          candidate.vendor.sourceTarball =
            "https://example.invalid/source.tar.gz";
        },
      },
      {
        label: "vendor tarball digest",
        apply: (candidate) => {
          candidate.vendor.sourceTarballSha256 = "0".repeat(64);
        },
      },
      {
        label: "vendor source digest",
        apply: (candidate) => {
          candidate.vendor.sourceFiles["jadepy/jade.py"] = "0".repeat(64);
        },
      },
      {
        label: "missing vendor source",
        apply: (candidate) => {
          delete candidate.vendor.sourceFiles["jadepy/jade.py"];
        },
      },
      {
        label: "unexpected vendor source",
        apply: (candidate) => {
          candidate.vendor.sourceFiles["unexpected.py"] = "0".repeat(64);
        },
      },
      {
        label: "Python version",
        apply: (candidate) => {
          candidate.runtime.pythonVersion = "3.13.6";
        },
      },
      {
        label: "Python image",
        apply: (candidate) => {
          candidate.runtime.image =
            "python:3.13.5-slim-bookworm@sha256:" + "0".repeat(64);
        },
      },
      {
        label: "relay mode",
        apply: (candidate) => {
          candidate.authBoundary.mode = "browser-direct";
        },
      },
      {
        label: "application route",
        apply: (candidate) => {
          candidate.authBoundary.applicationRoute = "/api/proxy";
        },
      },
      {
        label: "upstream origin",
        apply: (candidate) => {
          candidate.authBoundary.upstreamOrigin = "https://device.invalid";
        },
      },
      {
        label: "operations",
        apply: (candidate) => {
          candidate.authBoundary.operations = ["get_pin", "fetch"];
        },
      },
      {
        label: "HTTP method",
        apply: (candidate) => {
          candidate.authBoundary.method = "GET";
        },
      },
      {
        label: "accepted content type",
        apply: (candidate) => {
          candidate.authBoundary.accept = "text";
        },
      },
      {
        label: "reply handling",
        apply: (candidate) => {
          candidate.authBoundary.onReply = "proxy";
        },
      },
      {
        label: "request size limit",
        apply: (candidate) => {
          candidate.authBoundary.maxRequestBytes = 0;
        },
      },
      {
        label: "response size limit",
        apply: (candidate) => {
          candidate.authBoundary.maxResponseBytes = 0;
        },
      },
      {
        label: "connect timeout",
        apply: (candidate) => {
          candidate.authBoundary.connectTimeoutMs = 0;
        },
      },
      {
        label: "total timeout",
        apply: (candidate) => {
          candidate.authBoundary.totalTimeoutMs = 0;
        },
      },
      {
        label: "redirect limit",
        apply: (candidate) => {
          candidate.authBoundary.maxRedirects = 1;
        },
      },
      {
        label: "automatic retries",
        apply: (candidate) => {
          candidate.authBoundary.automaticRetries = 1;
        },
      },
      {
        label: "application authentication",
        apply: (candidate) => {
          candidate.authBoundary.requiresApplicationAuth = false;
        },
      },
      {
        label: "CSRF protection",
        apply: (candidate) => {
          candidate.authBoundary.requiresCsrf = false;
        },
      },
      {
        label: "body logging",
        apply: (candidate) => {
          candidate.authBoundary.logBodies = true;
        },
      },
      {
        label: "custom pinserver",
        apply: (candidate) => {
          candidate.authBoundary.customPinserver = "allowed";
        },
      },
      {
        label: "onion pinserver",
        apply: (candidate) => {
          candidate.authBoundary.onion = "allowed";
        },
      },
      {
        label: "offline authentication",
        apply: (candidate) => {
          candidate.authBoundary.offline = "allowed";
        },
      },
      {
        label: "frame size limit",
        apply: (candidate) => {
          candidate.protocolLimits.maxFrameBytes = 0;
        },
      },
      {
        label: "buffer size limit",
        apply: (candidate) => {
          candidate.protocolLimits.maxBufferedBytes = 0;
        },
      },
      {
        label: "extended chunk limit",
        apply: (candidate) => {
          candidate.protocolLimits.maxExtendedDataChunks = 0;
        },
      },
      {
        label: "RPC timeout",
        apply: (candidate) => {
          candidate.protocolLimits.rpcTimeoutMs = 0;
        },
      },
      {
        label: "interactive RPC timeout",
        apply: (candidate) => {
          candidate.protocolLimits.interactiveRpcTimeoutMs = 0;
        },
      },
      {
        label: "acceptance criteria",
        apply: (candidate) => {
          candidate.implementationAcceptance.pop();
        },
      },
    ];
    for (const mutation of mutations) {
      const candidate = structuredClone(manifest);
      mutation.apply(candidate);
      expect(validateManifest(candidate), mutation.label).toBe(false);
    }
    const spawnError = new Error("jq executable missing");
    expect(() =>
      validationSucceeded({ error: spawnError, status: null }),
    ).toThrow(spawnError);
    expect(() => validationSucceeded({ status: null })).toThrow(
      "Jade manifest validator did not exit",
    );
  });

  it("locks every PR10B acceptance criterion while capabilities remain blocked", () => {
    const expected = [
      "JADE-AUTH-001",
      "JADE-AUTH-002",
      "JADE-AUTH-003",
      "JADE-IDENTITY-001",
      "JADE-FRAMING-001",
      "JADE-PSBT-001",
      "JADE-PSBT-002",
      "JADE-FAILCLOSED-001",
      "JADE-IMPORT-001",
      "JADE-EVIDENCE-001",
      "JADE-MULTISIG-001",
    ];
    expect(manifest.implementationAcceptance).toEqual(expected);
    expect(new Set(manifest.implementationAcceptance).size).toBe(
      expected.length,
    );
    for (const acceptanceId of expected) {
      expect(adr).toContain(`\`${acceptanceId}\``);
    }
    expect(adr).toMatch(
      /All Jade funds-controlling capability rows are\s+therefore blocked/,
    );
    expect(adr).toContain("This ADR does not enable them");
  });

  it("executes the pinned vendor auth, binary PSBT, chunk, and error contracts in CI", () => {
    expect(harness).toContain("JadeAPI(auth_transport).auth_user");
    expect(harness).toContain("JadeAPI(psbt_transport).sign_psbt");
    expect(harness).toContain("get_extended_data");
    expect(harness).toContain("Vendor response-id correlation failed");
    expect(harness).toContain("except jade_error_module.JadeError");
    expect(runner).toContain('docker pull "$runtime_image"');
    expect(runner).toContain('cleanup-ci-callsite.sh" auto-run');
    expect(runner).toContain("docker create --rm --interactive");
    expect(runner).toContain('--cidfile "$cidfile" --name "$container_name"');
    expect(runner).toContain(
      'docker start --attach --interactive "$container_id"',
    );
    expect(runner).toContain(
      "ownership_label_args compose_container exact_delete",
    );
    expect(runner).not.toContain("--volume");
    expect(runner).toContain("--tmpfs /workspace:");
    expect(runner).toContain("--tmpfs /evidence:");
    expect(runner).toContain('tar -cf - \\\n  "$manifest"');
    expect(runner).toContain(
      'tar -xf "$evidence_root/proof-output.tar" -C "$evidence_root"',
    );
    expect(runner).not.toContain("docker run --rm --interactive");
    expect(runner).toContain("--read-only");
    expect(runner).toContain("--cap-drop ALL");
    expect(runner).toContain("JADE_PROTOCOL_PROOF_DIR");
    expect(workflow).toContain("Run pinned Jade vendor protocol harness");
    expect(workflow).toContain("npm run test:jade-protocol-harness");
    expect(workflow).toContain("${{ env.JADE_PROTOCOL_PROOF_DIR }}");
  });

  it("recovers and attests one exact container before accepting create output", () => {
    expect(runner).toContain(
      'recovered_id="$(recover_exact_created_container "$container_name")"',
    );
    expect(runner).toContain('container_id="$recovered_id"');
    expect(runner).toContain("container_identity_verified=1");
    expect(runner).toContain(
      "Jade protocol cidfile contains an invalid container ID",
    );
    expect(runner).toContain(
      "Jade protocol cidfile disagrees with the exact created container",
    );
    expect(runner).toContain('printf \'%s\\n\' "$container_id" > "$cidfile"');
    expect(runner.indexOf('container_id="$recovered_id"')).toBeLessThan(
      runner.indexOf('if [ -n "$cid_id" ]'),
    );
    expect(runner).toContain('assert_registered_transient "$container_id"');
    expect(runner).toContain(
      "register_owned_resource compose_container obsolete exact_delete engine_id",
    );
    expect(
      runner.indexOf("create_and_register_protocol_container"),
    ).toBeLessThan(runner.indexOf("docker start --attach --interactive"));
    expect(runner).toContain(".[0].Id == $id");
    expect(runner).toContain('.[0].Name == ("/" + $name)');
    for (const label of [
      "project",
      "deployment-id",
      "owner-id",
      "resource-class",
      "lifecycle",
      "cleanup-policy",
      "created-at",
      "created-by-release",
      "created-by-commit",
      "creation-run-id",
    ]) {
      expect(runner).toContain(`io.sanctuary.${label}`);
    }
  });

  it("behaviorally recovers a missing cidfile and arms malformed cidfile cleanup", () => {
    const exactId = "a".repeat(64);
    const missing = runResolveScenario();
    expect(missing).toMatchObject({ status: 0, stderr: "" });
    expect(missing.stdout).toContain(
      `status=0 id=${exactId} verified=1 cid=${exactId}`,
    );

    const malformed = runResolveScenario("not-an-id");
    expect(malformed.status).toBe(1);
    expect(malformed.stderr).toContain(
      "Jade protocol cidfile contains an invalid container ID",
    );
    expect(malformed.stdout).toContain(
      `status=1 id=${exactId} verified=1 cid=${exactId}`,
    );

    const mismatched = runResolveScenario("b".repeat(64));
    expect(mismatched.status).toBe(1);
    expect(mismatched.stderr).toContain(
      "Jade protocol cidfile disagrees with the exact created container",
    );
    expect(mismatched.stdout).toContain(`status=1 id=${exactId} verified=1`);
  });

  it("behaviorally retires the armed exact ID while preserving failure status", () => {
    const exactId = "a".repeat(64);
    const result = spawnSync(
      "bash",
      [
        "-c",
        `set -u
container_id="$EXACT_ID"
container_identity_verified=1
retire_registered_transient() { printf 'retired=%s verified=%s\\n' "$1" "$2"; }
${shellFunction("cleanup")}
false
cleanup`,
      ],
      { encoding: "utf8", env: { ...process.env, EXACT_ID: exactId } },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`retired=${exactId} verified=1\n`);
  });

  it("retires the attested immutable ID on timeout, signal, or normal exit", () => {
    expect(runner).toContain("trap cleanup EXIT");
    expect(runner).toContain("trap 'exit 130' INT");
    expect(runner).toContain("trap 'exit 143' TERM");
    expect(runner).toContain(
      'retire_registered_transient "$container_id" "$container_identity_verified"',
    );
    expect(runner).toContain('docker container rm --force "$exact_id"');
    expect(runner).toContain('docker container inspect "$exact_id"');
    expect(runner).toContain(
      'docker container ls --all --no-trunc --filter "id=$exact_id"',
    );
    expect(runner).toContain("The EXIT/signal trap owns that exact ID if the");
  });
});
