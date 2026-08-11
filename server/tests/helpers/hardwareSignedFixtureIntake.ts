import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateMnemonic, wordlists } from "bip39";
import {
  WALLET_POLICY_REGISTRY,
  WALLET_POLICY_REGISTRY_VERSION,
} from "@sanctuary/shared/constants/walletPolicy";
import {
  COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES,
  MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES,
  REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES,
  TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES,
  type HardwareSignedNegativeControlCase,
  type HardwareSignedPsbtVector,
  type HardwareSignedScriptType,
  type RequiredHardwareSignedRow,
  type UnsupportedHardwareSignedRow,
} from "../fixtures/hardware-signed-psbt-vectors";
import {
  defaultCommitReachability,
  EMPTY_HARDWARE_EVIDENCE_TRUST,
  sourceManifestMatches,
  validateCoreReceipt,
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
const BIP39_WORD_COUNTS = [12, 15, 18, 21, 24] as const;
const BIP39_WORDLISTS = [
  ...new Set(Object.values(wordlists as Record<string, string[]>)),
].map((words) => ({ words, vocabulary: new Set(words) }));
const MAX_EVIDENCE_AGE_MS = 180 * 24 * 60 * 60 * 1000;
const PACKAGE_LOCK_PATH = fileURLToPath(
  new URL("../../../package-lock.json", import.meta.url),
);
const CORE_PROOF_PATH = fileURLToPath(
  new URL("../../../scripts/verify-psbt/proof-manifest.json", import.meta.url),
);
const PACKAGE_LOCK = JSON.parse(readFileSync(PACKAGE_LOCK_PATH, "utf8")) as {
  packages: Record<string, { version?: string; integrity?: string }>;
};
const CORE_PROOF = JSON.parse(readFileSync(CORE_PROOF_PATH, "utf8")) as {
  coreImage: string;
  coreSubversion: string;
};

const EXPECTED_POLICY_ID: Record<HardwareSignedScriptType, string> = {
  p2pkh: "single-sig-legacy-bip44-v1",
  p2wpkh: "single-sig-native-segwit-bip84-v1",
  "p2sh-p2wpkh": "single-sig-nested-segwit-bip49-v1",
  p2tr: "single-sig-taproot-bip86-v1",
  p2wsh: "multisig-native-segwit-bip48-2-v1",
  "p2sh-p2wsh": "multisig-nested-segwit-bip48-1-v1",
};

const EXPECTED_SDK_PACKAGE: Record<HardwareSignedPsbtVector["vendor"], string> =
  {
    ledger: "@ledgerhq/ledger-bitcoin",
    trezor: "@trezor/connect-web",
    bitbox: "bitbox02-api",
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
  const vendorGates = vector.vendor === "trezor"
    ? TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES
    : vector.vendor === "ledger"
      ? LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES
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
      ...vector.artifact.signatures.map((signature) => JSON.stringify(signature)),
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
  if (vector.fixtureSchemaVersion !== 3) {
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
  if (!IMAGE_DIGEST.test(evidence.sanctuaryImageDigest)) {
    issues.push(
      issue(
        vector.id,
        "evidence.sanctuaryImageDigest",
        "Sanctuary image must be pinned by SHA-256 digest",
      ),
    );
  }
  return issues;
};

const validateSdkAndSourceProvenance = (
  vector: HardwareSignedPsbtVector,
): HardwareSignedFixtureIntakeIssue[] => {
  const issues: HardwareSignedFixtureIntakeIssue[] = [];
  const evidence = vector.evidence;
  if (!SRI_SHA512.test(evidence.sdkIntegrity)) {
    issues.push(
      issue(
        vector.id,
        "evidence.sdkIntegrity",
        "vendor SDK integrity must be an npm SHA-512 SRI value",
      ),
    );
  }
  const expectedPackage = EXPECTED_SDK_PACKAGE[vector.vendor];
  const lockedSdk = PACKAGE_LOCK.packages[`node_modules/${expectedPackage}`];
  if (
    evidence.sdkPackage !== expectedPackage ||
    evidence.sdkVersion !== lockedSdk?.version ||
    evidence.sdkIntegrity !== lockedSdk?.integrity
  ) {
    issues.push(
      issue(
        vector.id,
        "evidence.sdkIntegrity",
        "vendor SDK evidence must exactly match the current lockfile",
      ),
    );
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
    ["sdkVersion", evidence.sdkVersion],
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
  return issues;
};

const validatePhysicalProvenance = (
  vector: HardwareSignedPsbtVector,
  context: HardwareEvidenceVerificationContext,
): HardwareSignedFixtureIntakeIssue[] => [
  ...validateProvenanceIdentity(vector),
  ...validateSdkAndSourceProvenance(vector),
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
  if (vector.vendor === "ledger" && vector.artifact.type !== "ledger-signed-psbt") {
    issues.push(
      issue(
        vector.id,
        "artifact.type",
        "Ledger evidence must retain its source PSBT, exact signature records, and reconstructed PSBT",
      ),
    );
  }
  if (vector.vendor === "bitbox" && vector.artifact.type !== "signed-psbt") {
    issues.push(issue(
      vector.id,
      "artifact.type",
      "BitBox evidence must retain the adapter-returned signed PSBT",
    ));
  }
  if (vector.artifact.type === "ledger-signed-psbt") {
    if (vector.artifact.sourcePsbtBase64 !== vector.unsignedPsbtBase64) {
      issues.push(issue(
        vector.id,
        "artifact.sourcePsbtBase64",
        "Ledger source PSBT differs from fixture unsigned PSBT",
      ));
    }
    if (vector.artifact.signatures.length === 0) {
      issues.push(issue(
        vector.id,
        "artifact.signatures",
        "Ledger exact signature record list is empty",
      ));
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
  const seen = new Set<string>();
  const unsupported = new Set(unsupportedRows.map(rowKey));
  return fixtures.flatMap((vector) => {
    const key = rowKey(vector);
    const issues = validateHardwareSignedFixtureIntake(vector, context);
    if (seen.has(key)) {
      issues.push(
        issue(vector.id, "fixtureSet", `duplicate hardware fixture row ${key}`),
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
    seen.add(key);
    return issues;
  });
}
