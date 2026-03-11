import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QrScanStep } from '../../../components/ImportWallet/steps/QrScanStep';

let scannerProps: {
  onScan: (result: { rawValue: string }[]) => void;
  onError: (error: unknown) => void;
} | null = null;

let secureContext = true;

const mockDecoderFactory = vi.fn();
let mockDecoderInstance: {
  receivePart: ReturnType<typeof vi.fn>;
  estimatedPercentComplete: ReturnType<typeof vi.fn>;
  isComplete: ReturnType<typeof vi.fn>;
  isSuccess: ReturnType<typeof vi.fn>;
  resultError: ReturnType<typeof vi.fn>;
  resultUR: ReturnType<typeof vi.fn>;
};

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: (props: typeof scannerProps) => {
    scannerProps = props;
    return <div data-testid="qr-scanner" />;
  },
}));

vi.mock('@ngraveio/bc-ur', () => ({
  URDecoder: function MockURDecoder(this: unknown) {
    return mockDecoderFactory();
  },
}));

vi.mock('../../../services/hardwareWallet/environment', () => ({
  isSecureContext: () => secureContext,
}));

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

interface RenderOptions {
  cameraActive?: boolean;
  cameraError?: string | null;
  urProgress?: number;
  qrScanned?: boolean;
  validationError?: string | null;
}

function createDecoder() {
  return {
    receivePart: vi.fn(),
    estimatedPercentComplete: vi.fn().mockReturnValue(0),
    isComplete: vi.fn().mockReturnValue(false),
    isSuccess: vi.fn().mockReturnValue(true),
    resultError: vi.fn().mockReturnValue(null),
    resultUR: vi.fn().mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode('{"type":"single_sig"}'),
    }),
  };
}

function renderQrScanStep(options: RenderOptions = {}) {
  const props = {
    cameraActive: options.cameraActive ?? false,
    setCameraActive: vi.fn(),
    cameraError: options.cameraError ?? null,
    setCameraError: vi.fn(),
    urProgress: options.urProgress ?? 0,
    setUrProgress: vi.fn(),
    qrScanned: options.qrScanned ?? false,
    setQrScanned: vi.fn(),
    setImportData: vi.fn(),
    validationError: options.validationError ?? null,
    setValidationError: vi.fn(),
    bytesDecoderRef: { current: null as any },
  };

  render(<QrScanStep {...props} />);
  return props;
}

