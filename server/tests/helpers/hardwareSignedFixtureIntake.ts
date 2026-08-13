import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateMnemonic, wordlists } from "bip39";
import {
  WALLET_POLICY_REGISTRY,
  WALLET_POLICY_REGISTRY_VERSION,
} from "@sanctuary/shared/constants/walletPolicy";
import {
  COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  BITBOX02_PHYSICAL_MODELS,
  JADE_PLUS_PHYSICAL_MODEL,
  JADE_PLUS_PHYSICAL_TRANSPORT,
  LEDGER_PHYSICAL_MODELS,
  LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES,
  JADE_HARDWARE_SIGNED_SOFTWARE_GATES,
  MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES,
  REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES,
  TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES,
  TREZOR_PHYSICAL_MODELS,
  type HardwareEvidenceSdkPackage,
  type HardwareSignedNegativeControlCase,
  type HardwareSignedPsbtVector,
  type HardwareSignedScriptType,
  type RequiredHardwareSignedRow,
  type UnsupportedHardwareSignedRow,
} from "../fixtures/hardware-signed-psbt-vectors";
import {
  defaultCommitReachability,
  currentPackageLockSha256,
  EMPTY_HARDWARE_EVIDENCE_TRUST,
  hardwareEvidenceSourceManifestSha256,
  sourceManifestMatches,
  validateApplicationReceipt,
  validateCoreReceipt,
  validateReviewerReceipt,
  type HardwareEvidenceVerificationContext,
} from "./hardwareSignedEvidenceProvenance";

export interface HardwareSignedFixtureIntakeIssue {
  vectorId: string;
  field: string;
  message: string;
}

const MULTISIG_SCRIPT_TYPES: HardwareSignedScriptType[] = [
  "p2wsh",
  "p2sh-p2wsh",
];
const SECRET_PATTERNS = [
  /seed words?/i,
  /mnemonic/i,
  /passphrase/i,
  /\bpin\b/i,
  /pairing secret/i,
  /auth token/i,
  /private key/i,
  /\b(?:xprv|yprv|zprv|Yprv|Zprv|tprv|uprv|vprv|Uprv|Vprv)[1-9A-HJ-NP-Za-km-z]{20,}\b/,
];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
const SRI_SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const BIP39_WORD_COUNTS = [12, 15, 18, 21, 24] as const;
const BIP39_WORDLISTS = [
  ...new Set(Object.values(wordlists as Record<string, string[]>)),
].map((words) => ({ words, vocabulary: new Set(words) }));
const MAX_EVIDENCE_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PACKAGE_LOCK_PATH = resolve(REPO_ROOT, "package-lock.json");
const PACKAGE_JSON_PATH = resolve(REPO_ROOT, "package.json");
const CORE_PROOF_PATH = resolve(
  REPO_ROOT,
  "scripts/verify-psbt/proof-manifest.json",
);
const JADE_PROOF_PATH = resolve(REPO_ROOT, "config/jade-emulator-proof.json");
const PACKAGE_LOCK = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, "utf8")) as {
  packages: Record<string, { version?: string; integrity?: string }>;
};
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
    version: string;
  }
).version;
const CORE_PROOF = JSON.parse(readFileSync(CORE_PROOF_PATH, "utf8")) as {
  coreImage: string;
  coreSubversion: string;
};
const JADE_PROOF = JSON.parse(readFileSync(JADE_PROOF_PATH, "utf8")) as {
  firmware: { runtimeVersion: string };
};

const EXPECTED_POLICY_ID: Record<HardwareSignedScriptType, string> = {
  p2pkh: "single-sig-legacy-bip44-v1",
  p2wpkh: "single-sig-native-segwit-bip84-v1",
  "p2sh-p2wpkh": "single-sig-nested-segwit-bip49-v1",
  p2tr: "single-sig-taproot-bip86-v1",
  p2wsh: "multisig-native-segwit-bip48-2-v1",
  "p2sh-p2wsh": "multisig-nested-segwit-bip48-1-v1",
};

const EXPECTED_SDK_PACKAGES: Record<
  HardwareSignedPsbtVector["vendor"],
  readonly HardwareEvidenceSdkPackage[]
