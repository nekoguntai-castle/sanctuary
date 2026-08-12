import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockAssertWalletHardwareCapabilityById,
  mockBuildDescriptorFromDevices,
  mockHookExecuteAfter,
  mockLogError,
  mockLogWarn,
  mockNotificationUnsubscribeWalletAddresses,
  mockPrismaClient,
  mockSyncUnsubscribeWalletAddresses,
} from './walletTestHarness';
import { ForbiddenError } from '../../../../src/errors';
import {
  addDeviceToWallet,
  checkWalletAccess,
  checkWalletAccessWithRole,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  createWallet,
  deleteWallet,
  generateAddress,
  getUserWalletRole,
  getUserWallets,
  getWalletById,
  getWalletStats,
  updateWallet,
} from '../../../../src/services/wallet';
import {
  MAINNET_BIP48_SIGNERS,
  MAINNET_BIP84,
  MAINNET_BIP84_DESCRIPTORS,
  mainnetBip48Descriptors,
} from './descriptorTestFixtures';

const VALID_RECEIVE_DESCRIPTOR = MAINNET_BIP84_DESCRIPTORS.receive;
const VALID_CHANGE_DESCRIPTOR = MAINNET_BIP84_DESCRIPTORS.change;
const NATIVE_SEGWIT_POLICY_ID = 'single-sig-native-segwit-bip84-v1';
const MULTISIG_NATIVE_SEGWIT_POLICY_ID = 'multisig-native-segwit-bip48-2-v1';

