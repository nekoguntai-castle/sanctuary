import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { BIP32Factory } from "bip32";
import { entropyToMnemonic, wordlists } from "bip39";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { describe, expect, it } from "vitest";
import {
  BLOCKED_HARDWARE_SIGNED_ROWS,
  COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  HARDWARE_SIGNED_PSBT_VECTORS,
  JADE_HARDWARE_SIGNED_SOFTWARE_GATES,
  LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES,
  MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS,
  REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES,
  REQUIRED_HARDWARE_SIGNED_ROWS,
  REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES,
  TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES,
  UNSUPPORTED_HARDWARE_SIGNED_ROWS,
  type HardwareSignedAddressEvidence,
  type HardwareSignedArtifact,
  type HardwareSignedExpectedOutput,
  type HardwareSignedNegativeControlEvidence,
  type HardwareSignedPsbtVector,
  type HardwareSignedSoftwareGateEvidence,
  type TrezorConnectTransactionArtifact,
} from "@fixtures/hardware-signed-psbt-vectors";
import {
  assertHardwareSignedFixtureIntake as assertHardwareSignedFixtureIntakeRaw,
  validateHardwareSignedFixtureSet as validateHardwareSignedFixtureSetRaw,
} from "../../../helpers/hardwareSignedFixtureIntake";
import {
  missingHardwareSignedRows,
  expectedLedgerSignaturePubkey,
  replayHardwareSignedVector as replayHardwareSignedVectorRaw,
  unaccountedHardwareSignedRows,
} from "../../../helpers/hardwareSignedPsbtReplay";
import {
  applicationReceiptPayload,
  coreReceiptPayload,
  currentApplicationVersion,
  currentHardwareEvidenceSourceManifest,
  currentPackageLockSha256,
  hardwareEvidenceSourceManifestSha256,
  type HardwareEvidenceVerificationContext,
} from "../../../helpers/hardwareSignedEvidenceProvenance";
import {
  validateHardwareAddressDerivation,
  validateHardwarePsbtPolicyBinding,
} from "../../../helpers/hardwareSignedPolicyBinding";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const NETWORK = bitcoin.networks.regtest;
const ACCOUNT_PATH = "m/84'/1'/0'";
const ROOT = bip32.fromSeed(Buffer.alloc(32, 7), NETWORK);
const ACCOUNT = ROOT.derivePath(ACCOUNT_PATH);
const INPUT = ACCOUNT.derive(0).derive(0);
const CORE_RECEIPT_KEY_ID = "unit-test-core-receipt";
const CORE_RECEIPT_KEYS = generateKeyPairSync("ed25519");
const APPLICATION_RECEIPT_KEY_ID = "unit-test-application-receipt";
const APPLICATION_RECEIPT_KEYS = generateKeyPairSync("ed25519");
const TEST_CONTEXT: HardwareEvidenceVerificationContext = {
  trustedCoreReceiptKeys: {
    [CORE_RECEIPT_KEY_ID]: CORE_RECEIPT_KEYS.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  },
  trustedApplicationReceiptKeys: {
    [APPLICATION_RECEIPT_KEY_ID]: APPLICATION_RECEIPT_KEYS.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
  },
  isTestedCommitReachable: () => true,
  now: Date.parse("2026-08-11T00:00:00.000Z"),
};

const assertHardwareSignedFixtureIntake = (
  vector: HardwareSignedPsbtVector,
): void => assertHardwareSignedFixtureIntakeRaw(vector, TEST_CONTEXT);
const validateHardwareSignedFixtureSet = (
  fixtures: HardwareSignedPsbtVector[],
  unsupported: typeof UNSUPPORTED_HARDWARE_SIGNED_ROWS,
) => validateHardwareSignedFixtureSetRaw(fixtures, unsupported, TEST_CONTEXT);
const replayHardwareSignedVector = (vector: HardwareSignedPsbtVector) =>
  replayHardwareSignedVectorRaw(vector, TEST_CONTEXT);
const SIGNER = {
  fingerprint: Buffer.from(ROOT.fingerprint).toString("hex"),
  derivationPath: `${ACCOUNT_PATH}/0/0`,
  pubkey: Buffer.from(INPUT.publicKey).toString("hex"),
};

function generatedSignedVector(_scriptType: "p2wpkh") {
  const payment = bitcoin.payments.p2wpkh({
    pubkey: Uint8Array.from(INPUT.publicKey),
    network: NETWORK,
  });
  const change = ACCOUNT.derive(1).derive(0);
  const changePayment = bitcoin.payments.p2wpkh({
    pubkey: Uint8Array.from(change.publicKey),
    network: NETWORK,
  });
  const recipient = bitcoin.payments.p2wpkh({
    pubkey: Uint8Array.from(
      bip32.fromSeed(Buffer.alloc(32, 8), NETWORK).publicKey,
    ),
    network: NETWORK,
  });
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32), 0xffffffff);
  previous.addOutput(payment.output!, 100_000n);
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: previous.toBuffer(),
    witnessUtxo: { script: payment.output!, value: 100_000n },
    bip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(ROOT.fingerprint),
        path: SIGNER.derivationPath,
        pubkey: Uint8Array.from(INPUT.publicKey),
      },
    ],
  });
  psbt.addOutput({ address: recipient.address!, value: 50_000n });
  psbt.addOutput({
    address: changePayment.address!,
    value: 49_000n,
    bip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(ROOT.fingerprint),
        path: `${ACCOUNT_PATH}/1/0`,
        pubkey: Uint8Array.from(change.publicKey),
      },
    ],
  });
  const signed = psbt.clone();
  signed.signInput(0, INPUT);
  const finalized = signed.clone();
  finalized.finalizeAllInputs();
  const tx = finalized.extractTransaction();
  return {
    unsignedPsbtBase64: psbt.toBase64(),
    signedPsbtBase64: signed.toBase64(),
    finalTxHex: tx.toHex(),
    expectedFee: 1_000,
    expectedVsize: tx.virtualSize(),
    expectedTxid: tx.getId(),
  };
}

function outputAddress(output: bitcoin.Transaction["outs"][number]): string {
  return bitcoin.address.fromOutputScript(output.script, NETWORK);
}

function expectedOutputs(finalTxHex: string): HardwareSignedExpectedOutput[] {
  const tx = bitcoin.Transaction.fromHex(finalTxHex);
  return tx.outs.map((output, index) => ({
    index,
    address: outputAddress(output),
    valueSats: Number(output.value),
    isChange: index === 1,
    derivationPath: index === 1 ? "m/84'/1'/0'/1/0" : undefined,
  }));
}

function inputValueSats(unsignedPsbtBase64: string): number {
  const psbt = bitcoin.Psbt.fromBase64(unsignedPsbtBase64, {
    network: NETWORK,
  });
  return psbt.data.inputs.reduce(
    (total, input) => total + Number(input.witnessUtxo?.value ?? 0n),
    0,
  );
}

