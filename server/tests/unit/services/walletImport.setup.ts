/**
 * Shared test setup for wallet import tests.
 *
 * Provides mock setup and helpers used across all walletImport test files.
 */

import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
  withTransaction: (fn: (tx: any) => Promise<any>) => mockPrismaClient.$transaction(fn),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock descriptor parser
export const mockParseImportInput = vi.fn();
export const mockParseDescriptorForImport = vi.fn();
export const mockParseJsonImport = vi.fn();
export const mockValidateDescriptor = vi.fn();
export const mockValidateJsonImport = vi.fn();

vi.mock('../../../src/services/bitcoin/descriptorParser', () => ({
  parseDescriptorForImport: (...args: any[]) => mockParseDescriptorForImport(...args),
  parseJsonImport: (...args: any[]) => mockParseJsonImport(...args),
  validateDescriptor: (...args: any[]) => mockValidateDescriptor(...args),
  validateJsonImport: (...args: any[]) => mockValidateJsonImport(...args),
}));

// Mock import format registry (parseImportInput is now imported from here)
vi.mock('../../../src/services/import', () => ({
  parseImportInput: (...args: any[]) => mockParseImportInput(...args),
}));

// Mock descriptor builder
export const mockBuildDescriptorFromDevices = vi.fn();
vi.mock('../../../src/services/bitcoin/descriptorBuilder', () => ({
  buildDescriptorFromDevices: (...args: any[]) => mockBuildDescriptorFromDevices(...args),
}));

// Mock address derivation
export const mockDeriveAddressFromDescriptor = vi.fn();
vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveAddressFromDescriptor: (...args: any[]) => mockDeriveAddressFromDescriptor(...args),
}));

export { mockPrismaClient, resetPrismaMocks };

/** Helper to setup device mocks for import tests */
export const setupDeviceMocks = (devices: any[], existingDevices: any[] = []) => {
  // First call: check for existing devices before import
  mockPrismaClient.device.findMany.mockResolvedValueOnce(existingDevices);

  // Setup device creation mocks
  devices.forEach(device => {
    mockPrismaClient.device.create.mockResolvedValueOnce(device);
  });

  // Second call: lookup created/reused devices in transaction
  const allDevices = [...existingDevices, ...devices];
  mockPrismaClient.device.findMany.mockResolvedValueOnce(allDevices);
};

/** Standard beforeEach setup for wallet import tests */
export function setupBeforeEach() {
  vi.clearAllMocks();
  resetPrismaMocks();

  // Default mock implementations
  mockBuildDescriptorFromDevices.mockReturnValue({
    descriptor: 'wpkh([abcd1234/84h/0h/0h]xpub6Dz...)',
    fingerprint: 'wallet-fp',
  });

  mockDeriveAddressFromDescriptor.mockImplementation((descriptor, index, opts) => ({
    address: `bc1q${index}address${opts.change ? 'change' : 'receive'}`,
    derivationPath: `m/84'/0'/0'/${opts.change ? 1 : 0}/${index}`,
  }));
}
