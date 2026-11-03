import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../src/repositories', () => ({
  walletRepository: {
    findByIdWithSigningDevices: vi.fn(),
  },
}));

vi.mock('../../../src/services/bitcoin/signingIntent', () => ({
  validatePartialSignedPsbt: vi.fn().mockResolvedValue(undefined),
}));

import { walletRepository } from '../../../src/repositories';
import { validatePartialSignedPsbt } from '../../../src/services/bitcoin/signingIntent';
import { InvalidInputError } from '../../../src/errors';
import {
  assertDeviceSignedPsbt,
  resolveWalletSigningDevice,
  validateInitialSigningState,
} from '../../../src/services/draftSigning';
import {
  buildMultisigPsbt,
  buildTaprootPsbt,
  buildUnattributablePsbt,
} from './draftSignerPsbtFixture';

const walletId = 'wallet-1';
const FP_A = 'aaaaaaaa';
const FP_B = 'bbbbbbbb';
const FP_C = 'cccccccc';

const walletWithDevices = () => ({
  id: walletId,
  devices: [
    { deviceId: 'device-a', signerFingerprint: FP_A, device: { fingerprint: FP_A } },
    { deviceId: 'device-b', signerFingerprint: null, device: { fingerprint: FP_B.toUpperCase() } },
    { deviceId: 'device-c', signerFingerprint: FP_C, device: { fingerprint: 'dddddddd' } },
  ],
});

const signerMismatch = expect.objectContaining({
  details: expect.objectContaining({ reason: 'signer_mismatch' }),
});

describe('draft signer attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (walletRepository.findByIdWithSigningDevices as Mock).mockResolvedValue(walletWithDevices());
  });

  describe('validateInitialSigningState', () => {
    it('rejects a PSBT signed by one cosigner but attributed to another', async () => {
      const signedPsbtBase64 = buildMultisigPsbt([FP_A, FP_B, FP_C], [FP_A]);

      const result = validateInitialSigningState(walletId, {
        signedPsbtBase64,
        signedDeviceId: 'device-b',
      } as never);

      await expect(result).rejects.toThrow(InvalidInputError);
      await expect(result).rejects.toEqual(signerMismatch);
    });

    it('records the claimed device when its key produced a signature', async () => {
      const signedPsbtBase64 = buildMultisigPsbt([FP_A, FP_B, FP_C], [FP_A]);

      await expect(validateInitialSigningState(walletId, {
        signedPsbtBase64,
        signedDeviceId: 'device-a',
      } as never)).resolves.toEqual({
        signedPsbtBase64,
        signedDeviceIds: ['device-a'],
        status: 'partial',
      });
    });

    it('verifies the signatures before attributing them', async () => {
      (validatePartialSignedPsbt as Mock).mockRejectedValueOnce(new InvalidInputError('PSBT contains an invalid signature'));

      await expect(validateInitialSigningState(walletId, {
        signedPsbtBase64: buildMultisigPsbt([FP_A, FP_B], [FP_A]),
        signedDeviceId: 'device-a',
      } as never)).rejects.toThrow('PSBT contains an invalid signature');
    });
  });

  describe('resolveWalletSigningDevice', () => {
    it('prefers the bound signer fingerprint and normalizes case', async () => {
      await expect(resolveWalletSigningDevice(walletId, ' device-b ')).resolves.toEqual({
        deviceId: 'device-b',
        fingerprint: FP_B,
      });
      await expect(resolveWalletSigningDevice(walletId, 'device-c')).resolves.toEqual({
        deviceId: 'device-c',
        fingerprint: FP_C,
      });
    });
  });

  describe('assertDeviceSignedPsbt', () => {
    const deviceA = { deviceId: 'device-a', fingerprint: FP_A };
    const deviceB = { deviceId: 'device-b', fingerprint: FP_B };

    it('accepts each cosigner present in a combined PSBT', () => {
      const combined = buildMultisigPsbt([FP_A, FP_B, FP_C], [FP_A, FP_B]);

      expect(() => assertDeviceSignedPsbt(deviceA, combined)).not.toThrow();
      expect(() => assertDeviceSignedPsbt(deviceB, combined)).not.toThrow();
    });

    it('rejects a device whose key has not signed', () => {
      expect(() => assertDeviceSignedPsbt(deviceB, buildMultisigPsbt([FP_A, FP_B], []))).toThrow(signerMismatch);
    });

    it('rejects when there is no signed PSBT to attribute', () => {
      expect(() => assertDeviceSignedPsbt(deviceA, null)).toThrow(signerMismatch);
    });

    it('ignores signatures whose pubkey has no derivation entry', () => {
      expect(() => assertDeviceSignedPsbt(deviceA, buildUnattributablePsbt(FP_A))).toThrow(signerMismatch);
    });

    it('attributes a Taproot key-path signature through its derivation', () => {
      expect(() => assertDeviceSignedPsbt(deviceA, buildTaprootPsbt(FP_A, true))).not.toThrow();
      expect(() => assertDeviceSignedPsbt(deviceA, buildTaprootPsbt(FP_A, false))).toThrow(signerMismatch);
    });
  });
});
