import { fireEvent,render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { QrImport } from '../../../../components/DeviceDetail/accounts/QrImport';
import { isSecureContext } from '../../../../services/hardwareWallet/environment';

vi.mock('@yudiel/react-qr-scanner', () => ({
  Scanner: () => <div data-testid="qr-scanner" />,
}));

vi.mock('../../../../services/hardwareWallet/environment', () => ({
  isSecureContext: vi.fn(() => true),
}));

const createProps = (
  overrides: Partial<React.ComponentProps<typeof QrImport>> = {},
): React.ComponentProps<typeof QrImport> => ({
  qrMode: 'camera',
  setQrMode: vi.fn(),
  cameraActive: true,
  setCameraActive: vi.fn(),
  cameraError: null,
  setCameraError: vi.fn(),
  urProgress: 0,
  setUrProgress: vi.fn(),
  addAccountLoading: false,
  onQrScan: vi.fn(),
  onCameraError: vi.fn(),
  onFileUpload: vi.fn(),
  urDecoderRef: { current: null },
  bytesDecoderRef: { current: null },
  ...overrides,
});

describe('QrImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isSecureContext).mockReturnValue(true);
  });

  it('switches QR modes and clears mode-specific camera state', async () => {
    const user = userEvent.setup();
    const setQrMode = vi.fn();
    const setCameraActive = vi.fn();
    const setCameraError = vi.fn();

    render(
      <QrImport
        {...createProps({
          setQrMode,
          setCameraActive,
          setCameraError,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(setQrMode).toHaveBeenCalledWith('file');
    expect(setCameraActive).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole('button', { name: 'Camera' }));
    expect(setQrMode).toHaveBeenCalledWith('camera');
    expect(setCameraError).toHaveBeenCalledWith(null);
  });

  it('covers idle camera, insecure-context warning, retry, and stop reset branches', async () => {
    const user = userEvent.setup();
    const setCameraActive = vi.fn();
    const setCameraError = vi.fn();
    const setUrProgress = vi.fn();
    const urDecoderRef = { current: { active: true } };
    const bytesDecoderRef = { current: { active: true } };

    vi.mocked(isSecureContext).mockReturnValue(false);
    const { rerender } = render(
      <QrImport
        {...createProps({
          cameraActive: false,
          setCameraActive,
          setCameraError,
        })}
      />,
    );

    expect(screen.getByText('Camera requires HTTPS')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start Camera' }));
    expect(setCameraActive).toHaveBeenCalledWith(true);
    expect(setCameraError).toHaveBeenCalledWith(null);

    rerender(
      <QrImport
        {...createProps({
          cameraActive: false,
          cameraError: 'Camera blocked',
          setCameraActive,
          setCameraError,
        })}
      />,
    );
    expect(screen.getByText('Camera blocked')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(setCameraActive).toHaveBeenCalledWith(true);

    rerender(
      <QrImport
        {...createProps({
          urProgress: 25,
          setCameraActive,
          setUrProgress,
          urDecoderRef,
          bytesDecoderRef,
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Stop camera' }));
    expect(setCameraActive).toHaveBeenCalledWith(false);
    expect(setUrProgress).toHaveBeenCalledWith(0);
    expect(urDecoderRef.current).toBeNull();
    expect(bytesDecoderRef.current).toBeNull();
  });

  it('shows animated scanning progress only for partial UR progress values', () => {
    const { rerender } = render(<QrImport {...createProps({ urProgress: 50 })} />);

    expect(screen.getByText('Scanning...')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();

    rerender(<QrImport {...createProps({ urProgress: 100 })} />);
    expect(screen.queryByText('Scanning...')).not.toBeInTheDocument();
  });

  it('covers file-mode loading and upload branches', () => {
    const onFileUpload = vi.fn();
    const { rerender, container } = render(
      <QrImport
        {...createProps({
          qrMode: 'file',
          addAccountLoading: true,
          onFileUpload,
        })}
      />
    );

    expect(screen.getByText('Parsing file...')).toBeInTheDocument();

    rerender(
      <QrImport
        {...createProps({
          qrMode: 'file',
          addAccountLoading: false,
          onFileUpload,
        })}
      />
    );

    expect(screen.getByText('Upload QR data file')).toBeInTheDocument();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    fireEvent.change(fileInput, { target: { files: [new File(['{}'], 'qr.json', { type: 'application/json' })] } });
    expect(onFileUpload).toHaveBeenCalledTimes(1);
  });
});
