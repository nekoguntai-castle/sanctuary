/**
 * Repository Integration Test Setup
 *
 * Provides extensible test infrastructure for repository integration tests:
 * - Database connection management with configurable options
 * - Transaction rollback for test isolation
 * - Composable entity factory functions for creating test data
 * - Cleanup utilities with granular control
 * - Builder pattern for complex test scenarios
 *
 * Architecture:
 * - Factories: Create individual entities with sensible defaults
 * - Builders: Compose complex test scenarios with multiple related entities
 * - Hooks: Extensible beforeEach/afterEach for custom setup
 */

import { PrismaClient } from '../../../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcryptjs';

let prisma: PrismaClient | null = null;
let isSetup = false;
let txCounter = 0;
let deviceCounter = 0;
let utxoCounter = 0;
let addressCounter = 0;

// ========================================
// DATABASE CONNECTION
// ========================================

/**
 * Check if database is available for integration tests
 */
export function canRunIntegrationTests(): boolean {
  return !!(process.env.DATABASE_URL || process.env.TEST_DATABASE_URL);
}

/**
 * Get or create the test Prisma client
 */
export async function getTestPrisma(): Promise<PrismaClient> {
  if (prisma && isSetup) {
    return prisma;
  }

  const databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      'No database URL available. Set DATABASE_URL or TEST_DATABASE_URL to run integration tests.'
    );
  }

  const adapter = new PrismaPg({ connectionString: databaseUrl });
  prisma = new PrismaClient({ adapter });

  await prisma.$connect();
  isSetup = true;

  return prisma;
}

/**
 * Disconnect from test database
 */
export async function disconnectTestDatabase(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    isSetup = false;
  }
}

// ========================================
// TRANSACTION ROLLBACK WRAPPER
// ========================================

/**
 * Run a test function within a database transaction that is rolled back after completion.
 * This provides complete test isolation without leaving test data in the database.
 *
 * @example
 * ```typescript
 * it('should create a user', async () => {
 *   await withTestTransaction(async (tx) => {
 *     const user = await createTestUser(tx, { username: 'testuser' });
 *     expect(user.username).toBe('testuser');
 *   });
 * });
 * ```
 */
export async function withTestTransaction<T>(
  fn: (tx: PrismaClient) => Promise<T>
): Promise<T> {
  const client = await getTestPrisma();

  // Use Prisma's interactive transaction with rollback
  try {
    return await client.$transaction(async (tx) => {
      const result = await fn(tx as unknown as PrismaClient);
      // Force rollback by throwing a specific error
      throw new RollbackError(result);
    });
  } catch (error) {
    if (error instanceof RollbackError) {
      return error.result as T;
    }
    throw error;
  }
}

class RollbackError extends Error {
  constructor(public result: unknown) {
    super('Rollback');
    this.name = 'RollbackError';
  }
}

// ========================================
// CLEANUP UTILITIES
// ========================================

/**
 * Clean all test data from the database.
 * Use this for tests that don't use transaction rollback.
 */
export async function cleanupTestData(): Promise<void> {
  const client = await getTestPrisma();

  // Delete in order respecting foreign keys
  await client.transactionLabel.deleteMany();
  await client.addressLabel.deleteMany();
  await client.label.deleteMany();

  await client.transactionInput.deleteMany();
  await client.transactionOutput.deleteMany();
  await client.draftUtxoLock.deleteMany();
  await client.draftTransaction.deleteMany();
  await client.transaction.deleteMany();
  await client.uTXO.deleteMany();
  await client.address.deleteMany();
  await client.walletDevice.deleteMany();
  await client.mobilePermission.deleteMany();
  await client.walletUser.deleteMany();
  await client.wallet.deleteMany();

  await client.deviceAccount.deleteMany();
  await client.deviceUser.deleteMany();
  await client.device.deleteMany();
  await client.hardwareDeviceModel.deleteMany();

  await client.emailVerificationToken.deleteMany();
  await client.refreshToken.deleteMany();
  await client.revokedToken.deleteMany();
  await client.pushDevice.deleteMany();
  await client.ownershipTransfer.deleteMany();
  await client.groupMember.deleteMany();
  await client.group.deleteMany();
  await client.user.deleteMany();

  await client.auditLog.deleteMany();
  await client.priceData.deleteMany();
  await client.feeEstimate.deleteMany();
  await client.electrumServer.deleteMany();
  await client.nodeConfig.deleteMany();
}

