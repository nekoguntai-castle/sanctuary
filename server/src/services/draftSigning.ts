import { walletRepository } from '../repositories';
import { InvalidInputError, NotFoundError } from '../errors';
import type { CreateDraftInput, InitialSigningState } from './draftTypes';

export async function normalizeAndAssertSignedDeviceBelongsToWallet(
  walletId: string,
  signedDeviceIdInput: string
): Promise<string> {
  const signedDeviceId = signedDeviceIdInput.trim();
  if (!signedDeviceId) {
    throw new InvalidInputError('signedDeviceId must be non-empty');
  }

  const wallet = await walletRepository.findByIdWithSigningDevices(walletId);
  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  /* v8 ignore next -- wallet repository includes devices array for this lookup */
  const walletDeviceIds = new Set((wallet.devices || []).map(device => device.deviceId));
  if (!walletDeviceIds.has(signedDeviceId)) {
    throw new InvalidInputError('signedDeviceId must belong to the wallet');
  }

  return signedDeviceId;
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

  const signedDeviceId = await normalizeAndAssertSignedDeviceBelongsToWallet(
    walletId,
    /* v8 ignore next -- validated above; fallback keeps helper strict for internal callers */
    data.signedDeviceId ?? ''
  );

  return {
    signedPsbtBase64: data.signedPsbtBase64,
    signedDeviceIds: [signedDeviceId],
    status: 'partial',
  };
}
