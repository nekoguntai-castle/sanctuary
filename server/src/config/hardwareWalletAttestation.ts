import {
  HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK,
  OPERATOR_ATTESTABLE_HARDWARE_WALLET_VENDORS,
  isOperatorAttestableVendor,
  type OperatorAttestableHardwareWalletVendor,
} from '@sanctuary/shared/constants/hardwareWalletCapabilities';
import type { HardwareWalletConfig } from './types';

/*
 * Per-instance operator attestation (docs/plans/trezor-connect-10-migration.md
 * §9c). The switch lives in the runtime env, which needs host access, so an
 * admin web session cannot flip it. Every irregular input fails closed to an
 * empty vendor list.
 */

export const OPERATOR_ATTESTED_VENDORS_ENV = 'HARDWARE_WALLET_OPERATOR_ATTESTED_VENDORS';
export const OPERATOR_ATTESTATION_ACK_ENV = 'HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK';

/** Longest vendor token echoed into a boot warning. */
const MAX_LOGGED_VENDOR_LENGTH = 32;

type Warn = (message: string, context: Record<string, unknown>) => void;

function parseVendorList(raw: string | undefined): string[] {
  if (!raw) return [];
  const vendors = raw
    .split(',')
    .map(vendor => vendor.trim().toLowerCase())
    .filter(vendor => vendor.length > 0);
  return [...new Set(vendors)];
}

export function buildHardwareWalletConfig(
  warn: Warn,
  env: NodeJS.ProcessEnv = process.env,
): HardwareWalletConfig {
  const requested = parseVendorList(env[OPERATOR_ATTESTED_VENDORS_ENV]);
  if (requested.length === 0) return { operatorAttestedVendors: [] };

  if (env[OPERATOR_ATTESTATION_ACK_ENV] !== HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK) {
    warn(
      `${OPERATOR_ATTESTED_VENDORS_ENV} is ignored because ${OPERATOR_ATTESTATION_ACK_ENV} is not set to the required acknowledgement`,
      { requiredAck: HARDWARE_WALLET_OPERATOR_ATTESTATION_ACK },
    );
    return { operatorAttestedVendors: [] };
  }

  const accepted = requested.filter(isOperatorAttestableVendor);
  const ignored = requested.filter(vendor => !isOperatorAttestableVendor(vendor));
  if (ignored.length > 0) {
    warn(`${OPERATOR_ATTESTED_VENDORS_ENV} names vendors that cannot be operator-attested; they stay blocked`, {
      ignoredVendors: ignored.map(vendor => vendor.slice(0, MAX_LOGGED_VENDOR_LENGTH)),
      attestableVendors: [...OPERATOR_ATTESTABLE_HARDWARE_WALLET_VENDORS],
    });
  }
  if (accepted.length > 0) {
    warn('Hardware wallet operator attestation is active; these vendors are NOT Tier 3 verified', {
      vendors: accepted,
    });
  }

  const operatorAttestedVendors: readonly OperatorAttestableHardwareWalletVendor[] =
    Object.freeze(accepted);
  return { operatorAttestedVendors };
}