function syntheticAddressEvidence(
  accountPath = ACCOUNT_PATH,
): HardwareSignedAddressEvidence[] {
  return REQUIRED_HARDWARE_SIGNED_ADDRESS_PATH_SUFFIXES.map(
    (suffix, index) => ({
      path: `${accountPath}${suffix}`,
      sanctuaryAddress: bitcoin.payments.p2wpkh({
        pubkey: Uint8Array.from(ACCOUNT.derivePath(suffix.slice(1)).publicKey),
        network: NETWORK,
      }).address!,
      deviceAddress: bitcoin.payments.p2wpkh({
        pubkey: Uint8Array.from(ACCOUNT.derivePath(suffix.slice(1)).publicKey),
        network: NETWORK,
      }).address!,
      coreAddress: bitcoin.payments.p2wpkh({
        pubkey: Uint8Array.from(ACCOUNT.derivePath(suffix.slice(1)).publicKey),
        network: NETWORK,
      }).address!,
      displayedOnPhysicalDevice: true,
    }),
  );
}

function syntheticSoftwareGates(
  vendor: HardwareSignedPsbtVector["vendor"] = "ledger",
): HardwareSignedSoftwareGateEvidence[] {
  const vendorGates =
    vendor === "trezor"
      ? TREZOR_HARDWARE_SIGNED_SOFTWARE_GATES
      : vendor === "ledger"
        ? LEDGER_HARDWARE_SIGNED_SOFTWARE_GATES
        : vendor === "jade"
          ? JADE_HARDWARE_SIGNED_SOFTWARE_GATES
          : [];
  const commands = [...REQUIRED_HARDWARE_SIGNED_SOFTWARE_GATES, ...vendorGates];
  return commands.map((command) => ({
    command,
    status: "passed",
    capturedAt: "2026-08-10T00:00:00.000Z",
  }));
}

function syntheticNegativeControls(
  scriptType = "p2wpkh",
): HardwareSignedNegativeControlEvidence[] {
  const multisigControls =
    scriptType === "p2wsh" || scriptType === "p2sh-p2wsh"
      ? MULTISIG_HARDWARE_SIGNED_NEGATIVE_CONTROLS
      : [];
  return [...COMMON_HARDWARE_SIGNED_NEGATIVE_CONTROLS, ...multisigControls].map(
    (caseName) => ({
      caseName,
      expectedFailure: "fixture must fail closed",
      observedFailure: "fixture failed before signing or replay",
      passed: true,
    }),
  );
}

