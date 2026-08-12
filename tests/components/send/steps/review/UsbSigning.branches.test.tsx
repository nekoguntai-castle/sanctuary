import { fireEvent,render,screen } from '@testing-library/react';
import { describe,expect,it,vi } from 'vitest';
import { UsbSigning } from '../../../../../src/components/send/steps/review/UsbSigning';

vi.mock('../../../../../src/components/send/steps/review/deviceCapabilities', () => ({
  getDeviceCapabilities: (type: string) => type === 'blocked'
    ? { methods: [], labels: {}, blockedReason: 'Physical evidence is missing.' }
    : type === 'coldcard'
    ? { methods: ['airgap'], labels: {}, blockedReason: '' }
    : { methods: ['usb'], labels: {}, blockedReason: '' },
}));

describe('UsbSigning branch coverage', () => {
  it('shows the product-visible manifest reason when every signer is blocked', () => {
    render(
      <UsbSigning
        devices={[{ id: 'dev-blocked', type: 'blocked', label: 'Unverified signer' } as any]}
        signedDevices={new Set()}
        signingDeviceId={null}
        signing={false}
        onFileUpload={vi.fn()}
        setSigningDeviceId={vi.fn()}
        setQrSigningDevice={vi.fn()}
        fileInputRef={{ current: null }}
      />
    );

    expect(screen.getByText('Hardware-wallet signing is temporarily unavailable.'))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Unverified signer: Physical evidence is missing.',
    );
  });

  it('does not set signing state when onSignWithDevice is missing', () => {
    const setSigningDeviceId = vi.fn();
    const fileInput = document.createElement('input');

    render(
      <UsbSigning
        devices={[{ id: 'dev-1', type: 'ledger', label: 'Ledger' } as any]}
        signedDevices={new Set()}
        unsignedPsbt="cHNidP8BAFICAAAA"
        signingDeviceId={null}
        signing={false}
        onDownloadPsbt={vi.fn()}
        onFileUpload={vi.fn()}
        setSigningDeviceId={setSigningDeviceId}
        setQrSigningDevice={vi.fn()}
        fileInputRef={{ current: fileInput }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /USB \(Ledger\)/i }));
    expect(setSigningDeviceId).not.toHaveBeenCalled();
  });

  it('clicks hidden file input when uploading a signed PSBT', () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');

    render(
      <UsbSigning
        devices={[{ id: 'dev-2', type: 'coldcard', label: 'Coldcard' } as any]}
        signedDevices={new Set()}
        unsignedPsbt="cHNidP8BAFICAAAA"
        signingDeviceId={null}
        signing={false}
        onDownloadPsbt={vi.fn()}
        onFileUpload={vi.fn()}
        setSigningDeviceId={vi.fn()}
        setQrSigningDevice={vi.fn()}
        fileInputRef={{ current: null }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /upload signed/i }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
