import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError, InvalidInputError } from '../../../src/errors';

const mockDeviceRepository = vi.hoisted(() => ({
  findByFingerprintWithAccounts: vi.fn(),
  findHardwareModel: vi.fn(),
  createWithOwnerAndAccounts: vi.fn(),
  findByIdWithModelAndAccounts: vi.fn(),
  mergeAccounts: vi.fn(),
}));
const mockAssertHardwareWalletCapability = vi.hoisted(() => vi.fn());
const mockGetUserDeviceRole = vi.hoisted(() => vi.fn());

vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertHardwareWalletCapability: mockAssertHardwareWalletCapability,
}));

vi.mock('../../../src/services/deviceAccess', () => ({
  getUserDeviceRole: mockGetUserDeviceRole,
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
    mockAssertHardwareWalletCapability.mockReturnValue(undefined);
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue(null);
    mockDeviceRepository.findHardwareModel.mockResolvedValue({ id: 'model-1' });
    mockDeviceRepository.createWithOwnerAndAccounts.mockResolvedValue({ id: 'device-1' });
    mockDeviceRepository.findByIdWithModelAndAccounts.mockResolvedValue({ id: 'device-1', accounts: [] });
    mockGetUserDeviceRole.mockResolvedValue('owner');
  });

  it('rejects missing required device identity fields', async () => {
    await expect(registerDevice('user-1', {
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      xpub: 'xpub',
    })).rejects.toThrow(InvalidInputError);
  });

  it('rejects input without any xpub or accounts', async () => {
    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
    })).rejects.toThrow('Either xpub or accounts array is required');
  });

  it.each(['', '00000000', 'not-hex', 'abcd123'])(
    'rejects unsafe master fingerprint %j before repository access',
    async (fingerprint) => {
      await expect(registerDevice('user-1', {
        type: 'coldcard',
        label: 'Coldcard',
        fingerprint,
        derivationPath: "m/84'/0'/0'",
        xpub: 'xpub',
      })).rejects.toThrow(InvalidInputError);

      expect(mockDeviceRepository.findByFingerprintWithAccounts).not.toHaveBeenCalled();
      expect(mockDeviceRepository.createWithOwnerAndAccounts).not.toHaveBeenCalled();
    },
  );

  it('rejects xpub-only legacy registration without exact path evidence', async () => {
    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      xpub: 'xpub',
    })).rejects.toThrow('Legacy xpub and derivationPath must be provided together');

    expect(mockDeviceRepository.findByFingerprintWithAccounts).not.toHaveBeenCalled();
    expect(mockDeviceRepository.createWithOwnerAndAccounts).not.toHaveBeenCalled();
  });

  it.each([
    { derivationPath: " m/84'/0'/0'", xpub: 'xpub' },
    { derivationPath: "m/84'/0'/0'", xpub: 'xpub ' },
  ])('rejects silently normalized legacy evidence %#', async ({ derivationPath, xpub }) => {
    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath,
      xpub,
    })).rejects.toThrow('must not contain surrounding whitespace');
  });

  it('rejects silently normalized multi-account evidence', async () => {
    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      accounts: [{
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/0' ",
        xpub: 'xpub',
      }],
    })).rejects.toThrow('must not contain surrounding whitespace');
  });

  it.each(['ledger', 'jade', 'trezor'])(
    'blocks %s registration before duplicate lookup or writes',
    async (type) => {
      mockAssertHardwareWalletCapability.mockImplementationOnce(() => {
        throw new ForbiddenError(
          'blocked', undefined, { vendor: type, capability: 'import' },
        );
      });
      await expect(registerDevice('user-1', {
        type,
        label: `${type} device`,
        fingerprint: 'AABBCCDD',
        xpub: 'xpub',
      })).rejects.toMatchObject({
        statusCode: 403,
        details: { vendor: type, capability: 'import' },
      });

      expect(mockDeviceRepository.findByFingerprintWithAccounts).not.toHaveBeenCalled();
      expect(mockDeviceRepository.createWithOwnerAndAccounts).not.toHaveBeenCalled();
      expect(mockDeviceRepository.mergeAccounts).not.toHaveBeenCalled();
    },
  );

  it('blocks a spoofed non-target merge into an existing target device', async () => {
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue({
      id: 'ledger-1',
      type: 'ledger',
      model: { slug: 'ledger-nano-x' },
      label: 'Ledger',
      fingerprint: 'aabbccdd',
      accounts: [],
    });
    mockAssertHardwareWalletCapability
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw new ForbiddenError(
          'blocked', undefined, { vendor: 'ledger', capability: 'import' },
        );
      });

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Spoofed device',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
      merge: true,
    })).rejects.toMatchObject({
      statusCode: 403,
      details: { vendor: 'ledger', capability: 'import' },
    });
    expect(mockDeviceRepository.mergeAccounts).not.toHaveBeenCalled();
  });

  it.each(['unknown', 'hardware'])(
    'blocks generic %s registration before writes',
    async type => {
      mockAssertHardwareWalletCapability.mockImplementationOnce(() => {
        throw new ForbiddenError(
          'blocked', undefined, { vendor: 'unidentified', capability: 'import' },
        );
      });
      await expect(registerDevice('user-1', {
        type,
        label: 'Unidentified hardware',
        fingerprint: 'AABBCCDD',
        xpub: 'xpub',
      })).rejects.toMatchObject({ statusCode: 403 });
      expect(mockDeviceRepository.findByFingerprintWithAccounts).not.toHaveBeenCalled();
    },
  );

  it('rejects malformed multi-account input', async () => {
    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
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
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/1'/0'",
      xpub: 'xpub',
      modelSlug: 'coldcard-q',
    })).resolves.toEqual({
      kind: 'created',
      device: { id: 'device-1', accounts: [] },
    });

    expect(mockDeviceRepository.findByFingerprintWithAccounts).toHaveBeenCalledWith('aabbccdd');
    expect(mockDeviceRepository.createWithOwnerAndAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        type: 'coldcard',
        label: 'Coldcard',
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

  it('rejects registration to an existing fingerprint the caller has no access to', async () => {
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue({
      id: 'other-device-1',
      type: 'coldcard',
      model: null,
      label: 'Someone else’s Coldcard',
      fingerprint: 'aabbccdd',
      accounts: [],
    });
    mockGetUserDeviceRole.mockResolvedValue(null);

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
    })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Device with this fingerprint is registered to another account',
    });

    expect(mockGetUserDeviceRole).toHaveBeenCalledWith('other-device-1', 'user-1');
    expect(mockDeviceRepository.mergeAccounts).not.toHaveBeenCalled();
  });

  it('rejects a merge into an existing fingerprint the caller has no access to', async () => {
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue({
      id: 'other-device-1',
      type: 'coldcard',
      model: null,
      label: 'Someone else’s Coldcard',
      fingerprint: 'aabbccdd',
      accounts: [],
    });
    mockGetUserDeviceRole.mockResolvedValue(null);

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
      merge: true,
    })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Device with this fingerprint is registered to another account',
    });

    expect(mockDeviceRepository.mergeAccounts).not.toHaveBeenCalled();
  });

  it('rejects a viewer attempting to merge accounts into an existing device', async () => {
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue({
      id: 'device-1',
      type: 'coldcard',
      model: null,
      label: 'Coldcard',
      fingerprint: 'aabbccdd',
      accounts: [],
    });
    mockGetUserDeviceRole.mockResolvedValue('viewer');

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
      merge: true,
    })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Only a device owner can merge accounts into it',
    });

    expect(mockDeviceRepository.mergeAccounts).not.toHaveBeenCalled();
  });

  it('allows a viewer to read the duplicate device without merging', async () => {
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue({
      id: 'device-1',
      type: 'coldcard',
      model: null,
      label: 'Coldcard',
      fingerprint: 'aabbccdd',
      accounts: [],
    });
    mockGetUserDeviceRole.mockResolvedValue('viewer');

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
    })).resolves.toMatchObject({ kind: 'duplicate' });

    expect(mockDeviceRepository.mergeAccounts).not.toHaveBeenCalled();
  });

  it('allows an owner to merge new accounts into an existing device', async () => {
    mockDeviceRepository.findByFingerprintWithAccounts.mockResolvedValue({
      id: 'device-1',
      type: 'coldcard',
      model: null,
      label: 'Coldcard',
      fingerprint: 'aabbccdd',
      accounts: [],
    });
    mockGetUserDeviceRole.mockResolvedValue('owner');
    mockDeviceRepository.mergeAccounts.mockResolvedValue([{ id: 'account-1' }]);
    mockDeviceRepository.findByIdWithModelAndAccounts.mockResolvedValue({
      id: 'device-1',
      accounts: [{ id: 'account-1' }],
    });

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
      merge: true,
    })).resolves.toMatchObject({ kind: 'merged', added: 1 });

    expect(mockDeviceRepository.mergeAccounts).toHaveBeenCalledTimes(1);
  });

  it('rejects an unrecognized canonical model before device creation', async () => {
    mockDeviceRepository.findHardwareModel.mockResolvedValue(null);

    await expect(registerDevice('user-1', {
      type: 'coldcard',
      label: 'Coldcard',
      fingerprint: 'AABBCCDD',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub',
      modelSlug: 'not-a-real-model',
    })).rejects.toThrow('Unknown hardware wallet model');

    expect(mockDeviceRepository.createWithOwnerAndAccounts).not.toHaveBeenCalled();
  });
});