describe('QrScanStep', () => {
  const getScannerProps = () => {
    expect(scannerProps).toEqual(
      expect.objectContaining({
        onScan: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    return scannerProps as NonNullable<typeof scannerProps>;
  };

  beforeEach(() => {
    scannerProps = null;
    secureContext = true;
    mockDecoderInstance = createDecoder();
    mockDecoderFactory.mockImplementation(() => mockDecoderInstance);
  });

  it('renders start state and enables camera from CTA', async () => {
    const user = userEvent.setup();
    secureContext = false;
    const props = renderQrScanStep({ cameraActive: false });

    expect(screen.getByText('Scan Wallet QR Code')).toBeInTheDocument();
    expect(screen.getByText(/Camera access requires HTTPS/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start Camera' }));

    expect(props.setCameraActive).toHaveBeenCalledWith(true);
    expect(props.setCameraError).toHaveBeenCalledWith(null);
  });

  it('maps camera errors to user-friendly messages', () => {
    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    const deniedError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    qrScanner.onError(deniedError);
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.setCameraError).toHaveBeenCalledWith(
      'Camera access denied. Please allow camera permissions and try again.',
    );

    const notFoundError = Object.assign(new Error('missing'), { name: 'NotFoundError' });
    qrScanner.onError(notFoundError);
    expect(props.setCameraError).toHaveBeenCalledWith('No camera found on this device.');

    qrScanner.onError('unexpected');
    expect(props.setCameraError).toHaveBeenCalledWith(
      'Failed to access camera. Make sure you are using HTTPS.',
    );

    qrScanner.onError(new Error('camera exploded'));
    expect(props.setCameraError).toHaveBeenCalledWith('Camera error: camera exploded');
  });

  it('ignores empty scan payloads', () => {
    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    qrScanner.onScan([]);
    expect(props.setCameraActive).not.toHaveBeenCalledWith(false);
    expect(props.setImportData).not.toHaveBeenCalled();
    expect(props.setValidationError).not.toHaveBeenCalled();
  });

  it('parses direct JSON and descriptor scans', () => {
    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    const jsonContent = '{"type":"single_sig","scriptType":"native_segwit"}';
    qrScanner.onScan([{ rawValue: jsonContent }]);
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.setImportData).toHaveBeenCalledWith(jsonContent);
    expect(props.setQrScanned).toHaveBeenCalledWith(true);

    vi.clearAllMocks();
    const descriptor = 'wpkh([a1b2c3d4/84h/0h/0h]xpub123/0/*)';
    qrScanner.onScan([{ rawValue: descriptor }]);
    expect(props.setImportData).toHaveBeenCalledWith(descriptor);
    expect(props.setQrScanned).toHaveBeenCalledWith(true);
  });

  it('reports invalid and unknown non-UR scan payloads', () => {
    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    qrScanner.onScan([{ rawValue: '{invalid' }]);
    expect(props.setValidationError).toHaveBeenCalledWith('Invalid JSON in QR code');

    qrScanner.onScan([{ rawValue: 'plain text payload' }]);
    expect(props.setValidationError).toHaveBeenCalledWith(
      'QR code format not recognized. Please use a wallet export QR code.',
    );
  });

  it('handles unsupported UR types', () => {
    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    qrScanner.onScan([{ rawValue: 'ur:crypto-hdkey/abcd' }]);
    expect(props.setValidationError).toHaveBeenCalledWith(
      'Unsupported UR type: crypto-hdkey. Please export as JSON or output descriptor.',
    );

    qrScanner.onScan([{ rawValue: 'ur:/malformed' }]);
    expect(props.setValidationError).toHaveBeenCalledWith(
      'Unsupported UR type: unknown. Please export as JSON or output descriptor.',
    );
  });

  it('tracks progress for incomplete ur:bytes scans', async () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(0.42);
    mockDecoderInstance.isComplete.mockReturnValue(false);

    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    await qrScanner.onScan([{ rawValue: 'ur:bytes/part-1' }]);

    expect(mockDecoderFactory).toHaveBeenCalledTimes(1);
    expect(props.setUrProgress).toHaveBeenCalledWith(42);
    expect(props.setCameraActive).not.toHaveBeenCalledWith(false);
  });

  it('reuses existing bytes decoder when present', async () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(0.4);
    mockDecoderInstance.isComplete.mockReturnValue(false);

    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    props.bytesDecoderRef.current = mockDecoderInstance as any;
    mockDecoderFactory.mockClear();
    await qrScanner.onScan([{ rawValue: 'ur:bytes/part-2' }]);

    expect(mockDecoderFactory).not.toHaveBeenCalled();
    expect(mockDecoderInstance.receivePart).toHaveBeenCalledWith('ur:bytes/part-2');
  });

  it('completes ur:bytes scan and decodes imported data', async () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(1);
    mockDecoderInstance.isComplete.mockReturnValue(true);
    mockDecoderInstance.isSuccess.mockReturnValue(true);
    mockDecoderInstance.resultUR.mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode('{"type":"single_sig"}'),
    });

    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    await qrScanner.onScan([{ rawValue: 'ur:bytes/complete' }]);

    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.setImportData).toHaveBeenCalledWith('{"type":"single_sig"}');
    expect(props.setQrScanned).toHaveBeenCalledWith(true);
    expect(props.setUrProgress).toHaveBeenCalledWith(100);
    expect(props.setUrProgress).toHaveBeenCalledWith(0);
    expect(props.bytesDecoderRef.current).toBeNull();
  });

  it('handles ur:bytes decode failures and clears decoder ref', async () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(1);
    mockDecoderInstance.isComplete.mockReturnValue(true);
    mockDecoderInstance.isSuccess.mockReturnValue(false);
    mockDecoderInstance.resultError.mockReturnValue('bad checksum');

    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    await qrScanner.onScan([{ rawValue: 'ur:bytes/fail' }]);

    expect(props.setValidationError).toHaveBeenCalledWith(
      'UR decode failed: bad checksum',
    );
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.bytesDecoderRef.current).toBeNull();
  });

  it('uses fallback error text when ur:bytes decoder has no error message', async () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(1);
    mockDecoderInstance.isComplete.mockReturnValue(true);
    mockDecoderInstance.isSuccess.mockReturnValue(false);
    mockDecoderInstance.resultError.mockReturnValue(null);

    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    await qrScanner.onScan([{ rawValue: 'ur:bytes/fail-no-message' }]);
    expect(props.setValidationError).toHaveBeenCalledWith('UR decode failed: unknown error');
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
  });

  it('handles non-Error UR decode throws with generic message', async () => {
    mockDecoderInstance.receivePart.mockImplementation(() => {
      throw 'decoder panic';
    });

    const props = renderQrScanStep({ cameraActive: true });
    const qrScanner = getScannerProps();

    await qrScanner.onScan([{ rawValue: 'ur:bytes/throws-string' }]);
    expect(props.setValidationError).toHaveBeenCalledWith('Failed to decode QR code');
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.bytesDecoderRef.current).toBeNull();
  });

  it('supports camera close and retry flows', async () => {
    const user = userEvent.setup();

    const activeProps = renderQrScanStep({ cameraActive: true, urProgress: 50 });
    await user.click(screen.getByRole('button'));
    expect(activeProps.setCameraActive).toHaveBeenCalledWith(false);
    expect(activeProps.setUrProgress).toHaveBeenCalledWith(0);
    expect(activeProps.bytesDecoderRef.current).toBeNull();

    const retryProps = renderQrScanStep({
      cameraActive: false,
      cameraError: 'Camera failed',
    });
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(retryProps.setCameraActive).toHaveBeenCalledWith(true);
    expect(retryProps.setCameraError).toHaveBeenCalledWith(null);
  });

  it('renders success and validation states from props', () => {
    renderQrScanStep({
      qrScanned: true,
      validationError: 'Validation failed',
    });

    expect(screen.getByText('QR Code Scanned Successfully')).toBeInTheDocument();
    expect(screen.getByText('Validation failed')).toBeInTheDocument();
  });
});