> = {
  ledger: ["@ledgerhq/ledger-bitcoin", "@ledgerhq/hw-transport-webusb"],
  trezor: ["@trezor/connect", "@trezor/connect-web"],
  jade: ["cbor-x"],
  bitbox: ["bitbox02-api"],
};

const issue = (
  vectorId: string,
  field: string,
  message: string,
): HardwareSignedFixtureIntakeIssue => ({
  vectorId,
  field,
  message,
});

const rowKey = (row: RequiredHardwareSignedRow): string =>
  `${row.vendor}:${row.scriptType}`;

const isMultisig = (scriptType: HardwareSignedScriptType): boolean =>
  MULTISIG_SCRIPT_TYPES.includes(scriptType);

const requiredNegativeControls = (
  scriptType: HardwareSignedScriptType,
): HardwareSignedNegativeControlCase[] => {
  if (!isMultisig(scriptType)) return COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS;
  return [
    ...COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
    ...MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  ];
};

const missingValues = (
  required: readonly string[],
  actual: string[],
): string[] => {
  const actualSet = new Set(actual);
  return required.filter((value) => !actualSet.has(value));
};

const validateAddressEvidence = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const coveredSuffixes = vector.addressEvidence
    .map((evidence) =>
      REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES.find((suffix) =>
        evidence.path.endsWith(suffix),
      ),
    )
    .filter(
      (
        suffix,
      ): suffix is (typeof REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES)[number] =>
        Boolean(suffix),
    );
  const missing = missingValues(
    REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES,
    coveredSuffixes,
  );
  const mismatches = vector.addressEvidence.filter(
    (evidence) =>
      evidence.sanctuaryAddress !== evidence.deviceAddress ||
      evidence.sanctuaryAddress !== evidence.coreAddress,
  );
  const undisplayed = vector.addressEvidence.filter(
    (evidence) => evidence.displayedOnPhysicalDevice !== true,
  );

  return [
    ...missing.map((suffix) =>
      issue(
        vector.id,
        "addressEvidence",
        `missing address evidence for ${suffix}`,
      ),
    ),
    ...mismatches.map((evidence) =>
      issue(
        vector.id,
        "addressEvidence",
        `address mismatch for ${evidence.path}`,
      ),
    ),
    ...undisplayed.map((evidence) =>
      issue(
        vector.id,
        "addressEvidence",
        `missing physical display proof for ${evidence.path}`,
      ),
    ),
  ];
};

const validateNegativeControls = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const passedControls = vector.negativeControls
    .filter(
      (control) =>
        control.passed &&
        control.expectedFailure.trim() !== "" &&
        control.observedFailure.trim() !== "",
    )
    .map((control) => control.caseName);
  return missingValues(
    requiredNegativeControls(vector.scriptType),
    passedControls,
  ).map((caseName) =>
    issue(
      vector.id,
      "negativeControls",
      `missing passed negative control ${caseName}`,
    ),
  );
};

const validateSoftwareGates = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const passedCommands = vector.softwareGates
    .filter((gate) => gate.status === "passed" && gate.capturedAt.trim() !== "")
    .map((gate) => gate.command);
  const vendorGates =
    vector.vendor === "trezor"
      ? TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES
      : vector.vendor === "ledger"
        ? LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES
        : vector.vendor === "jade"
          ? JADE_HARDWARE_SIGNED_SOFTWARE_GATES
          : [];
  const required = [...REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES, ...vendorGates];
  return missingValues(required, passedCommands).map((command) =>
    issue(
      vector.id,
      "softwareGates",
      `missing passed software gate: ${command}`,
    ),
  );
};

