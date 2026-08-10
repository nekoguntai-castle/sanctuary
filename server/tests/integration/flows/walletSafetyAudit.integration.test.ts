import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  loadWalletSafetyRawSnapshot,
  withWalletSafetyReadOnlyTransaction,
  type RawAuditDatabaseClient,
} from '../../../src/repositories/walletSafetyAuditRepository';
import { buildWalletSafetyAuditReport } from '../../../src/services/walletSafetyAudit';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestUser, getTestUser } from '../setup/helpers';
import {
  AUDIT_FIXTURE_CHANGE,
  AUDIT_FIXTURE_RECEIVE,
  AUDIT_FIXTURE_SOURCE,
  AUDIT_FIXTURE_XPUB,
} from '../../fixtures/walletSafetyAuditFixture';

const describeWithDatabase = canRunIntegrationTests() ? describe : describe.skip;

describeWithDatabase('wallet safety raw audit PostgreSQL contract', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownTestDatabase();
  });

  it('reads a deterministic exact fixture without mutating it', async () => {
    const user = await createTestUser(prisma, getTestUser());
    const device = await prisma.device.create({
      data: {
        id: 'audit-db-device',
        userId: user.id,
        type: 'trezor',
        label: 'Sensitive fixture label',
        fingerprint: 'aabbccdd',
        derivationPath: "m/84'/1'/0'",
        xpub: AUDIT_FIXTURE_XPUB,
      },
    });
    const account = await prisma.deviceAccount.create({
      data: {
        id: 'audit-db-account',
        deviceId: device.id,
        purpose: 'single_sig',
        scriptType: 'native_segwit',
        derivationPath: "m/84'/1'/0'",
        xpub: AUDIT_FIXTURE_XPUB,
      },
    });
    const wallet = await prisma.wallet.create({
      data: {
        id: 'audit-db-wallet',
        name: 'Sensitive fixture wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
        descriptor: AUDIT_FIXTURE_RECEIVE,
        changeDescriptor: AUDIT_FIXTURE_CHANGE,
        descriptorPolicyVersion: 1,
        descriptorSourceKind: 'imported_multipath',
        sourceDescriptor: AUDIT_FIXTURE_SOURCE,
        sourceChangeDescriptor: null,
        sourceDescriptorChecksum: null,
        sourceChangeDescriptorChecksum: null,
        fingerprint: 'aabbccdd',
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
        canonicalPolicyVersion: 1,
      },
    });
    await prisma.address.createMany({
      data: [
        {
          id: 'audit-db-receive',
          walletId: wallet.id,
          address: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
          derivationPath: "m/84'/1'/0'/0/0",
          index: 0,
          branch: 0,
          coordinateVersion: 1,
          canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
          canonicalPolicyVersion: 1,
          scriptPubKey: '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1',
        },
        {
          id: 'audit-db-change',
          walletId: wallet.id,
          address: 'tb1q9u62588spffmq4dzjxsr5l297znf3z6j5p2688',
          derivationPath: "m/84'/1'/0'/1/0",
          index: 0,
          branch: 1,
          coordinateVersion: 1,
          canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
          canonicalPolicyVersion: 1,
          scriptPubKey: '00142f34aa1cf00a53b055a291a03a7d45f0a6988b52',
        },
      ],
    });
    await prisma.walletDevice.create({
      data: {
        id: 'audit-db-signer',
        walletId: wallet.id,
        deviceId: device.id,
        deviceAccountId: account.id,
        signerIndex: 0,
        signerBindingVersion: 1,
        signerFingerprint: 'aabbccdd',
        signerXpub: AUDIT_FIXTURE_XPUB,
        signerDerivationPath: "m/84'/1'/0'",
        signerPurpose: 'single_sig',
        signerScriptType: 'native_segwit',
      },
    });

    const auditClient = prisma as unknown as RawAuditDatabaseClient;
    const first = await loadWalletSafetyRawSnapshot(auditClient);
    const second = await loadWalletSafetyRawSnapshot(auditClient);

    expect(second).toEqual(first);
    expect(first).not.toHaveProperty('wallets.0.name');
    expect(first.signers[0]).not.toHaveProperty('deviceLabel');
    expect(buildWalletSafetyAuditReport(first).wallets[0]).toMatchObject({
      classification: 'proven_safe',
      findings: [],
    });
    await expect(prisma.wallet.count()).resolves.toBe(1);
    await expect(prisma.address.count()).resolves.toBe(2);
    await expect(prisma.walletDevice.count()).resolves.toBe(1);
  });

  it('rejects a write attempted inside the audit transaction', async () => {
    const auditClient = prisma as unknown as RawAuditDatabaseClient;
    await expect(withWalletSafetyReadOnlyTransaction(auditClient, async (transaction) => {
      await transaction.$executeRawUnsafe(`
        INSERT INTO "wallets" ("id", "name", "type", "scriptType", "network", "updatedAt")
        VALUES ('audit-forbidden-write', 'forbidden', 'single_sig', 'native_segwit', 'testnet3', NOW())
      `);
    })).rejects.toThrow();

    await expect(prisma.wallet.findUnique({
      where: { id: 'audit-forbidden-write' },
    })).resolves.toBeNull();
  });

  it('keeps a repeatable snapshot while another transaction commits', async () => {
    const auditClient = prisma as unknown as RawAuditDatabaseClient;
    let releaseFirstRead: (() => void) | undefined;
    const firstReadComplete = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let releaseWriter: (() => void) | undefined;
    const writerComplete = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });

    const reader = withWalletSafetyReadOnlyTransaction(auditClient, async (transaction) => {
      const first = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "wallets" ORDER BY "id" ASC',
      );
      releaseFirstRead?.();
      await writerComplete;
      const second = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
        'SELECT "id" FROM "wallets" ORDER BY "id" ASC',
      );
      return { first, second };
    });

    await firstReadComplete;
    await prisma.wallet.create({
      data: {
        id: 'audit-concurrent-wallet',
        name: 'Concurrent fixture',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'testnet3',
      },
    });
    releaseWriter?.();

    await expect(reader).resolves.toEqual({ first: [], second: [] });
    await expect(prisma.wallet.findUnique({
      where: { id: 'audit-concurrent-wallet' },
    })).resolves.not.toBeNull();
  });
});