export function registerWalletMutationMaintenanceTests(): void {
  describe('wallet mutation and maintenance operations', () => {
    beforeEach(() => {
      mockBuildDescriptorFromDevices.mockReturnValue({
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        fingerprint: 'abc12345',
      });
    });

    it.each([
      ['empty update', {}],
      ['undefined name', { name: undefined }],
      ['descriptor', { descriptor: 'replacement' }],
      ['fingerprint', { fingerprint: 'deadbeef' }],
      ['unknown field', { scriptType: 'taproot' }],
      ['multiple fields', { descriptor: 'replacement', fingerprint: 'deadbeef' }],
    ])(
      'blocks a direct service %s mutation before persistence',
      async (_case, updates) => {
        mockPrismaClient.walletUser.findFirst.mockResolvedValue({ role: 'owner' });

        await expect(updateWallet('wallet-1', 'owner-1', updates as never))
          .rejects.toMatchObject({
            statusCode: 400,
            code: 'INVALID_INPUT',
          });
        expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
      },
    );

    it('updates wallet metadata for owners and returns computed fields', async () => {
      const walletData = {
        id: 'wallet-1',
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd1234',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        devices: [{ id: 'd1' }],
        addresses: [{ id: 'a1' }, { id: 'a2' }],
        group: { name: 'Treasury' },
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(9876) } });

      const updated = await updateWallet('wallet-1', 'owner-1', { name: 'Renamed Wallet' });

      expect(updated.balance).toBe(9876);
      expect(updated.deviceCount).toBe(1);
      expect(updated.addressCount).toBe(2);
      expect(updated.isShared).toBe(true);
    });

    it('updates safe metadata but strips derivation material when display is disabled', async () => {
      mockAssertWalletHardwareCapabilityById.mockRejectedValueOnce(
        new ForbiddenError('blocked'),
      );
      const walletData = {
        id: 'wallet-ledger',
        name: 'Renamed Ledger Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd1234',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        devices: [{ id: 'd1' }],
        addresses: [{ id: 'a1', address: 'bc1qsecret' }],
        group: null,
        users: [{ userId: 'owner-1' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: 'wallet-ledger',
        devices: [{ device: { type: 'ledger' } }],
      });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: 0n } });

      const updated = await updateWallet(
        'wallet-ledger',
        'owner-1',
        { name: 'Renamed Ledger Wallet' },
      );

      expect(Reflect.get(updated, 'addresses')).toEqual([]);
      expect(updated.descriptor).toBeNull();
      expect(updated.fingerprint).toBeNull();
      expect(updated.addressCount).toBe(1);
    });

    it('propagates unexpected signer-provenance lookup failures', async () => {
      mockAssertWalletHardwareCapabilityById.mockRejectedValueOnce(
        new Error('database unavailable'),
      );
      const walletData = {
        id: 'wallet-1',
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      await expect(updateWallet('wallet-1', 'owner-1', { name: 'Name' }))
        .rejects.toThrow('database unavailable');
    });

    it('falls back to zero balance and private sharing metadata for owner updates', async () => {
      const walletData = {
        id: 'wallet-private',
        name: 'Private Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f0',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });

      const updated = await updateWallet('wallet-private', 'owner-1', { name: 'Private Wallet' });

      expect(updated.balance).toBe(0);
      expect(updated.isShared).toBe(false);
      expect(updated.sharedWith).toBeUndefined();
    });

    it('uses null groupName for shared wallets without a group object', async () => {
      const walletData = {
        id: 'wallet-shared-no-group',
        name: 'Shared No Group',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f9',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(5) } });

      const updated = await updateWallet('wallet-shared-no-group', 'owner-1', { name: 'Shared No Group' });

      expect(updated.isShared).toBe(true);
      expect(updated.sharedWith).toEqual({
        groupName: null,
        userCount: 2,
      });
    });

    it('rejects update for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(updateWallet('wallet-1', 'viewer-1', { name: 'Nope' })).rejects.toThrow('Only wallet owners can update wallet');
    });

    it('rejects update for signer-only users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'signer' });

      await expect(updateWallet('wallet-1', 'signer-1', { name: 'Nope' })).rejects.toThrow('Only wallet owners can update wallet');
      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
    });

    it('deletes wallet after unsubscribing realtime listeners', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });

      await deleteWallet('wallet-1', 'owner-1');

      expect(mockSyncUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockNotificationUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockPrismaClient.wallet.delete).toHaveBeenCalledWith({ where: { id: 'wallet-1' } });
    });

    it('swallows hook failures after delete', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockHookExecuteAfter.mockReturnValueOnce(Promise.reject(new Error('hook delete failed')));

      await deleteWallet('wallet-1', 'owner-1');

      await Promise.resolve();
      expect(mockLogWarn).toHaveBeenCalledWith(
        'After hook failed',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('rejects delete for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(deleteWallet('wallet-1', 'viewer-1')).rejects.toThrow('Only wallet owners can delete wallet');
    });

    it('rejects delete for signer-only users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'signer' });

      await expect(deleteWallet('wallet-1', 'signer-1')).rejects.toThrow('Only wallet owners can delete wallet');
      expect(mockPrismaClient.wallet.delete).not.toHaveBeenCalled();
      expect(mockSyncUnsubscribeWalletAddresses).not.toHaveBeenCalled();
      expect(mockNotificationUnsubscribeWalletAddresses).not.toHaveBeenCalled();
    });

    const signerFixture = (path: string) => {
      if (!path.startsWith("m/48'")) return MAINNET_BIP84;
      return path === MAINNET_BIP48_SIGNERS[2].path
        ? MAINNET_BIP48_SIGNERS[2]
        : MAINNET_BIP48_SIGNERS[0];
    };
    const account = (deviceId: string, id: string, path = "m/84'/0'/0'") => {
      const fixture = signerFixture(path);
      return {
        id,
        deviceId,
        purpose: path.startsWith("m/48'") ? 'multisig' : 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: path,
        xpub: fixture.xpub,
      };
    };
    const device = (id: string, accountId: string, path = "m/84'/0'/0'") => {
      const fixture = signerFixture(path);
      return {
        id,
        label: id,
        userId: 'user-1',
        type: 'coldcard',
        fingerprint: fixture.fingerprint,
        accounts: [account(id, accountId, path)],
      };
    };
    const storedLink = (index: number, id: string, path = "m/48'/0'/0'/2'") => {
      const fixture = signerFixture(path);
      return {
        deviceId: id,
        deviceAccountId: `${id}-account`,
        signerIndex: index,
        signerBindingVersion: 1,
        signerFingerprint: fixture.fingerprint,
        signerXpub: fixture.xpub,
        signerDerivationPath: path,
        signerPurpose: 'multisig',
        signerScriptType: 'native_segwit',
        device: { id, type: 'coldcard', accounts: [] },
        deviceAccount: null,
      };
    };
    const storedSingleLink = (index: number, id: string) => ({
      ...storedLink(index, id, "m/84'/0'/0'"),
      signerPurpose: 'single_sig',
    });

    it('atomically links an exact account and assigns the descriptor when requirements are met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-1', 'account-1'),
      ]);

      await addDeviceToWallet(
        'wallet-1',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 },
        'user-1',
      );

      const { walletRepository: walletRepo } = await import('../../../../src/repositories');
      expect(walletRepo.linkDeviceWithDescriptor).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ deviceAccountId: 'account-1', signerIndex: 0 }),
        expect.objectContaining({
          descriptor: VALID_RECEIVE_DESCRIPTOR,
          changeDescriptor: VALID_CHANGE_DESCRIPTOR,
          canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          addresses: expect.any(Array),
        }),
      );
      const assignment = vi.mocked(walletRepo.linkDeviceWithDescriptor).mock.calls[0][2];
      expect(assignment.addresses).toHaveLength(40);
      expect(assignment.addresses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          walletId: 'wallet-1',
          branch: 0,
          index: 0,
          coordinateVersion: 1,
          canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          scriptPubKey: '0014mockscriptpubkey',
        }),
        expect.objectContaining({
          walletId: 'wallet-1',
          branch: 1,
          index: 0,
          coordinateVersion: 1,
          canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          scriptPubKey: '0014mockscriptpubkey',
        }),
      ]));
      expect(walletRepo.linkDevice).not.toHaveBeenCalled();
    });

    it('propagates atomic signer assignment persistence failures', async () => {
      mockBuildDescriptorFromDevices.mockReturnValueOnce({
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        fingerprint: 'abc12345',
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-atomic-link-fail',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-1', 'account-1'),
      ]);
      const { walletRepository: walletRepo } = await import('../../../../src/repositories');
      vi.mocked(walletRepo.linkDeviceWithDescriptor).mockRejectedValueOnce(
        new Error('atomic signer address insertion failed'),
      );

      await expect(addDeviceToWallet(
        'wallet-atomic-link-fail',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('atomic signer address insertion failed');

      expect(walletRepo.linkDeviceWithDescriptor).toHaveBeenCalledTimes(1);
      expect(walletRepo.linkDevice).not.toHaveBeenCalled();
    });

    it('leaves no signer link when descriptor generation fails', async () => {
      mockBuildDescriptorFromDevices.mockImplementationOnce(() => {
        throw new Error('descriptor failed');
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-1', 'account-1'),
      ]);

      await expect(addDeviceToWallet(
        'wallet-1',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('descriptor failed');
      const { walletRepository: walletRepo3 } = await import('../../../../src/repositories');
      expect(walletRepo3.linkDevice).not.toHaveBeenCalled();
      expect(walletRepo3.linkDeviceWithDescriptor).not.toHaveBeenCalled();
    });

    it('defers multisig descriptor generation until required signer threshold is met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [{ ...storedLink(0, 'device-existing'), deviceAccountId: null }],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-new', 'account-new', "m/48'/0'/0'/2'"),
      ]);

      await addDeviceToWallet(
        'wallet-multi',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 1 },
        'user-1',
      );

      const { walletRepository: walletRepo2 } = await import('../../../../src/repositories');
      expect(walletRepo2.linkDevice).toHaveBeenCalled();
      expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
    });

    it('generates multisig descriptor from immutable snapshots when signer threshold is met', async () => {
      const multisigDescriptors = mainnetBip48Descriptors([
        MAINNET_BIP48_SIGNERS[0],
        MAINNET_BIP48_SIGNERS[2],
      ]);
      mockBuildDescriptorFromDevices.mockReturnValueOnce({
        descriptor: multisigDescriptors.receive,
        changeDescriptor: multisigDescriptors.change,
        fingerprint: [MAINNET_BIP48_SIGNERS[0], MAINNET_BIP48_SIGNERS[2]]
          .map(signer => signer.fingerprint)
          .join('-'),
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi-ready',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: null,
        devices: [storedLink(0, 'device-existing')],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-new', 'account-new', "m/48'/0'/1'/2'"),
      ]);

      await addDeviceToWallet(
        'wallet-multi-ready',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 1 },
        'user-1',
      );

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            derivationPath: "m/48'/0'/1'/2'",
          }),
        ]),
        expect.any(Object)
      );
      const { walletRepository: walletRepo } = await import('../../../../src/repositories');
      expect(walletRepo.linkDeviceWithDescriptor).toHaveBeenCalledWith(
        'wallet-multi-ready',
        expect.objectContaining({ signerIndex: 1 }),
        expect.objectContaining({
          descriptor: multisigDescriptors.receive,
          changeDescriptor: multisigDescriptors.change,
          canonicalPolicyId: MULTISIG_NATIVE_SEGWIT_POLICY_ID,
          canonicalPolicyVersion: 1,
          addresses: expect.arrayContaining([
            expect.objectContaining({
              walletId: 'wallet-multi-ready',
              branch: 0,
              index: 0,
              coordinateVersion: 1,
              canonicalPolicyId: MULTISIG_NATIVE_SEGWIT_POLICY_ID,
              canonicalPolicyVersion: 1,
              scriptPubKey: '0014mockscriptpubkey',
            }),
            expect.objectContaining({
              walletId: 'wallet-multi-ready',
              branch: 1,
              index: 0,
              coordinateVersion: 1,
              canonicalPolicyId: MULTISIG_NATIVE_SEGWIT_POLICY_ID,
              canonicalPolicyVersion: 1,
              scriptPubKey: '0014mockscriptpubkey',
            }),
          ]),
        }),
      );
    });

    it('rejects addDeviceToWallet when wallet is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);

      await expect(addDeviceToWallet(
        'wallet-missing',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('Wallet not found');
    });

    it('rejects addDeviceToWallet when device is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([]);

      await expect(addDeviceToWallet(
        'wallet-1',
        { deviceId: 'device-missing', deviceAccountId: 'account-missing', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('Device not found');
    });

    it('rejects addDeviceToWallet when device is already linked', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-1',
            device: {
              id: 'device-1',
              userId: 'user-1',
              type: 'coldcard',
              fingerprint: 'aabbccdd',
              xpub: 'xpub-device-1',
              derivationPath: "m/84'/0'/0'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        type: 'coldcard',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await expect(addDeviceToWallet(
        'wallet-1',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 1 },
        'user-1',
      )).rejects.toThrow(
        'Device is already linked to this wallet'
      );
    });

    it('rejects signer changes after descriptor materialization', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-materialized',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: 'wpkh(materialized)',
        devices: [],
      });

      await expect(addDeviceToWallet(
        'wallet-materialized',
        { deviceId: 'device-1', deviceAccountId: 'account-1', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('Cannot add a signer after the wallet descriptor is assigned');
    });

    it('rejects a noncontiguous requested signer index', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-gap',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [storedLink(0, 'device-existing')],
      });

      await expect(addDeviceToWallet(
        'wallet-gap',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 2 },
        'user-1',
      )).rejects.toThrow('next contiguous wallet signer index');
    });

    it.each([
      ['unsupported wallet type', 'unsupported', 'native_segwit'],
      ['unsupported script type', 'single_sig', 'unsupported'],
    ])('rejects %s before signer resolution', async (_case, type, scriptType) => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-unsupported',
        type,
        scriptType,
        network: 'mainnet',
        descriptor: null,
        devices: [],
      });

      await expect(addDeviceToWallet(
        'wallet-unsupported',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('Wallet type or script type is unsupported');
    });

    it('rejects multisig without a configured total signer count', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-no-count',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 1,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-new', 'account-new', "m/48'/0'/0'/2'"),
      ]);

      await expect(addDeviceToWallet(
        'wallet-no-count',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 0 },
        'user-1',
      )).rejects.toThrow('Wallet signer count is not configured');
    });

    it('rejects a signer beyond the configured single-sig count', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-over-count',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [storedSingleLink(0, 'device-existing')],
      });
      mockPrismaClient.device.findMany.mockResolvedValueOnce([
        device('device-new', 'account-new'),
      ]);

      await expect(addDeviceToWallet(
        'wallet-over-count',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 1 },
        'user-1',
      )).rejects.toThrow('already has its configured number of signers');
    });

    it('fails closed when sorting multiple legacy links without signer indexes', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-legacy-links',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [
          { deviceId: 'legacy-a' },
          { deviceId: 'legacy-b' },
        ],
      });

      await expect(addDeviceToWallet(
        'wallet-legacy-links',
        { deviceId: 'device-new', deviceAccountId: 'account-new', signerIndex: 2 },
        'user-1',
      )).rejects.toThrow('unproven legacy signer link');
    });
  });
}
