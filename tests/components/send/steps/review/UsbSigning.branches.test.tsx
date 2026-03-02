import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { UsbSigning } from '../../../../../components/send/steps/review/UsbSigning';

describe('UsbSigning branch coverage', () => {
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
