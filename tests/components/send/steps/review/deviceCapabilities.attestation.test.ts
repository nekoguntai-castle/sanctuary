import { afterEach, describe, expect, it } from 'vitest';
import { OPERATOR_ATTESTED_EVIDENCE_LABEL } from '@sanctuary/shared/constants/hardwareWalletCapabilities';
import { getDeviceCapabilities } from '../../../../../src/components/send/steps/review/deviceCapabilities';
import {
  clearHardwareWalletAttestation,
  setHardwareWalletAttestation,
} from '../../../../../src/services/hardwareWallet/operatorAttestation';

const modelT = { type: 'trezor', model: 'Trezor Model T' };

describe('deviceCapabilities with operator attestation', () => {
  afterEach(() => clearHardwareWalletAttestation());

  it('keeps Trezor blocked and unlabelled without an attestation', () => {
    const capabilities = getDeviceCapabilities(modelT);
    expect(capabilities.methods).toEqual([]);
    expect(capabilities).not.toHaveProperty('evidenceLabel');
  });

  it('offers USB with the attestation label for an exact attested Trezor model', () => {
    setHardwareWalletAttestation(['trezor']);
    expect(getDeviceCapabilities(modelT)).toMatchObject({
      methods: ['usb'],
      labels: { usb: 'USB', airgap: '', qr: '' },
      evidenceLabel: OPERATOR_ATTESTED_EVIDENCE_LABEL,
    });
  });

  it('keeps an unresolved Trezor model blocked even when attested', () => {
    setHardwareWalletAttestation(['trezor']);
    const capabilities = getDeviceCapabilities({ type: 'trezor' });
    expect(capabilities.methods).toEqual([]);
    expect(capabilities).not.toHaveProperty('evidenceLabel');
  });

  it('does not enable a vendor outside the attestable set', () => {
    setHardwareWalletAttestation(['ledger']);
    expect(getDeviceCapabilities({ type: 'ledger', model: 'Ledger Nano X' }).methods).toEqual([]);
  });
});
