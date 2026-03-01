import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QrSigning } from '../../../components/send/steps/review/QrSigning';

vi.mock('../../../components/qr', () => ({
  QRSigningModal: (props: any) => (
    <div data-testid="qr-signing-modal">
      <div>{props.psbtBase64}</div>
      <div>{props.deviceLabel}</div>
      <button onClick={props.onClose}>close-modal</button>
      <button onClick={() => props.onSignedPsbt('signed-psbt')}>submit-signed</button>
    </div>
  ),
}));

const device = { id: 'dev-1', label: 'Passport' } as any;

describe('QrSigning', () => {
  it('returns null when device or PSBT is missing', () => {
    const setQrSigningDevice = vi.fn();
    const { rerender } = render(
      <QrSigning
        qrSigningDevice={null}
        unsignedPsbt="unsigned"
        setQrSigningDevice={setQrSigningDevice}
      />,
    );
    expect(screen.queryByTestId('qr-signing-modal')).not.toBeInTheDocument();

    rerender(
      <QrSigning
        qrSigningDevice={device}
        unsignedPsbt={null}
        setQrSigningDevice={setQrSigningDevice}
      />,
    );
    expect(screen.queryByTestId('qr-signing-modal')).not.toBeInTheDocument();
  });

  it('renders modal and closes signing session', () => {
    const setQrSigningDevice = vi.fn();
    render(
      <QrSigning
        qrSigningDevice={device}
        unsignedPsbt="unsigned-psbt"
        setQrSigningDevice={setQrSigningDevice}
      />,
    );

    expect(screen.getByTestId('qr-signing-modal')).toBeInTheDocument();
    expect(screen.getByText('unsigned-psbt')).toBeInTheDocument();
    expect(screen.getByText('Passport')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-modal'));
    expect(setQrSigningDevice).toHaveBeenCalledWith(null);
  });

  it('processes signed PSBT with device id and clears session', () => {
    const setQrSigningDevice = vi.fn();
    const onProcessQrSignedPsbt = vi.fn();
    render(
      <QrSigning
        qrSigningDevice={device}
        unsignedPsbt="unsigned-psbt"
        onProcessQrSignedPsbt={onProcessQrSignedPsbt}
        setQrSigningDevice={setQrSigningDevice}
      />,
    );

    fireEvent.click(screen.getByText('submit-signed'));
    expect(onProcessQrSignedPsbt).toHaveBeenCalledWith('signed-psbt', 'dev-1');
    expect(setQrSigningDevice).toHaveBeenCalledWith(null);
  });

  it('still clears session when signed callback is omitted', () => {
    const setQrSigningDevice = vi.fn();
    render(
      <QrSigning
        qrSigningDevice={device}
        unsignedPsbt="unsigned-psbt"
        setQrSigningDevice={setQrSigningDevice}
      />,
    );

    fireEvent.click(screen.getByText('submit-signed'));
    expect(setQrSigningDevice).toHaveBeenCalledWith(null);
  });
});