// ========================================
// ENTITY FACTORIES
// ========================================

export interface CreateUserOptions {
  username?: string;
  password?: string;
  email?: string;
  isAdmin?: boolean;
  twoFactorEnabled?: boolean;
  twoFactorSecret?: string;
}

/**
 * Create a test user
 */
export async function createTestUser(
  tx: PrismaClient,
  options: CreateUserOptions = {}
) {
  const hashedPassword = await bcrypt.hash(options.password || 'testpassword', 10);

  return tx.user.create({
    data: {
      username: options.username || `testuser-${Date.now()}`,
      password: hashedPassword,
      email: options.email || `test-${Date.now()}@example.com`,
      emailVerified: true, // Auto-verify for tests so login works
      isAdmin: options.isAdmin ?? false,
      twoFactorEnabled: options.twoFactorEnabled ?? false,
      twoFactorSecret: options.twoFactorSecret,
    },
  });
}

export interface CreateGroupOptions {
  name?: string;
  description?: string;
}

/**
 * Create a test group
 */
export async function createTestGroup(
  tx: PrismaClient,
  options: CreateGroupOptions = {}
) {
  return tx.group.create({
    data: {
      name: options.name || `test-group-${Date.now()}`,
      description: options.description,
    },
  });
}

/**
 * Add a user to a group
 */
export async function addUserToGroup(
  tx: PrismaClient,
  userId: string,
  groupId: string,
  role: string = 'member'
) {
  return tx.groupMember.create({
    data: {
      userId,
      groupId,
      role,
    },
  });
}

export interface CreateWalletOptions {
  name?: string;
  type?: 'single_sig' | 'multi_sig';
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  network?: 'mainnet' | 'testnet' | 'signet' | 'regtest';
  descriptor?: string;
  fingerprint?: string;
  quorum?: number;
  totalSigners?: number;
  groupId?: string;
}

/**
 * Create a test wallet
 */
export async function createTestWallet(
  tx: PrismaClient,
  userId: string,
  options: CreateWalletOptions = {}
) {
  const wallet = await tx.wallet.create({
    data: {
      name: options.name || `test-wallet-${Date.now()}`,
      type: options.type || 'single_sig',
      scriptType: options.scriptType || 'native_segwit',
      network: options.network || 'testnet',
      descriptor: options.descriptor,
      fingerprint: options.fingerprint || `fp${Date.now().toString(16)}`,
      quorum: options.quorum,
      totalSigners: options.totalSigners,
      groupId: options.groupId,
    },
  });

  // Create WalletUser relationship
  await tx.walletUser.create({
    data: {
      walletId: wallet.id,
      userId,
      role: 'owner',
    },
  });

  return wallet;
}

export interface CreateDeviceOptions {
  type?: string;
  label?: string;
  fingerprint?: string;
  xpub?: string;
  derivationPath?: string;
}

/**
 * Create a test hardware device
 */
export async function createTestDevice(
  tx: PrismaClient,
  userId: string,
  options: CreateDeviceOptions = {}
) {
  const counter = ++deviceCounter;
  return tx.device.create({
    data: {
      userId,
      type: options.type || 'trezor',
      label: options.label || `test-device-${Date.now()}-${counter}`,
      fingerprint: options.fingerprint || `fp${Date.now().toString(16)}${counter.toString(16).padStart(4, '0')}`,
      xpub: options.xpub || 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
      derivationPath: options.derivationPath || "m/84'/1'/0'",
    },
  });
}

export interface CreateAddressOptions {
  address?: string;
  derivationPath?: string;
  index?: number;
  used?: boolean;
}

/**
 * Create a test address
 */
export async function createTestAddress(
  tx: PrismaClient,
  walletId: string,
  options: CreateAddressOptions = {}
) {
  const counter = ++addressCounter;
  return tx.address.create({
    data: {
      walletId,
      address: options.address || `tb1q${Date.now().toString(16)}${counter.toString(16).padStart(6, '0')}`.padEnd(42, '0'),
      derivationPath: options.derivationPath || `m/84'/1'/0'/0/${options.index ?? counter}`,
      index: options.index ?? counter,
      used: options.used ?? false,
    },
  });
}