const validateSanitization = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const review = vector.sanitization;
  const checks = [
    ["nonMainnetFunds", review.nonMainnetFunds],
    ["dedicatedOrWipeableDevice", review.dedicatedOrWipeableDevice],
    [
      "noSeedsPinsPassphrasesPairingSecrets",
      review.noSeedsPinsPassphrasesPairingSecrets,
    ],
    ["noHostAuthTokens", review.noHostAuthTokens],
    ["sanitizedArtifactsReviewed", review.sanitizedArtifactsReviewed],
  ] as const;
  const missingChecks = checks
    .filter(([, value]) => value !== true)
    .map(([field]) =>
      issue(
        vector.id,
        `sanitization.${field}`,
        "required sanitization check is not affirmed",
      ),
    );
  if (review.reviewer.trim() === "") {
    missingChecks.push(
      issue(
        vector.id,
        "sanitization.reviewer",
        "missing sanitization reviewer",
      ),
    );
  }
  if (review.reviewer.trim() === vector.evidence.operator.trim()) {
    missingChecks.push(
      issue(
        vector.id,
        "sanitization.reviewer",
        "operator and sanitization reviewer must differ",
      ),
    );
  }
  return missingChecks;
};

const sha256 = (value: Uint8Array | string): string =>
  createHash("sha256").update(value).digest("hex");

const artifactBytes = (
  vector: HardwareSignedPsbtVector,
): Uint8Array | string => {
  if (vector.artifact.type === "signed-psbt") {
    return Buffer.from(vector.artifact.signedPsbtBase64, "base64");
  }
  if (vector.artifact.type === "ledger-signed-psbt") {
    return [
      vector.artifact.sourcePsbtBase64,
      ...vector.artifact.signatures.map((signature) =>
        JSON.stringify(signature),
      ),
      vector.artifact.reconstructedPsbtBase64,
    ].join("\n");
  }
  return [
    vector.artifact.sourcePsbtBase64,
    ...vector.artifact.connectSignatures,
    vector.artifact.serializedTxHex,
  ].join("\n");
};

const validateProvenanceIdentity = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const evidence = vector.evidence;
  if (vector.fixtureSchemaVersion !== 5) {
    issues.push(
      issue(
        vector.id,
        "fixtureSchemaVersion",
        "unsupported physical fixture schema",
      ),
    );
  }
  if (
    vector.evidenceTier !== "physical-device" ||
    vector.device.emulated !== false
  ) {
    issues.push(
      issue(
        vector.id,
        "evidenceTier",
        "emulator evidence cannot satisfy physical-device fixture intake",
      ),
    );
  }
  if (!COMMIT_SHA.test(evidence.testedCommitSha)) {
    issues.push(
      issue(
        vector.id,
        "evidence.testedCommitSha",
        "tested commit must be a full Git SHA",
      ),
    );
  }
  return issues;
};

const validateApprovedModel = (
  vector: HardwareSignedPsbtVector,
  models: readonly string[],
  label: string,
): HardwareSignedFixtureIntakeIssue[] => {
  if (models.includes(vector.device.model)) return [];
  return [
    issue(
      vector.id,
      "device.model",
      `${label} model is not an approved physical evidence model`,
    ),
  ];
};

const validateExactSemver = (
  vector: HardwareSignedPsbtVector,
  value: string | undefined,
  field: string,
  label: string,
): HardwareSignedFixtureIntakeIssue[] => {
  if (value && SEMVER.test(value)) return [];
  return [
    issue(vector.id, field, `${label} must be an exact semantic version`),
  ];
};

const validateLedgerDevice = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const webUsb = vector.evidence.sdkPackages.find(
    ({ package: name }) => name === "@ledgerhq/hw-transport-webusb",
  );
  const issues = [
    ...validateApprovedModel(vector, LEDGER_PHYSICAL_MODELS, "Ledger"),
    ...validateExactSemver(
      vector,
      vector.device.firmwareVersion,
      "device.firmwareVersion",
      "Ledger firmware",
    ),
    ...validateExactSemver(
      vector,
      vector.device.bitcoinAppVersion,
      "device.bitcoinAppVersion",
      "Ledger Bitcoin app",
    ),
  ];
  if (vector.device.transport !== "webusb") {
    issues.push(
      issue(
        vector.id,
        "device.transport",
        "Ledger physical evidence must use webusb",
      ),
    );
  }
  if (vector.device.transportVersion !== webUsb?.version) {
    issues.push(
      issue(
        vector.id,
        "device.transportVersion",
        "Ledger WebUSB transport version must match the locked transport package",
      ),
    );
  }
  return issues;
};

