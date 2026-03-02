/**
 * useQrScanner Hook Tests
 *
 * Tests for the QR scanner hook that manages state for QR code scanning
 * with support for multiple formats: UR, ur:bytes, BBQr, and plain JSON.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Create mock instances that will be returned by constructors
let mockUrRegistryDecoder: {
  receivePart: ReturnType<typeof vi.fn>;
  estimatedPercentComplete: ReturnType<typeof vi.fn>;
  isComplete: ReturnType<typeof vi.fn>;
  isSuccess: ReturnType<typeof vi.fn>;
  resultError: ReturnType<typeof vi.fn>;
  resultRegistryType: ReturnType<typeof vi.fn>;
};

let mockBytesDecoder: {
  receivePart: ReturnType<typeof vi.fn>;
  estimatedPercentComplete: ReturnType<typeof vi.fn>;
  expectedPartCount: ReturnType<typeof vi.fn>;
  receivedPartIndexes: ReturnType<typeof vi.fn>;
  isComplete: ReturnType<typeof vi.fn>;
  isSuccess: ReturnType<typeof vi.fn>;
  resultError: ReturnType<typeof vi.fn>;
  resultUR: ReturnType<typeof vi.fn>;
};

let mockBbqrDecoder: {
  receivePart: ReturnType<typeof vi.fn>;
  getError: ReturnType<typeof vi.fn>;
  getProgress: ReturnType<typeof vi.fn>;
  getReceivedCount: ReturnType<typeof vi.fn>;
  getTotalParts: ReturnType<typeof vi.fn>;
  getFileType: ReturnType<typeof vi.fn>;
  isComplete: ReturnType<typeof vi.fn>;
  decode: ReturnType<typeof vi.fn>;
};

// Factory function to create fresh mock instances
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

// Initialize mocks
createMockDecoders();

// Mock URRegistryDecoder - use function to return current mock instance
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

// Mock BytesURDecoder from @ngraveio/bc-ur
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

// Mock BBQr service
vi.mock('../../services/bbqr', () => ({
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

// Mock device parsers
vi.mock('../../services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(),
}));

// Mock UR device decoder utilities
vi.mock('../../utils/urDeviceDecoder', () => ({
  extractFromUrResult: vi.fn(),
  extractFromUrBytesContent: vi.fn(),
  getUrType: vi.fn(),
}));

// Mock device connection utilities
vi.mock('../../utils/deviceConnection', () => ({
  normalizeDerivationPath: vi.fn((path: string) => path),
  generateMissingFieldsWarning: vi.fn(() => null),
}));

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Import after mocks
import { useQrScanner } from '../../hooks/useQrScanner';
import { isBBQr } from '../../services/bbqr';
import { parseDeviceJson } from '../../services/deviceParsers';
import {
  extractFromUrResult,
  extractFromUrBytesContent,
  getUrType,
} from '../../utils/urDeviceDecoder';
import { generateMissingFieldsWarning } from '../../utils/deviceConnection';

describe('useQrScanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Create fresh mock decoders for each test
    createMockDecoders();
    // Reset all mock implementations
    (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (getUrType as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (generateMissingFieldsWarning as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const { result } = renderHook(() => useQrScanner());

      expect(result.current.qrMode).toBe('camera');
      expect(result.current.cameraActive).toBe(false);
      expect(result.current.cameraError).toBeNull();
      expect(result.current.urProgress).toBe(0);
      expect(result.current.scanning).toBe(false);
      expect(result.current.scanResult).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should provide all required functions', () => {
      const { result } = renderHook(() => useQrScanner());

      expect(typeof result.current.setQrMode).toBe('function');
      expect(typeof result.current.setCameraActive).toBe('function');
      expect(typeof result.current.handleQrScan).toBe('function');
      expect(typeof result.current.handleCameraError).toBe('function');
      expect(typeof result.current.handleFileContent).toBe('function');
      expect(typeof result.current.reset).toBe('function');
      expect(typeof result.current.stopCamera).toBe('function');
    });
  });

  describe('QR Mode Switching', () => {
    it('should switch to file mode', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.setQrMode('file');
      });

      expect(result.current.qrMode).toBe('file');
      expect(result.current.cameraActive).toBe(false);
    });

    it('should switch to camera mode and clear camera error', () => {
      const { result } = renderHook(() => useQrScanner());

      // First set an error and switch to file
      act(() => {
        result.current.handleCameraError(new Error('Test error'));
        result.current.setQrMode('file');
      });

      expect(result.current.cameraError).not.toBeNull();

      // Switch back to camera
      act(() => {
        result.current.setQrMode('camera');
      });

      expect(result.current.qrMode).toBe('camera');
      expect(result.current.cameraError).toBeNull();
    });

    it('should deactivate camera when switching to file mode', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.setCameraActive(true);
      });

      expect(result.current.cameraActive).toBe(true);

      act(() => {
        result.current.setQrMode('file');
      });

      expect(result.current.cameraActive).toBe(false);
    });
  });

  describe('Camera State', () => {
    it('should toggle camera active state', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.setCameraActive(true);
      });

      expect(result.current.cameraActive).toBe(true);

      act(() => {
        result.current.setCameraActive(false);
      });

      expect(result.current.cameraActive).toBe(false);
    });
  });

  describe('Camera Error Handling', () => {
    it('should handle NotAllowedError', () => {
      const { result } = renderHook(() => useQrScanner());

      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';

      act(() => {
        result.current.setCameraActive(true);
        result.current.handleCameraError(error);
      });

      expect(result.current.cameraActive).toBe(false);
      expect(result.current.cameraError).toBe(
        'Camera access denied. Please allow camera permissions and try again.'
      );
    });

    it('should handle NotFoundError', () => {
      const { result } = renderHook(() => useQrScanner());

      const error = new Error('No camera');
      error.name = 'NotFoundError';

      act(() => {
        result.current.handleCameraError(error);
      });

      expect(result.current.cameraError).toBe('No camera found on this device.');
    });

    it('should handle generic Error', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.handleCameraError(new Error('Generic camera issue'));
      });

      expect(result.current.cameraError).toBe('Camera error: Generic camera issue');
    });

    it('should handle non-Error objects', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.handleCameraError('Some string error');
      });

      expect(result.current.cameraError).toBe(
        'Failed to access camera. Make sure you are using HTTPS.'
      );
    });
  });

  describe('Reset Functionality', () => {
    it('should reset all state', () => {
      const { result } = renderHook(() => useQrScanner());

      // Set various state values
      act(() => {
        result.current.setQrMode('file');
        result.current.setCameraActive(true);
        result.current.handleCameraError(new Error('Test'));
      });

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.qrMode).toBe('camera');
      expect(result.current.cameraActive).toBe(false);
      expect(result.current.cameraError).toBeNull();
      expect(result.current.urProgress).toBe(0);
      expect(result.current.scanning).toBe(false);
      expect(result.current.scanResult).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('Stop Camera Functionality', () => {
    it('should stop camera without full reset', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.setQrMode('file');
        result.current.setCameraActive(true);
      });

      act(() => {
        result.current.stopCamera();
      });

      expect(result.current.cameraActive).toBe(false);
      expect(result.current.urProgress).toBe(0);
      // Mode should be preserved
      expect(result.current.qrMode).toBe('file');
    });
  });

  describe('Plain JSON QR Scanning', () => {
    it('should parse plain JSON QR code successfully', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKi...',
        fingerprint: 'ABCD1234',
        derivationPath: "m/84'/0'/0'",
        label: 'My Device',
        format: 'coldcard',
      });

      act(() => {
        result.current.setCameraActive(true);
        result.current.handleQrScan([
          { rawValue: '{"xpub": "xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKi..."}' },
        ]);
      });

      expect(result.current.cameraActive).toBe(false);
      expect(result.current.scanResult).not.toBeNull();
      expect(result.current.scanResult?.xpub).toBe('xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKi...');
      expect(result.current.scanResult?.fingerprint).toBe('ABCD1234');
      expect(result.current.scanResult?.derivationPath).toBe("m/84'/0'/0'");
      expect(result.current.error).toBeNull();
    });

    it('should handle plain JSON with multiple accounts', () => {
      const { result } = renderHook(() => useQrScanner());

      const accounts = [
        {
          xpub: 'xpub1...',
          derivationPath: "m/84'/0'/0'",
          purpose: 'single_sig' as const,
          scriptType: 'native_segwit' as const,
        },
        {
          xpub: 'xpub2...',
          derivationPath: "m/48'/0'/0'/2'",
          purpose: 'multisig' as const,
          scriptType: 'native_segwit' as const,
        },
      ];

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub1...',
        fingerprint: 'ABCD1234',
        derivationPath: "m/84'/0'/0'",
        accounts,
        format: 'coldcard',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: '{"accounts": [...]}' }]);
      });

      expect(result.current.scanResult?.accounts).toEqual(accounts);
    });

    it('should handle unparseable JSON QR code', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'not valid json or xpub data' }]);
      });

      expect(result.current.error).toContain('Could not find xpub');
      expect(result.current.scanResult).toBeNull();
      expect(result.current.scanning).toBe(false);
    });

    it('uses fallback unknown error when plain scan throws non-Error values', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw 'non-error-scan-failure';
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'raw-content' }]);
      });

      expect(result.current.error).toBe('Unknown error');
      expect(result.current.scanning).toBe(false);
    });

    it('should ignore empty scan results', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        result.current.handleQrScan([]);
      });

      expect(result.current.scanResult).toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('should ignore null scan results', () => {
      const { result } = renderHook(() => useQrScanner());

      act(() => {
        // @ts-expect-error - Testing null handling
        result.current.handleQrScan(null);
      });

      expect(result.current.scanResult).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });

  describe('File Content Handling', () => {
    it('should process file content successfully', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6FileContent...',
        fingerprint: 'FILE1234',
        derivationPath: "m/84'/0'/0'",
        format: 'generic',
      });

      act(() => {
        result.current.handleFileContent('{"xpub": "xpub6FileContent..."}');
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6FileContent...');
      expect(result.current.scanResult?.fingerprint).toBe('FILE1234');
      expect(result.current.error).toBeNull();
    });

    it('should handle file content parsing error', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleFileContent('invalid content');
      });

      expect(result.current.error).toContain('Could not find xpub');
      expect(result.current.scanResult).toBeNull();
      expect(result.current.scanning).toBe(false);
    });

    it('uses fallback unknown error when file parsing throws non-Error values', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw 'non-error-file-failure';
      });

      act(() => {
        result.current.handleFileContent('raw file content');
      });

      expect(result.current.error).toBe('Unknown error');
      expect(result.current.scanning).toBe(false);
    });
  });

  describe('UR Format Processing', () => {
    it('falls back to unknown UR type when detector returns null', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue(null);
      mockUrRegistryDecoder.receivePart.mockReturnValue(true);
      mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockUrRegistryDecoder.isComplete.mockReturnValue(true);
      mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
      mockUrRegistryDecoder.resultRegistryType.mockReturnValue({ type: 'crypto-hdkey' });
      (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6UnknownType...',
        fingerprint: 'UNKN1234',
        path: "m/84'/0'/0'",
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:untyped/1-1/...' }]);
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6UnknownType...');
      expect(result.current.error).toBeNull();
    });

    it('should detect UR format and process crypto-hdkey', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
      mockUrRegistryDecoder.receivePart.mockReturnValue(true);
      mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockUrRegistryDecoder.isComplete.mockReturnValue(true);
      mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
      mockUrRegistryDecoder.resultRegistryType.mockReturnValue({ type: 'crypto-hdkey' });
      (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6UrCryptoHdKey...',
        fingerprint: 'UR123456',
        path: "m/84'/0'/0'",
      });

      act(() => {
        result.current.handleQrScan([
          { rawValue: 'ur:crypto-hdkey/1-1/...' },
        ]);
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6UrCryptoHdKey...');
      expect(result.current.scanResult?.fingerprint).toBe('UR123456');
      expect(result.current.error).toBeNull();
    });

    it('should track progress for multi-part UR codes', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-output');
      mockUrRegistryDecoder.receivePart.mockReturnValue(true);
      mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(0.5);
      mockUrRegistryDecoder.isComplete.mockReturnValue(false);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:crypto-output/1-2/...' }]);
      });

      expect(result.current.urProgress).toBe(50);
      expect(result.current.scanResult).toBeNull();
      expect(result.current.cameraActive).toBe(false); // Not changed until complete
    });

    it('should handle UR decode failure', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
      mockUrRegistryDecoder.receivePart.mockReturnValue(true);
      mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockUrRegistryDecoder.isComplete.mockReturnValue(true);
      mockUrRegistryDecoder.isSuccess.mockReturnValue(false);
      mockUrRegistryDecoder.resultError.mockReturnValue('Decode error');

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/...' }]);
      });

      expect(result.current.error).toContain('UR decode failed');
      expect(result.current.scanResult).toBeNull();
    });

    it('should handle UR result extraction failure', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
      mockUrRegistryDecoder.receivePart.mockReturnValue(true);
      mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockUrRegistryDecoder.isComplete.mockReturnValue(true);
      mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
      mockUrRegistryDecoder.resultRegistryType.mockReturnValue({ type: 'unknown' });
      (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/...' }]);
      });

      expect(result.current.error).toContain('Could not extract xpub from UR type');
    });
  });

  describe('UR Bytes Format Processing', () => {
    it('should detect and process ur:bytes format', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
      mockBytesDecoder.receivePart.mockReturnValue(true);
      mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockBytesDecoder.expectedPartCount.mockReturnValue(1);
      mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
      mockBytesDecoder.isComplete.mockReturnValue(true);
      mockBytesDecoder.isSuccess.mockReturnValue(true);
      mockBytesDecoder.resultUR.mockReturnValue({
        decodeCBOR: () => new TextEncoder().encode('{"xpub": "xpub..."}'),
      });
      (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6UrBytes...',
        fingerprint: 'BYTES123',
        path: "m/84'/0'/0'",
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:bytes/...' }]);
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6UrBytes...');
      expect(result.current.scanResult?.fingerprint).toBe('BYTES123');
    });

    it('should track progress for multi-part ur:bytes', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
      mockBytesDecoder.receivePart.mockReturnValue(true);
      mockBytesDecoder.estimatedPercentComplete.mockReturnValue(0.33);
      mockBytesDecoder.expectedPartCount.mockReturnValue(3);
      mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
      mockBytesDecoder.isComplete.mockReturnValue(false);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:bytes/1-3/...' }]);
      });

      expect(result.current.urProgress).toBe(33);
      expect(result.current.scanResult).toBeNull();
    });

    it('should handle ur:bytes decode failure', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
      mockBytesDecoder.receivePart.mockReturnValue(true);
      mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockBytesDecoder.expectedPartCount.mockReturnValue(1);
      mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
      mockBytesDecoder.isComplete.mockReturnValue(true);
      mockBytesDecoder.isSuccess.mockReturnValue(false);
      mockBytesDecoder.resultError.mockReturnValue('Bytes decode error');

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:bytes/...' }]);
      });

      expect(result.current.error).toContain('UR bytes decode failed');
    });

    it('should handle ur:bytes content extraction failure', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
      mockBytesDecoder.receivePart.mockReturnValue(true);
      mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockBytesDecoder.expectedPartCount.mockReturnValue(1);
      mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
      mockBytesDecoder.isComplete.mockReturnValue(true);
      mockBytesDecoder.isSuccess.mockReturnValue(true);
      mockBytesDecoder.resultUR.mockReturnValue({
        decodeCBOR: () => new TextEncoder().encode('invalid'),
      });
      (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:bytes/...' }]);
      });

      expect(result.current.error).toContain('Could not extract xpub from ur:bytes');
    });
  });

  describe('BBQr Format Processing', () => {
    it('should detect and process BBQr JSON format', () => {
      const { result } = renderHook(() => useQrScanner());

      (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockBbqrDecoder.receivePart.mockReturnValue(true);
      mockBbqrDecoder.getProgress.mockReturnValue(100);
      mockBbqrDecoder.getReceivedCount.mockReturnValue(1);
      mockBbqrDecoder.getTotalParts.mockReturnValue(1);
      mockBbqrDecoder.getFileType.mockReturnValue('J');
      mockBbqrDecoder.isComplete.mockReturnValue(true);
      mockBbqrDecoder.decode.mockReturnValue({
        data: new Uint8Array(),
        fileType: 'J',
        text: '{"xpub": "xpub6BBQr..."}',
      });
      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6BBQr...',
        fingerprint: 'BBQR1234',
        derivationPath: "m/84'/0'/0'",
        format: 'coldcard',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'B$2J01...' }]);
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6BBQr...');
      expect(result.current.scanResult?.fingerprint).toBe('BBQR1234');
    });

    it('should track progress for multi-part BBQr', () => {
      const { result } = renderHook(() => useQrScanner());

      (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockBbqrDecoder.receivePart.mockReturnValue(true);
      mockBbqrDecoder.getProgress.mockReturnValue(50);
      mockBbqrDecoder.getReceivedCount.mockReturnValue(2);
      mockBbqrDecoder.getTotalParts.mockReturnValue(4);
      mockBbqrDecoder.getFileType.mockReturnValue('J');
      mockBbqrDecoder.isComplete.mockReturnValue(false);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'B$2J04...' }]);
      });

      expect(result.current.urProgress).toBe(50);
      expect(result.current.scanResult).toBeNull();
    });

    it('should handle BBQr part rejection', () => {
      const { result } = renderHook(() => useQrScanner());

      (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockBbqrDecoder.receivePart.mockReturnValue(false);
      mockBbqrDecoder.getError.mockReturnValue('Invalid BBQr part');

      act(() => {
        result.current.handleQrScan([{ rawValue: 'B$2J01invalid...' }]);
      });

      expect(result.current.error).toContain('BBQr error');
    });

    it('should reject non-JSON BBQr file types', () => {
      const { result } = renderHook(() => useQrScanner());

      (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockBbqrDecoder.receivePart.mockReturnValue(true);
      mockBbqrDecoder.getProgress.mockReturnValue(100);
      mockBbqrDecoder.getReceivedCount.mockReturnValue(1);
      mockBbqrDecoder.getTotalParts.mockReturnValue(1);
      mockBbqrDecoder.getFileType.mockReturnValue('P');
      mockBbqrDecoder.isComplete.mockReturnValue(true);
      mockBbqrDecoder.decode.mockReturnValue({
        data: new Uint8Array(),
        fileType: 'P',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'B$2P01...' }]);
      });

      expect(result.current.error).toContain('not supported for device import');
      expect(result.current.error).toContain('JSON export format');
    });

    it('should handle BBQr JSON parsing failure', () => {
      const { result } = renderHook(() => useQrScanner());

      (isBBQr as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockBbqrDecoder.receivePart.mockReturnValue(true);
      mockBbqrDecoder.getProgress.mockReturnValue(100);
      mockBbqrDecoder.getReceivedCount.mockReturnValue(1);
      mockBbqrDecoder.getTotalParts.mockReturnValue(1);
      mockBbqrDecoder.getFileType.mockReturnValue('J');
      mockBbqrDecoder.isComplete.mockReturnValue(true);
      mockBbqrDecoder.decode.mockReturnValue({
        data: new Uint8Array(),
        fileType: 'J',
        text: '{"invalid": "no xpub"}',
      });
      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'B$2J01...' }]);
      });

      expect(result.current.error).toContain('Could not extract xpub from BBQr JSON');
    });
  });

  describe('Extracted Fields and Warnings', () => {
    it('should set extractedFields correctly for complete data', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6Complete...',
        fingerprint: 'COMP1234',
        derivationPath: "m/84'/0'/0'",
        label: 'My Wallet',
        format: 'generic',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: '{"complete": "data"}' }]);
      });

      expect(result.current.scanResult?.extractedFields).toEqual({
        xpub: true,
        fingerprint: true,
        derivationPath: true,
        label: true,
      });
    });

    it('should set extractedFields correctly for partial data', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6Partial...',
        fingerprint: '',
        derivationPath: '',
        format: 'generic',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: '{"partial": "data"}' }]);
      });

      expect(result.current.scanResult?.extractedFields).toEqual({
        xpub: true,
        fingerprint: false,
        derivationPath: false,
        label: false,
      });
    });

    it('should include warning for missing fields', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6...',
        fingerprint: '',
        derivationPath: '',
        format: 'generic',
      });
      (generateMissingFieldsWarning as ReturnType<typeof vi.fn>).mockReturnValue(
        'Missing fingerprint and derivation path'
      );

      act(() => {
        result.current.handleQrScan([{ rawValue: '{}' }]);
      });

      expect(result.current.scanResult?.warning).toBe(
        'Missing fingerprint and derivation path'
      );
    });

    it('should have no warning when all fields present', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6...',
        fingerprint: 'ABCD1234',
        derivationPath: "m/84'/0'/0'",
        format: 'generic',
      });
      (generateMissingFieldsWarning as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleQrScan([{ rawValue: '{}' }]);
      });

      expect(result.current.scanResult?.warning).toBeNull();
    });

    it('should uppercase fingerprint', () => {
      const { result } = renderHook(() => useQrScanner());

      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6...',
        fingerprint: 'abcd1234',
        derivationPath: "m/84'/0'/0'",
        format: 'generic',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: '{}' }]);
      });

      expect(result.current.scanResult?.fingerprint).toBe('ABCD1234');
    });
  });

  describe('Error Recovery', () => {
    it('should clear error on successful scan after error', () => {
      const { result } = renderHook(() => useQrScanner());

      // First, cause an error
      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue(null);

      act(() => {
        result.current.handleQrScan([{ rawValue: 'bad data' }]);
      });

      expect(result.current.error).not.toBeNull();

      // Now succeed
      (parseDeviceJson as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6Success...',
        fingerprint: 'SUCC1234',
        derivationPath: "m/84'/0'/0'",
        format: 'generic',
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'good data' }]);
      });

      expect(result.current.error).toBeNull();
      expect(result.current.scanResult?.xpub).toBe('xpub6Success...');
    });

    it('should reset decoders on error', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
      mockUrRegistryDecoder.receivePart.mockImplementation(() => {
        throw new Error('Decoder exception');
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'ur:crypto-hdkey/...' }]);
      });

      expect(result.current.error).toContain('Decoder exception');
      expect(result.current.urProgress).toBe(0);
      expect(result.current.scanning).toBe(false);
    });
  });

  describe('Case Insensitive UR Detection', () => {
    it('should detect uppercase UR format', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('crypto-hdkey');
      mockUrRegistryDecoder.receivePart.mockReturnValue(true);
      mockUrRegistryDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockUrRegistryDecoder.isComplete.mockReturnValue(true);
      mockUrRegistryDecoder.isSuccess.mockReturnValue(true);
      mockUrRegistryDecoder.resultRegistryType.mockReturnValue({});
      (extractFromUrResult as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6Upper...',
        fingerprint: 'UPPER123',
        path: "m/84'/0'/0'",
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'UR:CRYPTO-HDKEY/...' }]);
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6Upper...');
    });

    it('should detect mixed case UR format', () => {
      const { result } = renderHook(() => useQrScanner());

      (getUrType as ReturnType<typeof vi.fn>).mockReturnValue('bytes');
      mockBytesDecoder.receivePart.mockReturnValue(true);
      mockBytesDecoder.estimatedPercentComplete.mockReturnValue(1);
      mockBytesDecoder.expectedPartCount.mockReturnValue(1);
      mockBytesDecoder.receivedPartIndexes.mockReturnValue([0]);
      mockBytesDecoder.isComplete.mockReturnValue(true);
      mockBytesDecoder.isSuccess.mockReturnValue(true);
      mockBytesDecoder.resultUR.mockReturnValue({
        decodeCBOR: () => new TextEncoder().encode('{}'),
      });
      (extractFromUrBytesContent as ReturnType<typeof vi.fn>).mockReturnValue({
        xpub: 'xpub6Mixed...',
        fingerprint: 'MIXED123',
        path: "m/84'/0'/0'",
      });

      act(() => {
        result.current.handleQrScan([{ rawValue: 'Ur:Bytes/...' }]);
      });

      expect(result.current.scanResult?.xpub).toBe('xpub6Mixed...');
    });
  });
});
