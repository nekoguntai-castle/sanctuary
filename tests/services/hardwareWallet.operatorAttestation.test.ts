import { afterEach, describe, expect, it } from 'vitest';
import { OPERATOR_ATTESTED_EVIDENCE_LABEL } from '@sanctuary/shared/constants/hardwareWalletCapabilities';
import {
  applyHardwareWalletAttestationFromUser,
  clearHardwareWalletAttestation,
  getAttestedHardwareWalletVendors,
  getOperatorAttestationLabel,
  setHardwareWalletAttestation,
} from '../../src/services/hardwareWallet/operatorAttestation';

const modelT = { type: 'trezor', model: 'Trezor Model T' };

describe('operator attestation store', () => {
  afterEach(() => clearHardwareWalletAttestation());

  it('starts empty', () => {
    expect(getAttestedHardwareWalletVendors()).toEqual([]);
    expect(getOperatorAttestationLabel(modelT, 'import')).toBeUndefined();
  });

  it('stores a frozen copy of the vendor list and drops non-strings', () => {
    const vendors = ['trezor', 7 as unknown as string];
    setHardwareWalletAttestation(vendors);
    vendors.push('ledger');
    expect(getAttestedHardwareWalletVendors()).toEqual(['trezor']);
    expect(Object.isFrozen(getAttestedHardwareWalletVendors())).toBe(true);
  });

  it('labels only an exact attested model', () => {
    setHardwareWalletAttestation(['trezor']);
    expect(getOperatorAttestationLabel(modelT, 'import')).toBe(OPERATOR_ATTESTED_EVIDENCE_LABEL);
    expect(getOperatorAttestationLabel({ type: 'trezor' }, 'import')).toBeUndefined();
  });

  it('mirrors the user payload and fails closed on a missing or malformed field', () => {
    applyHardwareWalletAttestationFromUser({
      hardwareWalletAttestation: { vendors: ['trezor'], label: OPERATOR_ATTESTED_EVIDENCE_LABEL },
    });
    expect(getAttestedHardwareWalletVendors()).toEqual(['trezor']);

    for (const user of [
      { id: 'u1' },
      { hardwareWalletAttestation: null },
      { hardwareWalletAttestation: { vendors: 'trezor' } },
      null,
      undefined,
    ]) {
      setHardwareWalletAttestation(['trezor']);
      applyHardwareWalletAttestationFromUser(user);
      expect(getAttestedHardwareWalletVendors()).toEqual([]);
    }
  });

  it('clears the list', () => {
    setHardwareWalletAttestation(['trezor']);
    clearHardwareWalletAttestation();
    expect(getAttestedHardwareWalletVendors()).toEqual([]);
  });
});