export interface CreateTransactionOptions {
  txid?: string;
  type?: 'sent' | 'received' | 'consolidation';
  amount?: bigint;
  fee?: bigint;
  confirmations?: number;
  blockHeight?: number | null;
  blockTime?: Date;
  label?: string | null;
  memo?: string | null;
  rbfStatus?: 'active' | 'replaced' | 'confirmed';
}

/**
 * Create a test transaction
 */
export async function createTestTransaction(
  tx: PrismaClient,
  walletId: string,
  options: CreateTransactionOptions = {}
) {
  const uniqueTxid = options.txid || `${Date.now().toString(16)}${(++txCounter).toString(16).padStart(8, '0')}`.padEnd(64, 'a');
  return tx.transaction.create({
    data: {
      walletId,
      txid: uniqueTxid,
      type: options.type || 'received',
      amount: options.amount ?? BigInt(100000),
      fee: options.fee ?? BigInt(1000),
      confirmations: options.confirmations ?? 6,
      blockHeight: options.blockHeight ?? 100000,
      blockTime: options.blockTime ?? new Date(),
      label: options.label,
      memo: options.memo,
      rbfStatus: options.rbfStatus ?? 'active',
    },
  });
}

export interface CreateUtxoOptions {
  txid?: string;
  vout?: number;
  address?: string;
  amount?: bigint;
  scriptPubKey?: string;
  confirmations?: number;
  blockHeight?: number | null;
  spent?: boolean;
  spentTxid?: string;
  frozen?: boolean;
}

/**
 * Create a test UTXO
 */
export async function createTestUtxo(
  tx: PrismaClient,
  walletId: string,
  options: CreateUtxoOptions = {}
) {
  const counter = ++utxoCounter;
  const uniqueTxid = options.txid || `${Date.now().toString(16)}${counter.toString(16).padStart(8, '0')}`.padEnd(64, 'b');
  return tx.uTXO.create({
    data: {
      walletId,
      txid: uniqueTxid,
      vout: options.vout ?? 0,
      address: options.address || `tb1q${Date.now().toString(16)}${counter.toString(16).padStart(4, '0')}`.padEnd(42, '0'),
      amount: options.amount ?? BigInt(100000),
      scriptPubKey: options.scriptPubKey || '0014751e76e8199196d454941c45d1b3a323f1433bd6',
      confirmations: options.confirmations ?? 6,
      blockHeight: 'blockHeight' in options ? options.blockHeight : 100000,
      spent: options.spent ?? false,
      spentTxid: options.spentTxid,
      frozen: options.frozen ?? false,
    },
  });
}

export interface CreateLabelOptions {
  name?: string;
  color?: string;
  description?: string;
}

/**
 * Create a test label
 */
export async function createTestLabel(
  tx: PrismaClient,
  walletId: string,
  options: CreateLabelOptions = {}
) {
  return tx.label.create({
    data: {
      walletId,
      name: options.name || `label-${Date.now()}`,
      color: options.color || '#6366f1',
      description: options.description,
    },
  });
}

export interface CreateDraftOptions {
  recipient?: string;
  amount?: bigint;
  feeRate?: number;
  psbtBase64?: string;
  fee?: bigint;
  status?: 'unsigned' | 'partial' | 'signed';
}

/**
 * Create a test draft transaction
 */
export async function createTestDraft(
  tx: PrismaClient,
  walletId: string,
  userId: string,
  options: CreateDraftOptions = {}
) {
  return tx.draftTransaction.create({
    data: {
      walletId,
      userId,
      recipient: options.recipient || 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',
      amount: options.amount ?? BigInt(50000),
      feeRate: options.feeRate ?? 10,
      selectedUtxoIds: [],
      psbtBase64: options.psbtBase64 || 'cHNidP8BAHUCAAAAAQLdKnlX',
      fee: options.fee ?? BigInt(1000),
      totalInput: BigInt(100000),
      totalOutput: BigInt(99000),
      changeAmount: BigInt(49000),
      effectiveAmount: BigInt(50000),
      inputPaths: [],
      status: options.status ?? 'unsigned',
    },
  });
}

