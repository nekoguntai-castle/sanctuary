/**
 * Hardware-signed PSBT fixture intake.
 *
 * This artifact list is intentionally empty until sanitized Ledger, Trezor,
 * Jade, and BitBox artifacts are captured from physical devices. Unsupported rows are
 * recorded separately so missing evidence is not confused with blocked product
 * behavior.
 */

export type HardwareWalletVendor = "ledger" | "trezor" | "jade" | "bitbox";

export type HardwareSignedScriptType =
  "p2pkh" | "p2wpkh" | "p2sh-p2wpkh" | "p2tr" | "p2wsh" | "p2sh-p2wsh";

export type HardwareSignedNetwork = "regtest" | "testnet" | "signet";
export type HardwareSignedSoftwareGateStatus = "passed";
export const JADE_PLUS_PHYSICAL_MODEL = "Jade Plus" as const;
export const JADE_PLUS_PHYSICAL_TRANSPORT = "webserial" as const;
export const LEDGER_PHYSICAL_MODELS = [
  "Ledger Nano S Plus",
  "Ledger Nano X",
] as const;
export const TREZOR_PHYSICAL_MODELS = [
  "Trezor Model One",
  "Trezor Model T",
  "Trezor Safe 3",
  "Trezor Safe 5",
  "Trezor Safe 7",
] as const;
export const BITBOX02_PHYSICAL_MODELS = [
  "BitBox02 BTC-only",
  "BitBox02 Multi",
] as const;
export type HardwareSignedNegativeControlCase =
  | "wrong-network-or-account-path"
  | "tampered-recipient"
  | "tampered-amount-or-fee"
  | "missing-change-metadata"
  | "wrong-cosigner-or-fingerprint"
  | "below-quorum-multisig";

export interface RequiredHardwareSignedRow {
  vendor: HardwareWalletVendor;
  scriptType: HardwareSignedScriptType;
}

export interface UnsupportedHardwareSignedRow extends RequiredHardwareSignedRow {
  reason: string;
  productDecision: "blocked" | "not-supported-by-device";
}

export interface BlockedHardwareSignedRow extends RequiredHardwareSignedRow {
  reason: string;
  productDecision: "blocked-pending-physical-evidence";
}

export interface HardwareSignedExpectedOutput {
  index: number;
  address: string;
  valueSats: number;
  isChange: boolean;
  derivationPath?: string;
}

export interface HardwareSignedAddressEvidence {
  path: string;
  sanctuaryAddress: string;
  deviceAddress: string;
  coreAddress: string;
  displayedOnPhysicalDevice: true;
}

export interface HardwareSignedNegativeControlEvidence {
  caseName: HardwareSignedNegativeControlCase;
  expectedFailure: string;
  observedFailure: string;
  passed: true;
}

export interface HardwareSignedSoftwareGateEvidence {
  command: string;
  status: HardwareSignedSoftwareGateStatus;
  capturedAt: string;
}

export interface HardwareSignedSanitizationReview {
  reviewer: string;
  nonMainnetFunds: true;
  dedicatedOrWipeableDevice: true;
  noSeedsPinsPassphrasesPairingSecrets: true;
  noHostAuthTokens: true;
  sanitizedArtifactsReviewed: true;
}

export type HardwareSignedCapability =
  | "import" | "account_add" | "display" | "sign" | "finalize" | "broadcast";

export interface HardwareSignedCosigner {
  fingerprint: string;
  accountPath: string;
  accountXpub: string;
}

export interface HardwareSignedPsbtArtifact {
  type: "signed-psbt";
  signedPsbtBase64: string;
}

export interface LedgerSignedPsbtArtifact {
  type: "ledger-signed-psbt";
  sourcePsbtBase64: string;
  signatures: Array<{
    inputIndex: number;
    pubkey: string;
    signature: string;
    tapleafHash?: string;
  }>;
  reconstructedPsbtBase64: string;
}

export interface TrezorConnectTransactionArtifact {
  type: "trezor-connect-transaction";
  sourcePsbtBase64: string;
  connectSignatures: string[];
  serializedTxHex: string;
}

export type HardwareSignedArtifact =
  | HardwareSignedPsbtArtifact
  | LedgerSignedPsbtArtifact
  | TrezorConnectTransactionArtifact;

export type HardwareEvidenceSdkPackage =
  | "@ledgerhq/ledger-bitcoin"
  | "@ledgerhq/hw-transport-webusb"
  | "@trezor/connect"
  | "@trezor/connect-web"
  | "cbor-x"
  | "bitbox02-api";

export interface HardwareEvidenceSdkSubject {
  package: HardwareEvidenceSdkPackage;
  version: string;
  integrity: string;
}

export interface SanctuaryApplicationImageSubject {
  role: "frontend" | "backend";
  image: string;
  platform: "linux/amd64" | "linux/arm64";
  manifestDigest: string;
  configDigest: string;
  gitRevision: string;
  appVersion: string;
  packageLockSha256: string;
  sourceManifestSha256: string;
}