const validateTrezorDevice = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const connectWeb = vector.evidence.sdkPackages.find(
    ({ package: name }) => name === "@trezor/connect-web",
  );
  const issues = [
    ...validateApprovedModel(vector, TREZOR_PHYSICAL_MODELS, "Trezor"),
    ...validateExactSemver(
      vector,
      vector.device.firmwareVersion,
      "device.firmwareVersion",
      "Trezor firmware",
    ),
    ...validateExactSemver(
      vector,
      vector.device.companionVersion,
      "device.companionVersion",
      "Trezor Bridge or Suite companion",
    ),
  ];
  if (vector.device.bitcoinAppVersion !== undefined) {
    issues.push(
      issue(
        vector.id,
        "device.bitcoinAppVersion",
        "Trezor evidence must not invent a Bitcoin app version",
      ),
    );
  }
  if (vector.device.transport !== "trezor-connect") {
    issues.push(
      issue(
        vector.id,
        "device.transport",
        "Trezor physical evidence must use trezor-connect",
      ),
    );
  }
  if (vector.device.transportVersion !== connectWeb?.version) {
    issues.push(
      issue(
        vector.id,
        "device.transportVersion",
        "Trezor transport version must match the locked Connect-Web package",
      ),
    );
  }
  return issues;
};

const validateJadeDevice = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  if (vector.device.model !== JADE_PLUS_PHYSICAL_MODEL) {
    issues.push(
      issue(
        vector.id,
        "device.model",
        `Jade evidence must come from a physical ${JADE_PLUS_PHYSICAL_MODEL}`,
      ),
    );
  }
  if (vector.device.transport !== JADE_PLUS_PHYSICAL_TRANSPORT) {
    issues.push(
      issue(
        vector.id,
        "device.transport",
        `Jade Plus evidence must use ${JADE_PLUS_PHYSICAL_TRANSPORT}`,
      ),
    );
  }
  if (vector.device.firmwareVersion !== JADE_PROOF.firmware.runtimeVersion) {
    issues.push(
      issue(
        vector.id,
        "device.firmwareVersion",
        `Jade Plus firmware must match proven compatible release ${JADE_PROOF.firmware.runtimeVersion}`,
      ),
    );
  }
  if (!vector.device.transportVersion?.trim()) {
    issues.push(
      issue(
        vector.id,
        "device.transportVersion",
        "Jade Plus WebSerial transport metadata is required",
      ),
    );
  }
  return issues;
};

const validateBitBoxDevice = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues = [
    ...validateApprovedModel(vector, BITBOX02_PHYSICAL_MODELS, "BitBox02"),
    ...validateExactSemver(
      vector,
      vector.device.firmwareVersion,
      "device.firmwareVersion",
      "BitBox02 firmware",
    ),
  ];
  if (vector.device.transport !== "webhid") {
    issues.push(
      issue(
        vector.id,
        "device.transport",
        "BitBox02 physical evidence must use webhid",
      ),
    );
  }
  if (!vector.device.transportVersion?.trim()) {
    issues.push(
      issue(
        vector.id,
        "device.transportVersion",
        "BitBox02 WebHID transport metadata is required",
      ),
    );
  }
  return issues;
};

const validateVendorDevice = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  if (vector.vendor === "ledger") return validateLedgerDevice(vector);
  if (vector.vendor === "trezor") return validateTrezorDevice(vector);
  if (vector.vendor === "jade") return validateJadeDevice(vector);
  return validateBitBoxDevice(vector);
};

const validateDeviceBinding = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues = validateVendorDevice(vector);

  if (!vector.device.transportVersion?.trim()) {
    issues.push(
      issue(
        vector.id,
        "device.transportVersion",
        "physical transport version metadata is required",
      ),
    );
  }
  return issues;
};

const applicationIdentityMatches = (
  vector: HardwareSignedPsbtVector,
): boolean => {
  const { application } = vector.evidence;
  return (
    application.appVersion === PACKAGE_VERSION &&
    application.packageLockSha256 === currentPackageLockSha256() &&
    application.sourceManifestSha256 ===
      hardwareEvidenceSourceManifestSha256(vector.vendor)
  );
};

