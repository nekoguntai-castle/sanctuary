import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  addDeviceToWallet,
  createWallet,
  repairWalletDescriptor,
} from '../../../src/services/wallet';
import { backupService } from '../../../src/services/backupService';
import { importFromDescriptor } from '../../../src/services/walletImport/descriptorImport';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestUser, getTestUser } from '../setup/helpers';

const XPUB = 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';
const SECOND_XPUB = 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba';
const BIP48_XPUB = 'tpubDFH9dgzveyD8zTbPUFuLrGmCydNvxehyNdUXKJAQN8x4aZ4j6UZqGfnqFrD4NqyaTVGKbvEW54tsvPTK2UoSbCC1PJY8iCNiwTL3RWZEheQ';
const SECOND_BIP48_XPUB = 'tpubDFPtPArj4GzBEFHohegg1Xatrc1Fi9oSox5LzuSRX91miwQxuUrEpBxpvDRsmZYJKYFhgdK3UStsjC8JKXfUbMinjFqiEM4uNwzVaCaHpys';
const RECEIVE_DESCRIPTOR = `wpkh([aabbccdd/84'/1'/0']${XPUB}/0/*)`;
const CHANGE_DESCRIPTOR = `wpkh([aabbccdd/84'/1'/0']${XPUB}/1/*)`;
const TEST_WALLET_PREFIX = 'atomicity-';
const TRIGGER_NAME = 'test_fail_wallet_address_insert_trigger';
const FUNCTION_NAME = 'test_fail_wallet_address_insert';

const describeWithDatabase = canRunIntegrationTests() ? describe : describe.skip;

async function dropAddressInsertFailure(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON "addresses"`,
  );
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FUNCTION_NAME}()`);
}

