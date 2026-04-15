import { beforeAll, beforeEach, vi } from 'vitest';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

type UtxoSelectionModule = typeof import('../../../../src/services/utxoSelectionService');
type PrivacyServiceModule = typeof import('../../../../src/services/privacyService');

export let selectUtxos: UtxoSelectionModule['selectUtxos'];
export let compareStrategies: UtxoSelectionModule['compareStrategies'];
export let getRecommendedStrategy: UtxoSelectionModule['getRecommendedStrategy'];
export let calculateWalletPrivacy: PrivacyServiceModule['calculateWalletPrivacy'];
export let calculateSpendPrivacy: PrivacyServiceModule['calculateSpendPrivacy'];

export { mockPrismaClient };

export const WALLET_ID = 'wallet-integration-test';
export const ADDRESS_1 = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
export const ADDRESS_2 = 'tb1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3q0sl5k7';
export const ADDRESS_3 = 'tb1q0ht9tyks4vh7p5p904t340cr9nvahy7u3re7zg';
export const ADDRESS_4 = 'tb1qqqqqq0rd4lfmx0x7g0y76wz95wgc4qrm6c9s00';

export const createTestUtxo = (overrides: Partial<{
  id: string;
  txid: string;
  vout: number;
  walletId: string;
  address: string;
  amount: bigint;
  confirmations: number;
  blockHeight: number | null;
  frozen: boolean;
  spent: boolean;
  draftLock: null | { draftId: string };
  scriptPubKey: string;
}> = {}) => ({
  id: 'utxo-1',
  txid: 'a'.repeat(64),
  vout: 0,
  walletId: WALLET_ID,
  address: ADDRESS_1,
  amount: BigInt(100000),
  confirmations: 6,
  blockHeight: 800000,
  frozen: false,
  spent: false,
  draftLock: null,
  scriptPubKey: '0014' + 'a'.repeat(40),
  ...overrides,
});

export const setupCoinControlIntegrationHarness = () => {
  beforeAll(async () => {
    const utxoSelection = await import('../../../../src/services/utxoSelectionService');
    const privacyService = await import('../../../../src/services/privacyService');

    selectUtxos = utxoSelection.selectUtxos;
    compareStrategies = utxoSelection.compareStrategies;
    getRecommendedStrategy = utxoSelection.getRecommendedStrategy;
    calculateWalletPrivacy = privacyService.calculateWalletPrivacy;
    calculateSpendPrivacy = privacyService.calculateSpendPrivacy;
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });
};
