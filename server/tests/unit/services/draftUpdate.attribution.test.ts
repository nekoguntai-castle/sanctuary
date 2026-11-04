import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * updateDraft signer attribution: a signedDeviceId is recorded only when that
 * device's key signed the PSBT the update stores.
 */

vi.mock('../../../src/repositories', () => ({
  draftRepository: {
    findByIdInWallet: vi.fn(),
    update: vi.fn(),
  },
  walletRepository: {
    findByIdWithSigningDevices: vi.fn(),
  },
}));

vi.mock('../../../src/services/bitcoin/signingIntent', () => ({
  validatePartialSignedPsbt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { draftRepository, walletRepository } from '../../../src/repositories';
import { validatePartialSignedPsbt } from '../../../src/services/bitcoin/signingIntent';
import { updateDraft } from '../../../src/services/draftUpdate';
import { buildMultisigPsbt } from './draftSignerPsbtFixture';

describe('updateDraft signer attribution', () => {
  const walletId = 'wallet-456';
  const draftId = 'draft-789';
  const COSIGNER_FP = 'c3c3c3c3';
  const HUMAN_FP = 'b2b2b2b2';
  const mockDraft = {
    id: draftId,
    walletId,
    psbtBase64: buildMultisigPsbt([COSIGNER_FP, HUMAN_FP], []),
    signedPsbtBase64: null,
    signingIntentId: 'intent-1',
    signingIntentDigest: 'a'.repeat(64),
    status: 'unsigned',
    signedDeviceIds: [],
    updatedAt: new Date('2026-11-03T00:00:00.000Z'),
  };
  const signedDraft = {
    ...mockDraft,
    status: 'partial',
    signedPsbtBase64: buildMultisigPsbt([COSIGNER_FP, HUMAN_FP], [COSIGNER_FP]),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (draftRepository.findByIdInWallet as Mock).mockResolvedValue(signedDraft);
    (draftRepository.update as Mock).mockResolvedValue({ ...signedDraft });
    (walletRepository.findByIdWithSigningDevices as Mock).mockResolvedValue({
      id: walletId,
      devices: [
        { deviceId: 'device-1', signerFingerprint: COSIGNER_FP },
        { deviceId: 'device-unsigned', signerFingerprint: HUMAN_FP },
      ],
    });
  });

  it('rejects a signed device ID whose key did not sign the stored PSBT', async () => {
    await expect(
      updateDraft(walletId, draftId, { signedDeviceId: 'device-unsigned' })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'signer_mismatch' }) });

    expect(draftRepository.update).not.toHaveBeenCalled();
  });

  it('rejects a signed device ID when the draft has no signed PSBT', async () => {
    (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);

    await expect(
      updateDraft(walletId, draftId, { signedDeviceId: 'device-1' })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'signer_mismatch' }) });

    expect(validatePartialSignedPsbt).not.toHaveBeenCalled();
    expect(draftRepository.update).not.toHaveBeenCalled();
  });

  it('rejects an ID-only update on a legacy draft without a signing intent', async () => {
    (draftRepository.findByIdInWallet as Mock).mockResolvedValue({
      ...signedDraft, signingIntentId: null, signingIntentDigest: null,
    });

    await expect(
      updateDraft(walletId, draftId, { signedDeviceId: 'device-1' })
    ).rejects.toMatchObject({ details: expect.objectContaining({ reason: 'missing_intent' }) });

    expect(validatePartialSignedPsbt).not.toHaveBeenCalled();
    expect(draftRepository.update).not.toHaveBeenCalled();
  });

  it('re-validates the stored PSBT before attributing an ID-only update', async () => {
    await updateDraft(walletId, draftId, { signedDeviceId: 'device-1' });

    expect(validatePartialSignedPsbt).toHaveBeenCalledWith({
      walletId,
      intentId: signedDraft.signingIntentId,
      intentDigest: signedDraft.signingIntentDigest,
      signedPsbtBase64: signedDraft.signedPsbtBase64,
      draftId,
    });
  });

  it('attributes against the combined PSBT when a signature is uploaded', async () => {
    (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);

    await updateDraft(walletId, draftId, {
      signedPsbtBase64: buildMultisigPsbt([COSIGNER_FP, HUMAN_FP], [HUMAN_FP]),
      signedDeviceId: 'device-unsigned',
    });

    expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({
      signedDeviceIds: ['device-unsigned'],
    }));
  });

  it('derives the stored status from the combined PSBT', async () => {
    (draftRepository.findByIdInWallet as Mock).mockResolvedValue(signedDraft);

    await updateDraft(walletId, draftId, {
      signedPsbtBase64: buildMultisigPsbt([COSIGNER_FP, HUMAN_FP], [HUMAN_FP]),
      status: 'unsigned',
    });

    // COSIGNER signed earlier, HUMAN now: 2 of 2, regardless of the claimed status.
    expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({ status: 'signed' }));
  });

  it('keeps a partly signed draft partial', async () => {
    (draftRepository.findByIdInWallet as Mock).mockResolvedValue(mockDraft);

    await updateDraft(walletId, draftId, {
      signedPsbtBase64: buildMultisigPsbt([COSIGNER_FP, HUMAN_FP], [HUMAN_FP]),
      status: 'signed',
    });

    expect(draftRepository.update).toHaveBeenCalledWith(draftId, expect.objectContaining({ status: 'partial' }));
  });
});
