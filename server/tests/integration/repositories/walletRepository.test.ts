/**
 * Wallet Repository Integration Tests
 *
 * Tests the wallet repository against a real PostgreSQL database.
 * Uses the TestScenarioBuilder for complex test setups.
 */

import {
  describeIfDatabase,
  setupRepositoryTests,
  withTestTransaction,
  createTestUser,
  createTestWallet,
  createTestDevice,
  createTestAddress,
  createTestTransaction,
  createTestUtxo,
  createTestGroup,
  addUserToGroup,
  TestScenarioBuilder,
  assertExists,
  assertNotExists,
  generateFingerprint,
} from './setup';

describeIfDatabase('WalletRepository Integration Tests', () => {
  setupRepositoryTests();

  describe('findByIdWithAccess', () => {
    it('should find wallet when user is direct owner', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx, { username: 'direct-owner' });
        const wallet = await createTestWallet(tx, user.id, { name: 'Direct Wallet' });

        const found = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(wallet.id);
        expect(found?.name).toBe('Direct Wallet');
      });
    });

    it('should find wallet when user has access via group', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'group-owner' });
        const member = await createTestUser(tx, { username: 'group-member' });
        const group = await createTestGroup(tx, { name: 'Test Group' });

        await addUserToGroup(tx, owner.id, group.id, 'admin');
        await addUserToGroup(tx, member.id, group.id, 'member');

        // Create wallet with group ownership
        const wallet = await tx.wallet.create({
          data: {
            name: 'Group Wallet',
            type: 'single_sig',
            scriptType: 'native_segwit',
            network: 'testnet3',
            groupId: group.id,
          },
        });

        // Member should have access via group
        const found = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            OR: [
              { users: { some: { userId: member.id } } },
              { group: { members: { some: { userId: member.id } } } },
            ],
          },
        });

        expect(found).not.toBeNull();
        expect(found?.id).toBe(wallet.id);
      });
    });

    it('should return null for user without access', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'wallet-owner' });
        const other = await createTestUser(tx, { username: 'other-user' });
        const wallet = await createTestWallet(tx, owner.id, { name: 'Private Wallet' });

        const found = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            OR: [
              { users: { some: { userId: other.id } } },
              { group: { members: { some: { userId: other.id } } } },
            ],
          },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('findByIdWithAddresses', () => {
    it('should include addresses in wallet lookup', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Create some addresses
        await createTestAddress(tx, wallet.id, { index: 0 });
        await createTestAddress(tx, wallet.id, { index: 1 });
        await createTestAddress(tx, wallet.id, { index: 2 });

        const found = await tx.wallet.findFirst({
          where: { id: wallet.id },
          include: { addresses: true },
        });

        expect(found).not.toBeNull();
        expect(found?.addresses).toHaveLength(3);
        expect(found?.addresses.map((a) => a.index).sort()).toEqual([0, 1, 2]);
      });
    });
  });

  describe('findByUserId', () => {
    it('should find all wallets for a user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestWallet(tx, user.id, { name: 'Wallet 1' });
        await createTestWallet(tx, user.id, { name: 'Wallet 2' });
        await createTestWallet(tx, user.id, { name: 'Wallet 3' });

        const wallets = await tx.wallet.findMany({
          where: {
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(wallets).toHaveLength(3);
        expect(wallets.map((w) => w.name).sort()).toEqual(['Wallet 1', 'Wallet 2', 'Wallet 3']);
      });
    });

    it('should return empty array for user with no wallets', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        const wallets = await tx.wallet.findMany({
          where: {
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(wallets).toHaveLength(0);
      });
    });
  });

  describe('findByNetwork', () => {
    it('should filter wallets by network', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        await createTestWallet(tx, user.id, { name: 'Mainnet 1', network: 'mainnet' });
        await createTestWallet(tx, user.id, { name: 'Testnet 1', network: 'testnet3' });
        await createTestWallet(tx, user.id, { name: 'Testnet 2', network: 'testnet3' });

        const testnetWallets = await tx.wallet.findMany({
          where: {
            network: 'testnet3',
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
        });

        expect(testnetWallets).toHaveLength(2);
        expect(testnetWallets.every((w) => w.network === 'testnet3')).toBe(true);
      });
    });
  });

  describe('getIdsByNetwork', () => {
    it('should return only wallet IDs', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        const wallet1 = await createTestWallet(tx, user.id, { network: 'testnet3' });
        const wallet2 = await createTestWallet(tx, user.id, { network: 'testnet3' });

        const ids = await tx.wallet.findMany({
          where: {
            network: 'testnet3',
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
          select: { id: true },
        });

        expect(ids.map((w) => w.id).sort()).toEqual([wallet1.id, wallet2.id].sort());
      });
    });
  });

  describe('updateSyncState', () => {
    it('should update sync in progress flag', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        expect(wallet.syncInProgress).toBe(false);

        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: { syncInProgress: true },
        });

        expect(updated.syncInProgress).toBe(true);
      });
    });

    it('should update last synced timestamp', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const syncTime = new Date();
        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            lastSyncedAt: syncTime,
            lastSyncStatus: 'success',
          },
        });

        expect(updated.lastSyncedAt).toEqual(syncTime);
        expect(updated.lastSyncStatus).toBe('success');
      });
    });

    it('should update sync error message', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const updated = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            lastSyncStatus: 'failed',
            lastSyncError: 'Connection timeout',
          },
        });

        expect(updated.lastSyncStatus).toBe('failed');
        expect(updated.lastSyncError).toBe('Connection timeout');
      });
    });
  });

  describe('resetSyncState', () => {
    it('should reset all sync-related fields', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        // Set some sync state
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            syncInProgress: true,
            lastSyncedAt: new Date(),
            lastSyncStatus: 'success',
          },
        });

        // Reset
        const reset = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            syncInProgress: false,
            lastSyncedAt: null,
            lastSyncStatus: null,
          },
        });

        expect(reset.syncInProgress).toBe(false);
        expect(reset.lastSyncedAt).toBeNull();
        expect(reset.lastSyncStatus).toBeNull();
      });
    });
  });

  describe('hasAccess', () => {
    it('should return true for direct wallet user', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const hasAccess = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            OR: [
              { users: { some: { userId: user.id } } },
              { group: { members: { some: { userId: user.id } } } },
            ],
          },
          select: { id: true },
        });

        expect(hasAccess !== null).toBe(true);
      });
    });

    it('should return false for non-member', async () => {
      await withTestTransaction(async (tx) => {
        const owner = await createTestUser(tx, { username: 'owner' });
        const stranger = await createTestUser(tx, { username: 'stranger' });
        const wallet = await createTestWallet(tx, owner.id);

        const hasAccess = await tx.wallet.findFirst({
          where: {
            id: wallet.id,
            OR: [
              { users: { some: { userId: stranger.id } } },
              { group: { members: { some: { userId: stranger.id } } } },
            ],
          },
          select: { id: true },
        });

        expect(hasAccess === null).toBe(true);
      });
    });
  });

  describe('findById (internal)', () => {
    it('should find wallet without access check', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id, { name: 'Internal Test' });

        const found = await tx.wallet.findUnique({
          where: { id: wallet.id },
        });

        expect(found).not.toBeNull();
        expect(found?.name).toBe('Internal Test');
      });
    });

    it('should return null for non-existent wallet', async () => {
      await withTestTransaction(async (tx) => {
        const found = await tx.wallet.findUnique({
          where: { id: 'non-existent-id' },
        });

        expect(found).toBeNull();
      });
    });
  });

  describe('wallet types', () => {
    it('should create single-sig wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id, {
          type: 'single_sig',
          scriptType: 'native_segwit',
        });

        expect(wallet.type).toBe('single_sig');
        expect(wallet.scriptType).toBe('native_segwit');
        expect(wallet.quorum).toBeNull();
        expect(wallet.totalSigners).toBeNull();
      });
    });

    it('should create multi-sig wallet', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id, {
          type: 'multi_sig',
          scriptType: 'native_segwit',
          quorum: 2,
          totalSigners: 3,
        });

        expect(wallet.type).toBe('multi_sig');
        expect(wallet.quorum).toBe(2);
        expect(wallet.totalSigners).toBe(3);
      });
    });

    it('should support all script types', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        const types: Array<'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'> = [
          'native_segwit',
          'nested_segwit',
          'taproot',
          'legacy',
        ];

        for (const scriptType of types) {
          const wallet = await createTestWallet(tx, user.id, { scriptType });
          expect(wallet.scriptType).toBe(scriptType);
        }
      });
    });

    it('should support all networks', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);

        const networks: Array<'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest'> = [
          'mainnet',
          'testnet3',
          'testnet4',
          'signet',
          'regtest',
        ];

        for (const network of networks) {
          const wallet = await createTestWallet(tx, user.id, { network });
          expect(wallet.network).toBe(network);
        }
      });
    });
  });

  describe('cascade delete', () => {
    it('should cascade delete addresses when wallet is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const address = await createTestAddress(tx, wallet.id);

        await tx.wallet.delete({ where: { id: wallet.id } });

        await assertNotExists(tx, 'address', { id: address.id });
      });
    });

    it('should cascade delete transactions when wallet is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const transaction = await createTestTransaction(tx, wallet.id);

        await tx.wallet.delete({ where: { id: wallet.id } });

        await assertNotExists(tx, 'transaction', { id: transaction.id });
      });
    });

    it('should cascade delete UTXOs when wallet is deleted', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const utxo = await createTestUtxo(tx, wallet.id);

        await tx.wallet.delete({ where: { id: wallet.id } });

        await assertNotExists(tx, 'uTXO', { id: utxo.id });
      });
    });
  });

  describe('TestScenarioBuilder usage', () => {
    it('should create complete wallet scenario', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser({ username: 'scenario-user' })
          .withWallet({ name: 'Scenario Wallet' })
          .withAddresses(5)
          .withUtxos(3, { amount: BigInt(100000) })
          .withTransactions(2)
          .build();

        expect(scenario.user.username).toBe('scenario-user');
        expect(scenario.wallet?.name).toBe('Scenario Wallet');
        expect(scenario.addresses).toHaveLength(5);
        expect(scenario.utxos).toHaveLength(3);
        expect(scenario.transactions).toHaveLength(2);

        // Verify all UTXOs have correct amount
        expect(scenario.utxos.every((u) => u.amount === BigInt(100000))).toBe(true);
      });
    });

    it('should create user without wallet', async () => {
      await withTestTransaction(async (tx) => {
        const scenario = await new TestScenarioBuilder(tx)
          .withUser({ username: 'no-wallet-user' })
          .build();

        expect(scenario.user.username).toBe('no-wallet-user');
        expect(scenario.wallet).toBeNull();
        expect(scenario.addresses).toHaveLength(0);
      });
    });
  });

  describe('findByIdWithDevices model include', () => {
    it('returns device.model {slug, name} when a wallet device is linked to a HardwareDeviceModel', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);

        const suffix = Date.now().toString(36);
        const model = await tx.hardwareDeviceModel.create({
          data: {
            name: `Test Ledger Flex ${suffix}`,
            slug: `test-ledger-flex-${suffix}`,
            manufacturer: 'Ledger',
            connectivity: ['usb'],
            scriptTypes: ['native_segwit'],
          },
        });

        const device = await tx.device.create({
          data: {
            userId: user.id,
            modelId: model.id,
            type: 'ledger_flex',
            label: `Test Device ${suffix}`,
            fingerprint: `fp${suffix}`,
            xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
            derivationPath: "m/84'/1'/0'",
          },
        });

        await tx.walletDevice.create({
          data: { walletId: wallet.id, deviceId: device.id },
        });

        // Re-issue the include shape from walletRepository.findByIdWithDevices.
        // If the schema relation or select keys ever drift, this assertion catches it.
        const found = await tx.wallet.findFirst({
          where: { id: wallet.id },
          include: {
            devices: {
              include: {
                device: {
                  include: {
                    accounts: true,
                    model: { select: { slug: true, name: true } },
                  },
                },
              },
            },
          },
        });

        expect(found).not.toBeNull();
        expect(found?.devices).toHaveLength(1);
        expect(found?.devices[0]?.device.model).toEqual({
          slug: model.slug,
          name: model.name,
        });
      });
    });

    it('returns device.model = null when the device has no modelId', async () => {
      await withTestTransaction(async (tx) => {
        const user = await createTestUser(tx);
        const wallet = await createTestWallet(tx, user.id);
        const device = await createTestDevice(tx, user.id);

        await tx.walletDevice.create({
          data: { walletId: wallet.id, deviceId: device.id },
        });

        const found = await tx.wallet.findFirst({
          where: { id: wallet.id },
          include: {
            devices: {
              include: {
                device: {
                  include: {
                    accounts: true,
                    model: { select: { slug: true, name: true } },
                  },
                },
              },
            },
          },
        });

        expect(found?.devices[0]?.device.model).toBeNull();
      });
    });
  });
});
