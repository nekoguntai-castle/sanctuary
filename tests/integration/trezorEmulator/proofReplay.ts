import { createHash } from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "@bitcoinerlab/secp256k1";
import { expect } from "vitest";

bitcoin.initEccLib(ecc);

export interface ProofArtifact {
  sourcePsbt: string;
  connectSignatures: string[];
  serializedTx: string;
  sourcePsbtSha256: string;
  serializedTxSha256: string;
}

export function bytesSha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function proofArtifact(
  sourcePsbt: string,
  connectSignatures: string[],
  serializedTx: string,
): ProofArtifact {
  return {
    sourcePsbt,
    connectSignatures: [...connectSignatures],
    serializedTx,
    sourcePsbtSha256: bytesSha256(Buffer.from(sourcePsbt, "base64")),
    serializedTxSha256: bytesSha256(Buffer.from(serializedTx, "hex")),
  };
}

function signatureValidator(
  pubkey: Uint8Array,
  hash: Uint8Array,
  signature: Uint8Array,
): boolean {
  return pubkey.length === 32
    ? ecc.verifySchnorr(hash, pubkey, signature)
    : ecc.verify(hash, pubkey, signature);
}

function normalizeEcdsaSignature(
  signatureHex: string,
  sighashType: number,
): Uint8Array {
  const signature = Buffer.from(signatureHex, "hex");
  for (const candidate of [
    signature,
    Buffer.concat([signature, Buffer.from([sighashType])]),
  ]) {
    try {
      const decoded = bitcoin.script.signature.decode(candidate);
      if (decoded.hashType === sighashType) return Uint8Array.from(candidate);
    } catch {
      // Try the alternate native Connect encoding.
    }
  }
  throw new Error("Emulator returned an invalid ECDSA signature encoding");
}

function normalizeTaprootSignature(
  signatureHex: string,
  sighashType: number,
): Uint8Array {
  const signature = Buffer.from(signatureHex, "hex");
  if (
    signature.length === 64 &&
    sighashType === bitcoin.Transaction.SIGHASH_DEFAULT
  )
    return signature;
  if (
    signature.length === 65 &&
    signature[64] === sighashType &&
    sighashType !== bitcoin.Transaction.SIGHASH_DEFAULT
  )
    return signature;
  throw new Error("Emulator returned an invalid Taproot signature encoding");
}

function connectedDerivation(
  input: bitcoin.Psbt["data"]["inputs"][number],
  fingerprint: Uint8Array,
  taproot: boolean,
) {
  const derivations = taproot
    ? input.tapBip32Derivation
    : input.bip32Derivation;
  const matches = (derivations ?? []).filter((derivation) =>
    Buffer.from(derivation.masterFingerprint).equals(Buffer.from(fingerprint)),
  );
  if (matches.length !== 1)
    throw new Error(
      "Emulator PSBT does not bind exactly one selected-device origin",
    );
  return matches[0];
}

function independentlyApplySignatures(
  source: bitcoin.Psbt,
  signatures: string[],
  fingerprint: Uint8Array,
  taproot: boolean,
): bitcoin.Psbt {
  if (signatures.length !== source.inputCount) {
    throw new Error("Emulator signature count differs from PSBT input count");
  }
  const signed = source.clone();
  signatures.forEach((signatureHex, inputIndex) => {
    const input = signed.data.inputs[inputIndex];
    const derivation = connectedDerivation(input, fingerprint, taproot);
    if (taproot) {
      input.tapKeySig = normalizeTaprootSignature(
        signatureHex,
        input.sighashType ?? bitcoin.Transaction.SIGHASH_DEFAULT,
      );
    } else {
      const signature = normalizeEcdsaSignature(
        signatureHex,
        input.sighashType ?? bitcoin.Transaction.SIGHASH_ALL,
      );
      input.partialSig = [
        ...(input.partialSig ?? []).filter(
          (partial) =>
            !Buffer.from(partial.pubkey).equals(Buffer.from(derivation.pubkey)),
        ),
        { pubkey: derivation.pubkey, signature },
      ];
    }
    if (!signed.validateSignaturesOfInput(inputIndex, signatureValidator)) {
      throw new Error(
        `Emulator signature ${inputIndex} is cryptographically invalid`,
      );
    }
  });
  return signed;
}

function unsignedTransaction(psbt: bitcoin.Psbt): bitcoin.Transaction {
  return bitcoin.Transaction.fromBuffer(
    psbt.data.globalMap.unsignedTx.toBuffer(),
  );
}

