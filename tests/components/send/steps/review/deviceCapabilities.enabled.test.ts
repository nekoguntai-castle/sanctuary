import { describe, expect, it, vi } from 'vitest';

vi.mock('@sanctuary/shared/constants/hardwareWalletCapabilities', () => ({
  getHardwareWalletCapabilityRow: ({ type, model }: { type?: string; model?: string }) => model ? ({
    vendor: type,
    enabled: true,
    reason: 'verified fixture',
  }) : ({
    vendor: type,
    enabled: false,
    reason: 'unresolved identity',
  }),
}));

import { getDeviceCapabilities } from '../../../../../src/components/send/steps/review/deviceCapabilities';

describe('enabled device capabilities', () => {
  it.each([
    ['ledger', ['usb'], { usb: 'USB', airgap: '', qr: '' }],
    ['coldcard', ['airgap'], { usb: '', airgap: 'PSBT File', qr: '' }],
    ['keystone', ['qr', 'airgap'], { usb: '', airgap: 'PSBT File', qr: 'QR Code' }],
  ] as const)('exposes only the reviewed methods for exact %s models', (vendor, methods, labels) => {
    expect(getDeviceCapabilities({ type: vendor, model: `${vendor}-model` })).toEqual({
      methods,
      labels,
      blockedReason: 'verified fixture',
    });
  });

  it('keeps an unresolved vendor identity blocked even when an exact row could be enabled', () => {
    expect(getDeviceCapabilities({ type: 'ledger' })).toEqual({
      methods: [],
      labels: { usb: '', airgap: '', qr: '' },
      blockedReason: 'unresolved identity',
    });
  });
});
