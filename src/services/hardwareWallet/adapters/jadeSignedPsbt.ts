/**
 * Treat the device-returned PSBT as hostile input: its unsigned transaction,
 * UTXO/change metadata, and every pre-existing field must remain exact, while
 * every added ECDSA or key-path Schnorr signature must belong to the connected
 * signer and verify cryptographically before the artifact can advance.
 */
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import type { ValidatedPsbtSigningRequest } from '../psbtAccountBinding';

bitcoin.initEccLib(ecc);

type PsbtInput = bitcoin.Psbt['data']['inputs'][number];
interface ConnectedOrigin { pubkey: string }
interface ValidatedJadePsbt { psbt: string; signatures: number }

const bytesEqual = (first: Uint8Array, second: Uint8Array): boolean => (
  Buffer.from(first).equals(Buffer.from(second))
);

const signatureError = (detail: string): Error => (
  new Error(`Jade signed PSBT mismatch: ${detail}`)
);

const parseReturnedPsbt = (
  bytes: Uint8Array,
  network: ValidatedPsbtSigningRequest['network'],
): bitcoin.Psbt => {
  try {
    return bitcoin.Psbt.fromBuffer(bytes, {
      network: network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet,
    });
  } catch {
    throw signatureError('returned artifact is not a PSBT');
  }
};

const assertNotFinalized = (input: PsbtInput, index: number): void => {
  if (input.finalScriptSig || input.finalScriptWitness) {
    throw signatureError(`input ${index} is a finalized input`);
  }
  if (input.tapScriptSig?.length) {
    throw signatureError(`input ${index} contains unsupported Taproot script-path signatures`);
  }
};

const connectedOrigin = (
  validated: ValidatedPsbtSigningRequest,
  inputIndex: number,
): ConnectedOrigin => {
  const binding = validated.context.inputs.find(input => input.inputIndex === inputIndex)!;
  const origins = binding.signerOrigins.filter(origin => (
    origin.masterFingerprint === validated.connectedSigner.masterFingerprint
  ));
  if (origins.length !== 1) {
    throw signatureError(`input ${inputIndex} is not bound to exactly one connected key`);
  }
  return origins[0];
};

const countNewEcdsaSignature = (
  validated: ValidatedPsbtSigningRequest,
  returned: bitcoin.Psbt,
  index: number,
): number => {
  const returnedInput = returned.data.inputs[index];
  const signatures = returnedInput.partialSig ?? [];
  if (signatures.length !== 1) {
    throw signatureError(`input ${index} must contain exactly one new signature`);
  }
  const expectedPubkey = connectedOrigin(validated, index).pubkey;
  if (Buffer.from(signatures[0].pubkey).toString('hex') !== expectedPubkey) {
    throw signatureError(`input ${index} signature uses an unexpected key`);
  }
  return 1;
};

const countNewTaprootSignature = (
  validated: ValidatedPsbtSigningRequest,
  returned: bitcoin.Psbt,
  index: number,
): number => {
  const returnedSignature = returned.data.inputs[index].tapKeySig;
  if (!returnedSignature) {
    throw signatureError(`input ${index} must contain exactly one new signature`);
  }
  connectedOrigin(validated, index);
  return 1;
};

const assertBoundInputsUnsigned = (validated: ValidatedPsbtSigningRequest): void => {
  for (const binding of validated.context.inputs) {
    const input = validated.psbt.data.inputs[binding.inputIndex];
    if ((input?.partialSig?.length ?? 0) > 0 || input?.tapKeySig) {
      throw signatureError(`input ${binding.inputIndex} contains a pre-existing signature`);
    }
  }
};

const partialSignaturesEqual = (first: PsbtInput, second: PsbtInput): boolean => {
  const firstSignatures = first.partialSig ?? [];
  const secondSignatures = second.partialSig ?? [];
  return firstSignatures.length === secondSignatures.length
    && firstSignatures.every((signature, index) => (
      bytesEqual(signature.pubkey, secondSignatures[index].pubkey)
      && bytesEqual(signature.signature, secondSignatures[index].signature)
    ));
};

const tapSignaturesEqual = (first: PsbtInput, second: PsbtInput): boolean => {
  if (!first.tapKeySig && !second.tapKeySig) return true;
  return Boolean(first.tapKeySig && second.tapKeySig && bytesEqual(first.tapKeySig, second.tapKeySig));
};

const assertUnboundSignaturesUnchanged = (source: PsbtInput, returned: PsbtInput, index: number): void => {
  if (!partialSignaturesEqual(source, returned) || !tapSignaturesEqual(source, returned)) {
    throw signatureError(`unbound input ${index} contains a changed signature`);
  }
};

const verifyInputSignature = (psbt: bitcoin.Psbt, inputIndex: number): void => {
  let valid = false;
  try {
    valid = psbt.validateSignaturesOfInput(inputIndex, (pubkey, hash, signature) => (
      pubkey.length === 32
        ? ecc.verifySchnorr(hash, pubkey, signature)
        : ecc.verify(hash, pubkey, signature)
    ));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw signatureError(`input ${inputIndex} signature cannot be validated: ${detail}`);
  }
  if (!valid) throw signatureError(`input ${inputIndex} signature is cryptographically invalid`);
};

const restoreSignatureFields = (target: PsbtInput, source: PsbtInput): void => {
  if (source.partialSig) target.partialSig = source.partialSig;
  else delete target.partialSig;
  if (source.tapKeySig) target.tapKeySig = source.tapKeySig;
  else delete target.tapKeySig;
};

const assertOnlySignaturesChanged = (
  source: bitcoin.Psbt,
  returned: bitcoin.Psbt,
): void => {
  const normalized = returned.clone();
  for (const [index, input] of normalized.data.inputs.entries()) {
    restoreSignatureFields(input, source.data.inputs[index]);
  }
  if (!Buffer.from(normalized.toBuffer()).equals(Buffer.from(source.toBuffer()))) {
    throw signatureError('returned artifact changed non-signature data');
  }
};

/** Validate a Jade-returned PSBT before it can reach finalization or broadcast. */
export function validateJadeSignedPsbt(
  validated: ValidatedPsbtSigningRequest,
  returnedBytes: Uint8Array,
): ValidatedJadePsbt {
  if (validated.context.walletType === 'multi_sig') {
    throw new Error('Jade multisig signing is not supported');
  }
  const returned = parseReturnedPsbt(returnedBytes, validated.network);
  if (returned.data.inputs.length !== validated.psbt.data.inputs.length) {
    throw signatureError('returned artifact changed non-signature data');
  }
  assertBoundInputsUnsigned(validated);
  returned.data.inputs.forEach(assertNotFinalized);
  assertOnlySignaturesChanged(validated.psbt, returned);
  let signatures = 0;
  const boundIndexes = new Set(validated.context.inputs.map(input => input.inputIndex));
  for (const [index, input] of returned.data.inputs.entries()) {
    if (!boundIndexes.has(index)) {
      const sourceInput = validated.psbt.data.inputs[index];
      assertUnboundSignaturesUnchanged(sourceInput, input, index);
      continue;
    }
    signatures += validated.context.scriptType === 'taproot'
      ? countNewTaprootSignature(validated, returned, index)
      : countNewEcdsaSignature(validated, returned, index);
    verifyInputSignature(returned, index);
  }
  if (signatures !== boundIndexes.size || signatures === 0) {
    throw signatureError('returned artifact is missing a connected-device signature');
  }
  return { psbt: returned.toBase64(), signatures };
}