export interface CreateAuditLogOptions {
  action?: string;
  category?: string;
  details?: Record<string, unknown> | null;
  success?: boolean;
  errorMsg?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create a test audit log entry
 */
export async function createTestAuditLog(
  tx: PrismaClient,
  userId: string | null,
  username: string,
  options: CreateAuditLogOptions = {}
) {
  return tx.auditLog.create({
    data: {
      userId,
      username,
      action: options.action || 'test.action',
      category: options.category || 'system',
      details: options.details as any,
      success: options.success ?? true,
      errorMsg: options.errorMsg,
      ipAddress: options.ipAddress,
      userAgent: options.userAgent,
    },
  });
}

export interface CreateSessionOptions {
  token?: string;
  expiresAt?: Date;
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Create a test refresh token session
 */
export async function createTestSession(
  tx: PrismaClient,
  userId: string,
  options: CreateSessionOptions = {}
) {
  const crypto = await import('crypto');
  const token = options.token || crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  return tx.refreshToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deviceId: options.deviceId,
      deviceName: options.deviceName,
      userAgent: options.userAgent,
      ipAddress: options.ipAddress,
    },
  });
}

export interface CreatePushDeviceOptions {
  token?: string;
  platform?: 'ios' | 'android';
  deviceName?: string;
}

/**
 * Create a test push notification device
 */
export async function createTestPushDevice(
  tx: PrismaClient,
  userId: string,
  options: CreatePushDeviceOptions = {}
) {
  return tx.pushDevice.create({
    data: {
      userId,
      token: options.token || `push-token-${Date.now()}`,
      platform: options.platform || 'ios',
      deviceName: options.deviceName,
    },
  });
}

// ========================================
// JEST HELPERS
// ========================================

/**
 * Jest helper to skip tests if database is not available
 */
export function describeIfDatabase(name: string, fn: () => void): void {
  if (canRunIntegrationTests()) {
    describe(name, fn);
  } else {
    describe.skip(`${name} (no database)`, fn);
  }
}

/**
 * Jest helper for beforeAll/afterAll setup
 */
export function setupRepositoryTests() {
  beforeAll(async () => {
    await getTestPrisma();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });
}

// ========================================
// BUILDER PATTERN FOR COMPLEX SCENARIOS
// ========================================

/**
 * TestScenarioBuilder - Creates complex test scenarios with related entities
 *
 * @example
 * ```typescript
 * const scenario = await new TestScenarioBuilder(tx)
 *   .withUser({ username: 'alice', isAdmin: true })
 *   .withWallet({ name: 'Main Wallet' })
 *   .withUtxos(5, { amount: BigInt(100000) })
 *   .withTransactions(3)
 *   .build();
 *
 * // Access created entities
 * console.log(scenario.user.username);
 * console.log(scenario.wallet.name);
 * console.log(scenario.utxos.length);
 * ```
 */
type TestUserEntity = Awaited<ReturnType<typeof createTestUser>>;
type TestDeviceEntity = Awaited<ReturnType<typeof createTestDevice>>;
type TestWalletEntity = Awaited<ReturnType<typeof createTestWallet>>;
type TestAddressEntity = Awaited<ReturnType<typeof createTestAddress>>;
type TestUtxoEntity = Awaited<ReturnType<typeof createTestUtxo>>;
type TestTransactionEntity = Awaited<ReturnType<typeof createTestTransaction>>;
type TestLabelEntity = Awaited<ReturnType<typeof createTestLabel>>;

export class TestScenarioBuilder {
  private tx: PrismaClient;
  private userOptions: CreateUserOptions | null = null;
  private walletOptions: CreateWalletOptions | null = null;
  private deviceOptions: CreateDeviceOptions | null = null;
  private utxoCount = 0;
  private utxoOptions: CreateUtxoOptions = {};
  private transactionCount = 0;
  private transactionOptions: CreateTransactionOptions = {};
  private addressCount = 0;
  private addressOptions: CreateAddressOptions = {};
  private labelCount = 0;
  private labelOptions: CreateLabelOptions = {};

  constructor(tx: PrismaClient) {
    this.tx = tx;
  }

  withUser(options: CreateUserOptions = {}): this {
    this.userOptions = options;
    return this;
  }

