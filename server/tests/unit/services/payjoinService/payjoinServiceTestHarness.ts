import { vi, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

const { mockDnsLookup, mockPinnedRequest } = vi.hoisted(() => ({
  mockDnsLookup: vi.fn(),
  mockPinnedRequest: vi.fn(),
}));

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock the logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock PSBT validation functions
vi.mock('../../../../src/services/bitcoin/psbtValidation', () => ({
  parsePsbt: vi.fn(),
  validatePsbtStructure: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  validatePayjoinProposal: vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] }),
  getPsbtOutputs: vi.fn().mockReturnValue([]),
  getPsbtInputs: vi.fn().mockReturnValue([]),
  calculateFeeRate: vi.fn().mockReturnValue(10),
  clonePsbt: vi.fn(),
}));

// Mock the network utils
vi.mock('../../../../src/services/bitcoin/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/bitcoin/utils')>();
  return {
    ...actual,
    getNetwork: vi.fn().mockReturnValue(bitcoin.networks.testnet),
  };
});

vi.mock('node:dns/promises', () => ({
  default: { lookup: mockDnsLookup },
  lookup: mockDnsLookup,
}));

vi.mock('../../../../src/services/outboundNetwork/nativeRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/outboundNetwork/nativeRequest')>();
  return {
    ...actual,
    requestPinnedAddress: mockPinnedRequest,
  };
});

// Mock global fetch
global.fetch = vi.fn();

import * as payjoinService from '../../../../src/services/payjoinService';
import * as psbtValidation from '../../../../src/services/bitcoin/psbtValidation';
import * as bitcoinUtils from '../../../../src/services/bitcoin/utils';

export const parseBip21Uri = payjoinService.parseBip21Uri;
export const generateBip21Uri = payjoinService.generateBip21Uri;
export const processPayjoinRequest = payjoinService.processPayjoinRequest;
export const attemptPayjoinSend = payjoinService.attemptPayjoinSend;
export const PayjoinErrors = payjoinService.PayjoinErrors;
export const isPrivateIP = payjoinService.isPrivateIP;
export const requestPinnedAddressMock = mockPinnedRequest;
export const dnsLookupMock = mockDnsLookup;

export const parsePsbt = psbtValidation.parsePsbt;
export const validatePsbtStructure = psbtValidation.validatePsbtStructure;
export const validatePayjoinProposal = psbtValidation.validatePayjoinProposal;
export const getPsbtOutputs = psbtValidation.getPsbtOutputs;
export const calculateFeeRate = psbtValidation.calculateFeeRate;
export const clonePsbt = psbtValidation.clonePsbt;
export const getNetwork = bitcoinUtils.getNetwork;

// Test constants
export const TEST_ADDRESS_TESTNET = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
export const TEST_PAYJOIN_URL = 'https://example.com/payjoin';

export const setupPayjoinServiceTest = () => {
  resetPrismaMocks();
  vi.clearAllMocks();
  mockPrismaClient.wallet.findUnique.mockResolvedValue({
    id: 'wallet-456',
    devices: [{ device: { type: 'coldcard', model: null } }],
  });
  (global.fetch as Mock).mockReset();
  mockDnsLookup.mockReset();
  mockPinnedRequest.mockReset();
  mockDnsLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mockPinnedRequest.mockImplementation(async (options) => {
    const response = await global.fetch(options.url.toString(), {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    return {
      body: Buffer.from(await response.text()),
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
    };
  });
};
