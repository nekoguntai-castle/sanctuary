import { describe, expect, it } from 'vitest';
import {
  mockBuildDescriptorFromDevices,
  mockCurrentDeviceRole,
} from './walletImport.setup';
import { ConflictError } from '../../../src/errors/ApiError';
import { importFromParsedData } from '../../../src/services/walletImport/descriptorImport';
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
