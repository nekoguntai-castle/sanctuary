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

vi.mock('../../../services/hardwareWallet', () => ({
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
    expect(scannerProps).toBeTruthy();

    const deniedError = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    scannerProps!.onError(deniedError);
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.setCameraError).toHaveBeenCalledWith(
      'Camera access denied. Please allow camera permissions and try again.',
    );

    const notFoundError = Object.assign(new Error('missing'), { name: 'NotFoundError' });
    scannerProps!.onError(notFoundError);
    expect(props.setCameraError).toHaveBeenCalledWith('No camera found on this device.');

    scannerProps!.onError('unexpected');
    expect(props.setCameraError).toHaveBeenCalledWith(
      'Failed to access camera. Make sure you are using HTTPS.',
    );
  });

  it('parses direct JSON and descriptor scans', () => {
    const props = renderQrScanStep({ cameraActive: true });
    expect(scannerProps).toBeTruthy();

    const jsonContent = '{"type":"single_sig","scriptType":"native_segwit"}';
    scannerProps!.onScan([{ rawValue: jsonContent }]);
    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.setImportData).toHaveBeenCalledWith(jsonContent);
    expect(props.setQrScanned).toHaveBeenCalledWith(true);

    vi.clearAllMocks();
    const descriptor = 'wpkh([a1b2c3d4/84h/0h/0h]xpub123/0/*)';
    scannerProps!.onScan([{ rawValue: descriptor }]);
    expect(props.setImportData).toHaveBeenCalledWith(descriptor);
    expect(props.setQrScanned).toHaveBeenCalledWith(true);
  });

  it('reports invalid and unknown non-UR scan payloads', () => {
    const props = renderQrScanStep({ cameraActive: true });
    expect(scannerProps).toBeTruthy();

    scannerProps!.onScan([{ rawValue: '{invalid' }]);
    expect(props.setValidationError).toHaveBeenCalledWith('Invalid JSON in QR code');

    scannerProps!.onScan([{ rawValue: 'plain text payload' }]);
    expect(props.setValidationError).toHaveBeenCalledWith(
      'QR code format not recognized. Please use a wallet export QR code.',
    );
  });

  it('handles unsupported UR types', () => {
    const props = renderQrScanStep({ cameraActive: true });
    expect(scannerProps).toBeTruthy();

    scannerProps!.onScan([{ rawValue: 'ur:crypto-hdkey/abcd' }]);
    expect(props.setValidationError).toHaveBeenCalledWith(
      'Unsupported UR type: crypto-hdkey. Please export as JSON or output descriptor.',
    );
  });

  it('tracks progress for incomplete ur:bytes scans', () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(0.42);
    mockDecoderInstance.isComplete.mockReturnValue(false);

    const props = renderQrScanStep({ cameraActive: true });
    expect(scannerProps).toBeTruthy();

    scannerProps!.onScan([{ rawValue: 'ur:bytes/part-1' }]);

    expect(mockDecoderFactory).toHaveBeenCalledTimes(1);
    expect(props.setUrProgress).toHaveBeenCalledWith(42);
    expect(props.setCameraActive).not.toHaveBeenCalledWith(false);
  });

  it('completes ur:bytes scan and decodes imported data', () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(1);
    mockDecoderInstance.isComplete.mockReturnValue(true);
    mockDecoderInstance.isSuccess.mockReturnValue(true);
    mockDecoderInstance.resultUR.mockReturnValue({
      decodeCBOR: () => new TextEncoder().encode('{"type":"single_sig"}'),
    });

    const props = renderQrScanStep({ cameraActive: true });
    expect(scannerProps).toBeTruthy();

    scannerProps!.onScan([{ rawValue: 'ur:bytes/complete' }]);

    expect(props.setCameraActive).toHaveBeenCalledWith(false);
    expect(props.setImportData).toHaveBeenCalledWith('{"type":"single_sig"}');
    expect(props.setQrScanned).toHaveBeenCalledWith(true);
    expect(props.setUrProgress).toHaveBeenCalledWith(100);
    expect(props.setUrProgress).toHaveBeenCalledWith(0);
    expect(props.bytesDecoderRef.current).toBeNull();
  });

  it('handles ur:bytes decode failures and clears decoder ref', () => {
    mockDecoderInstance.estimatedPercentComplete.mockReturnValue(1);
    mockDecoderInstance.isComplete.mockReturnValue(true);
    mockDecoderInstance.isSuccess.mockReturnValue(false);
    mockDecoderInstance.resultError.mockReturnValue('bad checksum');

    const props = renderQrScanStep({ cameraActive: true });
    expect(scannerProps).toBeTruthy();

    scannerProps!.onScan([{ rawValue: 'ur:bytes/fail' }]);

    expect(props.setValidationError).toHaveBeenCalledWith(
      'UR decode failed: bad checksum',
    );
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
});
