import { beforeEach, vi } from 'vitest';
/**
 * Transaction Service Tests
 *
 * Tests for UTXO selection, fee calculation, and transaction creation.
 * These are CRITICAL tests for a Bitcoin wallet.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';

// Hoist mock variables for use in vi.mock() factories
const transactionServiceCreateMocks = vi.hoisted(() => ({
  mockParseDescriptor: vi.fn(),
  mockBindPsbtAccount: vi.fn(),
  mockNotifyNewTransactions: vi.fn(),
  mockEmitTransactionSent: vi.fn(),
  mockEmitTransactionReceived: vi.fn(),
}));
const { mockParseDescriptor, mockBindPsbtAccount, mockNotifyNewTransactions, mockEmitTransactionSent, mockEmitTransactionReceived } =
  transactionServiceCreateMocks;

export { mockParseDescriptor, mockBindPsbtAccount, mockNotifyNewTransactions, mockEmitTransactionSent, mockEmitTransactionReceived };

const TEST_ACCOUNT_XPUB =
  'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M';

type WalletFixture = Record<string, unknown>;

function singleSigDescriptor(
  scriptType: unknown,
  fingerprint: string,
  accountPath: string,
  branch: 0 | 1,
): string {
  const wrapper = scriptType === 'legacy' ? 'pkh' : scriptType === 'nested_segwit' ? 'sh(wpkh' : 'wpkh';
  const close = scriptType === 'nested_segwit' ? '))' : ')';
  return `${wrapper}([${fingerprint}/${accountPath}]${TEST_ACCOUNT_XPUB}/${branch}/*${close}`;
}

function singleSigPolicyId(scriptType: unknown): string {
  if (scriptType === 'legacy') return 'single-sig-legacy-bip44-v1';
  if (scriptType === 'nested_segwit') return 'single-sig-nested-segwit-bip49-v1';
  return 'single-sig-native-segwit-bip84-v1';
}

export function singleSigSigningWallet(
  wallet: WalletFixture,
  overrides: WalletFixture = {},
): WalletFixture {
  const scriptType = overrides.scriptType ?? wallet.scriptType;
  const fingerprint = String(overrides.fingerprint ?? wallet.fingerprint ?? 'aabbccdd');
  const accountPath = scriptType === 'legacy' ? "44'/1'/0'" : scriptType === 'nested_segwit' ? "49'/1'/0'" : "84'/1'/0'";
  const deviceId = 'single-sig-device';
  return {
    ...wallet,
    descriptor: singleSigDescriptor(scriptType, fingerprint, accountPath, 0),
    changeDescriptor: singleSigDescriptor(scriptType, fingerprint, accountPath, 1),
    canonicalPolicyId: singleSigPolicyId(scriptType),
    canonicalPolicyVersion: 1,
    devices: [{
      signerBindingVersion: 1,
      signerIndex: 0,
      signerFingerprint: fingerprint,
      signerXpub: TEST_ACCOUNT_XPUB,
      signerDerivationPath: `m/${accountPath}`,
      deviceAccountId: 'single-sig-account',
      deviceId,
      device: { id: deviceId, fingerprint, xpub: TEST_ACCOUNT_XPUB },
    }],
    ...overrides,
  };
}

export function multisigSigningWallet(
  wallet: WalletFixture,
  keys: ReadonlyArray<{ fingerprint: string; accountPath: string; xpub: string }>,
  overrides: WalletFixture = {},
): WalletFixture {
  const deviceLinks = keys.map((key, signerIndex) => {
    const deviceId = `multisig-device-${signerIndex}`;
    return {
      signerBindingVersion: 1,
      signerIndex,
      signerFingerprint: key.fingerprint,
      signerXpub: key.xpub,
      signerDerivationPath: `m/${key.accountPath}`,
      deviceAccountId: `multisig-account-${signerIndex}`,
      deviceId,
      device: { id: deviceId, fingerprint: key.fingerprint, xpub: key.xpub },
    };
  });
  const descriptor = String(overrides.descriptor ?? wallet.descriptor);
  return {
    ...wallet,
    descriptor,
    changeDescriptor: descriptor.replaceAll('/0/*', '/1/*'),
    canonicalPolicyId: descriptor.startsWith('sh(')
      ? 'multisig-nested-segwit-bip48-1-v1'
      : 'multisig-native-segwit-bip48-2-v1',
    canonicalPolicyVersion: 1,
    devices: deviceLinks,
    ...overrides,
  };
}

// Mock the Prisma client before importing the service
vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
}));

// Mock the nodeClient - getTransaction returns raw hex string when verbose=false
vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue({
    getTransaction: vi.fn().mockResolvedValue('0100000001c997a5e56e104102fa209c6a852dd90660a20b2d9c352423edce25857fcd3704000000004847304402204e45e16932b8af514961a1d3a1a25fdf3f4f7732e9d624c6c61548ab5fb8cd410220181522ec8eca07de4860a4acdd12909d831cc56cbbac4622082221a8768d1d0901ffffffff0100000000000000000000000000'),
    broadcastTransaction: vi.fn().mockResolvedValue('mock-txid'),
    getBlockHeight: vi.fn().mockResolvedValue(800000),
  }),
}));

// Mock the electrum client
vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    getTransaction: vi.fn().mockResolvedValue(null),
  }),
}));

// Mock blockchain service
vi.mock('../../../../../src/services/bitcoin/blockchain', () => ({
  broadcastTransaction: vi.fn().mockResolvedValue({ txid: 'mock-txid', broadcasted: true }),
  recalculateWalletBalances: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../../../src/services/eventService', () => ({
  eventService: {
    emitTransactionSent: mockEmitTransactionSent,
    emitTransactionReceived: mockEmitTransactionReceived,
  },
}));

vi.mock('../../../../../src/services/notifications/notificationService', () => ({
  notifyNewTransactions: mockNotifyNewTransactions,
}));

// Mock address derivation - supports both single-sig and multisig
vi.mock('../../../../../src/services/bitcoin/addressDerivation', () => ({
  parseDescriptor: mockParseDescriptor,
  convertToStandardXpub: vi.fn().mockImplementation((xpub: string) => {
    // Convert tpub to standard format (they're already standard in our test fixtures)
    return xpub;
  }),
}));

// Transaction-creation tests isolate construction from the binder's own exhaustive
// evidence tests while still asserting that a signing context is returned.
vi.mock('../../../../../src/services/bitcoin/psbtAccountBinding', () => ({
  bindPsbtAccount: mockBindPsbtAccount,
}));

vi.mock('../../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesForWallet: vi.fn().mockResolvedValue(undefined),
}));


export function setupTransactionServiceCreateTestHooks(): void {
  beforeEach(() => {
    resetPrismaMocks();
    mockNotifyNewTransactions.mockReset();
    mockNotifyNewTransactions.mockResolvedValue(undefined);
    mockEmitTransactionSent.mockReset();
    mockEmitTransactionReceived.mockReset();
    mockBindPsbtAccount.mockReset();
    mockBindPsbtAccount.mockImplementation(async (walletId: string) => ({
      version: 1,
      walletId,
      network: 'testnet3',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      descriptorDigest: '11'.repeat(32),
      unsignedTransactionDigest: '22'.repeat(32),
      signers: [{
        signerIndex: 0,
        deviceId: 'single-sig-device',
        deviceAccountId: 'single-sig-account',
        masterFingerprint: 'aabbccdd',
        accountPath: "m/84'/1'/0'",
        accountXpub: TEST_ACCOUNT_XPUB,
      }],
      inputs: [{
        inputIndex: 0,
        txid: '33'.repeat(32),
        vout: 0,
        amountSats: '200000',
        scriptPubKey: `0014${'aa'.repeat(20)}`,
        addressPath: "m/84'/1'/0'/0/0",
        signerOrigins: [{
          masterFingerprint: 'aabbccdd',
          path: "m/84'/1'/0'/0/0",
          pubkey: `02${'44'.repeat(32)}`,
        }],
      }],
      changeOutputs: [],
    }));
    // Set up default system settings
    mockPrismaClient.systemSetting.findUnique.mockImplementation((query: any) => {
      if (query.where.key === 'confirmationThreshold') {
        return Promise.resolve({ key: 'confirmationThreshold', value: '1' });
      }
      if (query.where.key === 'dustThreshold') {
        return Promise.resolve({ key: 'dustThreshold', value: '546' });
      }
      return Promise.resolve(null);
    });
    // Set up mockParseDescriptor implementation - supports both single-sig and multisig
    // Using only 2 keys for 2-of-2 multisig (both keys are valid testnet tpubs)
    mockParseDescriptor.mockImplementation((descriptor: string) => {
      // Check if it's a multisig descriptor
      if (descriptor.startsWith('wsh(sortedmulti(') || descriptor.startsWith('wsh(multi(')) {
        return {
          type: 'wsh-sortedmulti',
          quorum: 2,
          keys: [
            {
              fingerprint: 'aabbccdd',
              accountPath: "48'/1'/0'/2'",
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
              derivationPath: '0/*',
            },
            {
              fingerprint: 'eeff0011',
              accountPath: "48'/1'/0'/2'",
              xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
              derivationPath: '0/*',
            },
          ],
        };
      }
      if (descriptor.startsWith('sh(wsh(sortedmulti(') || descriptor.startsWith('sh(wsh(multi(')) {
        return {
          type: 'sh-wsh-sortedmulti',
          quorum: 2,
          keys: [
            {
              fingerprint: 'aabbccdd',
              accountPath: "48'/1'/0'/1'",
              xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
              derivationPath: '0/*',
            },
            {
              fingerprint: 'eeff0011',
              accountPath: "48'/1'/0'/1'",
              xpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
              derivationPath: '0/*',
            },
          ],
        };
      }
      // Single-sig descriptor
      return {
        type: 'wpkh',
        xpub: 'tpubDC8msFGeGuwnKG9Upg7DM2b4DaRqg3CUZa5g8v2SRQ6K4NSkxUgd7HsL2XVWbVm39yBA4LAxysQAm397zwQSQoQgewGiYZqrA9DsP4zbQ1M',
        fingerprint: 'aabbccdd',
        accountPath: "84'/1'/0'",
      };
    });
  });
}