function hash(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactHash(artifact: HardwareSignedArtifact): string {
  if (artifact.type === "signed-psbt")
    return hash(Buffer.from(artifact.signedPsbtBase64, "base64"));
  if (artifact.type === "ledger-signed-psbt") {
    return hash(
      [
        artifact.sourcePsbtBase64,
        ...artifact.signatures.map((signature) => JSON.stringify(signature)),
        artifact.reconstructedPsbtBase64,
      ].join("\n"),
    );
  }
  return hash(
    [
      artifact.sourcePsbtBase64,
      ...artifact.connectSignatures,
      artifact.serializedTxHex,
    ].join("\n"),
  );
}

function physicalEvidence(
  unsignedPsbtBase64: string,
  artifact: HardwareSignedArtifact,
  finalTxHex: string,
  vendor: HardwareSignedPsbtVector["vendor"],
) {
  const sdkPackages =
    vendor === "trezor"
      ? [
          {
            package: "@trezor/connect" as const,
            version: "9.7.3",
            integrity:
              "sha512-oAOfvJHT8tPqOXTmCOhn8uTZcoqSDuWAiWXQegx7C46tq+NLg+enkYXxUYEHq/9PmfZAOrUT9VMxZDsXM2thkA==",
          },
          {
            package: "@trezor/connect-web" as const,
            version: "9.7.3",
            integrity:
              "sha512-oTI/v9sUJMvLZgLa0seSGyPaumXydRYeAT4OVTQxIaEiL1hOA0yH+UvEfT4WKwxbxOtOqWosD8chP3uuWSArcg==",
          },
        ]
      : vendor === "bitbox"
        ? [
            {
              package: "bitbox02-api" as const,
              version: "0.15.1",
              integrity:
                "sha512-zeuHVF3kAQsJsa2q1fCtktVFiJV/G8nMuKonwMMsCx1RY0mzqc33RGlayTrvLrgs3fj30wLkWmXrgPmQCIJxmg==",
            },
          ]
        : vendor === "jade"
          ? [
              {
                package: "cbor-x" as const,
                version: "1.6.4",
                integrity:
                  "sha512-UGKHjp6RHC6QuZ2yy5LCKm7MojM4716DwoSaqwQpaH4DvZvbBTGcoDNTiG9Y2lByXZYFEs9WRkS5tLl96IrF1Q==",
              },
            ]
          : [
              {
                package: "@ledgerhq/ledger-bitcoin" as const,
                version: "0.3.1",
                integrity:
                  "sha512-rzgU7+rvSsYVSI3cNAIfk9NUaLF1k4aFl3MuU66zV8Pyvy7rikcrbyPaPIAdNIdqYVrOE7evDB0b6aEwTRqLHg==",
              },
              {
                package: "@ledgerhq/hw-transport-webusb" as const,
                version: "6.34.4",
                integrity:
                  "sha512-asBy3Uu8Cl/leyEAY5M27S/oAZwCpYuRPi9Sz6fgEgF2clX8Sold0iSI+MD0sne3PqcLK1K8V6H4MxviHH7sVw==",
              },
            ];
  const tx = bitcoin.Transaction.fromHex(finalTxHex);
  const invocationId = "core-acceptance-physical-capture-001";
  const testedCommitSha = "1".repeat(40);
  const packageLockSha256 = currentPackageLockSha256();
  const sourceManifestSha256 = hardwareEvidenceSourceManifestSha256(vendor);
  const appVersion = currentApplicationVersion();
  const application = {
    appVersion,
    packageLockSha256,
    sourceManifestSha256,
    images: (["frontend", "backend"] as const).map((role, index) => ({
      role,
      image: `sanctuary-${role}:physical-capture`,
      platform: "linux/amd64" as const,
      manifestDigest: `sha256:${String(index + 2).repeat(64)}`,
      configDigest: `sha256:${String(index + 4).repeat(64)}`,
      gitRevision: testedCommitSha,
      appVersion,
      packageLockSha256,
      sourceManifestSha256,
    })),
    receipt: {
      algorithm: "ed25519" as const,
      keyId: APPLICATION_RECEIPT_KEY_ID,
      payloadSha256: "",
      signatureBase64: "",
    },
  };
  return {
    capturedAt: "2026-08-10T00:00:00.000Z",
    expiresAt: "2027-02-05T00:00:00.000Z",
    operator: "fixture-operator",
    testedCommitSha,
    application,
    sdkPackages,
    sourceManifest: currentHardwareEvidenceSourceManifest(vendor),
    hostOs: "Ubuntu 24.04.3 LTS",
    browser: "Chromium 140.0.7339.80",
    captureId: "physical-capture-001",
    unsignedPsbtSha256: hash(Buffer.from(unsignedPsbtBase64, "base64")),
    signedArtifactSha256: artifactHash(artifact),
    changeRecognizedOnDevice: true as const,
    bitcoinCoreVersion: "/Satoshi:29.0.0/",
    bitcoinCoreImageDigest:
      "bitcoin/bitcoin:29.0@sha256:a6aa8a9e349b4108d13c558dbe43064057bd7b6474b858966884f9cb95b7ed78",
    coreAcceptance: {
      invocationId,
      requestJson: JSON.stringify({
        jsonrpc: "1.0",
        id: invocationId,
        method: "testmempoolaccept",
        params: [[finalTxHex]],
      }),
      responseJson: JSON.stringify({
        result: [
          {
            txid: tx.getId(),
            wtxid: Buffer.from(tx.getHash(true)).reverse().toString("hex"),
            allowed: true,
            vsize: tx.virtualSize(),
            fees: { base: 0.00001 },
          },
        ],
        error: null,
        id: invocationId,
      }),
      receipt: {
        algorithm: "ed25519" as const,
        keyId: CORE_RECEIPT_KEY_ID,
        payloadSha256: "",
        signatureBase64: "",
      },
    },
  };
}

function signCoreReceipt(vector: HardwareSignedPsbtVector): void {
  const payload = coreReceiptPayload(vector);
  vector.evidence.coreAcceptance.receipt.payloadSha256 = hash(payload);
  vector.evidence.coreAcceptance.receipt.signatureBase64 = sign(
    null,
    payload,
    CORE_RECEIPT_KEYS.privateKey,
  ).toString("base64");
}

function signApplicationReceipt(vector: HardwareSignedPsbtVector): void {
  const payload = applicationReceiptPayload(vector);
  vector.evidence.application.receipt.payloadSha256 = hash(payload);
  vector.evidence.application.receipt.signatureBase64 = sign(
    null,
    payload,
    APPLICATION_RECEIPT_KEYS.privateKey,
  ).toString("base64");
}

function signEvidenceReceipts(vector: HardwareSignedPsbtVector): void {
  signCoreReceipt(vector);
  signApplicationReceipt(vector);
}

function ledgerArtifact(
  unsignedPsbtBase64: string,
  signedPsbtBase64: string,
): HardwareSignedArtifact {
  const signed = bitcoin.Psbt.fromBase64(signedPsbtBase64, {
    network: NETWORK,
  });
  return {
    type: "ledger-signed-psbt",
    sourcePsbtBase64: unsignedPsbtBase64,
    signatures: signed.data.inputs.flatMap((input, inputIndex) =>
      (input.partialSig ?? []).map((signature) => ({
        inputIndex,
        pubkey: Buffer.from(signature.pubkey).toString("hex"),
        signature: Buffer.from(signature.signature).toString("hex"),
      })),
    ),
    reconstructedPsbtBase64: signedPsbtBase64,
  };
}

function physicalDeviceForVendor(
  vendor: HardwareSignedPsbtVector["vendor"],
): HardwareSignedPsbtVector["device"] {
  if (vendor === "trezor") {
    return {
      model: "Trezor Safe 5",
      firmwareVersion: "2.8.8",
      transport: "trezor-connect",
      transportVersion: "9.7.3",
      companionVersion: "2.0.33",
      emulated: false,
    };
  }
  if (vendor === "jade") {
    return {
      model: "Jade Plus",
      firmwareVersion: "1.0.40",
      transport: "webserial",
      transportVersion: "Web Serial API via Chromium 140.0.7339.80",
      emulated: false,
    };
  }
  if (vendor === "bitbox") {
    return {
      model: "BitBox02 BTC-only",
      firmwareVersion: "9.21.0",
      transport: "webhid",
      transportVersion: "WebHID via Chromium 140.0.7339.80",
      emulated: false,
    };
  }
  return {
    model: "Ledger Nano S Plus",
    firmwareVersion: "2.4.1",
    bitcoinAppVersion: "2.4.2",
    transport: "webusb",
    transportVersion: "6.34.4",
    emulated: false,
  };
}

function syntheticHardwareVector(
  overrides: Partial<HardwareSignedPsbtVector> = {},
): HardwareSignedPsbtVector {
  const source = generatedSignedVector("p2wpkh");
  const scriptType = overrides.scriptType ?? "p2wpkh";
  const vendor = overrides.vendor ?? "ledger";
  const unsignedPsbtBase64 =
    overrides.unsignedPsbtBase64 ?? source.unsignedPsbtBase64;
  const artifact =
    overrides.artifact ??
    (vendor === "ledger"
      ? ledgerArtifact(unsignedPsbtBase64, source.signedPsbtBase64)
      : {
          type: "signed-psbt" as const,
          signedPsbtBase64: source.signedPsbtBase64,
        });
  const vector: HardwareSignedPsbtVector = {
    fixtureSchemaVersion: 4,
    evidenceTier: "physical-device",
    id: "ledger-p2wpkh-synthetic-replay",
    description:
      "Synthetic unit fixture for the physical artifact replay contract",
    vendor,
    scriptType,
    network: "regtest",
    device: physicalDeviceForVendor(vendor),
    account: {
      fingerprint: SIGNER.fingerprint,
      accountPath: ACCOUNT_PATH,
      accountXpub: ACCOUNT.neutered().toBase58(),
      canonicalPolicyId: "single-sig-native-segwit-bip84-v1",
      canonicalPolicyVersion: 1,
    },
    unsignedPsbtBase64,
    artifact,
    inputValueSats: inputValueSats(unsignedPsbtBase64),
    expectedFeeSats: source.expectedFee,
    expectedVsize: source.expectedVsize,
    expectedTxid: source.expectedTxid,
    expectedOutputs: expectedOutputs(source.finalTxHex),
    addressEvidence: syntheticAddressEvidence(),
    negativeControls: syntheticNegativeControls(scriptType),
    softwareGates: syntheticSoftwareGates(vendor),
    sanitization: {
      reviewer: "fixture-reviewer",
      nonMainnetFunds: true,
      dedicatedOrWipeableDevice: true,
      noSeedsPinsPassphrasesPairingSecrets: true,
      noHostAuthTokens: true,
      sanitizedArtifactsReviewed: true,
    },
    signedBy: [SIGNER],
    evidence: physicalEvidence(
      unsignedPsbtBase64,
      artifact,
      source.finalTxHex,
      vendor,
    ),
    ...overrides,
  };
  if (!overrides.evidence) {
    vector.evidence = physicalEvidence(
      vector.unsignedPsbtBase64,
      vector.artifact,
      source.finalTxHex,
      vector.vendor,
    );
  }
  signEvidenceReceipts(vector);
  return vector;
}

function jadePlusDevice(
  overrides: Partial<HardwareSignedPsbtVector["device"]> = {},
): HardwareSignedPsbtVector["device"] {
  return {
    model: "Jade Plus",
    firmwareVersion: "1.0.40",
    transport: "webserial",
    transportVersion: "Web Serial API via Chromium 140.0.7339.80",
    emulated: false,
    ...overrides,
  };
}

function trezorArtifact(): TrezorConnectTransactionArtifact {
  const source = generatedSignedVector("p2wpkh");
  const signed = bitcoin.Psbt.fromBase64(source.signedPsbtBase64, {
    network: NETWORK,
  });
  const signature = Buffer.from(signed.data.inputs[0].partialSig![0].signature);
  return {
    type: "trezor-connect-transaction",
    sourcePsbtBase64: source.unsignedPsbtBase64,
    connectSignatures: [signature.subarray(0, -1).toString("hex")],
    serializedTxHex: source.finalTxHex,
  };
}

function mutateOutput(rawTxHex: string): string {
  const tx = bitcoin.Transaction.fromHex(rawTxHex);
  tx.outs[0].value -= 1n;
  return tx.toHex();
}

function falseChangeMetadata(
  markAsChange: boolean,
): Partial<HardwareSignedPsbtVector> {
  const source = generatedSignedVector("p2wpkh");
  const unsigned = bitcoin.Psbt.fromBase64(source.unsignedPsbtBase64, {
    network: NETWORK,
  });
  const signed = bitcoin.Psbt.fromBase64(source.signedPsbtBase64, {
    network: NETWORK,
  });
  const inputDerivation = unsigned.data.inputs[0].bip32Derivation![0];
  const outputDerivation = { ...inputDerivation, path: "m/84'/1'/0'/1/0" };
  unsigned.updateOutput(0, { bip32Derivation: [outputDerivation] });
  signed.updateOutput(0, { bip32Derivation: [outputDerivation] });
  return {
    unsignedPsbtBase64: unsigned.toBase64(),
    artifact: ledgerArtifact(unsigned.toBase64(), signed.toBase64()),
    expectedOutputs: expectedOutputs(source.finalTxHex).map((output) => ({
      ...output,
      isChange: markAsChange,
      derivationPath: markAsChange ? outputDerivation.path : undefined,
    })),
  };
}

function multisigPolicyVector(): HardwareSignedPsbtVector {
  const accountPath = "m/48'/1'/0'/2'";
  const roots = [11, 12].map((seed) =>
    bip32.fromSeed(Buffer.alloc(32, seed), NETWORK),
  );
  const accounts = roots.map((root) => root.derivePath(accountPath));
  const children = accounts.map((account) => account.derive(0).derive(0));
  const pubkeys = children
    .map((child) => Buffer.from(child.publicKey))
    .sort(Buffer.compare);
  const witness = bitcoin.payments.p2ms({ m: 2, pubkeys, network: NETWORK });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: witness, network: NETWORK });
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32), 0xffffffff);
  previous.addOutput(p2wsh.output!, 100_000n);
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    witnessUtxo: { script: p2wsh.output!, value: 100_000n },
    witnessScript: witness.output!,
    bip32Derivation: children.map((child, index) => ({
      masterFingerprint: Uint8Array.from(roots[index].fingerprint),
      path: `${accountPath}/0/0`,
      pubkey: Uint8Array.from(child.publicKey),
    })),
  });
  psbt.addOutput({
    address: expectedOutputs(generatedSignedVector("p2wpkh").finalTxHex)[0]
      .address,
    value: 99_000n,
  });
  const cosigners = accounts.map((account, index) => ({
    fingerprint: Buffer.from(roots[index].fingerprint).toString("hex"),
    accountPath,
    accountXpub: account.neutered().toBase58(),
  }));
  return syntheticHardwareVector({
    scriptType: "p2wsh",
    unsignedPsbtBase64: psbt.toBase64(),
    account: {
      ...cosigners[0],
      canonicalPolicyId: "multisig-native-segwit-bip48-2-v1",
      canonicalPolicyVersion: 1,
      multisig: { threshold: 1, cosigners },
    },
    signedBy: [
      {
        fingerprint: cosigners[0].fingerprint,
        derivationPath: `${accountPath}/0/0`,
        pubkey: Buffer.from(children[0].publicKey).toString("hex"),
      },
    ],
    negativeControls: syntheticNegativeControls("p2wsh"),
  });
}

