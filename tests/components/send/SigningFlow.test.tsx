import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type React from 'react';
import { describe,expect,it,vi } from 'vitest';
import { SigningFlow } from '../../../src/components/send/steps/review/SigningFlow';
import type { Device } from '../../../src/types';

vi.mock('../../../src/components/send/steps/review/deviceCapabilities', () => ({
  getDeviceCapabilities: ({ type }: { type?: string }) => {
    if (type === 'blocked') {
      return { methods: [], labels: {}, blockedReason: 'No reviewed evidence.' };
    }
    if (type === 'blocked-without-reason') {
      return { methods: [], labels: {}, blockedReason: '' };
    }
    if (type === 'coldcard') {
      return { methods: ['airgap'], labels: {}, blockedReason: '' };
    }
    if (type === 'passport') {
      return { methods: ['qr', 'airgap'], labels: {}, blockedReason: '' };
    }
    return { methods: ['usb'], labels: {}, blockedReason: '' };
  },
}));

const createDevice = (overrides: Partial<Device> = {}): Device => ({
  id: 'device-1',
  type: 'ledger',
  label: 'Ledger',
  fingerprint: 'ABCD1234',
  ...overrides,
});

function renderSigningFlow(overrides: Partial<React.ComponentProps<typeof SigningFlow>> = {}) {
  const defaultProps: React.ComponentProps<typeof SigningFlow> = {
    devices: [createDevice()],
    signedDevices: new Set<string>(),
    requiredSignatures: 2,
    unsignedPsbt: 'unsigned-psbt',
    signingDeviceId: null,
    uploadingDeviceId: null,
    signing: false,
    onSignWithDevice: undefined,
    onMarkDeviceSigned: vi.fn(),
    onDownloadPsbt: vi.fn(),
    onDeviceFileUpload: vi.fn(),
    setSigningDeviceId: vi.fn(),
    setQrSigningDevice: vi.fn(),
    deviceFileInputRefs: { current: {} },
  };

  const props = { ...defaultProps, ...overrides };
  return {
    ...render(<SigningFlow {...props} />),
    props,
  };
}

describe('SigningFlow', () => {
  it('shows the manifest reason instead of signing controls when blocked', () => {
    renderSigningFlow({ devices: [createDevice({ type: 'blocked' })] });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Signing unavailable: No reviewed evidence.',
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a fail-closed fallback when a blocked row has no reason', () => {
    renderSigningFlow({ devices: [createDevice({ type: 'blocked-without-reason' })] });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Signing unavailable: No reviewed capability evidence is available.',
    );
  });

  it('renders signature progress and signed state', () => {
    const signedDevice = createDevice({ id: 'ledger-1', label: 'Signed Ledger', type: 'ledger' });
    const unsignedDevice = createDevice({ id: 'coldcard-1', label: 'Coldcard', type: 'coldcard' });

    renderSigningFlow({
      devices: [signedDevice, unsignedDevice],
      signedDevices: new Set<string>(['ledger-1']),
      requiredSignatures: 2,
    });

    expect(screen.getByText('1 of 2')).toBeInTheDocument();
    expect(screen.getByText('Signed Ledger')).toBeInTheDocument();
    expect(screen.getByText('Signed')).toBeInTheDocument();
    expect(screen.getByText('Coldcard')).toBeInTheDocument();
  });

  it('uses USB signing callback when available and clears signing id', async () => {
    const user = userEvent.setup();
    const device = createDevice({ id: 'ledger-1', type: 'ledger' });
    const onSignWithDevice = vi.fn().mockResolvedValue(true);
    const setSigningDeviceId = vi.fn();

    renderSigningFlow({
      devices: [device],
      onSignWithDevice,
      setSigningDeviceId,
    });

    await user.click(screen.getByRole('button', { name: 'USB' }));

    await waitFor(() => {
      expect(onSignWithDevice).toHaveBeenCalledWith(device);
    });
    expect(setSigningDeviceId).toHaveBeenNthCalledWith(1, 'ledger-1');
    expect(setSigningDeviceId).toHaveBeenLastCalledWith(null);
  });

  it('marks device signed when USB callback is not provided', async () => {
    const user = userEvent.setup();
    const onMarkDeviceSigned = vi.fn();

    renderSigningFlow({
      devices: [createDevice({ id: 'ledger-1', type: 'ledger' })],
      onSignWithDevice: undefined,
      onMarkDeviceSigned,
    });

    await user.click(screen.getByRole('button', { name: 'USB' }));

    expect(onMarkDeviceSigned).toHaveBeenCalledWith('ledger-1');
  });

  it('shows QR action only when unsigned PSBT is present', async () => {
    const user = userEvent.setup();
    const passport = createDevice({ id: 'passport-1', type: 'passport', label: 'Passport' });
    const setQrSigningDevice = vi.fn();

    const { rerender, props } = renderSigningFlow({
      devices: [passport],
      unsignedPsbt: null,
      setQrSigningDevice,
    });

    expect(screen.queryByRole('button', { name: 'QR Code' })).not.toBeInTheDocument();

    rerender(
      <SigningFlow
        {...props}
        unsignedPsbt="unsigned-psbt"
      />
    );

    await user.click(screen.getByRole('button', { name: 'QR Code' }));
    expect(setQrSigningDevice).toHaveBeenCalledWith(passport);
  });

  it('handles air-gapped download/upload actions and stores file input ref', async () => {
    const user = userEvent.setup();
    const device = createDevice({ id: 'coldcard-1', type: 'coldcard', label: 'Coldcard' });
    const onDownloadPsbt = vi.fn();
    const onDeviceFileUpload = vi.fn();
    const deviceFileInputRefs = { current: {} as Record<string, HTMLInputElement | null> };

    const { container } = renderSigningFlow({
      devices: [device],
      onDownloadPsbt,
      onDeviceFileUpload,
      deviceFileInputRefs,
    });

    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(onDownloadPsbt).toHaveBeenCalledTimes(1);

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    expect(deviceFileInputRefs.current['coldcard-1']).toBe(fileInput);

    const file = new File(['signed psbt'], 'signed.psbt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(onDeviceFileUpload).toHaveBeenCalledTimes(1);
    expect(onDeviceFileUpload.mock.calls[0][1]).toBe('coldcard-1');
  });

  it('disables action buttons while signing or uploading', () => {
    const signingDevice = createDevice({ id: 'ledger-1', type: 'ledger' });
    const uploadDevice = createDevice({ id: 'coldcard-1', type: 'coldcard' });

    const { rerender, props } = renderSigningFlow({
      devices: [signingDevice],
      signingDeviceId: 'ledger-1',
      signing: false,
    });

    expect(screen.getByRole('button', { name: 'Signing...' })).toBeDisabled();

    rerender(
      <SigningFlow
        {...props}
        signingDeviceId={null}
        signing={true}
      />
    );

    expect(screen.getByRole('button', { name: 'USB' })).toBeDisabled();

    rerender(
      <SigningFlow
        {...props}
        devices={[uploadDevice]}
        signing={false}
        uploadingDeviceId="coldcard-1"
      />
    );

    const uploadControl = screen.getByText('Upload');
    expect(uploadControl.className).toContain('opacity-50');
  });
});
