import { beforeEach, describe, expect, it, vi } from 'vitest';

const capabilityMocks = vi.hoisted(() => ({
  assertHardwareWalletCapability: vi.fn(),
}));

vi.mock('../../../src/services/hardwareWalletCapabilities', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/services/hardwareWalletCapabilities')>(),
  assertHardwareWalletCapability: capabilityMocks.assertHardwareWalletCapability,
}));

const mockDeviceRepository = vi.hoisted(() => ({
  findByIdWithModelAndAccounts: vi.fn(),
  findDuplicateAccount: vi.fn(),
  createAccount: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({ deviceRepository: mockDeviceRepository }));

import { addDeviceAccountWithEvidence } from '../../../src/services/deviceAccountRegistration';
import { ForbiddenError } from '../../../src/errors';

const input = {
  purpose: 'single_sig' as const,
  scriptType: 'native_segwit' as const,
  derivationPath: "m/84'/0'/1'",
  xpub: 'xpub-new',
  masterFingerprint: 'AABBCCDD',
};

describe('deviceAccountRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeviceRepository.findByIdWithModelAndAccounts.mockResolvedValue({
      id: 'device-1',
      type: 'coldcard',
      fingerprint: 'aabbccdd',
      model: { slug: 'coldcard-q' },
      accounts: [],
    });
    mockDeviceRepository.findDuplicateAccount.mockResolvedValue(null);
    mockDeviceRepository.createAccount.mockResolvedValue({ id: 'account-1' });
    capabilityMocks.assertHardwareWalletCapability.mockReturnValue(undefined);
  });

  it('rejects an unknown device before account lookup', async () => {
    mockDeviceRepository.findByIdWithModelAndAccounts.mockResolvedValue(null);
    await expect(addDeviceAccountWithEvidence('missing', input)).rejects.toThrow('Device not found');
    expect(mockDeviceRepository.findDuplicateAccount).not.toHaveBeenCalled();
  });

  it('blocks an unverified account-add row before duplicate lookup or creation', async () => {
    capabilityMocks.assertHardwareWalletCapability.mockImplementationOnce(() => {
      throw new ForbiddenError('blocked');
    });

    await expect(addDeviceAccountWithEvidence('device-1', input))
      .rejects.toThrow(ForbiddenError);
    expect(mockDeviceRepository.findDuplicateAccount).not.toHaveBeenCalled();
    expect(mockDeviceRepository.createAccount).not.toHaveBeenCalled();
  });

  it.each([
    { field: 'connected', masterFingerprint: '00000000', storedFingerprint: 'aabbccdd' },
    { field: 'stored', masterFingerprint: 'aabbccdd', storedFingerprint: 'bad-value' },
  ])('rejects invalid $field identity evidence before account lookup', async ({
    masterFingerprint,
    storedFingerprint,
  }) => {
    mockDeviceRepository.findByIdWithModelAndAccounts.mockResolvedValue({
      id: 'device-1',
      type: 'coldcard',
      fingerprint: storedFingerprint,
      model: { slug: 'coldcard-q' },
      accounts: [],
    });
    await expect(addDeviceAccountWithEvidence('device-1', {
      ...input,
      masterFingerprint,
    })).rejects.toThrow(/device:/i);
    expect(mockDeviceRepository.findDuplicateAccount).not.toHaveBeenCalled();
  });

  it('rejects a valid but mismatched connected device before account lookup', async () => {
    await expect(addDeviceAccountWithEvidence('device-1', {
      ...input,
      masterFingerprint: 'deadbeef',
    })).rejects.toThrow('does not match');
    expect(mockDeviceRepository.findDuplicateAccount).not.toHaveBeenCalled();
  });

  it('rejects duplicate account coordinates before creation', async () => {
    mockDeviceRepository.findDuplicateAccount.mockResolvedValue({ id: 'duplicate' });
    await expect(addDeviceAccountWithEvidence('device-1', input)).rejects.toThrow('already exists');
    expect(mockDeviceRepository.createAccount).not.toHaveBeenCalled();
  });

  it('creates an account only after exact identity comparison', async () => {
    await expect(addDeviceAccountWithEvidence('device-1', input)).resolves.toEqual({ id: 'account-1' });
    expect(mockDeviceRepository.createAccount).toHaveBeenCalledWith({
      deviceId: 'device-1',
      purpose: input.purpose,
      scriptType: input.scriptType,
      derivationPath: input.derivationPath,
      xpub: input.xpub,
    });
  });
});