async function installAddressInsertFailure(prisma: PrismaClient): Promise<void> {
  await dropAddressInsertFailure(prisma);
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION ${FUNCTION_NAME}() RETURNS trigger
    LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM "wallets"
        WHERE "id" = NEW."walletId"
          AND "name" LIKE '${TEST_WALLET_PREFIX}%'
      ) THEN
        RAISE EXCEPTION 'forced wallet address insert failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER ${TRIGGER_NAME}
    BEFORE INSERT ON "addresses"
    FOR EACH ROW EXECUTE FUNCTION ${FUNCTION_NAME}()
  `);
}

async function restoreWithAddressInsertFailure(
  prisma: PrismaClient,
  backup: Parameters<typeof backupService.restoreFromBackup>[0],
) {
  await installAddressInsertFailure(prisma);
  try {
    return await backupService.restoreFromBackup(backup);
  } finally {
    await dropAddressInsertFailure(prisma);
  }
}

interface SignerFixtureInput {
  fingerprint: string;
  xpub: string;
  purpose: 'single_sig' | 'multisig';
  derivationPath: string;
}

async function createSignerFixture(
  prisma: PrismaClient,
  userId: string,
  input: SignerFixtureInput,
) {
  const device = await prisma.device.create({
    data: {
      userId,
      type: 'bitbox',
      label: `Atomicity signer ${input.fingerprint}`,
      fingerprint: input.fingerprint,
      xpub: input.xpub,
      derivationPath: input.derivationPath,
    },
  });
  const account = await prisma.deviceAccount.create({
    data: {
      deviceId: device.id,
      purpose: input.purpose,
      scriptType: 'native_segwit',
      derivationPath: input.derivationPath,
      xpub: input.xpub,
    },
  });
  return { device, account };
}

async function expectDescriptorPolicyUnassigned(
  prisma: PrismaClient,
  walletId: string,
): Promise<void> {
  await expect(prisma.wallet.findUnique({
    where: { id: walletId },
    select: {
      descriptor: true,
      changeDescriptor: true,
      fingerprint: true,
      descriptorPolicyVersion: true,
      descriptorSourceKind: true,
      sourceDescriptor: true,
      sourceChangeDescriptor: true,
      sourceDescriptorChecksum: true,
      sourceChangeDescriptorChecksum: true,
    },
  })).resolves.toEqual({
    descriptor: null,
    changeDescriptor: null,
    fingerprint: null,
    descriptorPolicyVersion: null,
    descriptorSourceKind: null,
    sourceDescriptor: null,
    sourceChangeDescriptor: null,
    sourceDescriptorChecksum: null,
    sourceChangeDescriptorChecksum: null,
  });
  await expect(prisma.address.count({ where: { walletId } })).resolves.toBe(0);
}

async function readWalletPolicyAndAddresses(prisma: PrismaClient, walletId: string) {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { id: walletId },
    select: {
      id: true,
      name: true,
      type: true,
      scriptType: true,
      network: true,
      descriptor: true,
      changeDescriptor: true,
      fingerprint: true,
      descriptorPolicyVersion: true,
      descriptorSourceKind: true,
      sourceDescriptor: true,
      sourceChangeDescriptor: true,
      sourceDescriptorChecksum: true,
      sourceChangeDescriptorChecksum: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const addresses = await prisma.address.findMany({
    where: { walletId },
    orderBy: { id: 'asc' },
  });
  return { wallet, addresses };
}

describeWithDatabase('wallet descriptor persistence atomicity', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    await installAddressInsertFailure(prisma);
  });

  afterEach(async () => {
    await dropAddressInsertFailure(prisma);
    await cleanupTestData();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('rejects a versioned descriptor policy without a source kind', async () => {
    const walletName = `${TEST_WALLET_PREFIX}missing-source-kind`;

    await expect(prisma.wallet.create({
      data: {
        name: walletName,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        descriptor: RECEIVE_DESCRIPTOR,
        changeDescriptor: CHANGE_DESCRIPTOR,
        fingerprint: 'aabbccdd',
        descriptorPolicyVersion: 1,
        descriptorSourceKind: null,
        sourceDescriptor: RECEIVE_DESCRIPTOR,
        sourceChangeDescriptor: CHANGE_DESCRIPTOR,
      },
    })).rejects.toThrow();

    await expect(prisma.wallet.count({ where: { name: walletName } })).resolves.toBe(0);
  });

  it('freezes every wallet metadata field that controls an assigned policy', async () => {
    const wallet = await prisma.wallet.create({
      data: {
        name: `${TEST_WALLET_PREFIX}immutable-metadata`,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        descriptor: RECEIVE_DESCRIPTOR,
        changeDescriptor: CHANGE_DESCRIPTOR,
        fingerprint: 'aabbccdd',
        descriptorPolicyVersion: 1,
        descriptorSourceKind: 'imported_pair',
        sourceDescriptor: RECEIVE_DESCRIPTOR,
        sourceChangeDescriptor: CHANGE_DESCRIPTOR,
      },
    });

    for (const data of [
      { type: 'multi_sig' },
      { scriptType: 'taproot' },
      { network: 'mainnet' },
      { quorum: 1 },
      { totalSigners: 1 },
    ]) {
      await expect(prisma.wallet.update({ where: { id: wallet.id }, data })).rejects.toThrow(
        'Assigned wallet descriptor policies are immutable',
      );
    }

    await expect(prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } }))
      .resolves.toMatchObject({
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        quorum: null,
        totalSigners: null,
      });
  });

  it('rolls back wallet creation when initial address insertion fails', async () => {
    const user = await createTestUser(prisma, getTestUser());
    const walletName = `${TEST_WALLET_PREFIX}create`;

    await expect(createWallet(user.id, {
      name: walletName,
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
    })).rejects.toThrow('forced wallet address insert failure');

    await expect(prisma.wallet.count({ where: { name: walletName } })).resolves.toBe(0);
    await expect(prisma.walletUser.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.user.count({ where: { id: user.id } })).resolves.toBe(1);
  });

  it('rolls back imported wallet, signer, and account rows when address insertion fails', async () => {
    const user = await createTestUser(prisma, getTestUser());
    const walletName = `${TEST_WALLET_PREFIX}import`;

    await expect(importFromDescriptor(user.id, {
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      name: walletName,
      network: 'testnet3',
    })).rejects.toThrow('forced wallet address insert failure');

    await expect(prisma.wallet.count({ where: { name: walletName } })).resolves.toBe(0);
    await expect(prisma.walletUser.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.device.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.deviceUser.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.deviceAccount.count({
      where: { device: { userId: user.id } },
    })).resolves.toBe(0);
    await expect(prisma.user.count({ where: { id: user.id } })).resolves.toBe(1);
  });

  it('rolls back the threshold-crossing signer link and descriptor assignment', async () => {
    const user = await createTestUser(prisma, getTestUser());
    const wallet = await prisma.wallet.create({
      data: {
        name: `${TEST_WALLET_PREFIX}threshold-link`,
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        quorum: 2,
        totalSigners: 2,
        users: { create: { userId: user.id, role: 'owner' } },
      },
    });
    const derivationPath = "m/48'/1'/0'/2'";
    const firstSigner = await createSignerFixture(prisma, user.id, {
      fingerprint: '11111111',
      xpub: BIP48_XPUB,
      purpose: 'multisig',
      derivationPath,
    });
    const thresholdSigner = await createSignerFixture(prisma, user.id, {
      fingerprint: '22222222',
      xpub: SECOND_BIP48_XPUB,
      purpose: 'multisig',
      derivationPath,
    });
    await prisma.walletDevice.create({
      data: {
        walletId: wallet.id,
        deviceId: firstSigner.device.id,
        deviceAccountId: firstSigner.account.id,
        signerIndex: 0,
        signerBindingVersion: 1,
        signerFingerprint: firstSigner.device.fingerprint,
        signerXpub: firstSigner.account.xpub,
        signerDerivationPath: derivationPath,
        signerPurpose: 'multisig',
        signerScriptType: 'native_segwit',
      },
    });

    await expect(addDeviceToWallet(wallet.id, {
      deviceId: thresholdSigner.device.id,
      deviceAccountId: thresholdSigner.account.id,
      signerIndex: 1,
    }, user.id)).rejects.toThrow('forced wallet address insert failure');

    await expect(prisma.walletDevice.count({
      where: { walletId: wallet.id, deviceId: thresholdSigner.device.id },
    })).resolves.toBe(0);
    await expect(prisma.walletDevice.count({
      where: { walletId: wallet.id, deviceId: firstSigner.device.id },
    })).resolves.toBe(1);
    await expectDescriptorPolicyUnassigned(prisma, wallet.id);
  });

  it('retires descriptor repair without writing wallet policy state', async () => {
    const user = await createTestUser(prisma, getTestUser());
    const wallet = await prisma.wallet.create({
      data: {
        name: `${TEST_WALLET_PREFIX}repair-retired`,
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        users: { create: { userId: user.id, role: 'owner' } },
      },
    });

    await expect(repairWalletDescriptor(wallet.id, user.id)).rejects.toThrow(
      'Direct wallet repair is retired',
    );
    await expectDescriptorPolicyUnassigned(prisma, wallet.id);
  });

  it('preserves the live verified wallet byte-for-byte when restore address insertion fails', async () => {
    const user = await createTestUser(prisma, { ...getTestUser(), isAdmin: true });
    await dropAddressInsertFailure(prisma);
    const wallet = await createWallet(user.id, {
      name: `${TEST_WALLET_PREFIX}restore-live`,
      type: 'single_sig',
      scriptType: 'native_segwit',
      network: 'testnet3',
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
    });
    // Restore is intentionally database-wide. The integration runner supplies a
    // disposable serial database, and createBackup returns only an in-memory payload.
    const backup = await backupService.createBackup('wallet-atomicity-test');
    const original = await readWalletPolicyAndAddresses(prisma, wallet.id);
    expect(original.wallet).toMatchObject({
      descriptor: RECEIVE_DESCRIPTOR,
      changeDescriptor: CHANGE_DESCRIPTOR,
      fingerprint: 'aabbccdd',
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'imported_pair',
      sourceDescriptor: RECEIVE_DESCRIPTOR,
      sourceChangeDescriptor: CHANGE_DESCRIPTOR,
    });
    expect(original.addresses).toHaveLength(40);
    const result = await restoreWithAddressInsertFailure(prisma, backup);

    expect(result).toMatchObject({
      success: false,
      committed: false,
      tablesRestored: 0,
      recordsRestored: 0,
      error: expect.stringContaining('forced wallet address insert failure'),
    });
    await expect(readWalletPolicyAndAddresses(prisma, wallet.id)).resolves.toEqual(original);
  });
});
