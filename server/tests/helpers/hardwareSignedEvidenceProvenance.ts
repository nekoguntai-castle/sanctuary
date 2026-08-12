import { createHash, createPublicKey, verify } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";
import type {
  HardwareSignedPsbtVector,
  HardwareWalletVendor,
} from "../fixtures/hardware-signed-psbt-vectors";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const PROOF_SOURCE_ROOTS = [
  "package-lock.json",
  "shared/constants/hardwareWalletCapabilities.ts",
  "shared/constants/walletPolicy.ts",
  "src/hooks/send/useUsbSigning.ts",
  "src/hooks/useHardwareWallet.ts",
  "src/services/hardwareWallet/service.ts",
  "src/services/hardwareWallet/types.ts",
  "src/services/hardwareWallet/psbtAccountBinding.ts",
  "server/src/services/hardwareWalletCapabilities.ts",
  "server/src/services/bitcoin/signingIntent/artifactValidation.ts",
  "server/src/services/bitcoin/signingIntent/broadcastLifecycle.ts",
  "server/src/services/bitcoin/signingIntent/canonical.ts",
  "server/src/services/bitcoin/signingIntent/prevoutValidation.ts",
  "server/src/services/bitcoin/signingIntent/schema.ts",
  "server/src/services/bitcoin/signingIntent/service.ts",
  "server/src/api/transactions/broadcasting.ts",
  "server/src/api/transactions/drafting.ts",
  "server/src/api/transactions/requestValidation.ts",
  "server/tests/fixtures/hardware-signed-psbt-vectors.ts",
] as const;

const VENDOR_SOURCE_ROOTS: Record<HardwareWalletVendor, readonly string[]> = {
  ledger: ["src/services/hardwareWallet/adapters/ledger"],
  trezor: ["src/services/hardwareWallet/adapters/trezor"],
  jade: [
    "config/jade-emulator-proof.json",
    "config/jade-protocol-harness.json",
    "server/src/api/hardware.ts",
    "server/src/api/openapi/paths/hardware.ts",
    "server/src/middleware/bodyParsing.ts",
    "server/src/middleware/rateLimit.ts",
    "server/src/middleware/requestLogger.ts",
    "server/src/services/jadePinRelay.ts",
    "src/api/authPolicy.ts",
    "src/services/hardwareWallet/adapters/jade.ts",
    "src/services/hardwareWallet/adapters/jadeIdentity.ts",
    "src/services/hardwareWallet/adapters/jadePinRelayClient.ts",
    "src/services/hardwareWallet/adapters/jadeProtocol.ts",
    "src/services/hardwareWallet/adapters/jadeSignedPsbt.ts",
  ],
  bitbox: ["src/services/hardwareWallet/adapters/bitbox"],
};

const STATIC_IMPORT_CACHE = new Map<
  string,
  { contents: string; specifiers: readonly string[] }
>();

export interface HardwareEvidenceVerificationContext {
  trustedCoreReceiptKeys: Readonly<Record<string, string>>;
  isTestedCommitReachable?: (sha: string) => boolean;
  now?: number;
}

export const EMPTY_HARDWARE_EVIDENCE_TRUST: HardwareEvidenceVerificationContext =
  Object.freeze({
    trustedCoreReceiptKeys: Object.freeze({}),
  });

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const recursiveTypeScriptFiles = (directory: string): string[] => {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return recursiveTypeScriptFiles(path);
    return name.endsWith(".ts") ? [path] : [];
  });
};

const hardwareSignedHelperFiles = (): string[] => {
  const directory = resolve(REPO_ROOT, "server/tests/helpers");
  return readdirSync(directory)
    .filter((name) => /^hardwareSigned.*\.ts$/.test(name))
    .map((name) => resolve(directory, name));
};

