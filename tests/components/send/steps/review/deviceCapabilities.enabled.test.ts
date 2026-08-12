import { describe, expect, it, vi } from 'vitest';

vi.mock('@sanctuary/shared/constants/hardwareWalletCapabilities', () => ({
  getHardwareWalletCapabilityRow: ({ type }: { type?: string }) => ({
    vendor: type,
    enabled: true,
    reason: 'verified fixture',
  }),
}));

import { getDeviceCapabilities } from '../../../../../src/components/send/steps/review/deviceCapabilities';

describe('enabled device capabilities', () => {
  it.each([
    ['ledger', ['usb'], { usb: 'USB', airgap: '', qr: '' }],
    ['coldcard', ['airgap'], { usb: '', airgap: 'PSBT File', qr: '' }],
    ['keystone', ['qr', 'airgap'], { usb: '', airgap: 'PSBT File', qr: 'QR Code' }],
  ] as const)('exposes only the reviewed methods for %s', (vendor, methods, labels) => {
    expect(getDeviceCapabilities(vendor)).toEqual({
      methods,
      labels,
      blockedReason: 'verified fixture',
    });
  });
});