export interface SignedEvidenceReceipt {
  algorithm: "ed25519";
  keyId: string;
  payloadSha256: string;
  signatureBase64: string;
}

export interface HardwareSignedPsbtVector {
  fixtureSchemaVersion: 5;
  evidenceTier: "physical-device";
  id: string;
  description: string;
  vendor: HardwareWalletVendor;
  scriptType: HardwareSignedScriptType;
  network: HardwareSignedNetwork;
  coveredCapabilities: HardwareSignedCapability[];
  device: {
    model: string;
    firmwareVersion: string;
    bitcoinAppVersion?: string;
    transport: "webusb" | "webhid" | "webserial" | "trezor-connect";
    transportVersion: string;
    companionVersion?: string;
    emulated: false;
  };
  account: {
    fingerprint: string;
    accountPath: string;
    accountXpub: string;
    canonicalPolicyId: string;
    canonicalPolicyVersion: number;
    multisig?: {
      threshold: number;
      cosigners: HardwareSignedCosigner[];
    };
  };
  unsignedPsbtBase64: string;
  artifact: HardwareSignedArtifact;
  inputValueSats: number;
  expectedFeeSats: number;
  expectedVsize: number;
  expectedTxid: string;
  expectedOutputs: HardwareSignedExpectedOutput[];
  addressEvidence: HardwareSignedAddressEvidence[];
  negativeControls: HardwareSignedNegativeControlEvidence[];
  softwareGates: HardwareSignedSoftwareGateEvidence[];
  sanitization: HardwareSignedSanitizationReview;
  signedBy: Array<{
    fingerprint: string;
    derivationPath: string;
    pubkey: string;
  }>;
  evidence: {
    capturedAt: string;
    expiresAt: string;
    operator: string;
    testedCommitSha: string;
    application: {
      appVersion: string;
      packageLockSha256: string;
      sourceManifestSha256: string;
      images: SanctuaryApplicationImageSubject[];
      receipt: SignedEvidenceReceipt;
    };
    sdkPackages: HardwareEvidenceSdkSubject[];
    sourceManifest: Array<{
      path: string;
      sha256: string;
    }>;
    hostOs: string;
    browser: string;
    captureId: string;
    unsignedPsbtSha256: string;
    signedArtifactSha256: string;
    changeRecognizedOnDevice: true;
    bitcoinCoreVersion: string;
    bitcoinCoreImageDigest: string;
    coreAcceptance: {
      invocationId: string;
      requestJson: string;
      responseJson: string;
      receipt: {
        algorithm: "ed25519";
        keyId: string;
        payloadSha256: string;
        signatureBase64: string;
      };
    };
    independentReview: {
      reviewerKeyId: string;
      receipt: SignedEvidenceReceipt;
    };
    notes?: string;
  };
}

export const REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES = [
  "/0/0",
  "/0/1",
  "/0/19",
  "/0/999",
  "/1/0",
  "/1/1",
  "/1/19",
] as const;

export const COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS: HardwareSignedNegativeControlCase[] =
  [
    "wrong-network-or-account-path",
    "tampered-recipient",
    "tampered-amount-or-fee",
    "missing-change-metadata",
  ];

export const MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS: HardwareSignedNegativeControlCase[] =
  ["wrong-cosigner-or-fingerprint", "below-quorum-multisig"];

export const REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES = [
  "npm --prefix scripts/verify-addresses run verify",
  "npm --prefix scripts/verify-psbt run verify",
  "npm run test:run -- tests/services/hardwareWallet.trezorAdapter.test.ts tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.jadeAdapter.test.ts tests/services/hardwareWallet.bitboxAdapter.test.ts",
  "npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts",
  "npm run typecheck:app",
  "npm run typecheck:tests",
  "npm --prefix server run typecheck:tests",
  "npm run quality:lizard",
] as const;

export const TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES = [
  "npm run test:trezor-emulator-proof",
] as const;

export const LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES = [
  "npm run test:ledger-emulator-proof",
] as const;

export const JADE_HARDWARE_SIGNED_SOFTWARE_GATES = [
  "npm run test:jade-emulator-proof",
] as const;