const resolveTypeScriptImport = (
  sourcePath: string,
  specifier: string,
): string | undefined => {
  let importedPath: string;
  if (specifier.startsWith("."))
    importedPath = resolve(dirname(sourcePath), specifier);
  else if (specifier.startsWith("@sanctuary/shared/")) {
    importedPath = resolve(
      REPO_ROOT,
      "shared",
      specifier.slice("@sanctuary/shared/".length),
    );
  } else if (specifier.startsWith("@/")) {
    importedPath = resolve(REPO_ROOT, "src", specifier.slice(2));
  } else return undefined;

  const repositoryRelativePath = relative(REPO_ROOT, importedPath);
  if (
    repositoryRelativePath === ".." ||
    repositoryRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(repositoryRelativePath)
  ) {
    throw new Error(`Repository import escapes the source tree: ${specifier}`);
  }

  for (const candidate of [
    importedPath,
    `${importedPath}.ts`,
    `${importedPath}.tsx`,
    resolve(importedPath, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(
    `Cannot resolve repository import ${specifier} from ${relative(REPO_ROOT, sourcePath)}`,
  );
};

const staticModuleSpecifier = (node: ts.Node): string | undefined => {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)
      ? node.moduleSpecifier.text
      : undefined;
  }
  if (
    ts.isImportEqualsDeclaration(node) &&
    ts.isExternalModuleReference(node.moduleReference) &&
    node.moduleReference.expression &&
    ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  return undefined;
};

const staticModuleSpecifiers = (
  sourcePath: string,
  contents: string,
): string[] => {
  if (sourcePath.endsWith(".json")) return [];
  const cached = STATIC_IMPORT_CACHE.get(sourcePath);
  if (cached?.contents === contents) return [...cached.specifiers];
  const sourceFile = ts.createSourceFile(
    sourcePath,
    contents,
    ts.ScriptTarget.Latest,
    false,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    const specifier = staticModuleSpecifier(node);
    if (specifier) specifiers.push(specifier);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  STATIC_IMPORT_CACHE.set(sourcePath, { contents, specifiers });
  return specifiers;
};

const staticRepositoryDependencies = (
  sourcePath: string,
  contents: string,
): string[] => {
  return staticModuleSpecifiers(sourcePath, contents).flatMap((specifier) => {
    const dependency = resolveTypeScriptImport(sourcePath, specifier);
    return dependency ? [dependency] : [];
  });
};

const repositoryDependencyClosure = (
  sourcePaths: readonly string[],
): string[] => {
  const discovered = new Set(sourcePaths.map((path) => resolve(path)));
  const pending = [...discovered].sort(compareText);
  while (pending.length > 0) {
    const sourcePath = pending.shift()!;
    const contents = readFileSync(sourcePath, "utf8");
    const dependencies = staticRepositoryDependencies(sourcePath, contents);
    for (const dependency of dependencies.sort(compareText)) {
      if (discovered.has(dependency)) continue;
      discovered.add(dependency);
      pending.push(dependency);
    }
    pending.sort(compareText);
  }
  return [...discovered];
};

const canonicalSourceBytes = (path: string): Buffer => {
  const contents = readFileSync(path);
  if (!path.endsWith("hardware-signed-psbt-vectors.ts")) return contents;
  const marker = Buffer.from("export const HARDWARE_SIGNED_PSBT_VECTORS");
  const markerIndex = contents.indexOf(marker);
  if (markerIndex < 0)
    throw new Error("Hardware fixture source is missing its vector marker");
  return contents.subarray(0, markerIndex);
};

export function currentHardwareEvidenceSourceManifest(
  vendor: HardwareWalletVendor,
) {
  const vendorFiles = VENDOR_SOURCE_ROOTS[vendor].flatMap((source) => {
    const path = resolve(REPO_ROOT, source);
    return statSync(path).isDirectory() ? recursiveTypeScriptFiles(path) : [path];
  });
  const rootFiles = PROOF_SOURCE_ROOTS.map((path) => resolve(REPO_ROOT, path));
  const helperFiles = hardwareSignedHelperFiles();
  const sourceFiles = repositoryDependencyClosure([
    ...rootFiles,
    ...helperFiles,
    ...vendorFiles,
  ]);
  return sourceFiles
    .map((path) => ({
      path: relative(REPO_ROOT, path),
      sha256: sha256(canonicalSourceBytes(path)),
    }))
    .sort((left, right) => compareText(left.path, right.path));
}

export function defaultCommitReachability(sha: string): boolean {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", sha, "HEAD"],
    {
      cwd: REPO_ROOT,
      stdio: "ignore",
    },
  );
  return result.status === 0;
}

export function coreReceiptPayload(vector: HardwareSignedPsbtVector): Buffer {
  const acceptance = vector.evidence.coreAcceptance;
  const payload = {
    schema: "sanctuary-core-acceptance-v1",
    captureId: vector.evidence.captureId,
    invocationId: acceptance.invocationId,
    testedCommitSha: vector.evidence.testedCommitSha,
    bitcoinCoreVersion: vector.evidence.bitcoinCoreVersion,
    bitcoinCoreImageDigest: vector.evidence.bitcoinCoreImageDigest,
    requestSha256: sha256(acceptance.requestJson),
    responseSha256: sha256(acceptance.responseJson),
  };
  return Buffer.from(JSON.stringify(payload), "utf8");
}

export function validateCoreReceipt(
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext,
): string | null {
  const receipt = vector.evidence.coreAcceptance.receipt;
  const trustedKey = context.trustedCoreReceiptKeys[receipt.keyId];
  if (!trustedKey) return "Core acceptance receipt key is not trusted";
  const payload = coreReceiptPayload(vector);
  if (receipt.payloadSha256 !== sha256(payload))
    return "Core acceptance receipt payload hash mismatch";
  try {
    const valid = verify(
      null,
      payload,
      createPublicKey(trustedKey),
      Buffer.from(receipt.signatureBase64, "base64"),
    );
    return valid ? null : "Core acceptance receipt signature is invalid";
  } catch {
    return "Core acceptance receipt signature is invalid";
  }
}

export function sourceManifestMatches(
  vector: HardwareSignedPsbtVector,
): boolean {
  return (
    JSON.stringify(vector.evidence.sourceManifest) ===
    JSON.stringify(currentHardwareEvidenceSourceManifest(vector.vendor))
  );
}
