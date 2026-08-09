import {
  HARDWARE_WALLET_CAPABILITY_MANIFEST_ID,
  HARDWARE_WALLET_CAPABILITY_ROWS,
  type HardwareWalletCapability,
  type HardwareWalletVendor,
} from "@sanctuary/shared/constants/hardwareWalletCapabilities";
import { ForbiddenError } from "../errors";
import { walletRepository } from "../repositories";

interface HardwareWalletIdentity {
  type?: string | null;
  model?: string | { slug?: string | null; name?: string | null } | null;
}

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

function modelIdentity(model: HardwareWalletIdentity["model"]): string {
  if (typeof model === "string") return model;
  return `${model?.slug ?? ""} ${model?.name ?? ""}`;
}

function vendorFromText(value: string): HardwareWalletVendor | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("ledger")) return "ledger";
  if (normalized.includes("jade")) return "jade";
  if (normalized.includes("trezor")) return "trezor";
  return null;
}

const EXPLICIT_NON_TARGET_DEVICE_TYPES = new Set([
  "bitbox",
  "bitbox02",
  "coldcard",
  "keystone",
  "passport",
  "seedsigner",
  "specter",
]);

export function classifyHardwareWalletVendor(
  identity: HardwareWalletIdentity,
): HardwareWalletVendor | null {
  return (
    vendorFromText(modelIdentity(identity.model)) ??
    vendorFromText(identity.type ?? "")
  );
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
    if (EXPLICIT_NON_TARGET_DEVICE_TYPES.has(normalizedType)) {
      return { allowed: true, vendor: null, capability };
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

  const row = HARDWARE_WALLET_CAPABILITY_ROWS.find(
    (candidate) =>
      candidate.vendor === vendor && candidate.capability === capability,
  );
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
