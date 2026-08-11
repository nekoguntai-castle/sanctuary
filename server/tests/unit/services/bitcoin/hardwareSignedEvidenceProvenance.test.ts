import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HardwareSignedPsbtVector } from "../../../fixtures/hardware-signed-psbt-vectors";
import {
  coreReceiptPayload,
  currentHardwareEvidenceSourceManifest,
  defaultCommitReachability,
  validateCoreReceipt,
} from "../../../helpers/hardwareSignedEvidenceProvenance";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

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

    expect(validateCoreReceipt(vector, { trustedCoreReceiptKeys })).toBeNull();
    const signature = Buffer.from(
      vector.evidence.coreAcceptance.receipt.signatureBase64,
      "base64",
    );
    signature[0] ^= 1;
    vector.evidence.coreAcceptance.receipt.signatureBase64 =
      signature.toString("base64");
    expect(validateCoreReceipt(vector, { trustedCoreReceiptKeys })).toBe(
      "Core acceptance receipt signature is invalid",
    );
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
      }),
    ).toBe("Core acceptance receipt signature is invalid");
  });
});
