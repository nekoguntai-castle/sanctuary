import * as bitcoin from 'bitcoinjs-lib';
import { walletRepository } from '../repositories';
import { InvalidInputError, NotFoundError } from '../errors';
import type { CreateDraftInput, InitialSigningState } from './draftTypes';
import { validatePartialSignedPsbt } from './bitcoin/signingIntent';

export interface WalletSigningDevice {
  deviceId: string;
  /** Lowercase hex master fingerprint the device signs with. */
  fingerprint: string;
}

export async function resolveWalletSigningDevice(
  walletId: string,
  signedDeviceIdInput: string
): Promise<WalletSigningDevice> {
  const signedDeviceId = signedDeviceIdInput.trim();
  if (!signedDeviceId) {
    throw new InvalidInputError('signedDeviceId must be non-empty');
  }

  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  /* v8 ignore next -- wallet repository includes devices array for this lookup */
  const walletDevice = (wallet.devices || []).find(device => device.deviceId === signedDeviceId);
  if (!walletDevice) {
    throw new InvalidInputError('signedDeviceId must belong to the wallet');
  }

  const fingerprint = walletDevice.signerFingerprint ?? walletDevice.device.fingerprint;
  return { deviceId: signedDeviceId, fingerprint: fingerprint.toLowerCase() };
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/**
 * Master fingerprints whose keys carry a signature in the PSBT. Only sound for
 * a PSBT that passed validatePartialSignedPsbt: that check verifies every
 * signature and pins the derivation maps to the server-built unsigned PSBT, so
 * a signature's pubkey maps to a fingerprint the server authored.
 */
const signerFingerprints = (verifiedPsbtBase64: string): Set<string> => {
  const fingerprints = new Set<string>();
  for (const input of bitcoin.Psbt.fromBase64(verifiedPsbtBase64).data.inputs) {
    for (const { pubkey } of input.partialSig ?? []) {
      const derivation = input.bip32Derivation?.find(entry => hex(entry.pubkey) === hex(pubkey));
      if (derivation) fingerprints.add(hex(derivation.masterFingerprint));
    }
    if (input.tapKeySig) {
      /* v8 ignore next -- validation requires exactly one key-path derivation, for the internal key */
      for (const derivation of input.tapBip32Derivation ?? []) {
        fingerprints.add(hex(derivation.masterFingerprint));
      }
    }
  }
  return fingerprints;
};

/**
 * Reject a signedDeviceId unless that device's key produced a signature in the
 * verified PSBT, so signedDeviceIds never names a cosigner that did not sign.
 */
export function assertDeviceSignedPsbt(
  device: WalletSigningDevice,
  verifiedPsbtBase64: string | null
): void {
  if (verifiedPsbtBase64 && signerFingerprints(verifiedPsbtBase64).has(device.fingerprint)) {
    return;
  }
  throw new InvalidInputError('signedDeviceId did not sign the PSBT', 'signedDeviceId', {
    reason: 'signer_mismatch',
  });
}

export async function validateInitialSigningState(
  walletId: string,
  data: CreateDraftInput
): Promise<InitialSigningState> {
  const hasSignedPsbt = data.signedPsbtBase64 !== undefined;
  const hasSignedDeviceId = data.signedDeviceId !== undefined;

  if (!hasSignedPsbt && !hasSignedDeviceId) {
    return { signedPsbtBase64: null, signedDeviceIds: [], status: 'unsigned' };
  }

  if (!hasSignedPsbt || !hasSignedDeviceId) {
    throw new InvalidInputError('signedPsbtBase64 and signedDeviceId must be provided together');
  }

  if (!data.signedPsbtBase64?.trim()) {
    throw new InvalidInputError('signedPsbtBase64 and signedDeviceId must be non-empty');
  }

  const signingDevice = await resolveWalletSigningDevice(
    walletId,
    /* v8 ignore next -- validated above; fallback keeps helper strict for internal callers */
    data.signedDeviceId ?? ''
  );
  await validatePartialSignedPsbt({
    walletId,
    intentId: data.intentId,
    intentDigest: data.intentDigest,
    signedPsbtBase64: data.signedPsbtBase64,
  });
  assertDeviceSignedPsbt(signingDevice, data.signedPsbtBase64);

  return {
    signedPsbtBase64: data.signedPsbtBase64,
    signedDeviceIds: [signingDevice.deviceId],
    status: 'partial',
  };
}
