import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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
const runner = readFileSync(
  path.join(repoRoot, "scripts/ci/run-jade-protocol-harness.sh"),
  "utf8",
);
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
    expect(runner).toContain("docker create");
    expect(runner).toContain("docker start --attach --interactive");
    expect(runner).not.toContain("--volume");
    expect(runner).toContain("--tmpfs /workspace:");
    expect(runner).toContain("--tmpfs /evidence:");
    expect(runner).toContain('tar -cf - \\\n  "$manifest"');
    expect(runner).toContain(
      'tar -xf "$evidence_root/proof-output.tar" -C "$evidence_root"',
    );
    expect(runner).toContain("trap cleanup EXIT INT TERM");
    expect(runner).toContain('docker rm -f "$container_name"');
    expect(runner).toContain("--read-only");
    expect(runner).toContain("--cap-drop ALL");
    expect(runner).toContain("JADE_PROTOCOL_PROOF_DIR");
    expect(workflow).toContain("Run pinned Jade vendor protocol harness");
    expect(workflow).toContain("npm run test:jade-protocol-harness");
    expect(workflow).toContain("${{ env.JADE_PROTOCOL_PROOF_DIR }}");
  });
});