function completeMultisigPolicyVector(
  scriptType: "p2wsh" | "p2sh-p2wsh" = "p2wsh",
): { psbt: bitcoin.Psbt; vector: HardwareSignedPsbtVector } {
  const vector = multisigPolicyVector();
  vector.scriptType = scriptType;
  vector.account.multisig!.threshold = 2;
  const psbt = bitcoin.Psbt.fromBase64(vector.unsignedPsbtBase64, {
    network: NETWORK,
  });

  if (scriptType === "p2sh-p2wsh") {
    const input = psbt.data.inputs[0];
    const witness = bitcoin.payments.p2wsh({
      redeem: { output: input.witnessScript },
      network: NETWORK,
    });
    const nested = bitcoin.payments.p2sh({ redeem: witness, network: NETWORK });
    input.redeemScript = witness.output!;
    input.witnessUtxo = {
      script: nested.output!,
      value: input.witnessUtxo!.value,
    };
  }

  return { psbt, vector };
}

function malformedTaprootVector(): HardwareSignedPsbtVector {
  const accountPath = "m/86'/1'/0'";
  const root = bip32.fromSeed(Buffer.alloc(32, 86), NETWORK);
  const account = root.derivePath(accountPath);
  const child = account.derive(0).derive(0);
  const internal = Buffer.from(child.publicKey).subarray(1);
  const payment = bitcoin.payments.p2tr({
    internalPubkey: internal,
    network: NETWORK,
  });
  const previous = new bitcoin.Transaction();
  previous.addInput(Buffer.alloc(32), 0xffffffff);
  previous.addOutput(payment.output!, 100_000n);
  const psbt = new bitcoin.Psbt({ network: NETWORK });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    witnessUtxo: { script: payment.output!, value: 100_000n },
    tapInternalKey: internal,
    tapBip32Derivation: [
      {
        masterFingerprint: Uint8Array.from(root.fingerprint),
        path: `${accountPath}/0/0`,
        pubkey: internal,
        leafHashes: [Buffer.alloc(32, 1)],
      },
    ],
  });
  psbt.addOutput({
    address: expectedOutputs(generatedSignedVector("p2wpkh").finalTxHex)[0]
      .address,
    value: 99_000n,
  });
  return syntheticHardwareVector({
    scriptType: "p2tr",
    unsignedPsbtBase64: psbt.toBase64(),
    account: {
      fingerprint: Buffer.from(root.fingerprint).toString("hex"),
      accountPath,
      accountXpub: account.neutered().toBase58(),
      canonicalPolicyId: "single-sig-taproot-bip86-v1",
      canonicalPolicyVersion: 1,
    },
    signedBy: [
      {
        fingerprint: Buffer.from(root.fingerprint).toString("hex"),
        derivationPath: `${accountPath}/0/0`,
        pubkey: internal.toString("hex"),
      },
    ],
  });
}

