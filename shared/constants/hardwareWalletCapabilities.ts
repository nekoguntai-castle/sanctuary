/**
 * Funds-safety capability policy for hardware-wallet integrations.
 *
 * This is deliberately checked in and fail-closed. A blocked row may only be
 * enabled in a reviewed change that also adds the row's physical evidence.
 */
export const HARDWARE_WALLET_CAPABILITY_MANIFEST_ID =
  "wallet-safety-v1-2026-08-09" as const;

export const HARDWARE_WALLET_VENDORS = [
  "ledger",
  "jade",
  "trezor",
] as const;

export type HardwareWalletVendor =
  (typeof HARDWARE_WALLET_VENDORS)[number];

export const HARDWARE_WALLET_CAPABILITIES = [
  "import",
  "account_add",
  "display",
  "sign",
  "finalize",
  "broadcast",
] as const;

export type HardwareWalletCapability =
  (typeof HARDWARE_WALLET_CAPABILITIES)[number];

export interface HardwareWalletCapabilityRow {
  id: string;
  vendor: HardwareWalletVendor;
  modelFamily: "*";
  firmwareRange: "unverified";
  appVersionRange: "unverified";
  sdkVersionRange: "unverified";
  transport: "any";
  derivationNetworkFamily: "any";
  chainEnvironment: "any";
  policy: "any";
  accountRange: "any";
  capability: HardwareWalletCapability;
  enabled: false;
  evidenceTier: "unverified";
  evidenceIds: readonly [];
  freshness: {
    status: "unverified";
    checkedAt: null;
    expiresAt: null;
  };
  reason: string;
}

const BLOCK_REASONS: Record<HardwareWalletVendor, string> = {
  ledger:
    "Blocked pending row-specific derivation, address-display, and physical signing evidence.",
  jade:
    "Blocked pending Jade Plus identity, authentication, payload-validation, and physical-device evidence.",
  trezor:
    "Blocked pending master-fingerprint, selected-session, address-display, and raw-transaction evidence.",
};

export const HARDWARE_WALLET_CAPABILITY_ROWS: readonly HardwareWalletCapabilityRow[] =
  Object.freeze(HARDWARE_WALLET_VENDORS.flatMap((vendor) =>
    HARDWARE_WALLET_CAPABILITIES.map((capability) => Object.freeze({
      id: `${vendor}.${capability}`,
      vendor,
      modelFamily: "*" as const,
      firmwareRange: "unverified" as const,
      appVersionRange: "unverified" as const,
      sdkVersionRange: "unverified" as const,
      transport: "any" as const,
      derivationNetworkFamily: "any" as const,
      chainEnvironment: "any" as const,
      policy: "any" as const,
      accountRange: "any" as const,
      capability,
      enabled: false as const,
      evidenceTier: "unverified" as const,
      evidenceIds: [] as const,
      freshness: Object.freeze({
        status: "unverified" as const,
        checkedAt: null,
        expiresAt: null,
      }),
      reason: BLOCK_REASONS[vendor],
    })),
  ));
