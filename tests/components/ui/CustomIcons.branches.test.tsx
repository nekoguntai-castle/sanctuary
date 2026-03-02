import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { HardwareDevice, WalletType } from '../../../types';
import {
  SatsIcon,
  SanctuaryLogo,
  getDeviceIcon,
  getWalletIcon,
} from '../../../components/ui/CustomIcons';

function iconTypeName(icon: any): string {
  if (!icon) return 'unknown';
  if (typeof icon.type === 'string') return icon.type;
  return icon.type?.displayName || icon.type?.name || 'unknown';
}

function expectSvgToRender(icon: any): void {
  const { container, unmount } = render(icon);
  expect(container.querySelector('svg')).toBeInTheDocument();
  unmount();
}

describe('CustomIcons branch coverage', () => {
  it('renders standalone exported icons', () => {
    expectSvgToRender(<SatsIcon className="sats-icon" />);
    expectSvgToRender(<SanctuaryLogo className="logo-icon" />);
  });

  it('routes wallet icon selection by wallet type', () => {
    const multisigIcon = getWalletIcon(WalletType.MULTI_SIG, 'wallet-icon');
    const singlesigIcon = getWalletIcon(WalletType.SINGLE_SIG, 'wallet-icon');

    expect(iconTypeName(multisigIcon)).toBe('MultiSigIcon');
    expect(iconTypeName(singlesigIcon)).toBe('SingleSigIcon');
    expect(multisigIcon.props.className).toBe('wallet-icon');
    expect(singlesigIcon.props.className).toBe('wallet-icon');
    expectSvgToRender(multisigIcon);
    expectSvgToRender(singlesigIcon);
  });

  it('matches device icons across enum and normalized string patterns, including default fallback', () => {
    const matrix: Array<{ type: any; expected: string }> = [
      { type: HardwareDevice.COLDCARD_MK4, expected: 'ColdCardMk4Icon' },
      { type: 'coldcard mk3', expected: 'ColdCardMk4Icon' },
      { type: HardwareDevice.COLDCARD_Q, expected: 'ColdCardQIcon' },
      { type: 'coldcard q', expected: 'ColdCardQIcon' },
      { type: HardwareDevice.TREZOR_SAFE_7, expected: 'TrezorSafe7Icon' },
      { type: 'trezor safe_7', expected: 'TrezorSafe7Icon' },
      { type: HardwareDevice.TREZOR, expected: 'TrezorIcon' },
      { type: 'trezor model t', expected: 'TrezorIcon' },
      { type: HardwareDevice.LEDGER_STAX, expected: 'LedgerStaxIcon' },
      { type: HardwareDevice.LEDGER_FLEX, expected: 'LedgerFlexIcon' },
      { type: HardwareDevice.LEDGER_GEN_5, expected: 'LedgerGen5Icon' },
      { type: 'ledger gen_5', expected: 'LedgerGen5Icon' },
      { type: HardwareDevice.LEDGER, expected: 'LedgerNanoIcon' },
      { type: 'ledger nano x', expected: 'LedgerNanoIcon' },
      { type: HardwareDevice.BITBOX, expected: 'BitBoxIcon' },
      { type: 'bitbox02', expected: 'BitBoxIcon' },
      { type: HardwareDevice.FOUNDATION_PASSPORT, expected: 'FoundationPassportIcon' },
      { type: 'foundation passport', expected: 'FoundationPassportIcon' },
      { type: HardwareDevice.BLOCKSTREAM_JADE, expected: 'BlockstreamJadeIcon' },
      { type: 'blockstream jade', expected: 'BlockstreamJadeIcon' },
      { type: HardwareDevice.KEYSTONE, expected: 'KeystoneIcon' },
      { type: 'keystone pro', expected: 'KeystoneIcon' },
      { type: 'some unknown device', expected: 'Key' },
    ];

    for (const entry of matrix) {
      const icon = getDeviceIcon(entry.type, 'device-icon');
      expect(iconTypeName(icon)).toBe(entry.expected);
      expect(icon.props.className).toBe('device-icon');
      expectSvgToRender(icon);
    }
  });

  it('handles a non-string device value by using fallback icon', () => {
    const nonStringType = { includes: () => false } as any;
    const icon = getDeviceIcon(nonStringType, 'fallback-icon');

    expect(iconTypeName(icon)).toBe('Key');
    expect(icon.props.className).toBe('fallback-icon');
    expectSvgToRender(icon);
  });
});
