/**
 * Funds-safety capability policy for hardware-wallet integrations.
 *
 * This is deliberately checked in and fail-closed. A blocked row may only be
 * enabled in a reviewed change that also adds the row's physical evidence.
 */
export const HARDWARE_WALLET_CAPABILITY_MANIFEST_ID =
  "wallet-safety-v3-2026-08-12" as const;

export const HARDWARE_WALLET_VENDORS = [
  "bitbox",
  "coldcard",
  "generic",
  "jade",
  "keystone",
  "ledger",
  "passport",
  "seedsigner",
  "specter",
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

export interface HardwareWalletIdentity {
  type?: string | null;
  model?: string | { slug?: string | null; name?: string | null } | null;
}

export interface HardwareWalletImplementationInventoryRow {
  vendor: HardwareWalletVendor;
  aliases: readonly string[];
  catalogModelSlugs: readonly string[];
  catalogModelNames: readonly string[];
}

function implementationInventoryRow(
  vendor: HardwareWalletVendor,
  aliases: string[],
  catalogModelSlugs: string[],
  catalogModelNames: string[],
): HardwareWalletImplementationInventoryRow {
  return Object.freeze({
    vendor,
    aliases: Object.freeze(aliases),
    catalogModelSlugs: Object.freeze(catalogModelSlugs),
    catalogModelNames: Object.freeze(catalogModelNames),
  });
}

/**
 * Baseline inventory of every signer family reachable through persisted device
 * types, the hardware model catalog, browser adapters, or air-gapped flows.
 * Missing and conflicting identities are deliberately not classified.
 */
export const HARDWARE_WALLET_IMPLEMENTATION_INVENTORY:
readonly HardwareWalletImplementationInventoryRow[] = Object.freeze([
  implementationInventoryRow(
    "bitbox",
    ["bitbox"],
    ["bitbox02", "bitbox02-btc-only"],
    ["BitBox02", "BitBox02 Bitcoin-only"],
  ),
  implementationInventoryRow(
    "coldcard",
    ["coldcard"],
    ["coldcard-mk4", "coldcard-q", "coldcard-mk3"],
    ["ColdCard Mk4", "ColdCard Q", "ColdCard Mk3"],
  ),
  implementationInventoryRow(
    "generic",
    ["generic"],
    ["generic-sd", "generic-usb"],
    ["Generic SD Card", "Generic USB"],
  ),
  implementationInventoryRow(
    "jade",
    ["jade"],
    ["blockstream-jade", "blockstream-jade-plus"],
    ["Blockstream Jade", "Blockstream Jade Plus"],
  ),
  implementationInventoryRow(
    "keystone",
    ["keystone"],
    ["keystone-pro", "keystone-3-pro", "keystone-essential"],
    ["Keystone Pro", "Keystone 3 Pro", "Keystone Essential"],
  ),
  implementationInventoryRow(
    "ledger",
    ["ledger"],
    ["ledger-nano-s-plus", "ledger-nano-x", "ledger-stax", "ledger-flex", "ledger-gen-5"],
    ["Ledger Nano S Plus", "Ledger Nano X", "Ledger Stax", "Ledger Flex", "Ledger Gen 5"],
  ),
  implementationInventoryRow(
    "passport",
    ["passport"],
    ["foundation-passport", "foundation-passport-batch2"],
    ["Foundation Passport", "Foundation Passport Batch 2"],
  ),
  implementationInventoryRow("seedsigner", ["seedsigner"], ["seedsigner"], ["SeedSigner"]),
  implementationInventoryRow("specter", ["specter", "specter diy"], [], []),
  implementationInventoryRow(
    "trezor",
    ["trezor"],
    ["trezor-model-one", "trezor-model-t", "trezor-safe-3", "trezor-safe-5", "trezor-safe-7"],
    ["Trezor Model One", "Trezor Model T", "Trezor Safe 3", "Trezor Safe 5", "Trezor Safe 7"],
  ),
]);

const normalizeIdentityText = (value: string): string =>
  value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const vendorForIdentityText = (
  value: string | null | undefined,
): HardwareWalletVendor | null => {
  if (!value) return null;
  const normalized = normalizeIdentityText(value);
  for (const row of HARDWARE_WALLET_IMPLEMENTATION_INVENTORY) {
    const matches = row.aliases.some(
      (alias) => normalized === normalizeIdentityText(alias),
    );
    if (matches) return row.vendor;
    const exactCatalogIdentity = [...row.catalogModelSlugs, ...row.catalogModelNames]
      .some((value) => normalizeIdentityText(value) === normalized);
    if (exactCatalogIdentity) {
      return row.vendor;
    }
  }
  return null;
};

const exactModelSlugForIdentityText = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  const normalized = normalizeIdentityText(value);
  for (const row of HARDWARE_WALLET_IMPLEMENTATION_INVENTORY) {
    const slugIndex = row.catalogModelSlugs.findIndex(
      (slug) => normalizeIdentityText(slug) === normalized,
    );
    if (slugIndex >= 0) return row.catalogModelSlugs[slugIndex];
    const nameIndex = row.catalogModelNames.findIndex(
      (name) => normalizeIdentityText(name) === normalized,
    );
    /* v8 ignore next -- catalog names/slugs are generated as aligned pairs */
    if (nameIndex >= 0) return row.catalogModelSlugs[nameIndex];
  }
  return null;
};