  withWallet(options: CreateWalletOptions = {}): this {
    this.walletOptions = options;
    return this;
  }

  withDevice(options: CreateDeviceOptions = {}): this {
    this.deviceOptions = options;
    return this;
  }

  withUtxos(count: number, options: CreateUtxoOptions = {}): this {
    this.utxoCount = count;
    this.utxoOptions = options;
    return this;
  }

  withTransactions(count: number, options: CreateTransactionOptions = {}): this {
    this.transactionCount = count;
    this.transactionOptions = options;
    return this;
  }

  withAddresses(count: number, options: CreateAddressOptions = {}): this {
    this.addressCount = count;
    this.addressOptions = options;
    return this;
  }

  withLabels(count: number, options: CreateLabelOptions = {}): this {
    this.labelCount = count;
    this.labelOptions = options;
    return this;
  }

  private async createRequestedDevice(user: TestUserEntity): Promise<TestDeviceEntity | null> {
    if (this.deviceOptions === null) {
      return null;
    }

    return createTestDevice(this.tx, user.id, this.deviceOptions);
  }

  private async createRequestedWallet(user: TestUserEntity): Promise<TestWalletEntity | null> {
    if (this.walletOptions === null) {
      return null;
    }

    return createTestWallet(this.tx, user.id, this.walletOptions);
  }

  private async createRequestedAddresses(wallet: TestWalletEntity | null): Promise<TestAddressEntity[]> {
    const addresses: TestAddressEntity[] = [];
    if (!wallet || this.addressCount <= 0) {
      return addresses;
    }

    for (let i = 0; i < this.addressCount; i++) {
      addresses.push(
        await createTestAddress(this.tx, wallet.id, {
          ...this.addressOptions,
          index: i,
        })
      );
    }

    return addresses;
  }

  private async createRequestedUtxos(wallet: TestWalletEntity | null): Promise<TestUtxoEntity[]> {
    const utxos: TestUtxoEntity[] = [];
    if (!wallet || this.utxoCount <= 0) {
      return utxos;
    }

    for (let i = 0; i < this.utxoCount; i++) {
      utxos.push(
        await createTestUtxo(this.tx, wallet.id, {
          ...this.utxoOptions,
          vout: i,
        })
      );
    }

    return utxos;
  }

  private async createRequestedTransactions(wallet: TestWalletEntity | null): Promise<TestTransactionEntity[]> {
    const transactions: TestTransactionEntity[] = [];
    if (!wallet || this.transactionCount <= 0) {
      return transactions;
    }

    for (let i = 0; i < this.transactionCount; i++) {
      transactions.push(
        await createTestTransaction(this.tx, wallet.id, this.transactionOptions)
      );
    }

    return transactions;
  }

  private async createRequestedLabels(wallet: TestWalletEntity | null): Promise<TestLabelEntity[]> {
    const labels: TestLabelEntity[] = [];
    if (!wallet || this.labelCount <= 0) {
      return labels;
    }

    for (let i = 0; i < this.labelCount; i++) {
      labels.push(
        await createTestLabel(this.tx, wallet.id, {
          ...this.labelOptions,
          name: `${this.labelOptions.name || 'label'}-${i}`,
        })
      );
    }

    return labels;
  }

  async build(): Promise<TestScenario> {
    const user = await createTestUser(this.tx, this.userOptions || {});
    const device = await this.createRequestedDevice(user);
    const wallet = await this.createRequestedWallet(user);

    return {
      user,
      device,
      wallet,
      addresses: await this.createRequestedAddresses(wallet),
      utxos: await this.createRequestedUtxos(wallet),
      transactions: await this.createRequestedTransactions(wallet),
      labels: await this.createRequestedLabels(wallet),
    };
  }
}

export interface TestScenario {
  user: TestUserEntity;
  device: TestDeviceEntity | null;
  wallet: TestWalletEntity | null;
  addresses: TestAddressEntity[];
  utxos: TestUtxoEntity[];
  transactions: TestTransactionEntity[];
  labels: TestLabelEntity[];
}

// ========================================
// COMPOSABLE TEST HOOKS
// ========================================

