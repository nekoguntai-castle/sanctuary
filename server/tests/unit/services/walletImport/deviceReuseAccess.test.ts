import { beforeEach, describe, expect, it } from 'vitest';
import '../walletImport.setup';
import { setupBeforeEach } from '../walletImport.setup';
import { mockPrismaClient } from '../../../mocks/prisma';
import { createWalletTransaction } from '../../../../src/services/walletImport/walletImportService';
import type { ParsedDescriptor } from '../../../../src/services/bitcoin/descriptorParser';
import type { DeviceResolution } from '../../../../src/services/walletImport/types';

const userId = 'importer';
const deviceId = 'shared-device';
const path = "m/84'/0'/0'";
const xpub = 'xpub6Dz...';
const parsed = {
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  devices: [{ fingerprint: 'abcd1234', derivationPath: path, xpub }],
} as ParsedDescriptor;
const resolution: DeviceResolution = {
  fingerprint: 'abcd1234',
  derivationPath: path,
  xpub,
  existingDeviceId: deviceId,
  existingDeviceLabel: 'Shared Device',
  willCreate: false,
  existingType: 'watch_only',
};

function importResolvedDevice() {
  return createWalletTransaction(userId, {
    parsed,
    resolutions: [resolution],
    name: 'Imported wallet',
    network: 'mainnet',
  });
}

function currentDeviceRole(role: 'owner' | 'viewer' | null) {
  mockPrismaClient.device.findUnique.mockResolvedValue({
    users: role ? [{ role }] : [],
    groupRole: 'viewer',
    group: null,
  });
}

function groupDeviceRole(groupRole: 'owner' | 'viewer', directRole: 'viewer' | null = null) {
  mockPrismaClient.device.findUnique.mockResolvedValue({
    users: directRole ? [{ role: directRole }] : [],
    groupRole,
    group: { members: [{ userId }] },
  });
}

function accountAtPath() {
  mockPrismaClient.deviceAccount.findMany.mockResolvedValue([{
    id: 'existing-account',
    deviceId,
    purpose: 'single_sig',
    scriptType: 'native_segwit',
    derivationPath: path,
    xpub,
  }]);
}

describe('wallet import device reuse authorization', () => {
  beforeEach(() => {
    setupBeforeEach();
    mockPrismaClient.wallet.create.mockResolvedValue({
      id: 'imported-wallet', name: 'Imported wallet',
      type: 'single_sig', scriptType: 'native_segwit',
      network: 'mainnet', quorum: null, totalSigners: null,
      descriptor: 'descriptor',
    });
  });

  it('denies a viewer adding a new account without partial writes', async () => {
    currentDeviceRole('viewer');
    await expect(importResolvedDevice()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
  });

  it('allows an owner to add a new account path', async () => {
    currentDeviceRole('owner');
    const result = await importResolvedDevice();
    expect(result.reusedDeviceIds).toEqual([deviceId]);
    expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deviceId, derivationPath: path, xpub }),
    });
  });

  it('allows a current viewer to reuse the exact account', async () => {
    currentDeviceRole('viewer');
    accountAtPath();
    const result = await importResolvedDevice();
    expect(result.reusedDeviceIds).toEqual([deviceId]);
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
  });

  it('denies exact reuse when access was revoked after resolution', async () => {
    currentDeviceRole(null);
    accountAtPath();
    await expect(importResolvedDevice()).rejects.toMatchObject({ statusCode: 403 });
    expect(mockPrismaClient.deviceAccount.findMany).not.toHaveBeenCalled();
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
  });

  it('allows group-only owner access to add an account', async () => {
    groupDeviceRole('owner');
    await importResolvedDevice();
    expect(mockPrismaClient.deviceAccount.create).toHaveBeenCalledTimes(1);
  });

  it('allows group-only viewer access to reuse an exact account', async () => {
    groupDeviceRole('viewer');
    accountAtPath();
    await importResolvedDevice();
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
  });

  it('keeps a direct viewer grant ahead of an owner group role', async () => {
    groupDeviceRole('owner', 'viewer');
    await expect(importResolvedDevice()).rejects.toThrow(/owner access/i);
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
  });

  it('denies reuse when the resolved device was deleted', async () => {
    accountAtPath();
    await expect(importResolvedDevice()).rejects.toThrow(/device access/i);
    expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
  });

  it('checks owner access again immediately before inserting a new account', async () => {
    mockPrismaClient.device.findUnique
      .mockResolvedValueOnce({ users: [{ role: 'owner' }], groupRole: 'viewer', group: null })
      .mockResolvedValueOnce({ users: [], groupRole: 'viewer', group: null });
    await expect(importResolvedDevice()).rejects.toThrow(/device access/i);
    expect(mockPrismaClient.deviceAccount.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.wallet.create).not.toHaveBeenCalled();
  });
});