export const REQUIRED_HARDWARE_SIGNED_ROWS: RequiredHardwareSignedRow[] = [
  { vendor: "ledger", scriptType: "p2pkh" },
  { vendor: "ledger", scriptType: "p2wpkh" },
  { vendor: "ledger", scriptType: "p2sh-p2wpkh" },
  { vendor: "ledger", scriptType: "p2tr" },
  { vendor: "ledger", scriptType: "p2wsh" },
  { vendor: "ledger", scriptType: "p2sh-p2wsh" },
  { vendor: "trezor", scriptType: "p2wpkh" },
  { vendor: "trezor", scriptType: "p2sh-p2wpkh" },
  { vendor: "trezor", scriptType: "p2tr" },
  { vendor: "trezor", scriptType: "p2wsh" },
  { vendor: "trezor", scriptType: "p2sh-p2wsh" },
  { vendor: "jade", scriptType: "p2pkh" },
  { vendor: "jade", scriptType: "p2wpkh" },
  { vendor: "jade", scriptType: "p2sh-p2wpkh" },
  { vendor: "jade", scriptType: "p2tr" },
  { vendor: "jade", scriptType: "p2wsh" },
  { vendor: "jade", scriptType: "p2sh-p2wsh" },
  { vendor: "bitbox", scriptType: "p2wpkh" },
  { vendor: "bitbox", scriptType: "p2sh-p2wpkh" },
  { vendor: "bitbox", scriptType: "p2tr" },
  { vendor: "bitbox", scriptType: "p2wsh" },
  { vendor: "bitbox", scriptType: "p2sh-p2wsh" },
];

export const UNSUPPORTED_HARDWARE_SIGNED_ROWS: UnsupportedHardwareSignedRow[] =
  [
    {
      vendor: "ledger",
      scriptType: "p2wsh",
      reason:
        "Current Ledger signing adapter builds single-sig DefaultWalletPolicy templates only; " +
        "multisig Ledger signing is not exposed in the product.",
      productDecision: "blocked",
    },
    {
      vendor: "ledger",
      scriptType: "p2sh-p2wsh",
      reason:
        "Current Ledger signing adapter builds single-sig DefaultWalletPolicy templates only; " +
        "multisig Ledger signing is not exposed in the product.",
      productDecision: "blocked",
    },
    {
      vendor: "jade",
      scriptType: "p2wsh",
      reason:
        "Current Jade adapter explicitly rejects multisig signing; multisig Jade signing is not exposed in the product.",
      productDecision: "blocked",
    },
    {
      vendor: "jade",
      scriptType: "p2sh-p2wsh",
      reason:
        "Current Jade adapter explicitly rejects multisig signing; multisig Jade signing is not exposed in the product.",
      productDecision: "blocked",
    },
    {
      vendor: "bitbox",
      scriptType: "p2wsh",
      reason:
        "Current BitBox02 signing adapter uses btcSignSimple single-sig script configs only; " +
        "multisig BitBox signing is not exposed in the product.",
      productDecision: "blocked",
    },
    {
      vendor: "bitbox",
      scriptType: "p2sh-p2wsh",
      reason:
        "Current BitBox02 signing adapter uses btcSignSimple single-sig script configs only; " +
        "multisig BitBox signing is not exposed in the product.",
      productDecision: "blocked",
    },
  ];

/**
 * These rows are implemented far enough for software/emulator conformance, but
 * remain disabled until current, sanitized physical-device evidence is checked
 * in. A block never counts as physical evidence or satisfies strict fixture
 * completeness.
 */
export const BLOCKED_HARDWARE_SIGNED_ROWS: BlockedHardwareSignedRow[] = [
  ...["p2pkh", "p2wpkh", "p2sh-p2wpkh", "p2tr"].map((scriptType) => ({
    vendor: "ledger" as const,
    scriptType: scriptType as HardwareSignedScriptType,
    reason:
      "Ledger capability remains disabled until a current Tier 3 physical-device artifact is reviewed.",
    productDecision: "blocked-pending-physical-evidence" as const,
  })),
  ...["p2wpkh", "p2sh-p2wpkh", "p2tr", "p2wsh", "p2sh-p2wsh"].map(
    (scriptType) => ({
      vendor: "trezor" as const,
      scriptType: scriptType as HardwareSignedScriptType,
      reason:
        "Trezor capability remains disabled until a current Tier 3 physical-device artifact is reviewed.",
      productDecision: "blocked-pending-physical-evidence" as const,
    }),
  ),
  ...["p2pkh", "p2wpkh", "p2sh-p2wpkh", "p2tr"].map((scriptType) => ({
    vendor: "jade" as const,
    scriptType: scriptType as HardwareSignedScriptType,
    reason:
      "Jade capability remains disabled until a current Tier 3 Jade Plus physical-device artifact is reviewed.",
    productDecision: "blocked-pending-physical-evidence" as const,
  })),
  ...["p2wpkh", "p2sh-p2wpkh", "p2tr"].map((scriptType) => ({
    vendor: "bitbox" as const,
    scriptType: scriptType as HardwareSignedScriptType,
    reason:
      "BitBox02 capability remains disabled until current Tier 3 physical-device artifacts are reviewed.",
    productDecision: "blocked-pending-physical-evidence" as const,
  })),
];

export const HARDWARE_SIGNED_PSBT_VECTORS: HardwareSignedPsbtVector[] = [];