describe("Hardware-signed PSBT fixture replay harness", () => {
  it("binds Ledger Taproot signatures to the tweaked P2TR output key", () => {
    const internal = Buffer.alloc(32, 7);
    const output = Buffer.alloc(32, 8);
    expect(
      Buffer.from(
        expectedLedgerSignaturePubkey(
          "p2tr",
          {
            witnessUtxo: {
              script: Buffer.concat([Buffer.from([0x51, 0x20]), output]),
              value: 100_000n,
            },
          },
          internal,
        ),
      ),
    ).toEqual(output);
    expect(
      Buffer.from(expectedLedgerSignaturePubkey("p2wpkh", {}, internal)),
    ).toEqual(internal);
    expect(() =>
      expectedLedgerSignaturePubkey(
        "p2tr",
        {
          witnessUtxo: { script: Buffer.alloc(33), value: 100_000n },
        },
        internal,
      ),
    ).toThrow(/verified output key/i);
  });

  it("keeps required, unsupported, and evidence-blocked rows explicit", () => {
    expect(REQUIRED_HARDWARE_SIGNED_ROWS).toHaveLength(22);
    expect(UNSUPPORTED_HARDWARE_SIGNED_ROWS).toHaveLength(6);
    expect(BLOCKED_HARDWARE_SIGNED_ROWS).toHaveLength(13);
    expect(
      BLOCKED_HARDWARE_SIGNED_ROWS.filter((row) => row.vendor === "ledger"),
    ).toHaveLength(4);
    expect(
      BLOCKED_HARDWARE_SIGNED_ROWS.filter((row) => row.vendor === "trezor"),
    ).toHaveLength(5);
    expect(
      BLOCKED_HARDWARE_SIGNED_ROWS.filter((row) => row.vendor === "jade"),
    ).toHaveLength(4);
    expect(
      BLOCKED_HARDWARE_SIGNED_ROWS.every((row) =>
        ["ledger", "trezor", "jade"].includes(row.vendor),
      ),
    ).toBe(true);
    expect(
      BLOCKED_HARDWARE_SIGNED_ROWS.every((row) => row.reason.length > 20),
    ).toBe(true);
  });

  it("replays every committed physical-device fixture without software fallback", () => {
    HARDWARE_SIGNED_PSBT_VECTORS.forEach((vector) => {
      expect(vector.evidenceTier).toBe("physical-device");
      expect(vector.device.emulated).toBe(false);
      expect(replayHardwareSignedVector(vector).txid).toBe(vector.expectedTxid);
    });
  });

  it("keeps physical completeness distinct from product blocking", () => {
    const missing = missingHardwareSignedRows(
      REQUIRED_HARDWARE_SIGNED_ROWS,
      HARDWARE_SIGNED_PSBT_VECTORS,
      UNSUPPORTED_HARDWARE_SIGNED_ROWS,
    );
    expect(missing).toHaveLength(16);
    expect(missing.filter((row) => row.vendor === "ledger")).toHaveLength(4);
    expect(missing.filter((row) => row.vendor === "trezor")).toHaveLength(5);
    expect(missing.filter((row) => row.vendor === "jade")).toHaveLength(4);
    expect(
      unaccountedHardwareSignedRows(
        REQUIRED_HARDWARE_SIGNED_ROWS,
        HARDWARE_SIGNED_PSBT_VECTORS,
        UNSUPPORTED_HARDWARE_SIGNED_ROWS,
        BLOCKED_HARDWARE_SIGNED_ROWS,
      ),
    ).toHaveLength(3);
    if (process.env.REQUIRE_HARDWARE_SIGNED_FIXTURES === "1")
      expect(missing).toEqual([]);
    if (process.env.REQUIRE_TREZOR_PHYSICAL_FIXTURES === "1") {
      expect(missing.filter((row) => row.vendor === "trezor")).toEqual([]);
    }
    if (process.env.REQUIRE_LEDGER_PHYSICAL_FIXTURES === "1") {
      expect(missing.filter((row) => row.vendor === "ledger")).toEqual([]);
    }
    if (process.env.REQUIRE_JADE_PHYSICAL_FIXTURES === "1") {
      expect(missing.filter((row) => row.vendor === "jade")).toEqual([]);
    }
  });

  it("replays the adapter-returned signed PSBT with exact outputs and authenticated input values", () => {
    const vector = syntheticHardwareVector();
    const result = replayHardwareSignedVector(vector);
    expect(result).toMatchObject({
      txid: vector.expectedTxid,
      feeSats: vector.expectedFeeSats,
      vsize: vector.expectedVsize,
    });
    expect(result.outputs).toEqual(
      vector.expectedOutputs.map(({ index, address, valueSats }) => ({
        index,
        address,
        valueSats,
      })),
    );
  });

  it("rejects malformed Ledger artifact intake before replay", () => {
    const source = generatedSignedVector("p2wpkh");
    const valid = ledgerArtifact(
      source.unsignedPsbtBase64,
      source.signedPsbtBase64,
    );
    expect(valid.type).toBe("ledger-signed-psbt");
    if (valid.type !== "ledger-signed-psbt")
      throw new Error("invalid test fixture");

    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          artifact: { ...valid, sourcePsbtBase64: source.signedPsbtBase64 },
        }),
      ),
    ).toThrow("Ledger source PSBT differs from fixture unsigned PSBT");
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          artifact: { ...valid, signatures: [] },
        }),
      ),
    ).toThrow("Ledger exact signature record list is empty");
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          artifact: {
            type: "signed-psbt",
            signedPsbtBase64: source.signedPsbtBase64,
          },
        }),
      ),
    ).toThrow("Ledger evidence must retain its source PSBT");
  });

  it("rejects duplicated, absent, script-path, malformed, and reconstructed Ledger signatures", () => {
    const source = generatedSignedVector("p2wpkh");
    const valid = ledgerArtifact(
      source.unsignedPsbtBase64,
      source.signedPsbtBase64,
    );
    expect(valid.type).toBe("ledger-signed-psbt");
    if (valid.type !== "ledger-signed-psbt")
      throw new Error("invalid test fixture");
    const signature = valid.signatures[0];

    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          artifact: { ...valid, signatures: [signature, signature] },
        }),
      ),
    ).toThrow("Ledger signature indexes are duplicated");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          artifact: { ...valid, signatures: [{ ...signature, inputIndex: 1 }] },
        }),
      ),
    ).toThrow("Ledger signature input is absent");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          artifact: {
            ...valid,
            signatures: [{ ...signature, tapleafHash: "00".repeat(32) }],
          },
        }),
      ),
    ).toThrow("Ledger Taproot script-path evidence is unsupported");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          artifact: { ...valid, signatures: [{ ...signature, signature: "" }] },
        }),
      ),
    ).toThrow("Ledger signature is malformed");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          artifact: {
            ...valid,
            reconstructedPsbtBase64: source.unsignedPsbtBase64,
          },
        }),
      ),
    ).toThrow("Ledger reconstructed PSBT mismatch");
  });

  it("cryptographically binds the complete Trezor Connect tuple", () => {
    const artifact = trezorArtifact();
    const vector = syntheticHardwareVector({
      id: "trezor-p2wpkh-connect-tuple-replay",
      vendor: "trezor",
      artifact,
      device: {
        model: "Trezor Safe 5",
        firmwareVersion: "2.8.8",
        transport: "trezor-connect",
        transportVersion: "9.7.3",
        companionVersion: "2.0.33",
        emulated: false,
      },
    });
    expect(replayHardwareSignedVector(vector).txid).toBe(vector.expectedTxid);
  });

  it("accepts only Jade Plus WebSerial physical-device metadata", () => {
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          id: "jade-plus-p2wpkh-physical-binding",
          vendor: "jade",
          device: jadePlusDevice(),
        }),
      ),
    ).not.toThrow();

    const mislabeled = validateHardwareSignedFixtureSet(
      [
        syntheticHardwareVector({
          vendor: "jade",
          device: physicalDeviceForVendor("ledger"),
        }),
      ],
      [],
    );
    expect(mislabeled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "device.model",
          message: "Jade evidence must come from a physical Jade Plus",
        }),
        expect.objectContaining({
          field: "device.transport",
          message: "Jade Plus evidence must use webserial",
        }),
      ]),
    );
  });

  it.each([
    ["Ledger model", { model: "Ledger Nano S Plus" }, "physical Jade Plus"],
    ["WebUSB transport", { transport: "webusb" }, "must use webserial"],
    [
      "empty firmware",
      { firmwareVersion: "   " },
      "proven compatible release 1.0.40",
    ],
    [
      "incompatible firmware",
      { firmwareVersion: "1.0.39" },
      "proven compatible release 1.0.40",
    ],
    [
      "missing transport metadata",
      { transportVersion: undefined },
      "transport metadata is required",
    ],
    [
      "empty transport metadata",
      { transportVersion: "   " },
      "transport metadata is required",
    ],
  ] as const)(
    "rejects Jade evidence with %s",
    (_caseName, deviceOverride, message) => {
      expect(() =>
        assertHardwareSignedFixtureIntake(
          syntheticHardwareVector({
            vendor: "jade",
            device: jadePlusDevice(deviceOverride),
          }),
        ),
      ).toThrow(message);
    },
  );

  it("rejects emulator provenance and same-person review", () => {
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          evidenceTier: "physical-device",
          device: {
            ...syntheticHardwareVector().device,
            emulated: true as false,
          },
        }),
      ),
    ).toThrow(
      "emulator evidence cannot satisfy physical-device fixture intake",
    );
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          sanitization: {
            ...syntheticHardwareVector().sanitization,
            reviewer: "fixture-operator",
          },
        }),
      ),
    ).toThrow("operator and sanitization reviewer must differ");
  });

  it("rejects incomplete provenance and evidence hash drift", () => {
    const vector = syntheticHardwareVector();
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: { ...vector.evidence, testedCommitSha: "short" },
      }),
    ).toThrow("tested commit must be a full Git SHA");
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: { ...vector.evidence, signedArtifactSha256: "0".repeat(64) },
      }),
    ).toThrow("signed artifact hash mismatch");
  });

  it("rejects stale evidence, policy-code drift, and SDK lockfile drift", () => {
    const vector = syntheticHardwareVector();
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: { ...vector.evidence, expiresAt: "2026-08-10T00:00:00.000Z" },
      }),
    ).toThrow("physical evidence is expired");
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          sourceManifest: vector.evidence.sourceManifest.map((entry, index) =>
            index === 0 ? { ...entry, sha256: "0".repeat(64) } : entry,
          ),
        },
      }),
    ).toThrow("source manifest differs");
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          sdkPackages: vector.evidence.sdkPackages.map((sdk, index) =>
            index === 0 ? { ...sdk, version: "9.7.3" } : sdk,
          ),
        },
      }),
    ).toThrow("exactly match the current lockfile");
  });

  it("binds the signed capture to exact frontend/backend images and current source inputs", () => {
    const vector = syntheticHardwareVector();
    expect(() => assertHardwareSignedFixtureIntake(vector)).not.toThrow();

    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          application: {
            ...vector.evidence.application,
            images: vector.evidence.application.images.slice(0, 1),
          },
        },
      }),
    ).toThrow("exactly one frontend and one backend image subject");

    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          application: {
            ...vector.evidence.application,
            packageLockSha256: "0".repeat(64),
          },
        },
      }),
    ).toThrow("current version, lockfile, and funds-safety source manifest");

    const tamperedReceipt = Buffer.from(
      vector.evidence.application.receipt.signatureBase64,
      "base64",
    );
    tamperedReceipt[0] ^= 1;
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          application: {
            ...vector.evidence.application,
            receipt: {
              ...vector.evidence.application.receipt,
              signatureBase64: tamperedReceipt.toString("base64"),
            },
          },
        },
      }),
    ).toThrow("Sanctuary application receipt signature is invalid");

    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          application: {
            ...vector.evidence.application,
            receipt: {
              ...vector.evidence.application.receipt,
              algorithm: "rsa" as never,
            },
          },
        },
      }),
    ).toThrow("Sanctuary application receipt algorithm is invalid");
  });

  it.each([
    [
      "Ledger model",
      { model: "Ledger Nano S" },
      "approved physical evidence model",
    ],
    [
      "Ledger firmware",
      { firmwareVersion: "unknown" },
      "exact semantic version",
    ],
    [
      "Ledger Bitcoin app",
      { bitcoinAppVersion: undefined },
      "Ledger Bitcoin app",
    ],
    [
      "Ledger transport",
      { transportVersion: "6.34.3" },
      "locked transport package",
    ],
  ] as const)(
    "rejects %s tuple drift",
    (_caseName, deviceOverride, message) => {
      expect(() =>
        assertHardwareSignedFixtureIntake(
          syntheticHardwareVector({
            device: { ...physicalDeviceForVendor("ledger"), ...deviceOverride },
          }),
        ),
      ).toThrow(message);
    },
  );

  it.each([
    ["Trezor model", { model: "Trezor" }, "approved physical evidence model"],
    [
      "Trezor firmware",
      { firmwareVersion: "unknown" },
      "exact semantic version",
    ],
    [
      "Trezor Connect",
      { transportVersion: "9.7.2" },
      "locked Connect-Web package",
    ],
    ["Trezor companion", { companionVersion: "" }, "Bridge or Suite companion"],
  ] as const)(
    "rejects %s tuple drift",
    (_caseName, deviceOverride, message) => {
      expect(() =>
        assertHardwareSignedFixtureIntake(
          syntheticHardwareVector({
            vendor: "trezor",
            artifact: trezorArtifact(),
            device: { ...physicalDeviceForVendor("trezor"), ...deviceOverride },
          }),
        ),
      ).toThrow(message);
    },
  );

  it("rejects canonical policy, account xpub, and address derivation drift", () => {
    const vector = syntheticHardwareVector();
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        account: {
          ...vector.account,
          canonicalPolicyId: "single-sig-taproot-bip86-v1",
        },
      }),
    ).toThrow("current canonical wallet policy");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          account: {
            ...vector.account,
            accountXpub: bip32
              .fromSeed(Buffer.alloc(32, 99), NETWORK)
              .neutered()
              .toBase58(),
          },
        }),
      ),
    ).toThrow("account xpub derivation mismatch");
    const addresses = syntheticAddressEvidence();
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          addressEvidence: addresses.map((entry, index) =>
            index === 0
              ? {
                  ...entry,
                  sanctuaryAddress: addresses[1].sanctuaryAddress,
                  deviceAddress: addresses[1].sanctuaryAddress,
                  coreAddress: addresses[1].sanctuaryAddress,
                }
              : entry,
          ),
        }),
      ),
    ).toThrow("address evidence does not derive");
  });

  it("rejects incomplete multisig policy binding and non-key-path BIP371 metadata", () => {
    expect(() => replayHardwareSignedVector(multisigPolicyVector())).toThrow(
      "multisig threshold or key order mismatch",
    );
    expect(() => replayHardwareSignedVector(malformedTaprootVector())).toThrow(
      "violates BIP371 key-path metadata",
    );
  });

  it("rejects nested P2SH-P2WSH outer and redeem wrapper mismatches", () => {
    const { psbt, vector } = completeMultisigPolicyVector("p2sh-p2wsh");
    expect(() => validateHardwarePsbtPolicyBinding(vector, psbt)).not.toThrow();

    const wrongOuter = psbt.clone();
    wrongOuter.data.inputs[0].witnessUtxo!.script = Buffer.alloc(23, 1);
    expect(() => validateHardwarePsbtPolicyBinding(vector, wrongOuter)).toThrow(
      "multisig wrapper mismatch",
    );

    const wrongRedeem = psbt.clone();
    wrongRedeem.data.inputs[0].redeemScript = Buffer.alloc(34, 2);
    expect(() =>
      validateHardwarePsbtPolicyBinding(vector, wrongRedeem),
    ).toThrow("nested multisig redeem script mismatch");
  });

  it("rejects an invalid multisig witness policy", () => {
    const { psbt, vector } = completeMultisigPolicyVector();
    psbt.data.inputs[0].witnessScript = Buffer.from([0xff]);
    expect(() => validateHardwarePsbtPolicyBinding(vector, psbt)).toThrow(
      "multisig witness policy is invalid",
    );
  });

  it("rejects out-of-account and unknown-cosigner derivations", () => {
    const outsideAccount = completeMultisigPolicyVector();
    outsideAccount.psbt.data.inputs[0].bip32Derivation![0].path =
      "m/48'/1'/9'/2'/0/0";
    expect(() =>
      validateHardwarePsbtPolicyBinding(
        outsideAccount.vector,
        outsideAccount.psbt,
      ),
    ).toThrow("derivation is outside its account path");

    const unknownCosigner = completeMultisigPolicyVector();
    unknownCosigner.psbt.data.inputs[0].bip32Derivation![0].masterFingerprint =
      Buffer.from("ffffffff", "hex");
    expect(() =>
      validateHardwarePsbtPolicyBinding(
        unknownCosigner.vector,
        unknownCosigner.psbt,
      ),
    ).toThrow("contains an unknown cosigner");
  });

  it("derives P2SH-P2WSH address evidence from the complete cosigner policy", () => {
    const { psbt, vector } = completeMultisigPolicyVector("p2sh-p2wsh");
    const path = `${vector.account.accountPath}/0/0`;
    const address = bitcoin.address.fromOutputScript(
      psbt.data.inputs[0].witnessUtxo!.script,
      NETWORK,
    );
    vector.addressEvidence = [
      {
        path,
        sanctuaryAddress: address,
        deviceAddress: address,
        coreAddress: address,
        displayedOnPhysicalDevice: true,
      },
    ];

    expect(() => validateHardwareAddressDerivation(vector)).not.toThrow();
    vector.addressEvidence[0].sanctuaryAddress = bitcoin.payments.p2wsh({
      redeem: { output: psbt.data.inputs[0].witnessScript },
      network: NETWORK,
    }).address!;
    expect(() => validateHardwareAddressDerivation(vector)).toThrow(
      "address evidence does not derive from the account policy",
    );
  });

  it("rejects Core acceptance records that do not bind the replayed transaction", () => {
    const vector = syntheticHardwareVector();
    const response = JSON.parse(
      vector.evidence.coreAcceptance.responseJson,
    ) as {
      result: Array<{ txid: string }>;
    };
    response.result[0].txid = "0".repeat(64);
    vector.evidence.coreAcceptance.responseJson = JSON.stringify(response);
    signEvidenceReceipts(vector);
    expect(() => replayHardwareSignedVector(vector)).toThrow(
      "Bitcoin Core acceptance evidence mismatch",
    );
  });

  it("rejects unsigned Core transcripts, unreachable commits, and source drift", () => {
    const vector = syntheticHardwareVector();
    expect(() => replayHardwareSignedVectorRaw(vector)).toThrow(
      "receipt key is not trusted",
    );
    expect(() =>
      assertHardwareSignedFixtureIntakeRaw(vector, {
        ...TEST_CONTEXT,
        isTestedCommitReachable: () => false,
      }),
    ).toThrow("not a reachable ancestor");
    vector.evidence.coreAcceptance.requestJson =
      vector.evidence.coreAcceptance.requestJson.replace(
        "testmempoolaccept",
        "sendrawtransaction",
      );
    expect(() => replayHardwareSignedVector(vector)).toThrow(
      "receipt payload hash mismatch",
    );
  });

  it("rejects missing or mismatched physical address display evidence", () => {
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          addressEvidence: syntheticAddressEvidence().filter(
            (evidence) => !evidence.path.endsWith("/1/19"),
          ),
        }),
      ),
    ).toThrow("missing address evidence for /1/19");
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          addressEvidence: syntheticAddressEvidence().map((evidence, index) =>
            index === 0
              ? { ...evidence, deviceAddress: "bcrt1qmismatch" }
              : evidence,
          ),
        }),
      ),
    ).toThrow("address mismatch");
  });

  it("rejects missing software gates, negative controls, and secret-shaped notes", () => {
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          softwareGates: syntheticSoftwareGates().slice(1),
        }),
      ),
    ).toThrow("missing passed software gate");
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          negativeControls: syntheticNegativeControls().filter(
            (control) => control.caseName !== "tampered-recipient",
          ),
        }),
      ),
    ).toThrow("missing passed negative control tampered-recipient");
    const vector = syntheticHardwareVector();
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: {
          ...vector.evidence,
          notes: "operator accidentally pasted seed words here",
        },
      }),
    ).toThrow("secret-shaped material");
  });

  it.each([
    [12, 16],
    [15, 20],
    [18, 24],
    [21, 28],
    [24, 32],
  ])(
    "rejects an unlabeled valid %i-word BIP39 mnemonic without disclosing it",
    (_wordCount, entropyBytes) => {
      const mnemonic = entropyToMnemonic(
        Buffer.alloc(entropyBytes, entropyBytes),
      );
      const vector = syntheticHardwareVector();
      let errorMessage = "";
      try {
        assertHardwareSignedFixtureIntake({
          ...vector,
          evidence: {
            ...vector.evidence,
            notes: `capture annotation: ${mnemonic}; reviewed`,
          },
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      expect(errorMessage).toContain("valid BIP39 mnemonic detected");
      expect(errorMessage).not.toContain(mnemonic);
    },
  );

  it.each(
    Object.entries(wordlists).filter((entry): entry is [string, string[]] =>
      Array.isArray(entry[1]),
    ),
  )(
    "rejects an unlabeled valid mnemonic from the %s BIP39 wordlist",
    (_wordlistName, wordlist) => {
      const mnemonic = entropyToMnemonic(Buffer.alloc(16, 7), wordlist);
      const vector = syntheticHardwareVector();
      let errorMessage = "";
      try {
        assertHardwareSignedFixtureIntake({
          ...vector,
          evidence: {
            ...vector.evidence,
            notes: `capture annotation: ${mnemonic}; reviewed`,
          },
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      expect(errorMessage).toContain("valid BIP39 mnemonic detected");
      expect(errorMessage).not.toContain(mnemonic);
    },
  );

  it.each([
    ["eleven words", "abandon ".repeat(11).trim()],
    ["invalid checksum", `${"abandon ".repeat(11)}abandon`],
    ["twenty-five words", "abandon ".repeat(25).trim()],
    [
      "non-English invalid checksum",
      Array(12).fill(wordlists.japanese[0]).join(" "),
    ],
  ])("does not classify %s as a valid BIP39 mnemonic", (_caseName, notes) => {
    const vector = syntheticHardwareVector();
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: { ...vector.evidence, notes },
      }),
    ).not.toThrow();
  });

  it.each([
    "xprv",
    "yprv",
    "zprv",
    "Yprv",
    "Zprv",
    "tprv",
    "uprv",
    "vprv",
    "Uprv",
    "Vprv",
  ])(
    "rejects an unlabeled %s private extended key without disclosing it",
    (prefix) => {
      const privateExtendedKey = `${prefix}${"A".repeat(24)}`;
      const vector = syntheticHardwareVector();
      let errorMessage = "";
      try {
        assertHardwareSignedFixtureIntake({
          ...vector,
          evidence: { ...vector.evidence, notes: privateExtendedKey },
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
      expect(errorMessage).toContain("secret-shaped material");
      expect(errorMessage).not.toContain(privateExtendedKey);
    },
  );

  it.each([
    ["public extended key", `xpub${"A".repeat(24)}`],
    ["short private prefix", `xprv${"A".repeat(19)}`],
  ])("does not classify a %s as a private extended key", (_caseName, notes) => {
    const vector = syntheticHardwareVector();
    expect(() =>
      assertHardwareSignedFixtureIntake({
        ...vector,
        evidence: { ...vector.evidence, notes },
      }),
    ).not.toThrow();
  });

  it("rejects non-test networks and missing Core acceptance", () => {
    expect(() =>
      assertHardwareSignedFixtureIntake(
        syntheticHardwareVector({
          network: "mainnet" as HardwareSignedPsbtVector["network"],
        }),
      ),
    ).toThrow("regtest, signet, or testnet only");
    const vector = syntheticHardwareVector();
    const response = JSON.parse(
      vector.evidence.coreAcceptance.responseJson,
    ) as {
      result: Array<{ allowed: boolean }>;
    };
    response.result[0].allowed = false;
    vector.evidence.coreAcceptance.responseJson = JSON.stringify(response);
    signEvidenceReceipts(vector);
    expect(() => replayHardwareSignedVector(vector)).toThrow(
      "Bitcoin Core acceptance evidence mismatch",
    );
  });

  it("rejects duplicate fixture rows and rows blocked as unsupported", () => {
    expect(
      validateHardwareSignedFixtureSet(
        [
          syntheticHardwareVector({ id: "first-ledger-p2wpkh" }),
          syntheticHardwareVector({ id: "second-ledger-p2wpkh" }),
        ],
        UNSUPPORTED_HARDWARE_SIGNED_ROWS,
      ),
    ).toEqual([
      expect.objectContaining({
        field: "fixtureSet",
        message: expect.stringContaining("duplicate"),
      }),
    ]);
    expect(
      validateHardwareSignedFixtureSet(
        [
          syntheticHardwareVector({
            vendor: "ledger",
            scriptType: "p2wsh",
            negativeControls: syntheticNegativeControls("p2wsh"),
          }),
        ],
        UNSUPPORTED_HARDWARE_SIGNED_ROWS,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "fixtureSet",
          message: expect.stringContaining("conflicts"),
        }),
      ]),
    );
  });

  it("rejects raw transaction/source intent mismatch and missing output declarations", () => {
    const artifact = trezorArtifact();
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          vendor: "trezor",
          artifact: {
            ...artifact,
            serializedTxHex: mutateOutput(artifact.serializedTxHex),
          },
        }),
      ),
    ).toThrow("output 0 intent mismatch");
    const outputs = expectedOutputs(generatedSignedVector("p2wpkh").finalTxHex);
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({ expectedOutputs: outputs.slice(0, -1) }),
      ),
    ).toThrow("expected outputs must exactly cover");
  });

  it("rejects duplicate output indices, forged input totals, and signer attribution mismatch", () => {
    const outputs = expectedOutputs(generatedSignedVector("p2wpkh").finalTxHex);
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          expectedOutputs: [outputs[0], { ...outputs[0], index: 0 }],
        }),
      ),
    ).toThrow("expected outputs must exactly cover");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({ inputValueSats: 1 }),
      ),
    ).toThrow("declared input value mismatch");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({
          signedBy: [{ ...SIGNER, fingerprint: "00000000" }],
        }),
      ),
    ).toThrow("signer metadata differs from the selected account");
  });

  it("rejects false or hidden device-owned change metadata", () => {
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector(falseChangeMetadata(true)),
      ),
    ).toThrow("account xpub derivation mismatch");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector(falseChangeMetadata(false)),
      ),
    ).toThrow("hides device-owned change");
  });

  it("rejects malformed metadata and transaction invariants", () => {
    expect(() =>
      replayHardwareSignedVector(syntheticHardwareVector({ id: "   " })),
    ).toThrow("missing id");
    expect(() =>
      replayHardwareSignedVector(syntheticHardwareVector({ signedBy: [] })),
    ).toThrow("no signer evidence");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({ expectedTxid: "00" }),
      ),
    ).toThrow("txid mismatch");
    expect(() =>
      replayHardwareSignedVector(
        syntheticHardwareVector({ expectedFeeSats: 1 }),
      ),
    ).toThrow("fee mismatch");
    expect(() =>
      replayHardwareSignedVector(syntheticHardwareVector({ expectedVsize: 1 })),
    ).toThrow("vsize mismatch");
  });
});
