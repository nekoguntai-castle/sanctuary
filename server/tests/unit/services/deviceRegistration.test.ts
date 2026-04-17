import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidInputError } from '../../../src/errors';

const mockDeviceRepository = vi.hoisted(() => ({
  findByFingerprintWithAccounts: vi.fn(),
  findHardwareModel: vi.fn(),
  createWithOwnerAndAccounts: vi.fn(),
  findByIdWithModelAndAccounts: vi.fn(),
  mergeAccounts: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  deviceRepository: mockDeviceRepository,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { registerDevice } from '../../../src/services/deviceRegistration';

describe('deviceRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue(null);
    mockDeviceRepository.findHardwareModel.mockResolvedValue({ id: 'model-1' });
    mockDeviceRepository.createWithOwnerAndAccounts.mockResolvedValue({ id: 'device-1' });
    mockDeviceRepository.findByIdWithModelAndAccounts.mockResolvedValue({ id: 'device-1', accounts: [] });
  });

  it('rejects missing required device identity fields', async () => {
    await expect(registerDevice('user-1', {
      label: 'Ledger',
      fingerprint: 'AABBCCDD',
      xpub: 'xpub',
    })).rejects.toThrow(InvalidInputError);
  });

  it('rejects input without any xpub or accounts', async () => {
    await expect(registerDevice('user-1', {
      type: 'hardware',
      label: 'Ledger',
      fingerprint: 'AABBCCDD',
    })).rejects.toThrow('Either xpub or accounts array is required');
  });

  it('rejects malformed multi-account input', async () => {
    await expect(registerDevice('user-1', {
      type: 'hardware',
      label: 'Ledger',
      fingerprint: 'AABBCCDD',
      accounts: [{
        purpose: 'bad-purpose' as any,
        scriptType: 'native_segwit',
        derivationPath: "m/84'/1'/0'",
        xpub: 'xpub',
      }],
    })).rejects.toThrow('Account purpose');
  });

  it('creates a new device with normalized legacy account metadata', async () => {
    await expect(registerDevice('user-1', {
      type: 'hardware',
      label: 'Ledger',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/1'/0'",
      xpub: 'xpub',
      modelSlug: 'ledger-nano',
    })).resolves.toEqual({
      kind: 'created',
      device: { id: 'device-1', accounts: [] },
    });

    expect(mockDeviceRepository.findByFingerprintWithAccounts).toHaveBeenCalledWith('aabbccdd');
    expect(mockDeviceRepository.createWithOwnerAndAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'hardware',
        label: 'Ledger',
        fingerprint: 'aabbccdd',
        derivationPath: "m/84'/1'/0'",
        xpub: 'xpub',
        modelId: 'model-1',
      }),
      [{
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/1'/0'",
        xpub: 'xpub',
      }],
    );
  });
});