export function classifyHardwareWalletVendor(
  identity: HardwareWalletIdentity,
): HardwareWalletVendor | null {
  const modelValues = typeof identity.model === "string"
    ? [identity.model]
    : [identity.model?.slug, identity.model?.name];
  const recognized = new Set(
    [identity.type, ...modelValues]
      .map(vendorForIdentityText)
      .filter((vendor): vendor is HardwareWalletVendor => vendor !== null),
  );
  const exactModels = new Set(
    [identity.type, ...modelValues]
      .map(exactModelSlugForIdentityText)
      .filter((model): model is string => model !== null),
  );
  // Type/model disagreement is ambiguous, never a precedence rule. Returning
  // null makes every server capability boundary fail closed.
  return recognized.size === 1 && exactModels.size <= 1 ? [...recognized][0] : null;
}

export function getHardwareWalletCapabilityRow(
  identity: HardwareWalletIdentity,
  capability: HardwareWalletCapability,
): HardwareWalletCapabilityRow | null {
  const vendor = classifyHardwareWalletVendor(identity);
  if (!vendor) return null;
  const modelFamily = capabilityModelFamily(identity, vendor);
  return HARDWARE_WALLET_CAPABILITY_ROWS.find(
    (row) => row.vendor === vendor
      && row.modelFamily === modelFamily
      && row.capability === capability,
  ) ?? null;
}

function capabilityModelFamily(
  identity: HardwareWalletIdentity,
  vendor: HardwareWalletVendor,
): string {
  const inventory = HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.find(
    (row) => row.vendor === vendor,
  );
  /* v8 ignore next -- vendor and inventory are exhaustively generated together */
  if (!inventory) return `${vendor}-unresolved`;
  const modelValues = typeof identity.model === "string"
    ? [identity.model]
    : [identity.model?.slug, identity.model?.name];
  for (const modelValue of modelValues) {
    if (!modelValue) continue;
    const exactModel = exactModelSlugForIdentityText(modelValue);
    if (exactModel && inventory.catalogModelSlugs.includes(exactModel)) return exactModel;
  }
  return `${vendor}-unresolved`;
}

export interface HardwareWalletCapabilityRow {
  id: string;
  vendor: HardwareWalletVendor;
  modelFamily: string;
  firmwareRange: "unverified";
  appVersionRange: "unverified";
  sdkVersionRange: "unverified";
  transport: "unverified";
  derivationNetworkFamily: "unverified";
  chainEnvironment: "unverified";
  policy: "unverified";
  accountRange: "unverified";
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
  bitbox:
    "Blocked pending exact identity, change, value, signature-mapping, and physical-device evidence.",
  coldcard:
    "Blocked pending row-specific import, air-gapped signing, and physical-device evidence.",
  generic:
    "Blocked because generic signer identity cannot establish a reviewed device and evidence tuple.",
  ledger:
    "Blocked pending row-specific derivation, address-display, and physical signing evidence.",
  jade:
    "Blocked pending Jade Plus identity, authentication, payload-validation, and physical-device evidence.",
  keystone:
    "Blocked pending row-specific QR import, signing, and physical-device evidence.",
  passport:
    "Blocked pending row-specific QR/SD import, signing, and physical-device evidence.",
  seedsigner:
    "Blocked pending row-specific QR signing and physical-device evidence.",
  specter:
    "Blocked pending row-specific air-gapped signing and physical-device evidence.",
  trezor:
    "Blocked pending master-fingerprint, selected-session, address-display, and raw-transaction evidence.",
};

export const HARDWARE_WALLET_CAPABILITY_ROWS: readonly HardwareWalletCapabilityRow[] =
  Object.freeze(HARDWARE_WALLET_IMPLEMENTATION_INVENTORY.flatMap((inventory) =>
    [...inventory.catalogModelSlugs, `${inventory.vendor}-unresolved`].flatMap((modelFamily) =>
      HARDWARE_WALLET_CAPABILITIES.map((capability) => Object.freeze({
        id: `${inventory.vendor}.${modelFamily}.${capability}`,
        vendor: inventory.vendor,
        modelFamily,
        firmwareRange: "unverified" as const,
        appVersionRange: "unverified" as const,
        sdkVersionRange: "unverified" as const,
        transport: "unverified" as const,
        derivationNetworkFamily: "unverified" as const,
        chainEnvironment: "unverified" as const,
        policy: "unverified" as const,
        accountRange: "unverified" as const,
        capability,
        enabled: false as const,
        evidenceTier: "unverified" as const,
        evidenceIds: [] as const,
        freshness: Object.freeze({
          status: "unverified" as const,
          checkedAt: null,
          expiresAt: null,
        }),
        reason: BLOCK_REASONS[inventory.vendor],
      })),
    ),
  ));
