import { beforeEach, describe, expect, it, vi } from 'vitest';
import { processBBQr } from '../../../hooks/qr/bbqrDecoder';
import * as bbqrService from '../../../services/bbqr';
import * as deviceParsers from '../../../services/deviceParsers';

const decoderInstance = vi.hoisted(() => ({
  receivePart: vi.fn(),
  getError: vi.fn(),
  getProgress: vi.fn(),
  getReceivedCount: vi.fn(),
  getTotalParts: vi.fn(),
  getFileType: vi.fn(),
  isComplete: vi.fn(),
  decode: vi.fn(),
}));

vi.mock('../../../services/bbqr', () => ({
  BBQrDecoder: vi.fn(function MockBBQrDecoder() {
    return decoderInstance;
  }),
  BBQrFileTypes: {
    J: 'JSON',
    P: 'PSBT',
  },
}));

vi.mock('../../../services/deviceParsers', () => ({
  parseDeviceJson: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('processBBQr', () => {
  const callbacks = {
    setUrProgress: vi.fn(),
    setCameraActive: vi.fn(),
    setScanning: vi.fn(),
    setError: vi.fn(),
    setScanResult: vi.fn(),
    createScanResult: vi.fn(() => ({ type: 'scan-result' })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    decoderInstance.receivePart.mockReturnValue(true);
    decoderInstance.getProgress.mockReturnValue(0.5);
    decoderInstance.getReceivedCount.mockReturnValue(1);
    decoderInstance.getTotalParts.mockReturnValue(2);
    decoderInstance.getFileType.mockReturnValue('J');
    decoderInstance.isComplete.mockReturnValue(false);
  });

  it('creates a decoder, updates progress, and returns false when assembly is incomplete', () => {
    const ref = { current: null } as any;

    const result = processBBQr('part-1', ref, callbacks);

    expect(result).toBe(false);
    expect(bbqrService.BBQrDecoder).toHaveBeenCalledTimes(1);
    expect(callbacks.setUrProgress).toHaveBeenCalledWith(0.5);
    expect(callbacks.setScanResult).not.toHaveBeenCalled();
  });

  it('reuses an existing decoder and handles unknown file type logging branch', () => {
    const ref = { current: decoderInstance } as any;
    decoderInstance.getFileType.mockReturnValueOnce(null);

    const result = processBBQr('part-2', ref, callbacks);

    expect(result).toBe(false);
    expect(bbqrService.BBQrDecoder).not.toHaveBeenCalled();
    expect(callbacks.setUrProgress).toHaveBeenCalledWith(0.5);
  });

  it('throws when a BBQr part is rejected', () => {
    const ref = { current: null } as any;
    decoderInstance.receivePart.mockReturnValue(false);
    decoderInstance.getError.mockReturnValue('bad part');

    expect(() => processBBQr('bad-part', ref, callbacks)).toThrow('BBQr error: bad part');
  });

  it('decodes complete JSON and uses fallback fingerprint/path values when absent', () => {
    const ref = { current: null } as any;
    decoderInstance.isComplete.mockReturnValue(true);
    decoderInstance.decode.mockReturnValue({ fileType: 'J', text: '{"xpub":"x"}' });
    vi.mocked(deviceParsers.parseDeviceJson).mockReturnValue({
      xpub: 'xpub6example',
      label: 'Coldcard',
    } as any);

    const result = processBBQr('final-part', ref, callbacks);

    expect(result).toBe(true);
    expect(ref.current).toBeNull();
    expect(callbacks.setCameraActive).toHaveBeenCalledWith(false);
    expect(callbacks.setScanning).toHaveBeenNthCalledWith(1, true);
    expect(callbacks.setScanning).toHaveBeenLastCalledWith(false);
    expect(callbacks.setError).toHaveBeenCalledWith(null);
    expect(callbacks.setUrProgress).toHaveBeenLastCalledWith(0);
    expect(callbacks.createScanResult).toHaveBeenCalledWith(
      'xpub6example',
      '',
      '',
      'Coldcard',
      undefined
    );
    expect(callbacks.setScanResult).toHaveBeenCalledWith({ type: 'scan-result' });
  });

  it('throws when JSON content does not include an xpub', () => {
    const ref = { current: null } as any;
    decoderInstance.isComplete.mockReturnValue(true);
    decoderInstance.decode.mockReturnValue({ fileType: 'J', text: '{"fingerprint":"abcd"}' });
    vi.mocked(deviceParsers.parseDeviceJson).mockReturnValue({ fingerprint: 'abcd1234' } as any);

    expect(() => processBBQr('final-part', ref, callbacks)).toThrow(
      'Could not extract xpub from BBQr JSON content'
    );
  });

  it('throws for unsupported BBQr file types', () => {
    const ref = { current: null } as any;
    decoderInstance.isComplete.mockReturnValue(true);
    decoderInstance.decode.mockReturnValue({ fileType: 'P', text: 'psbt-data' });

    expect(() => processBBQr('final-part', ref, callbacks)).toThrow(
      'BBQr file type "PSBT" is not supported for device import.'
    );
  });
});
