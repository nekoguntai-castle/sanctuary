import { describe,expect,it } from 'vitest';
import { getDeviceCapabilities } from '../../../../../src/components/send/steps/review/deviceCapabilities';

describe('deviceCapabilities branch coverage', () => {
  it.each([
    'passport', 'foundation', 'keystone 3 pro', 'seedsigner',
    'Coldcard Mk4', 'Ledger Nano X', 'BitBox02', 'Unknown Device', '',
  ])('advertises no signing method for blocked identity %s', (identity) => {
    expect(getDeviceCapabilities(identity)).toMatchObject({
      methods: [],
      labels: { usb: '', airgap: '', qr: '' },
      blockedReason: expect.any(String),
    });
  });
});
