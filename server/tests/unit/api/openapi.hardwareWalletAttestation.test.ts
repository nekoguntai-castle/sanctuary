/**
 * The user object returned by GET /auth/me and the login, register and 2FA
 * verify session bodies documents the optional per-instance operator
 * attestation (docs/plans/trezor-connect-10-migration.md §9c).
 */
import { describe, expect, it } from 'vitest';
import {
  OPERATOR_ATTESTABLE_HARDWARE_WALLET_VENDORS,
  OPERATOR_ATTESTED_EVIDENCE_LABEL,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';

import { openApiSpec } from '../../../src/api/openapi/spec';

describe('OpenAPI hardware wallet attestation contract', () => {
  it('documents the optional attestation on the user object', () => {
    const { User, HardwareWalletAttestation, LoginResponse } = openApiSpec.components.schemas;

    expect(User.properties.hardwareWalletAttestation).toEqual({
      $ref: '#/components/schemas/HardwareWalletAttestation',
    });
    expect(User.required).not.toContain('hardwareWalletAttestation');
    expect(LoginResponse.properties.user).toEqual({ $ref: '#/components/schemas/User' });
    expect(HardwareWalletAttestation.required).toEqual(['vendors', 'label']);
    expect(HardwareWalletAttestation.properties.vendors.items.enum).toEqual([
      ...OPERATOR_ATTESTABLE_HARDWARE_WALLET_VENDORS,
    ]);
    expect(HardwareWalletAttestation.properties.label.enum).toEqual([OPERATOR_ATTESTED_EVIDENCE_LABEL]);
  });
});