const applicationImageRolesMatch = (
  vector: HardwareSignedPsbtVector,
): boolean => {
  const roles = vector.evidence.application.images.map(({ role }) => role);
  return (
    roles.length === 2 &&
    new Set(roles).size === 2 &&
    roles.includes("frontend") &&
    roles.includes("backend")
  );
};

const applicationImageMatches = (
  vector: HardwareSignedPsbtVector,
  image: HardwareSignedPsbtVector["evidence"]["application"]["images"][number],
): boolean => {
  const { application } = vector.evidence;
  return (
    IMAGE_DIGEST.test(image.manifestDigest) &&
    IMAGE_DIGEST.test(image.configDigest) &&
    image.gitRevision === vector.evidence.testedCommitSha &&
    image.appVersion === application.appVersion &&
    image.packageLockSha256 === application.packageLockSha256 &&
    image.sourceManifestSha256 === application.sourceManifestSha256 &&
    image.image.trim() !== "" &&
    image.image.toLowerCase().includes(image.role)
  );
};

const validateApplicationProvenance = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const { application } = vector.evidence;
  if (!applicationIdentityMatches(vector)) {
    issues.push(
      issue(
        vector.id,
        "evidence.application",
        "Sanctuary application evidence must match the current version, lockfile, and funds-safety source manifest",
      ),
    );
  }

  if (!applicationImageRolesMatch(vector)) {
    issues.push(
      issue(
        vector.id,
        "evidence.application.images",
        "exactly one frontend and one backend image subject are required",
      ),
    );
  }
  for (const image of application.images) {
    if (!applicationImageMatches(vector, image)) {
      issues.push(
        issue(
          vector.id,
          "evidence.application.images",
          `Sanctuary ${image.role} image subject is incomplete or does not match the capture source identity`,
        ),
      );
    }
  }
  return issues;
};

const validateSdkAndSourceProvenance = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const evidence = vector.evidence;
  const expectedPackages = EXPECTED_SDK_PACKAGES[vector.vendor];
  const actualPackages = evidence.sdkPackages.map(({ package: name }) => name);
  const uniquePackages = new Set(actualPackages);
  if (
    actualPackages.length !== expectedPackages.length ||
    uniquePackages.size !== actualPackages.length ||
    expectedPackages.some((name) => !uniquePackages.has(name))
  ) {
    issues.push(
      issue(
        vector.id,
        "evidence.sdkPackages",
        "vendor SDK evidence must contain the exact required package tuple",
      ),
    );
  }
  for (const sdk of evidence.sdkPackages) {
    const lockedSdk = PACKAGE_LOCK.packages[`node_modules/${sdk.package}`];
    if (
      !SRI_SHA512.test(sdk.integrity) ||
      sdk.version !== lockedSdk?.version ||
      sdk.integrity !== lockedSdk?.integrity
    ) {
      issues.push(
        issue(
          vector.id,
          "evidence.sdkPackages",
          `vendor SDK evidence for ${sdk.package} must exactly match the current lockfile`,
        ),
      );
    }
  }
  if (!sourceManifestMatches(vector)) {
    issues.push(
      issue(
        vector.id,
        "evidence.sourceManifest",
        "fixture source manifest differs from current funds-safety code",
      ),
    );
  }
  return issues;
};

const validateFreshnessAndOperator = (
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const evidence = vector.evidence;
  for (const [field, value] of [
    ["hostOs", evidence.hostOs],
    ["browser", evidence.browser],
    ["captureId", evidence.captureId],
    ["operator", evidence.operator],
  ] as const) {
    if (value.trim() === "")
      issues.push(issue(vector.id, `evidence.${field}`, `missing ${field}`));
  }
  const capturedAt = Date.parse(evidence.capturedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  const now = context.now ?? Date.now();
  if (!Number.isFinite(capturedAt) || capturedAt > now) {
    issues.push(
      issue(
        vector.id,
        "evidence.capturedAt",
        "capture time must be an ISO timestamp",
      ),
    );
  }
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt <= capturedAt ||
    expiresAt - capturedAt > MAX_EVIDENCE_AGE_MS ||
    expiresAt <= now
  ) {
    issues.push(
      issue(
        vector.id,
        "evidence.expiresAt",
        "physical evidence is expired or exceeds the freshness window",
      ),
    );
  }
  if (evidence.changeRecognizedOnDevice !== true) {
    issues.push(
      issue(
        vector.id,
        "evidence.changeRecognizedOnDevice",
        "device change recognition was not proven",
      ),
    );
  }
  return issues;
};

