import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe,expect,it,vi } from 'vitest';
import { QrScannerPanel } from '../../../components/ConnectDevice/QrScannerPanel';

const scannerPropsSpy = vi.fn();

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: (props: any) => {
    scannerPropsSpy(props);
    return <div data-testid="qr-scanner" />;
  },
}));

const baseModel = {
  id: 'passport',
  slug: 'passport',
  name: 'Passport',
  manufacturer: 'Foundation',
  connectivity: ['qr_code'],
  airGapped: true,
  secureElement: true,
  openSource: true,
  supportsBitcoinOnly: true,
  integrationTested: true,
} as any;

function createProps(overrides: Record<string, unknown> = {}) {
  return {
    selectedModel: baseModel,
    scanned: false,
    qrMode: 'camera' as const,
    cameraActive: false,
    cameraError: null,
    urProgress: 0,
    scanning: false,
    fingerprint: 'deadbeef',
    isSecure: true,
    onQrModeChange: vi.fn(),
    onCameraActiveChange: vi.fn(),
    onQrScan: vi.fn(),
    onCameraError: vi.fn(),
    onFileUpload: vi.fn(),
    onStopCamera: vi.fn(),
    ...overrides,
  };
}

describe('QrScannerPanel', () => {
  it('switches modes and starts camera from initial state', async () => {
    const user = userEvent.setup();
    const props = createProps({ isSecure: false });

    render(<QrScannerPanel {...props} />);

    expect(screen.getByText(/requires HTTPS/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Upload File/i }));
    await user.click(screen.getByRole('button', { name: /Scan with Camera/i }));
    await user.click(screen.getByRole('button', { name: /Start Camera/i }));

    expect(props.onQrModeChange).toHaveBeenCalledWith('file');
    expect(props.onQrModeChange).toHaveBeenCalledWith('camera');
    expect(props.onCameraActiveChange).toHaveBeenCalledWith(true);
  });

  it('omits the secure-origin warning when camera access is already secure', () => {
    render(<QrScannerPanel {...createProps()} />);

    expect(screen.queryByText(/requires HTTPS/i)).not.toBeInTheDocument();
  });

  it('renders active camera with scanner, progress, and stop control', async () => {
    const user = userEvent.setup();
    const props = createProps({ cameraActive: true, urProgress: 45 });
    scannerPropsSpy.mockClear();

    const { container } = render(<QrScannerPanel {...props} />);

    expect(screen.getByTestId('qr-scanner')).toBeInTheDocument();
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(screen.getByText(/Keep camera pointed at animated QR code/i)).toBeInTheDocument();
    expect(scannerPropsSpy).toHaveBeenCalled();
    const scannerProps = scannerPropsSpy.mock.calls[scannerPropsSpy.mock.calls.length - 1]![0];
    expect(scannerProps.onScan).toBe(props.onQrScan);
    expect(scannerProps.onError).toBe(props.onCameraError);
    expect(scannerProps.constraints).toEqual({ facingMode: 'environment' });
    expect(scannerProps.scanDelay).toBe(100);

    const stopButton = container.querySelector('button.absolute') as HTMLButtonElement;
    expect(stopButton).not.toBeNull();
    await user.click(stopButton);
    expect(props.onStopCamera).toHaveBeenCalledTimes(1);
  });

  it('shows positioning hint when camera is active and UR progress is zero', () => {
    const props = createProps({ cameraActive: true, urProgress: 0 });
    render(<QrScannerPanel {...props} />);

    expect(screen.getByText(/Position the QR code within the frame/i)).toBeInTheDocument();
  });

  it('hides progress and positioning copy after animated QR progress completes', () => {
    const props = createProps({ cameraActive: true, urProgress: 100 });
    render(<QrScannerPanel {...props} />);

    expect(screen.queryByText(/Scanning animated QR/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Position the QR code within the frame/i)).not.toBeInTheDocument();
  });

  it('renders camera error and retries activation', async () => {
    const user = userEvent.setup();
    const props = createProps({ cameraError: 'Camera permission denied' });

    render(<QrScannerPanel {...props} />);

    expect(screen.getByText('Camera permission denied')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Try Again/i }));
    expect(props.onCameraActiveChange).toHaveBeenCalledWith(true);
  });

  it('handles file mode upload and parsing state', () => {
    const idleProps = createProps({ qrMode: 'file', scanning: false });
    const { container, rerender } = render(<QrScannerPanel {...idleProps} />);

    expect(screen.getByText(/Upload a file containing your QR code data/i)).toBeInTheDocument();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['data'], 'qr.txt', { type: 'text/plain' })] } });
    expect(idleProps.onFileUpload).toHaveBeenCalledTimes(1);

    const scanningProps = createProps({ qrMode: 'file', scanning: true });
    rerender(<QrScannerPanel {...scanningProps} />);
    expect(screen.getByText(/Parsing file/i)).toBeInTheDocument();
  });

  it('renders success state with fingerprint and fallback fingerprint text', () => {
    const { rerender } = render(<QrScannerPanel {...createProps({ scanned: true })} />);

    expect(screen.getByText(/QR Code Scanned Successfully/i)).toBeInTheDocument();
    expect(screen.getByText(/Fingerprint: deadbeef/i)).toBeInTheDocument();

    rerender(<QrScannerPanel {...createProps({ scanned: true, fingerprint: '' })} />);
    expect(screen.getByText(/Fingerprint: Not provided/i)).toBeInTheDocument();
  });
});
