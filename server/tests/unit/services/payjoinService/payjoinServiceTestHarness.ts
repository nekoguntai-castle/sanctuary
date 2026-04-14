import { vi, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

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
vi.mock('../../../../src/services/bitcoin/utils', () => ({
  getNetwork: vi.fn().mockReturnValue(bitcoin.networks.testnet),
}));

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
  (global.fetch as Mock).mockReset();
};
