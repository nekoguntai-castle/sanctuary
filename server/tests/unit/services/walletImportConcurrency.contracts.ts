import { describe, expect, it } from 'vitest';
import {
  mockBuildDescriptorFromDevices,
  mockCurrentDeviceRole,
  mockAssertHardwareWalletCapability,
} from './walletImport.setup';
import { ConflictError } from '../../../src/errors/ApiError';
import { importFromParsedData } from '../../../src/services/walletImport/descriptorImport';
import { resolveDevices } from '../../../src/services/walletImport/deviceResolution';
import { deviceRepository } from '../../../src/repositories/deviceRepository';
import { mockPrismaClient } from '../../mocks/prisma';
import type { ParsedDescriptor } from '../../../src/services/bitcoin/descriptorParser';

const USER_ID = 'wallet-import-race-user';
const FINGERPRINT = 'aabbccdd';
const DERIVATION_PATH = "m/84'/0'/0'";
const XPUB = 'xpub-existing-signer';

function makeParsedDescriptor(): ParsedDescriptor {
  return {
    type: 'single_sig',
    scriptType: 'native_segwit',
    devices: [{ fingerprint: FINGERPRINT, derivationPath: DERIVATION_PATH, xpub: XPUB }],
    network: 'mainnet',
    isChange: false,
  };
}

function createPreflightBarrier(): { wait: () => Promise<void>; release: () => void } {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  return {
    async wait() {
      arrived += 1;
      if (arrived === 2) release();
      await gate;
    },
    release,
  };
}

function installAdvisoryLockTransactionMock(): void {
  let lockTail = Promise.resolve();
  mockPrismaClient.$transaction.mockImplementation(async (callback) => {
    let releaseLock: (() => void) | undefined;
    const tx = {
      ...mockPrismaClient,
      $executeRaw: async () => {
        const previous = lockTail;
        let release!: () => void;
        lockTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        releaseLock = release;
        return 0;
      },
    };
    try {
      return await callback(tx as never);
    } finally {
      releaseLock?.();
    }
  });
}

export const registerWalletImportConcurrencyContracts = () => describe('wallet import concurrency', () => {
  it('resolves devices using the supplied import transaction snapshot', async () => {
    const tx = { device: { findMany: vi.fn().mockResolvedValue([]) } };
    const repositorySpy = vi.spyOn(deviceRepository, 'findByUserIdWithModel');
    const parsed = makeParsedDescriptor();

    try {
      await resolveDevices(USER_ID, parsed.devices, undefined, tx as never);
      expect(repositorySpy).toHaveBeenCalledWith(USER_ID, tx);
    } finally {
      repositorySpy.mockRestore();
    }
  });

  it('reuses a signer discovered by the locked refresh instead of recreating it', async () => {
    const existing = {
      id: 'concurrent-existing-device',
      userId: USER_ID,
      type: 'coldcard',
      label: 'Existing account zero',
      fingerprint: FINGERPRINT,
      xpub: 'root-xpub',
      derivationPath: "m/84'/0'/0'",
      model: null,
    };
    mockCurrentDeviceRole('owner');
    mockPrismaClient.device.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existing]);
    mockPrismaClient.deviceAccount.findMany.mockResolvedValue([{
      id: 'account-zero',
      deviceId: existing.id,
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'account-zero-xpub',
    }]);

    const result = await importFromParsedData(USER_ID, {
      parsed: {
        ...makeParsedDescriptor(),
        devices: [{
          fingerprint: FINGERPRINT,
          derivationPath: "m/84'/0'/1'",
          xpub: 'account-one-xpub',
        }],
      },
      name: 'Account one import',
    });

    expect(result.devicesCreated).toBe(0);
    expect(result.devicesReused).toBe(1);
    expect(mockPrismaClient.device.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
      data: {
        deviceId: existing.id,
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/0'/1'",
        xpub: 'account-one-xpub',
      },
    });
  });

  it('checks fresh hardware capability before reusing a newly visible signer', async () => {
    const existing = {
      id: 'unsupported-existing-device',
      userId: USER_ID,
      type: 'ledger',
      label: 'Newly visible signer',
      fingerprint: FINGERPRINT,
      xpub: 'root-xpub',
      derivationPath: "m/84'/0'/0'",
      model: null,
    };
    mockPrismaClient.device.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([existing]);
    mockAssertHardwareWalletCapability.mockImplementation(({ type }) => {
      if (type === 'ledger') throw new Error('unsupported fresh signer');
    });

    await expect(importFromParsedData(USER_ID, {
      parsed: {
        ...makeParsedDescriptor(),
        devices: [{
          fingerprint: FINGERPRINT,
          derivationPath: "m/84'/0'/1'",
          xpub: 'account-one-xpub',
        }],
      },
      name: 'Unsupported account one',
    })).rejects.toThrow('unsupported fresh signer');

    expect(mockAssertHardwareWalletCapability).toHaveBeenLastCalledWith({
      type: 'ledger',
      model: null,
    }, 'import');
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
  });

  it('admits at most one identical import after both preflight reads see no wallet', async () => {
    const barrier = createPreflightBarrier();
    const persistedWallets: Array<Record<string, unknown>> = [];
    let preflightReads = 0;
    let createdWallets = 0;

    installAdvisoryLockTransactionMock();
    mockCurrentDeviceRole('owner');
    mockBuildDescriptorFromDevices.mockReturnValue({
      descriptor: `wpkh([${FINGERPRINT}/84h/0h/0h]${XPUB}/0/*)`,
      changeDescriptor: `wpkh([${FINGERPRINT}/84h/0h/0h]${XPUB}/1/*)`,
      fingerprint: FINGERPRINT,
    });
    mockPrismaClient.device.findMany.mockResolvedValue([{
      id: 'existing-device',
      userId: USER_ID,
      type: 'coldcard',
      label: 'Existing signer',
      fingerprint: FINGERPRINT,
      xpub: XPUB,
      model: null,
    }]);
    mockPrismaClient.deviceAccount.findMany.mockResolvedValue([{
      id: 'existing-account',
      deviceId: 'existing-device',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: DERIVATION_PATH,
      xpub: XPUB,
    }]);
    mockPrismaClient.wallet.findMany.mockImplementation(async () => {
      if (preflightReads < 2) {
        preflightReads += 1;
        await barrier.wait();
        return [];
      }
      return persistedWallets as never;
    });
    mockPrismaClient.wallet.create.mockImplementation(async ({ data }) => {
      createdWallets += 1;
      const wallet = {
        id: `created-wallet-${createdWallets}`,
        name: data.name,
        scriptType: data.scriptType,
        network: data.network,
        descriptor: data.descriptor,
      };
      persistedWallets.push(wallet);
      return wallet;
    });

    const attempts = await Promise.allSettled([
      importFromParsedData(USER_ID, { parsed: makeParsedDescriptor(), name: 'Race A' }),
      importFromParsedData(USER_ID, { parsed: makeParsedDescriptor(), name: 'Race B' }),
    ]);

    expect(
      attempts.filter((attempt) => attempt.status === 'fulfilled'),
      JSON.stringify(attempts.map((attempt) => (
        attempt.status === 'rejected' ? String(attempt.reason) : attempt.status
      ))),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.any(ConflictError),
    });
    expect(createdWallets).toBe(1);
  });
});