const validateEvidenceHashes = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const evidence = vector.evidence;
  const expectedUnsignedHash = sha256(
    Buffer.from(vector.unsignedPsbtBase64, "base64"),
  );
  if (
    !SHA256_HEX.test(evidence.unsignedPsbtSha256) ||
    evidence.unsignedPsbtSha256 !== expectedUnsignedHash
  ) {
    issues.push(
      issue(
        vector.id,
        "evidence.unsignedPsbtSha256",
        "unsigned PSBT hash mismatch",
      ),
    );
  }
  const expectedArtifactHash = sha256(artifactBytes(vector));
  if (
    !SHA256_HEX.test(evidence.signedArtifactSha256) ||
    evidence.signedArtifactSha256 !== expectedArtifactHash
  ) {
    issues.push(
      issue(
        vector.id,
        "evidence.signedArtifactSha256",
        "signed artifact hash mismatch",
      ),
    );
  }
  return issues;
};

const validateRepositoryAndReceipt = (
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const reachable =
    context.isTestedCommitReachable ?? defaultCommitReachability;
  if (!reachable(vector.evidence.testedCommitSha)) {
    issues.push(
      issue(
        vector.id,
        "evidence.testedCommitSha",
        "tested commit is not a reachable ancestor of HEAD",
      ),
    );
  }
  const receiptError = validateCoreReceipt(vector, context);
  if (receiptError)
    issues.push(
      issue(vector.id, "evidence.coreAcceptance.receipt", receiptError),
    );
  const applicationReceiptError = validateApplicationReceipt(vector, context);
  if (applicationReceiptError)
    issues.push(
      issue(vector.id, "evidence.application.receipt", applicationReceiptError),
    );
  const reviewerReceiptError = validateReviewerReceipt(vector, context);
  if (reviewerReceiptError)
    issues.push(
      issue(vector.id, "evidence.independentReview.receipt", reviewerReceiptError),
    );
  return issues;
};

const validatePhysicalProvenance = (
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext,
): HardwareSignedFixtureIntakeIssue[] => [
  ...validateProvenanceIdentity(vector),
  ...validateApplicationProvenance(vector),
  ...validateSdkAndSourceProvenance(vector),
  ...validateDeviceBinding(vector),
  ...validateFreshnessAndOperator(vector, context),
  ...validateEvidenceHashes(vector),
  ...validateRepositoryAndReceipt(vector, context),
];

const validateCanonicalAccountPath = (
  vector: HardwareSignedPsbtVector,
  policy: (typeof WALLET_POLICY_REGISTRY)[number],
): HardwareSignedFixtureIntakeIssue[] => {
  const scriptComponent =
    policy.bip48ScriptType === null ? "" : `/${policy.bip48ScriptType}'`;
  const expectedPath = new RegExp(
    `^m/${policy.purpose}'/1'/[0-9]+'${scriptComponent.replace("/", "\\/")}$`,
  );
  return expectedPath.test(vector.account.accountPath)
    ? []
    : [
        issue(
          vector.id,
          "account.accountPath",
          "account path does not match the canonical testnet policy",
        ),
      ];
};

