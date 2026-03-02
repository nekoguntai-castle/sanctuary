import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeviceDetailsForm } from '../../../components/ConnectDevice/DeviceDetailsForm';

const selectedModel = {
  id: 'model-1',
  slug: 'ledger-nano-s',
  name: 'Ledger Nano S',
  manufacturer: 'Ledger',
  connectivity: ['usb'],
  airGapped: false,
  secureElement: true,
  openSource: false,
  supportsBitcoinOnly: false,
  integrationTested: true,
} as any;

const createProps = (overrides: Record<string, unknown> = {}) => ({
  selectedModel,
  method: 'manual',
  scanned: false,
  formData: {
    label: 'My Device',
    xpub: '',
    fingerprint: '',
    derivationPath: "m/84'/0'/0'",
    parsedAccounts: [],
    selectedAccounts: new Set<number>(),
  },
  saving: false,
  error: null,
  warning: null,
  qrExtractedFields: null,
  showQrDetails: false,
  onFormDataChange: vi.fn(),
  onToggleAccount: vi.fn(),
  onToggleQrDetails: vi.fn(),
  onSave: vi.fn(),
  ...overrides,
});

describe('DeviceDetailsForm branch coverage', () => {
  it('covers scanned non-manual read-only styling and error rendering branches', () => {
    render(
      <DeviceDetailsForm
        {...createProps({
          method: 'usb',
          scanned: true,
          error: 'Save failed',
          formData: {
            label: 'Ledger',
            xpub: 'xpub123',
            fingerprint: 'A1B2C3D4',
            derivationPath: "m/84'/0'/0'",
            parsedAccounts: [],
            selectedAccounts: new Set<number>(),
          },
        })}
      />,
    );

    const fingerprintInput = screen.getByPlaceholderText('00000000');
    expect(fingerprintInput).toHaveAttribute('readonly');
    expect(fingerprintInput.className).toContain('opacity-70');

    const xpubInput = screen.getByPlaceholderText('xpub... / ypub... / zpub...');
    expect(xpubInput).toHaveAttribute('readonly');
    expect(xpubInput.className).toContain('opacity-70');

    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('covers QR details condition short-circuit branches when either condition is false', () => {
    const { rerender } = render(
      <DeviceDetailsForm
        {...createProps({
          scanned: true,
          qrExtractedFields: null,
        })}
      />,
    );

    expect(screen.queryByText('QR Import Details')).not.toBeInTheDocument();

    rerender(
      <DeviceDetailsForm
        {...createProps({
          scanned: false,
          qrExtractedFields: {
            xpub: true,
            fingerprint: true,
            derivationPath: true,
            label: true,
          },
        })}
      />,
    );

    expect(screen.queryByText('QR Import Details')).not.toBeInTheDocument();
  });

  it('covers warning and collapsed QR details branches', () => {
    const props = createProps({
      scanned: true,
      warning: 'Fingerprint was missing from QR',
      qrExtractedFields: {
        xpub: true,
        fingerprint: false,
        derivationPath: false,
        label: false,
      },
      showQrDetails: false,
    });

    render(<DeviceDetailsForm {...props} />);

    expect(screen.getByText('Fingerprint was missing from QR')).toBeInTheDocument();
    expect(screen.getByText('QR Import Details')).toBeInTheDocument();
    expect(screen.queryByText('Not in QR')).not.toBeInTheDocument();
    expect(screen.queryByText('Using default')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('QR Import Details'));
    expect(props.onToggleQrDetails).toHaveBeenCalledTimes(1);
  });

  it('covers expanded QR detail status branches for extracted and missing fields', () => {
    const { rerender } = render(
      <DeviceDetailsForm
        {...createProps({
          scanned: true,
          warning: null,
          qrExtractedFields: {
            xpub: true,
            fingerprint: false,
            derivationPath: false,
            label: false,
          },
          showQrDetails: true,
        })}
      />,
    );

    expect(screen.getAllByText('Extended Public Key').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Not in QR')).toBeInTheDocument();
    expect(screen.getByText('Using default')).toBeInTheDocument();
    expect(screen.getAllByText('From QR').length).toBeGreaterThanOrEqual(1);

    rerender(
      <DeviceDetailsForm
        {...createProps({
          scanned: true,
          warning: null,
          qrExtractedFields: {
            xpub: true,
            fingerprint: true,
            derivationPath: true,
            label: false,
          },
          showQrDetails: true,
        })}
      />,
    );

    expect(screen.getAllByText('From QR').length).toBeGreaterThanOrEqual(3);

    rerender(
      <DeviceDetailsForm
        {...createProps({
          scanned: true,
          warning: null,
          qrExtractedFields: {
            xpub: false,
            fingerprint: true,
            derivationPath: true,
            label: true,
          },
          showQrDetails: true,
        })}
      />,
    );

    expect(screen.getByText('Manual')).toBeInTheDocument();
  });
});
