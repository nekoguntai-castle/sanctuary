import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QrImport } from '../../../../components/DeviceDetail/accounts/QrImport';

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
