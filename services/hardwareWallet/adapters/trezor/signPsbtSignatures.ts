import * as bitcoin from 'bitcoinjs-lib';
import { createLogger } from '../../../../utils/logger';
import { uint8ArrayEquals, toHex } from '../../../../utils/bufferUtils';
import type { TrezorPsbt, TrezorPsbtInput } from './signPsbtTypes';

const log = createLogger('TrezorAdapter');

const verifyWitnessScriptMatches = (
  witnessScript: Uint8Array,
  witness: Uint8Array[],
  inputIndex: number
): void => {
  const trezorWitnessScript = witness[witness.length - 1];
  if (!uint8ArrayEquals(witnessScript, trezorWitnessScript)) {
    log.error('WitnessScript mismatch - Trezor signed with different script', {
      inputIndex,
      psbtWitnessScriptHex: toHex(witnessScript),
      trezorWitnessScriptHex: toHex(trezorWitnessScript),
    });
  }
};

const getWitnessSignatures = (witness: Uint8Array[]): Uint8Array[] => {
  return witness.slice(1, witness.length - 1).filter(sig => sig.length > 0);
};

const getDevicePubkey = (
  psbtInput: TrezorPsbtInput,
  deviceFingerprintBuffer: Buffer | null
): Uint8Array | null => {
  if (!deviceFingerprintBuffer || !psbtInput.bip32Derivation) {
    return null;
  }

  const trezorDerivation = psbtInput.bip32Derivation.find(d =>
    uint8ArrayEquals(d.masterFingerprint, deviceFingerprintBuffer)
  );
  return trezorDerivation?.pubkey ?? null;
};

const appendSignatureIfMissing = (
  psbtInput: TrezorPsbtInput,
  pubkey: Uint8Array,
  signature: Uint8Array
): void => {
  const existingSig = psbtInput.partialSig?.find(ps => uint8ArrayEquals(ps.pubkey, pubkey));
  if (existingSig) {
    return;
  }

  if (!psbtInput.partialSig) {
    psbtInput.partialSig = [];
  }

  psbtInput.partialSig.push({ pubkey, signature });
};

const processMultisigWitnessInput = (
  psbtInput: TrezorPsbtInput,
  witness: Uint8Array[],
  inputIndex: number,
  deviceFingerprintBuffer: Buffer | null
): void => {
  if (!witness || witness.length === 0 || !psbtInput.witnessScript) {
    return;
  }

  verifyWitnessScriptMatches(psbtInput.witnessScript, witness, inputIndex);
  const signatures = getWitnessSignatures(witness);
  const trezorPubkey = getDevicePubkey(psbtInput, deviceFingerprintBuffer);

  if (trezorPubkey && signatures.length > 0) {
    appendSignatureIfMissing(psbtInput, trezorPubkey, signatures[0]);
    return;
  }

  log.warn('Could not match Trezor signature to pubkey', {
    inputIndex,
    hasTrezorPubkey: !!trezorPubkey,
    signaturesFound: signatures.length,
  });
};

export const applyTrezorMultisigSignatures = (
  psbt: TrezorPsbt,
  signedTxHex: string,
  deviceFingerprintBuffer: Buffer | null
): void => {
  try {
    const signedTx = bitcoin.Transaction.fromHex(signedTxHex);
    signedTx.ins.forEach((input, index) =>
      processMultisigWitnessInput(psbt.data.inputs[index], input.witness, index, deviceFingerprintBuffer)
    );
  } catch (extractError) {
    log.warn('Failed to extract signatures from Trezor rawTx', {
      error: extractError instanceof Error ? extractError.message : String(extractError),
    });
  }
};
