import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  OPERATOR_ATTESTED_EVIDENCE_LABEL,
  classifyHardwareWalletVendor,
  getHardwareWalletCapabilityRow,
  resolveHardwareWalletCapability,
  type HardwareWalletCapability,
  type HardwareWalletIdentity,
  type HardwareWalletVendor,
  type OperatorAttestableHardwareWalletVendor,
} from "@sanctuary/shared/constants/hardwareWalletCapabilities";
import { getConfig } from "../config";
import { ForbiddenError } from "../errors";
import { walletRepository } from "../repositories";
import { createLogger } from "../utils/logger";

const log = createLogger("HW_CAPABILITY");

// The display gate runs on every address read, so each attested
// vendor/model/capability is logged once per process, not per decision.
const loggedAttestedDecisions = new Set<string>();

export type HardwareWalletCapabilityDecision =
  | {
      allowed: true;
      vendor: null;
      capability: HardwareWalletCapability;
    }
  | {
      allowed: true;
      vendor: HardwareWalletVendor;
      capability: HardwareWalletCapability;
      evidenceTier: "operator-attested";
      manifestId: typeof HARDWARE_WALLET_CAPABILITY_MANIFEST_ID;
    }
  | {
      allowed: false;
      vendor: HardwareWalletVendor | "unidentified";
      capability: HardwareWalletCapability;
      manifestId: typeof HARDWARE_WALLET_CAPABILITY_MANIFEST_ID;
      reason: string;
      evidenceTier: "unverified";
      evidenceIds: readonly [];
    };

export { classifyHardwareWalletVendor };

export interface HardwareWalletAttestationForClient {
  vendors: OperatorAttestableHardwareWalletVendor[];
  label: typeof OPERATOR_ATTESTED_EVIDENCE_LABEL;
}

/**
 * Vendors the operator attested for this instance (docs/plans/
 * trezor-connect-10-migration.md §9c). A config without the section (partial
 * test or early-boot configs) attests nothing, so the default stays blocked.
 */
export function getOperatorAttestedHardwareWalletVendors(): readonly OperatorAttestableHardwareWalletVendor[] {
  return getConfig().hardwareWallet?.operatorAttestedVendors ?? [];
}

/** The attestation state the client needs to mirror the server gate. */
export function getOperatorAttestationForClient(): HardwareWalletAttestationForClient {
  return {
    vendors: [...getOperatorAttestedHardwareWalletVendors()],
    label: OPERATOR_ATTESTED_EVIDENCE_LABEL,
  };
}

export function getHardwareWalletCapabilityDecision(
  identity: HardwareWalletIdentity,
  capability: HardwareWalletCapability,
): HardwareWalletCapabilityDecision {
  const vendor = classifyHardwareWalletVendor(identity);
  if (!vendor) {
    const normalizedType = identity.type?.trim().toLowerCase();
    if (normalizedType === "watch_only" && capability === "import") {
      return { allowed: true, vendor: null, capability };
    }
    // Unknown and unlisted hardware identities never inherit capability access.
    if (
      !normalizedType ||
      normalizedType === "unknown" ||
      normalizedType === "hardware" ||
      normalizedType === "watch_only"
    ) {
      return {
        allowed: false,
        vendor: "unidentified",
        capability,
        manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
        reason: "Blocked because hardware identity and capability evidence are unavailable.",
        evidenceTier: "unverified",
        evidenceIds: [],
      };
    }
    return {
      allowed: false,
      vendor: "unidentified",
      capability,
      manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
      reason: "Blocked because the device type is not an explicitly supported signer identity.",
      evidenceTier: "unverified",
      evidenceIds: [],
    };
  }

  const row = getHardwareWalletCapabilityRow(identity, capability);
  /* v8 ignore start -- row completeness is an exhaustive checked-in manifest invariant */
  if (!row) {
    return {
      allowed: false,
      vendor,
      capability,
      manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
      reason: "Blocked because the capability manifest row is missing.",
      evidenceTier: "unverified",
      evidenceIds: [],
    };
  }
  /* v8 ignore stop */

  const { enabled } = resolveHardwareWalletCapability(
    identity,
    capability,
    getOperatorAttestedHardwareWalletVendors(),
  );
  if (enabled) {
    // Operator-attested on this instance only; never Tier 3 evidence.
    const key = `${vendor}|${row.modelFamily}|${capability}`;
    if (!loggedAttestedDecisions.has(key)) {
      loggedAttestedDecisions.add(key);
      log.warn("Hardware wallet capability allowed by operator attestation (not Tier 3 verified)", {
        vendor,
        modelFamily: row.modelFamily,
        capability,
      });
    }
    return {
      allowed: true,
      vendor,
      capability,
      evidenceTier: "operator-attested",
      manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
    };
  }

  return {
    allowed: false,
    vendor,
    capability,
    manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
    reason: row.reason,
    evidenceTier: row.evidenceTier,
    evidenceIds: row.evidenceIds,
  };
}

export function assertHardwareWalletCapability(
  identity: HardwareWalletIdentity,
  capability: HardwareWalletCapability,
): void {
  const decision = getHardwareWalletCapabilityDecision(identity, capability);
  if (decision.allowed) return;

  throw new ForbiddenError(
    `Hardware wallet ${decision.capability} is temporarily unavailable: ${decision.reason}`,
    undefined,
    {
      vendor: decision.vendor,
      capability: decision.capability,
      manifestId: decision.manifestId,
      evidenceTier: decision.evidenceTier,
      evidenceIds: decision.evidenceIds,
    },
  );
}

export function assertWalletHardwareCapability(
  wallet: {
    devices: Array<{
      device: HardwareWalletIdentity;
    }>;
  },
  capability: HardwareWalletCapability,
): void {
  if (!Array.isArray(wallet.devices)) {
    throw new ForbiddenError(
      "Hardware wallet capability is unavailable because signer provenance is missing.",
    );
  }
  if (wallet.devices.length === 0) {
    if (capability === "account_add") return;
    throw new ForbiddenError(
      "Hardware wallet capability is unavailable because no signer provenance is linked to this wallet.",
    );
  }
  for (const { device } of wallet.devices) {
    assertHardwareWalletCapability(device, capability);
  }
}

export function assertUnscopedRawTransactionBroadcastDisabled(): never {
  throw new ForbiddenError(
    "Unscoped raw-transaction broadcast is temporarily unavailable. Use a wallet-scoped, intent-validated broadcast.",
    undefined,
    {
      capability: "broadcast",
      manifestId: HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
      source: "unscoped_raw_transaction",
    },
  );
}

export async function assertWalletHardwareCapabilityById(
  walletId: string,
  capability: HardwareWalletCapability,
): Promise<void> {
  const wallet = await walletRepository.findByIdWithDevices(walletId);
  if (!wallet) {
    throw new ForbiddenError(
      "Hardware wallet capability is unavailable because wallet signer provenance could not be loaded.",
    );
  }
  assertWalletHardwareCapability(wallet, capability);
}
