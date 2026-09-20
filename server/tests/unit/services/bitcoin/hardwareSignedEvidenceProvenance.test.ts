import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HardwareSignedPsbtVector } from "../../../fixtures/hardware-signed-psbt-vectors";
import {
  coreReceiptPayload,
  currentHardwareEvidenceSourceManifest,
  defaultCommitReachability,
  repositoryDependencyClosure,
  resolveTypeScriptImport,
  sourceManifestMatches,
  validateCoreReceipt,
} from "../../../helpers/hardwareSignedEvidenceProvenance";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const JADE_DEDICATED_PROOF_SOURCES = [
  "config/jade-emulator-proof.json",
  "config/jade-protocol-harness.json",
  "server/src/api/hardware.ts",
  "server/src/api/openapi/paths/hardware.ts",
  "server/src/middleware/bodyParsing.ts",
  "server/src/middleware/rateLimit.ts",
  "server/src/middleware/requestLogger.ts",
  "server/src/services/jadePinRelay.ts",
  "src/api/authPolicy.ts",
] as const;

describe("hardware evidence source import resolution", () => {
  it("resolves emitted extensions to the corresponding source and retains runtime code beside declarations", () => {
    const tempRoot = resolve(REPO_ROOT, ".tmp");
    mkdirSync(tempRoot, { recursive: true });
    const directory = mkdtempSync(resolve(tempRoot, "hardware-source-imports-"));
    const source = resolve(directory, "entry.ts");
    const write = (name: string, contents = "export const value = 1;") => writeFileSync(resolve(directory, name), contents);
    try {
      write("entry.ts", 'export * from "./enums.js"; export * from "./esm.mjs"; export * from "./common.cjs";');
      write("enums.ts"); write("enums.js", "export const stale = true;");
      write("esm.mts"); write("esm.ts");
      write("common.cts"); write("common.ts");
      expect(resolveTypeScriptImport(source, "./enums.js")).toBe(resolve(directory, "enums.ts"));
      expect(resolveTypeScriptImport(source, "./esm.mjs")).toBe(resolve(directory, "esm.mts"));
      expect(resolveTypeScriptImport(source, "./common.cjs")).toBe(resolve(directory, "common.cts"));
      expect(repositoryDependencyClosure([source])).not.toContain(resolve(directory, "enums.js"));
      for (const [runtime, declaration] of [["plain.js", "plain.d.ts"], ["view.jsx", "view.d.ts"], ["module.mjs", "module.d.mts"], ["legacy.cjs", "legacy.d.cts"]]) {
        write(runtime); write(declaration, "export declare const value: number;");
        write("entry.ts", `export * from "./${runtime}";`);
        expect(resolveTypeScriptImport(source, `./${runtime}`)).toBe(resolve(directory, declaration));
        expect(repositoryDependencyClosure([source])).toEqual(expect.arrayContaining([resolve(directory, declaration), resolve(directory, runtime)]));
      }
      write("native.js");
      write("wrong.ts");
      expect(resolveTypeScriptImport(source, "./native.js")).toBe(resolve(directory, "native.js"));
      expect(() => resolveTypeScriptImport(source, "./wrong.mjs")).toThrow("Cannot resolve repository import");
      expect(() => resolveTypeScriptImport(source, "./wrong.cjs")).toThrow("Cannot resolve repository import");
      expect(() => resolveTypeScriptImport(source, "./missing.js")).toThrow("Cannot resolve repository import");
      expect(() => resolveTypeScriptImport(source, "../../../../outside.js")).toThrow("escapes the source tree");
      expect(resolveTypeScriptImport(source, "node:fs")).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function receiptVector(): HardwareSignedPsbtVector {
  return {
    vendor: "trezor",
    evidence: {
      captureId: "receipt-unit-test",
      testedCommitSha: "1".repeat(40),
      bitcoinCoreVersion: "/Satoshi:29.0.0/",
      bitcoinCoreImageDigest: "sha256:" + "2".repeat(64),
      coreAcceptance: {
        invocationId: "core-invocation-1",
        requestJson: '{"method":"testmempoolaccept"}',
        responseJson: '{"result":[{"allowed":true}]}',
        receipt: {
          algorithm: "ed25519",
          keyId: "test-key",
          payloadSha256: "",
          signatureBase64: "",
        },
      },
    },
  } as HardwareSignedPsbtVector;
}

function recursiveTypeScriptPaths(directory: string): string[] {
  return readdirSync(resolve(REPO_ROOT, directory)).flatMap((name) => {
    const path = resolve(REPO_ROOT, directory, name);
    if (statSync(path).isDirectory()) {
      return recursiveTypeScriptPaths(relative(REPO_ROOT, path));
    }
    return name.endsWith(".ts") ? [relative(REPO_ROOT, path)] : [];
  });
}

describe("hardware evidence source inventory", () => {
  it("binds generated Prisma source and rejects altered generated-source hashes", () => {
    const sourceManifest = currentHardwareEvidenceSourceManifest("trezor");
    for (const path of ["server/src/generated/prisma/client.ts", "server/src/generated/prisma/enums.ts", "server/src/generated/prisma/internal/class.ts"]) {
      expect(sourceManifest.map((entry) => entry.path)).toContain(path);
      const vector = {
        vendor: "trezor",
        evidence: { sourceManifest: sourceManifest.map((entry) => entry.path === path ? { ...entry, sha256: "0".repeat(64) } : entry) },
      } as HardwareSignedPsbtVector;
      expect(sourceManifestMatches(vector), path).toBe(false);
    }
  });
  it("recursively binds every selected-vendor adapter module and proof helper", () => {
    const paths = new Set(
      currentHardwareEvidenceSourceManifest("trezor").map(
        (entry) => entry.path,
      ),
    );
    const proofHelpers = readdirSync(resolve(REPO_ROOT, "server/tests/helpers"))
      .filter((name) => /^hardwareSigned.*\.ts$/.test(name))
      .map((name) => `server/tests/helpers/${name}`);
    const trezorAdapter = recursiveTypeScriptPaths(
      "src/services/hardwareWallet/adapters/trezor",
    );

    expect(
      [...proofHelpers, ...trezorAdapter].filter((path) => !paths.has(path)),
    ).toEqual([]);
  });

  it("binds direct production dependencies outside the selected adapter directory", () => {
    const paths = new Set(
      currentHardwareEvidenceSourceManifest("trezor").map(
        (entry) => entry.path,
      ),
    );
    for (const path of [
      "shared/schemas/bitcoinResponses.ts",
      "shared/schemas/psbtSigningContext.ts",
      "src/api/client.ts",
      "src/hooks/send/types.ts",
      "src/hooks/send/useSendOperationOwner.ts",
      "src/services/hardwareWallet/identity.ts",
      "src/services/hardwareWallet/signingSupport.ts",
      "src/utils/bufferUtils.ts",
      "src/utils/logger.ts",
    ]) {
      expect(paths.has(path), `missing direct source dependency ${path}`).toBe(
        true,
      );
    }
  });

  it("binds transitive production dependencies outside the selected adapter directory", () => {
    const paths = new Set(
      currentHardwareEvidenceSourceManifest("trezor").map(
        (entry) => entry.path,
      ),
    );

    expect(paths.has("shared/schemas/deviceIdentity.ts")).toBe(true);
  });

  it.each(["ledger", "trezor", "bitbox"] as const)(
    "binds only the selected %s adapter directory",
    (vendor) => {
      const paths = currentHardwareEvidenceSourceManifest(vendor).map(
        (entry) => entry.path,
      );
      const selectedDirectory = `src/services/hardwareWallet/adapters/${vendor}/`;
      const selectedAdapter = recursiveTypeScriptPaths(
        selectedDirectory.slice(0, -1),
      );
      const unrelatedDirectories = ["ledger", "trezor", "bitbox", "jade"]
        .filter((candidate) => candidate !== vendor)
        .map(
          (candidate) => `src/services/hardwareWallet/adapters/${candidate}/`,
        );

      expect(selectedAdapter.filter((path) => !paths.includes(path))).toEqual(
        [],
      );
      expect(
        paths.filter((path) =>
          unrelatedDirectories.some((directory) => path.startsWith(directory)),
        ),
      ).toEqual([]);
      expect(paths).toContain("shared/schemas/deviceIdentity.ts");
    },
  );

  it("binds every Jade adapter module without binding another vendor directory", () => {
    const paths = currentHardwareEvidenceSourceManifest("jade").map(
      (entry) => entry.path,
    );
    for (const file of [
      "jade.ts",
      "jadeIdentity.ts",
      "jadePinRelayClient.ts",
      "jadeProtocol.ts",
      "jadeSignedPsbt.ts",
    ])
      expect(paths).toContain(`src/services/hardwareWallet/adapters/${file}`);
    for (const path of JADE_DEDICATED_PROOF_SOURCES)
      expect(paths).toContain(path);
    expect(
      paths.some((path) => /adapters\/(?:ledger|trezor|bitbox)\//.test(path)),
    ).toBe(false);
  });

  it("expires Jade evidence when a dedicated relay or auth source hash changes", () => {
    const sourceManifest = currentHardwareEvidenceSourceManifest("jade");
    const vector = {
      vendor: "jade",
      evidence: { sourceManifest },
    } as HardwareSignedPsbtVector;
    expect(sourceManifestMatches(vector)).toBe(true);

    for (const path of JADE_DEDICATED_PROOF_SOURCES) {
      const mutatedVector = {
        ...vector,
        evidence: {
          sourceManifest: sourceManifest.map((entry) =>
            entry.path === path ? { ...entry, sha256: "0".repeat(64) } : entry,
          ),
        },
      } as HardwareSignedPsbtVector;
      expect(sourceManifestMatches(mutatedVector), path).toBe(false);
    }
  });
});

describe("hardware evidence repository and receipt provenance", () => {
  it("uses Git ancestry for the default tested-commit reachability decision", () => {
    expect(defaultCommitReachability("HEAD")).toBe(true);
    expect(defaultCommitReachability("0".repeat(40))).toBe(false);
  });

  it("accepts a valid receipt and rejects a tampered signature", () => {
    const vector = receiptVector();
    const keys = generateKeyPairSync("ed25519");
    const payload = coreReceiptPayload(vector);
    vector.evidence.coreAcceptance.receipt.payloadSha256 = createHash("sha256")
      .update(payload)
      .digest("hex");
    vector.evidence.coreAcceptance.receipt.signatureBase64 = sign(
      null,
      payload,
      keys.privateKey,
    ).toString("base64");
    const trustedCoreReceiptKeys = {
      "test-key": keys.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
    };

    expect(
      validateCoreReceipt(vector, {
        trustedCoreReceiptKeys,
        trustedApplicationReceiptKeys: {},
        trustedReviewerReceiptKeys: {},
      }),
    ).toBeNull();
    const signature = Buffer.from(
      vector.evidence.coreAcceptance.receipt.signatureBase64,
      "base64",
    );
    signature[0] ^= 1;
    vector.evidence.coreAcceptance.receipt.signatureBase64 =
      signature.toString("base64");
    expect(
      validateCoreReceipt(vector, {
        trustedCoreReceiptKeys,
        trustedApplicationReceiptKeys: {},
        trustedReviewerReceiptKeys: {},
      }),
    ).toBe("Core acceptance receipt signature is invalid");
  });

  it("fails closed when the trusted receipt key cannot be parsed", () => {
    const vector = receiptVector();
    const payload = coreReceiptPayload(vector);
    vector.evidence.coreAcceptance.receipt.payloadSha256 = createHash("sha256")
      .update(payload)
      .digest("hex");

    expect(
      validateCoreReceipt(vector, {
        trustedCoreReceiptKeys: { "test-key": "not-a-public-key" },
        trustedApplicationReceiptKeys: {},
        trustedReviewerReceiptKeys: {},
      }),
    ).toBe("Core acceptance receipt signature is invalid");
  });
});
