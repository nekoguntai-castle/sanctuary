import * as ecc from '@bitcoinerlab/secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import { uint8ArrayEquals } from '../../../../utils/bufferUtils';
import type { TrezorPsbt, TrezorPsbtInput } from './signPsbtTypes';

const signatureError = (detail: string): Error => new Error(`Trezor signature mismatch: ${detail}`);

const decodeSignature = (signatureHex: string, inputIndex: number): Buffer => {
  if (!/^(?:[0-9a-f]{2})+$/i.test(signatureHex)) {
    throw signatureError(`input ${inputIndex} signature is missing or malformed`);
  }
  return Buffer.from(signatureHex, 'hex');
};

const expectedSighashType = (input: TrezorPsbtInput): number => {
  return input.sighashType ?? bitcoin.Transaction.SIGHASH_ALL;
};

const decodeScriptSighashType = (signature: Buffer): number | undefined => {
  try {
    return bitcoin.script.signature.decode(Uint8Array.from(signature)).hashType;
  } catch {
    return undefined;
  }
};

const normalizeEcdsaSignature = (
  input: TrezorPsbtInput,
  signature: Buffer,
  inputIndex: number
): Buffer => {
  const sighashType = expectedSighashType(input);
  // Connect versions have returned both DER-only and DER-plus-sighash forms.
  // Accept either encoding only when the resulting sighash equals the PSBT.
  const withSighash = Buffer.concat([signature, Buffer.from([sighashType])]);
  if (decodeScriptSighashType(withSighash) === sighashType) {
    return withSighash;
  }
  const embeddedSighashType = decodeScriptSighashType(signature);
  if (embeddedSighashType === undefined) {
    throw signatureError(`input ${inputIndex} ECDSA signature encoding is invalid`);
  }
  if (embeddedSighashType !== sighashType) {
    throw signatureError(`input ${inputIndex} signature sighash type differs from the PSBT`);
  }
  return signature;
};

const normalizeTaprootSignature = (
  input: TrezorPsbtInput,
  signature: Buffer,
  inputIndex: number
): Buffer => {
  if (signature.length !== 64 && signature.length !== 65) {
    throw signatureError(`input ${inputIndex} Taproot signature length is invalid`);
  }
  const expected = input.sighashType ?? bitcoin.Transaction.SIGHASH_DEFAULT;
  if (signature.length === 64) {
    if (expected !== bitcoin.Transaction.SIGHASH_DEFAULT) {
      throw signatureError(`input ${inputIndex} Taproot signature omits the required sighash type`);
    }
    return signature;
  }
  if (signature[64] !== expected || expected === bitcoin.Transaction.SIGHASH_DEFAULT) {
    throw signatureError(
      `input ${inputIndex} Taproot signature sighash type differs from the PSBT`
    );
  }
  return signature;
};

const connectedDerivation = (
  input: TrezorPsbtInput,
  deviceFingerprint: Buffer,
  taproot: boolean,
  inputIndex: number
) => {
  const derivations = taproot ? input.tapBip32Derivation : input.bip32Derivation;
  const matches = (derivations ?? []).filter((derivation) =>
    uint8ArrayEquals(derivation.masterFingerprint, deviceFingerprint)
  );
  if (matches.length !== 1) {
    throw signatureError(
      `input ${inputIndex} does not contain exactly one connected-device origin`
    );
  }
  return matches[0];
};

function applyTaprootSignature(
  input: TrezorPsbtInput,
  signature: Buffer,
  inputIndex: number
): boolean {
  if (signature.length !== 64 && signature.length !== 65) {
    throw signatureError(`input ${inputIndex} Taproot signature length is invalid`);
  }
  if (input.tapKeySig) {
    if (!uint8ArrayEquals(input.tapKeySig, signature)) {
      throw signatureError(`input ${inputIndex} already contains a different Taproot signature`);
    }
    return false;
  }
  input.tapKeySig = signature;
  return true;
}

function applyEcdsaSignature(
  input: TrezorPsbtInput,
  pubkey: Uint8Array,
  signature: Buffer,
  inputIndex: number
): boolean {
  const existing = input.partialSig?.find((partial) => uint8ArrayEquals(partial.pubkey, pubkey));
  if (existing) {
    if (!uint8ArrayEquals(existing.signature, signature)) {
      throw signatureError(`input ${inputIndex} already contains a different device signature`);
    }
    return false;
  }
  input.partialSig = [...(input.partialSig ?? []), { pubkey, signature }];
  return true;
}

function verifyInputSignature(psbt: TrezorPsbt, inputIndex: number): void {
  let valid = false;
  try {
    valid = psbt.validateSignaturesOfInput(inputIndex, (pubkey, hash, signature) =>
      pubkey.length === 32
        ? ecc.verifySchnorr(
            Uint8Array.from(hash),
            Uint8Array.from(pubkey),
            Uint8Array.from(signature)
          )
        : ecc.verify(Uint8Array.from(hash), Uint8Array.from(pubkey), Uint8Array.from(signature))
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw signatureError(`input ${inputIndex} signature cannot be validated: ${detail}`);
  }
  if (!valid) throw signatureError(`input ${inputIndex} signature is cryptographically invalid`);
}

/** Apply only signatures verified against the selected device derivation. */
export function validateAndApplyTrezorSignatures(
  sourcePsbt: TrezorPsbt,
  connectSignatures: string[],
  deviceFingerprint: Buffer | null,
  taproot: boolean
): { validatedPsbt: TrezorPsbt; addedSignatures: number } {
  if (!deviceFingerprint) throw signatureError('connected master fingerprint is unavailable');
  if (connectSignatures.length !== sourcePsbt.txInputs.length) {
    throw signatureError('Connect signature count differs from the transaction input count');
  }
  const validatedPsbt = sourcePsbt.clone();
  let addedSignatures = 0;
  for (const [inputIndex, signatureHex] of connectSignatures.entries()) {
    const input = validatedPsbt.data.inputs[inputIndex];
    const derivation = connectedDerivation(input, deviceFingerprint, taproot, inputIndex);
    const decodedSignature = decodeSignature(signatureHex, inputIndex);
    const signature = taproot
      ? normalizeTaprootSignature(input, decodedSignature, inputIndex)
      : normalizeEcdsaSignature(input, decodedSignature, inputIndex);
    const added = taproot
      ? applyTaprootSignature(input, signature, inputIndex)
      : applyEcdsaSignature(input, derivation.pubkey, signature, inputIndex);
    verifyInputSignature(validatedPsbt, inputIndex);
    if (added) addedSignatures += 1;
  }
  return { validatedPsbt, addedSignatures };
}
