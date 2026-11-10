import { describe, expect, it } from 'vitest';
import {
  HARDWARE_WALLET_CAPABILITIES,
  HARDWARE_WALLET_CAPABILITY_ROWS,
  isOperatorAttestableVendor,
  resolveHardwareWalletCapability,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';

const modelT = { type: 'trezor', model: 'Trezor Model T' };

describe('per-instance operator attestation', () => {
  it('leaves every capability fail-closed without an attestation', () => {
    for (const capability of HARDWARE_WALLET_CAPABILITIES) {
      expect(resolveHardwareWalletCapability(modelT, capability, [])).toMatchObject({
        enabled: false,
        evidence: 'unverified',
      });
    }
  });

  it('enables every capability of an exact model of an attested vendor', () => {
    for (const capability of HARDWARE_WALLET_CAPABILITIES) {
      const resolved = resolveHardwareWalletCapability(modelT, capability, ['trezor']);
      expect(resolved).toMatchObject({ enabled: true, evidence: 'operator-attested' });
      expect(resolved.row).toMatchObject({ vendor: 'trezor', modelFamily: 'trezor-model-t' });
    }
  });

  it('keeps an unresolved model of an attested vendor blocked', () => {
    expect(
      resolveHardwareWalletCapability({ type: 'trezor', model: null }, 'sign', ['trezor'])
    ).toMatchObject({ enabled: false, evidence: 'unverified' });
  });

  it('ignores vendors that cannot be operator-attested', () => {
    expect(isOperatorAttestableVendor('ledger')).toBe(false);
    expect(
      resolveHardwareWalletCapability({ type: 'ledger', model: 'Ledger Nano X' }, 'sign', [
        'ledger',
      ])
    ).toMatchObject({ enabled: false, evidence: 'unverified' });
  });

  it('keeps an unidentified device blocked', () => {
    expect(resolveHardwareWalletCapability({ type: 'unknown' }, 'sign', ['trezor'])).toEqual({
      row: null,
      enabled: false,
      evidence: 'unverified',
    });
  });

  it('never mutates the static Tier 3 capability rows', () => {
    resolveHardwareWalletCapability(modelT, 'sign', ['trezor']);
    expect(HARDWARE_WALLET_CAPABILITY_ROWS.every((row) => row.enabled === false)).toBe(true);
  });
});
