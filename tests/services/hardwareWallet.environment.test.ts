import { afterEach,describe,expect,it,vi } from 'vitest';
import {
isHardwareWalletSupported,
isSecureContext,
isWebUSBSupported,
} from '../../src/services/hardwareWallet/environment';

describe('hardwareWallet environment helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('handles missing globals defensively', () => {
    vi.stubGlobal('navigator', undefined);
    vi.stubGlobal('window', undefined);

    expect(isWebUSBSupported()).toBe(false);
    expect(isSecureContext()).toBe(false);
    expect(isHardwareWalletSupported()).toBe(false);
  });

  it('detects support based on WebUSB + secure context', () => {
    vi.stubGlobal('navigator', { usb: {} });
    vi.stubGlobal('window', { isSecureContext: true });

    expect(isWebUSBSupported()).toBe(true);
    expect(isSecureContext()).toBe(true);
    expect(isHardwareWalletSupported()).toBe(true);
  });

  it('returns false when either capability is missing', () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('window', { isSecureContext: true });
    expect(isHardwareWalletSupported()).toBe(false);

    vi.stubGlobal('navigator', { usb: {} });
    vi.stubGlobal('window', { isSecureContext: false });
    expect(isHardwareWalletSupported()).toBe(false);
  });
});
