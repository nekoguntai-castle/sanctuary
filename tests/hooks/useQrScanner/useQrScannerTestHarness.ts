import { renderHook } from '@testing-library/react';
import { beforeEach, vi } from 'vitest';

export let mockUrRegistryDecoder: any;
export let mockBytesDecoder: any;
export let mockBbqrDecoder: any;

function createMockDecoders() {
  mockUrRegistryDecoder = {
    receivePart: vi.fn(),
    estimatedPercentComplete: vi.fn(),
    isComplete: vi.fn(),
    isSuccess: vi.fn(),
    resultError: vi.fn(),
    resultRegistryType: vi.fn(),
  };

  mockBytesDecoder = {
    receivePart: vi.fn(),
    estimatedPercentComplete: vi.fn(),
    expectedPartCount: vi.fn(),
    receivedPartIndexes: vi.fn(),
    isComplete: vi.fn(),
    isSuccess: vi.fn(),
    resultError: vi.fn(),
    resultUR: vi.fn(),
  };

  mockBbqrDecoder = {
    receivePart: vi.fn(),
    getError: vi.fn(),
    getProgress: vi.fn(),
    getReceivedCount: vi.fn(),
    getTotalParts: vi.fn(),
    getFileType: vi.fn(),
    isComplete: vi.fn(),
    decode: vi.fn(),
  };
}

createMockDecoders();

vi.mock('@keystonehq/bc-ur-registry', () => ({
  URRegistryDecoder: class MockURRegistryDecoder {
    receivePart = (...args: unknown[]) => mockUrRegistryDecoder.receivePart(...args);
    estimatedPercentComplete = () => mockUrRegistryDecoder.estimatedPercentComplete();
    isComplete = () => mockUrRegistryDecoder.isComplete();
    isSuccess = () => mockUrRegistryDecoder.isSuccess();
    resultError = () => mockUrRegistryDecoder.resultError();
    resultRegistryType = () => mockUrRegistryDecoder.resultRegistryType();
  },
}));

vi.mock('@ngraveio/bc-ur', () => ({
  URDecoder: class MockURDecoder {
    receivePart = (...args: unknown[]) => mockBytesDecoder.receivePart(...args);
    estimatedPercentComplete = () => mockBytesDecoder.estimatedPercentComplete();
    expectedPartCount = () => mockBytesDecoder.expectedPartCount();
    receivedPartIndexes = () => mockBytesDecoder.receivedPartIndexes();
    isComplete = () => mockBytesDecoder.isComplete();
    isSuccess = () => mockBytesDecoder.isSuccess();
    resultError = () => mockBytesDecoder.resultError();
    resultUR = () => mockBytesDecoder.resultUR();
  },
}));

vi.mock('../../../src/services/bbqr', () => ({
  BBQrDecoder: class MockBBQrDecoder {
    receivePart = (...args: unknown[]) => mockBbqrDecoder.receivePart(...args);
    getError = () => mockBbqrDecoder.getError();
    getProgress = () => mockBbqrDecoder.getProgress();
    getReceivedCount = () => mockBbqrDecoder.getReceivedCount();
    getTotalParts = () => mockBbqrDecoder.getTotalParts();
    getFileType = () => mockBbqrDecoder.getFileType();
    isComplete = () => mockBbqrDecoder.isComplete();
    decode = () => mockBbqrDecoder.decode();
  },
  isBBQr: vi.fn(),
  BBQrFileTypes: {
    P: 'PSBT',
    T: 'Transaction',
    J: 'JSON',
    C: 'CBOR',
    U: 'Unicode Text',
    B: 'Binary',
    X: 'Executable',
  },
  BBQrEncodings: {
    H: 'Hex',
    '2': 'Base32',
    Z: 'Zlib+Base32',
  },
}));

vi.mock('../../../src/services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(),
}));

vi.mock('../../../src/utils/urDeviceDecoder', () => ({
  extractFromUrResult: vi.fn(),
  extractFromUrBytesContent: vi.fn(),
  getUrType: vi.fn(),
}));

vi.mock('../../../src/utils/deviceConnection', () => ({
  normalizeDerivationPath: vi.fn((path: string) => path),
  generateMissingFieldsWarning: vi.fn(() => null),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useQrScanner } from '../../../src/hooks/qr/useQrScanner';
import { isBBQr } from '../../../src/services/bbqr';
import { parseDeviceJson } from '../../../src/services/deviceParsers';
import { generateMissingFieldsWarning } from '../../../src/utils/deviceConnection';
import {
  extractFromUrBytesContent,
  extractFromUrResult,
  getUrType,
} from '../../../src/utils/urDeviceDecoder';

export function renderUseQrScanner() {
  return renderHook(() => useQrScanner());
}

export function registerUseQrScannerTestHarness() {
  beforeEach(() => {
    vi.clearAllMocks();
    createMockDecoders();
    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (generateMissingFieldsWarning as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });
}