function expectSameTransactionIntent(
  expected: bitcoin.Transaction,
  actual: bitcoin.Transaction,
): void {
  expect(actual.version).toBe(expected.version);
  expect(actual.locktime).toBe(expected.locktime);
  expect(actual.ins).toHaveLength(expected.ins.length);
  expect(actual.outs).toHaveLength(expected.outs.length);
  expected.ins.forEach((input, inputIndex) => {
    const actualInput = actual.ins[inputIndex];
    expect(Buffer.from(actualInput.hash)).toEqual(Buffer.from(input.hash));
    expect(actualInput.index).toBe(input.index);
    expect(actualInput.sequence).toBe(input.sequence);
  });
  expected.outs.forEach((output, outputIndex) => {
    const actualOutput = actual.outs[outputIndex];
    expect(actualOutput.value).toBe(output.value);
    expect(Buffer.from(actualOutput.script)).toEqual(
      Buffer.from(output.script),
    );
  });
}

function serializedInputStack(
  transaction: bitcoin.Transaction,
  inputIndex: number,
): Buffer[] {
  const input = transaction.ins[inputIndex];
  const scriptItems =
    bitcoin.script.decompile(Uint8Array.from(input.script)) ?? [];
  return [
    ...scriptItems
      .filter((item): item is Uint8Array => item instanceof Uint8Array)
      .map(Buffer.from),
    ...input.witness.map(Buffer.from),
  ];
}

export function replayArtifactIndependently(
  artifact: ProofArtifact,
  fingerprint: Uint8Array,
  taproot: boolean,
): bitcoin.Psbt {
  expect(bytesSha256(Buffer.from(artifact.sourcePsbt, "base64"))).toBe(
    artifact.sourcePsbtSha256,
  );
  expect(bytesSha256(Buffer.from(artifact.serializedTx, "hex"))).toBe(
    artifact.serializedTxSha256,
  );
  const source = bitcoin.Psbt.fromBase64(artifact.sourcePsbt, {
    network: bitcoin.networks.testnet,
  });
  const signed = independentlyApplySignatures(
    source,
    artifact.connectSignatures,
    fingerprint,
    taproot,
  );
  const finalized = signed.clone();
  finalized.finalizeAllInputs();
  expect(finalized.extractTransaction().toHex()).toBe(artifact.serializedTx);
  return signed;
}

export function replayFirstSignerArtifactIndependently(
  artifact: ProofArtifact,
  fingerprint: Uint8Array,
): bitcoin.Psbt {
  expect(bytesSha256(Buffer.from(artifact.sourcePsbt, "base64"))).toBe(
    artifact.sourcePsbtSha256,
  );
  expect(bytesSha256(Buffer.from(artifact.serializedTx, "hex"))).toBe(
    artifact.serializedTxSha256,
  );
  const source = bitcoin.Psbt.fromBase64(artifact.sourcePsbt, {
    network: bitcoin.networks.testnet,
  });
  source.data.inputs.forEach((input) =>
    expect(input.partialSig ?? []).toHaveLength(0),
  );
  const signed = independentlyApplySignatures(
    source,
    artifact.connectSignatures,
    fingerprint,
    false,
  );
  const serialized = bitcoin.Transaction.fromHex(artifact.serializedTx);
  expectSameTransactionIntent(unsignedTransaction(source), serialized);
  signed.data.inputs.forEach((input, inputIndex) => {
    expect(input.partialSig).toHaveLength(1);
    const signature = input.partialSig![0].signature;
    const occurrences = serializedInputStack(serialized, inputIndex).filter(
      (item) => item.equals(Buffer.from(signature)),
    );
    expect(occurrences).toHaveLength(1);
  });
  expect(() => signed.clone().finalizeAllInputs()).toThrow();
  return signed;
}

export function assertReturnedMultisigPsbt(
  returnedPsbt: string | undefined,
  sourcePsbt: bitcoin.Psbt,
  independentlySigned: bitcoin.Psbt,
  fingerprint: Uint8Array,
): void {
  expect(returnedPsbt).toBeTruthy();
  const returned = bitcoin.Psbt.fromBase64(returnedPsbt!, {
    network: bitcoin.networks.testnet,
  });
  expect(returned.data.globalMap.unsignedTx.toBuffer()).toEqual(
    sourcePsbt.data.globalMap.unsignedTx.toBuffer(),
  );
  returned.data.inputs.forEach((input, inputIndex) => {
    const sourceSignatures =
      sourcePsbt.data.inputs[inputIndex].partialSig ?? [];
    for (const existing of sourceSignatures) {
      expect(
        input.partialSig?.some(
          (partial) =>
            Buffer.from(partial.pubkey).equals(Buffer.from(existing.pubkey)) &&
            Buffer.from(partial.signature).equals(
              Buffer.from(existing.signature),
            ),
        ),
      ).toBe(true);
    }
    const selected = connectedDerivation(input, fingerprint, false);
    expect(
      input.partialSig?.some((partial) =>
        Buffer.from(partial.pubkey).equals(Buffer.from(selected.pubkey)),
      ),
    ).toBe(true);
    expect(input.partialSig).toHaveLength(
      independentlySigned.data.inputs[inputIndex].partialSig?.length ?? 0,
    );
    expect(
      returned.validateSignaturesOfInput(inputIndex, signatureValidator),
    ).toBe(true);
  });
}
