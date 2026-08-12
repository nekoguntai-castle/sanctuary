import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  classifyHardwareWalletVendor,
  getHardwareWalletCapabilityRow,
  type HardwareWalletCapability,
  type HardwareWalletIdentity,
  type HardwareWalletVendor,
} from "@sanctuary/shared/constants/hardwareWalletCapabilities";
import { ForbiddenError } from "../errors";
import { walletRepository } from "../repositories";

export type HardwareWalletCapabilityDecision =
  | {
      allowed: true;
      vendor: null;
      capability: HardwareWalletCapability;
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
