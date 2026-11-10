/**
 * Per-instance operator attestation, as reported by GET /auth/me
 * (docs/plans/trezor-connect-10-migration.md §9c).
 *
 * The client only mirrors what the server reports for the signed-in session.
 * The list starts empty, is replaced on each user payload and is cleared on
 * logout, so any missing or malformed field fails closed.
 */

import {
  OPERATOR_ATTESTED_EVIDENCE_LABEL,
  resolveHardwareWalletCapability,
  type HardwareWalletCapability,
  type HardwareWalletIdentity,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';

let attestedVendors: readonly string[] = Object.freeze([]);

export function setHardwareWalletAttestation(vendors: readonly string[]): void {
  attestedVendors = Object.freeze(vendors.filter((vendor) => typeof vendor === 'string'));
}

export function getAttestedHardwareWalletVendors(): readonly string[] {
  return attestedVendors;
}

export function clearHardwareWalletAttestation(): void {
  setHardwareWalletAttestation([]);
}

/** Mirror the optional `hardwareWalletAttestation` field of a user payload. */
export function applyHardwareWalletAttestationFromUser(user: object | null | undefined): void {
  type AttestationPayload = { hardwareWalletAttestation?: { vendors?: unknown } | null };
  const vendors = (user as AttestationPayload | null | undefined)?.hardwareWalletAttestation?.vendors;
  setHardwareWalletAttestation(Array.isArray(vendors) ? vendors : []);
}

/** The evidence label to show when this instance's attestation enables the row. */
export function getOperatorAttestationLabel(
  identity: HardwareWalletIdentity,
  capability: HardwareWalletCapability,
): string | undefined {
  const resolved = resolveHardwareWalletCapability(identity, capability, attestedVendors);
  return resolved.evidence === 'operator-attested' ? OPERATOR_ATTESTED_EVIDENCE_LABEL : undefined;
}
