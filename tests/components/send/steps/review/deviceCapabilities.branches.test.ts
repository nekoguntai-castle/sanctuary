import { describe, expect, it } from 'vitest';
import { getDeviceCapabilities } from '../../../../../components/send/steps/review/deviceCapabilities';

describe('deviceCapabilities branch coverage', () => {
  it('covers all special-case branches inside the air-gapped QR condition chain', () => {
    expect(getDeviceCapabilities('passport')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });

    expect(getDeviceCapabilities('foundation')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });

    expect(getDeviceCapabilities('keystone 3 pro')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });

    expect(getDeviceCapabilities('seedsigner')).toEqual({
      methods: ['qr', 'airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: 'QR Code' },
    });
  });

  it('covers coldcard, usb-only, and default fallback branches', () => {
    expect(getDeviceCapabilities('Coldcard Mk4')).toEqual({
      methods: ['airgap'],
      labels: { usb: '', airgap: 'PSBT File', qr: '' },
    });

    expect(getDeviceCapabilities('Ledger Nano X')).toEqual({
      methods: ['usb'],
      labels: { usb: 'USB', airgap: '', qr: '' },
    });

    expect(getDeviceCapabilities('Unknown Device')).toEqual({
      methods: ['usb', 'airgap'],
      labels: { usb: 'USB', airgap: 'PSBT File', qr: '' },
    });
  });
});