const validateCanonicalMultisig = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const multisigRequired = isMultisig(vector.scriptType);
  if (multisigRequired !== Boolean(vector.account.multisig)) {
    return [
      issue(
        vector.id,
        "account.multisig",
        "multisig policy presence does not match the script type",
      ),
    ];
  }
  if (!vector.account.multisig) return [];

  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const { threshold, cosigners } = vector.account.multisig;
  const identities = new Set(
    cosigners.map(
      (cosigner) =>
        `${cosigner.fingerprint}:${cosigner.accountPath}:${cosigner.accountXpub}`,
    ),
  );
  if (
    !Number.isSafeInteger(threshold) ||
    threshold < 1 ||
    threshold > cosigners.length ||
    cosigners.length < 2 ||
    identities.size !== cosigners.length
  ) {
    issues.push(
      issue(
        vector.id,
        "account.multisig",
        "multisig threshold and cosigner set must be complete and unique",
      ),
    );
  }
  const selectedAccountPresent = cosigners.some(
    (cosigner) =>
      cosigner.fingerprint === vector.account.fingerprint &&
      cosigner.accountPath === vector.account.accountPath &&
      cosigner.accountXpub === vector.account.accountXpub,
  );
  if (!selectedAccountPresent) {
    issues.push(
      issue(
        vector.id,
        "account.multisig",
        "selected account is absent from the multisig cosigner set",
      ),
    );
  }
  return issues;
};

const validateCanonicalPolicy = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const policy = WALLET_POLICY_REGISTRY.find(
    (row) => row.id === vector.account.canonicalPolicyId,
  );
  if (
    !policy ||
    policy.id !== EXPECTED_POLICY_ID[vector.scriptType] ||
    vector.account.canonicalPolicyVersion !== WALLET_POLICY_REGISTRY_VERSION
  ) {
    issues.push(
      issue(
        vector.id,
        "account.canonicalPolicyId",
        "fixture is not bound to the current canonical wallet policy",
      ),
    );
    return issues;
  }
  issues.push(...validateCanonicalAccountPath(vector, policy));
  issues.push(...validateCanonicalMultisig(vector));
  return issues;
};

const validateArtifactContract = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  if (
    vector.vendor === "trezor" &&
    vector.artifact.type !== "trezor-connect-transaction"
  ) {
    issues.push(
      issue(
        vector.id,
        "artifact.type",
        "Trezor evidence must retain the Connect artifact tuple",
      ),
    );
  }
  if (
    vector.vendor === "ledger" &&
    vector.artifact.type !== "ledger-signed-psbt"
  ) {
    issues.push(
      issue(
        vector.id,
        "artifact.type",
        "Ledger evidence must retain its source PSBT, exact signature records, and reconstructed PSBT",
      ),
    );
  }
  if (vector.vendor === "bitbox" && vector.artifact.type !== "signed-psbt") {
    issues.push(
      issue(
        vector.id,
        "artifact.type",
        "BitBox evidence must retain the adapter-returned signed PSBT",
      ),
    );
  }
  if (vector.vendor === "jade" && vector.artifact.type !== "signed-psbt") {
    issues.push(
      issue(
        vector.id,
        "artifact.type",
        "Jade evidence must retain the adapter-returned signed PSBT",
      ),
    );
  }
  if (vector.artifact.type === "ledger-signed-psbt") {
    if (vector.artifact.sourcePsbtBase64 !== vector.unsignedPsbtBase64) {
      issues.push(
        issue(
          vector.id,
          "artifact.sourcePsbtBase64",
          "Ledger source PSBT differs from fixture unsigned PSBT",
        ),
      );
    }
    if (vector.artifact.signatures.length === 0) {
      issues.push(
        issue(
          vector.id,
          "artifact.signatures",
          "Ledger exact signature record list is empty",
        ),
      );
    }
  }
  if (vector.artifact.type === "trezor-connect-transaction") {
    if (vector.artifact.sourcePsbtBase64 !== vector.unsignedPsbtBase64) {
      issues.push(
        issue(
          vector.id,
          "artifact.sourcePsbtBase64",
          "Trezor source PSBT differs from fixture unsigned PSBT",
        ),
      );
    }
    if (vector.artifact.connectSignatures.length === 0) {
      issues.push(
        issue(
          vector.id,
          "artifact.connectSignatures",
          "Trezor Connect signature array is empty",
        ),
      );
    }
  }
  return issues;
};

const validateReplayEvidence = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  if ((vector.network as string) === "mainnet") {
    issues.push(
      issue(
        vector.id,
        "network",
        "hardware fixture evidence must use regtest, signet, or testnet only",
      ),
    );
  }
  if (
    vector.evidence.bitcoinCoreVersion !== CORE_PROOF.coreSubversion ||
    vector.evidence.bitcoinCoreImageDigest !== CORE_PROOF.coreImage
  ) {
    issues.push(
      issue(
        vector.id,
        "evidence.bitcoinCoreImageDigest",
        "Bitcoin Core evidence must match the current pinned proof manifest",
      ),
    );
  }
  return issues;
};