export interface TestHookOptions {
  cleanupBefore?: boolean;
  cleanupAfter?: boolean;
  seedSystemSettings?: boolean;
  customSetup?: (tx: PrismaClient) => Promise<void>;
  customTeardown?: (tx: PrismaClient) => Promise<void>;
}

/**
 * Create a configured test suite with custom hooks
 *
 * @example
 * ```typescript
 * const { setup, teardown, getPrisma } = createTestSuite({
 *   cleanupBefore: true,
 *   seedSystemSettings: true,
 *   customSetup: async (tx) => {
 *     await createTestUser(tx, { username: 'setup-user' });
 *   },
 * });
 *
 * describe('MyTests', () => {
 *   beforeAll(setup);
 *   afterAll(teardown);
 *
 *   it('test', async () => {
 *     const tx = getPrisma();
 *     // ...
 *   });
 * });
 * ```
 */
export function createTestSuite(options: TestHookOptions = {}) {
  let testPrisma: PrismaClient | null = null;

  const setup = async () => {
    testPrisma = await getTestPrisma();

    if (options.cleanupBefore) {
      await cleanupTestData();
    }

    if (options.seedSystemSettings) {
      await seedSystemSettings(testPrisma);
    }

    if (options.customSetup) {
      await options.customSetup(testPrisma);
    }
  };

  const teardown = async () => {
    if (testPrisma && options.customTeardown) {
      await options.customTeardown(testPrisma);
    }

    if (options.cleanupAfter) {
      await cleanupTestData();
    }

    await disconnectTestDatabase();
  };

  const getPrismaClient = () => {
    if (!testPrisma) {
      throw new Error('Test suite not initialized. Call setup() first.');
    }
    return testPrisma;
  };

  return { setup, teardown, getPrisma: getPrismaClient };
}

/**
 * Seed default system settings required for tests
 */
async function seedSystemSettings(tx: PrismaClient): Promise<void> {
  const defaultSettings = [
    { key: 'confirmationThreshold', value: '3' },
    { key: 'deepConfirmationThreshold', value: '100' },
    { key: 'dustThreshold', value: '546' },
  ];

  for (const setting of defaultSettings) {
    await tx.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
}

// ========================================
// ASSERTION HELPERS
// ========================================

/**
 * Assert that a database record exists
 */
export async function assertExists<T>(
  tx: PrismaClient,
  model: keyof PrismaClient,
  where: Record<string, unknown>
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = await (tx[model] as any).findFirst({ where });
  if (!record) {
    throw new Error(`Expected record to exist in ${String(model)} with ${JSON.stringify(where)}`);
  }
  return record as T;
}

/**
 * Assert that a database record does not exist
 */
export async function assertNotExists(
  tx: PrismaClient,
  model: keyof PrismaClient,
  where: Record<string, unknown>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const record = await (tx[model] as any).findFirst({ where });
  if (record) {
    throw new Error(`Expected no record in ${String(model)} with ${JSON.stringify(where)}`);
  }
}

/**
 * Assert record count matches expected
 */
export async function assertCount(
  tx: PrismaClient,
  model: keyof PrismaClient,
  expectedCount: number,
  where: Record<string, unknown> = {}
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const count = await (tx[model] as any).count({ where });
  if (count !== expectedCount) {
    throw new Error(
      `Expected ${expectedCount} records in ${String(model)}, found ${count}`
    );
  }
}

// ========================================
// DATA GENERATORS
// ========================================

/**
 * Generate a unique ID with optional prefix
 */
export function generateId(prefix = ''): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Generate a valid Bitcoin testnet address
 */
export function generateTestnetAddress(type: 'p2wpkh' | 'p2sh' | 'p2pkh' = 'p2wpkh'): string {
  const random = Math.random().toString(36).slice(2);
  switch (type) {
    case 'p2wpkh':
      return `tb1q${random.padEnd(38, '0').slice(0, 38)}`;
    case 'p2sh':
      return `2N${random.padEnd(33, '0').slice(0, 33)}`;
    case 'p2pkh':
      return `m${random.padEnd(33, '0').slice(0, 33)}`;
  }
}

/**
 * Generate a valid transaction ID (64 hex chars)
 */
export function generateTxid(): string {
  return Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}

/**
 * Generate a valid device fingerprint (8 hex chars)
 */
export function generateFingerprint(): string {
  return Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
}
