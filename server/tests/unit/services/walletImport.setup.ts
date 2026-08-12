/**
 * Shared test setup for wallet import tests.
 *
 * Provides mock setup and helpers used across all walletImport test files.
 */

import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { resolveDescriptorTextPair as actualResolveDescriptorTextPair } from '../../../src/services/bitcoin/descriptorParser/descriptorParser';

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
export const mockResolveDescriptorTextPair = vi.fn();
export const mockParseCanonicalDescriptor = vi.fn();
export const mockValidateCanonicalDescriptorPair = vi.fn();
export const mockExpandCanonicalMultipathDescriptor = vi.fn();
export const mockParseJsonImport = vi.fn();
export const mockValidateDescriptor = vi.fn();
export const mockValidateJsonImport = vi.fn();
export const mockAssertHardwareWalletCapability = vi.fn();

vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertHardwareWalletCapability: (...args: unknown[]) =>
    mockAssertHardwareWalletCapability(...args),
}));

vi.mock('../../../src/services/bitcoin/descriptorParser', () => ({
  parseDescriptorForImport: (...args: any[]) => mockParseDescriptorForImport(...args),
  resolveDescriptorTextPair: (...args: any[]) => mockResolveDescriptorTextPair(...args),
  parseCanonicalDescriptor: (...args: any[]) => mockParseCanonicalDescriptor(...args),
  validateCanonicalDescriptorPair: (...args: any[]) => mockValidateCanonicalDescriptorPair(...args),
  expandCanonicalMultipathDescriptor: (...args: any[]) => mockExpandCanonicalMultipathDescriptor(...args),
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

// Mock canonical address derivation. Keep the compatibility export for older
// wallet-import suites until they migrate independently.
export const mockDeriveCanonicalAddress = vi.fn();
export const mockDeriveAddressFromDescriptor = mockDeriveCanonicalAddress;
vi.mock('../../../src/services/bitcoin/addressDerivation', () => ({
  deriveCanonicalAddress: (...args: any[]) => mockDeriveCanonicalAddress(...args),
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
  mockAssertHardwareWalletCapability.mockReturnValue(undefined);

  // Default mock implementations
  mockBuildDescriptorFromDevices.mockReturnValue({
    descriptor: "wpkh([abcd1234/84'/0'/0']xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8/0/*)",
    changeDescriptor: "wpkh([abcd1234/84'/0'/0']xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8/1/*)",
    fingerprint: 'abcd1234',
  });
  mockResolveDescriptorTextPair.mockImplementation(actualResolveDescriptorTextPair);
  mockParseCanonicalDescriptor.mockImplementation((descriptor: string) => ({
    body: descriptor.split('#')[0],
    checksum: descriptor.includes('#') ? descriptor.split('#')[1] : undefined,
    keys: [{ fingerprint: 'abcd1234' }],
  }));
  mockValidateCanonicalDescriptorPair.mockImplementation((receive: string, change: string) => ({
    receive: mockParseCanonicalDescriptor(receive),
    change: mockParseCanonicalDescriptor(change),
  }));
  mockExpandCanonicalMultipathDescriptor.mockImplementation((descriptor: string) => {
    if (!descriptor.includes('<0;1>/*')) {
      throw new Error('Descriptor import requires an explicit receive/change pair');
    }
    return {
      receiveDescriptor: descriptor.split('#')[0].replace(/<0;1>/g, '0'),
      changeDescriptor: descriptor.split('#')[0].replace(/<0;1>/g, '1'),
    };
  });
  mockParseDescriptorForImport.mockImplementation((descriptor: string) => ({
    type: 'single_sig',
    scriptType: 'native_segwit',
    devices: [{
      fingerprint: 'abcd1234',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-test',
    }],
    network: 'mainnet',
    isChange: descriptor.includes('/1/*'),
  }));

  mockDeriveCanonicalAddress.mockImplementation((_descriptors, coordinate) => ({
    address: `bc1q${coordinate.index}address${coordinate.branch === 1 ? 'change' : 'receive'}`,
    derivationPath: `m/84'/0'/0'/${coordinate.branch}/${coordinate.index}`,
    scriptPubKey: `0014${coordinate.index.toString(16).padStart(40, '0')}`,
    branch: coordinate.branch,
    index: coordinate.index,
    signerOrigins: [],
    publicKey: Buffer.alloc(33),
  }));
}