const collectStringValues = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectStringValues);
  if (value && typeof value === "object")
    return Object.values(value).flatMap(collectStringValues);
  return [];
};

const containsBip39Mnemonic = (value: string): boolean => {
  const words =
    value
      .normalize("NFKD")
      .toLowerCase()
      .match(/[\p{L}\p{M}]+/gu) ?? [];
  return BIP39_WORD_COUNTS.some((wordCount) => {
    if (words.length < wordCount) return false;
    for (let start = 0; start <= words.length - wordCount; start += 1) {
      const candidateWords = words.slice(start, start + wordCount);
      const matchingWordlists = BIP39_WORDLISTS.filter(({ vocabulary }) =>
        candidateWords.every((word) => vocabulary.has(word)),
      );
      if (
        matchingWordlists.some(({ words: candidateWordlist }) =>
          validateMnemonic(candidateWords.join(" "), candidateWordlist),
        )
      )
        return true;
    }
    return false;
  });
};

const validateSecretReview = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const values = collectStringValues(vector);
  const matches = SECRET_PATTERNS.filter((pattern) =>
    values.some((value) => pattern.test(value)),
  );
  const issues = matches.map((pattern) =>
    issue(
      vector.id,
      "sanitization",
      `secret-shaped material matched ${pattern}`,
    ),
  );
  if (values.some(containsBip39Mnemonic)) {
    issues.push(
      issue(vector.id, "sanitization", "valid BIP39 mnemonic detected"),
    );
  }
  return issues;
};

export function validateHardwareSignedFixtureIntake(
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext = EMPTY_HARDWARE_EVIDENCE_TRUST,
): HardwareSignedFixtureIntakeIssue[] {
  return [
    ...validatePhysicalProvenance(vector, context),
    ...validateCanonicalPolicy(vector),
    ...validateArtifactContract(vector),
    ...validateAddressEvidence(vector),
    ...validateNegativeControls(vector),
    ...validateSoftwareGates(vector),
    ...validateSanitization(vector),
    ...validateReplayEvidence(vector),
    ...validateSecretReview(vector),
  ];
}

export function assertHardwareSignedFixtureIntake(
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext = EMPTY_HARDWARE_EVIDENCE_TRUST,
): void {
  const issues = validateHardwareSignedFixtureIntake(vector, context);
  if (issues.length === 0) return;

  throw new Error(
    `Hardware signed fixture ${vector.id || "<missing id>"} failed intake validation: ` +
      issues.map(({ field, message }) => `${field}: ${message}`).join("; "),
  );
}

export function validateHardwareSignedFixtureSet(
  fixtures: HardwareSignedPsbtVector[],
  unsupportedRows: UnsupportedHardwareSignedRow[],
  context: HardwareEvidenceVerificationContext = EMPTY_HARDWARE_EVIDENCE_TRUST,
): HardwareSignedFixtureIntakeIssue[] {
  const seenRows = new Set<string>();
  const seenIds = new Set<string>();
  const unsupported = new Set(unsupportedRows.map(rowKey));
  return fixtures.flatMap((vector) => {
    const key = rowKey(vector);
    const issues = validateHardwareSignedFixtureIntake(vector, context);
    if (seenRows.has(key)) {
      issues.push(
        issue(vector.id, "fixtureSet", `duplicate hardware fixture row ${key}`),
      );
    }
    if (vector.id.trim() === "" || seenIds.has(vector.id)) {
      issues.push(
        issue(vector.id, "fixtureSet", "hardware fixture IDs must be nonempty and unique"),
      );
    }
    if (unsupported.has(key)) {
      issues.push(
        issue(
          vector.id,
          "fixtureSet",
          `fixture row ${key} conflicts with unsupported product decision`,
        ),
      );
    }
    seenRows.add(key);
    seenIds.add(vector.id);
    return issues;
  });
}
