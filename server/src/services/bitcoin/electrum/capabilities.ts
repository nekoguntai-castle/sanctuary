import { z } from "zod";

export const ELECTRUM_FEATURE_VALUES = [
  "base_electrum",
  "verbose_tx",
  "silent_payments_v0",
] as const;

export const ELECTRUM_SERVER_USAGE_VALUES = [
  "general",
  "silent_payments",
  "both",
] as const;

export type ElectrumFeature = (typeof ELECTRUM_FEATURE_VALUES)[number];
export type ElectrumServerUsage = (typeof ELECTRUM_SERVER_USAGE_VALUES)[number];
export type ElectrumServerFeatures = Record<string, unknown>;

/**
 * Frigate-compatible BIP352 Electrum servers advertise Silent Payments support
 * as server.features.silent_payments: [0]. New protocol versions should be
 * reviewed explicitly before they are admitted to the feature-scoped pool.
 */
export const SILENT_PAYMENTS_PROTOCOL_VERSION = 0;
export const ELECTRUM_CAPABILITY_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

const ServerFeaturesSchema = z.record(z.string(), z.unknown());

export interface CapabilityFreshnessOptions {
  now?: number;
  capabilityStaleAfterMs?: number;
}

export interface ElectrumCapabilityProfileInput {
  serverFeatures?: unknown;
  serverVersion?: string | null;
  protocolVersion?: string | null;
  supportsVerbose?: boolean | null;
  lastCapabilityError?: string | null;
}

export interface ElectrumCapabilityProfile {
  serverFeatures: ElectrumServerFeatures | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  supportsVerbose: boolean | null;
  silentPaymentVersions: number[];
  supportsSilentPaymentsV0: boolean;
  capabilityProfileKey: string;
  lastCapabilityError: string | null;
}

export interface ElectrumServerCapabilityState {
  supportsVerbose?: boolean | null;
  supportsSilentPaymentsV0?: boolean | null;
  lastCapabilityCheck?: Date | string | null;
  lastCapabilityError?: string | null;
}

function uniqueSortedIntegers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function parseSilentPaymentVersions(value: unknown): {
  versions: number[];
  error: string | null;
} {
  if (value === undefined || value === null) {
    return { versions: [], error: null };
  }

  if (!Array.isArray(value)) {
    return {
      versions: [],
      error:
        "server.features silent_payments must be an array of protocol versions",
    };
  }

  const versions = value.filter(
    (version): version is number => Number.isInteger(version) && version >= 0,
  );

  if (versions.length !== value.length) {
    return {
      versions: [],
      error:
        "server.features silent_payments must only contain non-negative integers",
    };
  }

  return { versions: uniqueSortedIntegers(versions), error: null };
}

function normalizeFeatures(value: unknown): {
  features: ElectrumServerFeatures | null;
  error: string | null;
} {
  if (value === undefined || value === null) {
    return { features: null, error: null };
  }

  const result = ServerFeaturesSchema.safeParse(value);
  if (!result.success) {
    return {
      features: null,
      error: "server.features returned an invalid feature object",
    };
  }

  return { features: result.data, error: null };
}

export function parseSilentPaymentVersionsValue(value: unknown): number[] {
  return parseSilentPaymentVersions(value).versions;
}

export function normalizeElectrumCapabilityProfile(
  input: ElectrumCapabilityProfileInput,
): ElectrumCapabilityProfile {
  const normalizedFeatures = normalizeFeatures(input.serverFeatures);
  const silentPayments = parseSilentPaymentVersions(
    normalizedFeatures.features?.silent_payments,
  );
  const lastCapabilityError =
    input.lastCapabilityError ??
    normalizedFeatures.error ??
    silentPayments.error ??
    null;
  const silentPaymentVersions = silentPayments.error
    ? []
    : silentPayments.versions;
  const supportsSilentPaymentsV0 = silentPaymentVersions.includes(
    SILENT_PAYMENTS_PROTOCOL_VERSION,
  );

  const profile = {
    serverVersion: input.serverVersion ?? null,
    protocolVersion: input.protocolVersion ?? null,
    supportsVerbose: input.supportsVerbose ?? null,
    silentPaymentVersions,
    supportsSilentPaymentsV0,
    lastCapabilityError,
  };

  return {
    ...profile,
    serverFeatures: normalizedFeatures.features,
    capabilityProfileKey: JSON.stringify(profile),
  };
}

export function isElectrumFeature(value: unknown): value is ElectrumFeature {
  return (
    typeof value === "string" &&
    ELECTRUM_FEATURE_VALUES.includes(value as ElectrumFeature)
  );
}

export function normalizeRequiredFeatures(
  features: readonly ElectrumFeature[] | undefined,
): ElectrumFeature[] {
  return [...new Set(features ?? [])].sort();
}

export function normalizeServerUsage(value: unknown): ElectrumServerUsage {
  return ELECTRUM_SERVER_USAGE_VALUES.includes(value as ElectrumServerUsage)
    ? (value as ElectrumServerUsage)
    : "general";
}

export function resolveFeaturePoolUsage(
  requiredFeatures: readonly ElectrumFeature[] | undefined,
  requestedUsage?: ElectrumServerUsage,
): ElectrumServerUsage {
  if (requestedUsage) {
    return requestedUsage;
  }

  return requiredFeatures?.includes("silent_payments_v0")
    ? "silent_payments"
    : "general";
}

export function serverUsageMatchesPool(
  serverUsageValue: unknown,
  poolUsage: ElectrumServerUsage,
): boolean {
  const serverUsage = normalizeServerUsage(serverUsageValue);
  if (poolUsage === "both") {
    return serverUsage === "both";
  }

  return serverUsage === poolUsage || serverUsage === "both";
}

export function isCapabilityCheckFresh(
  lastCapabilityCheck: Date | string | null | undefined,
  options: CapabilityFreshnessOptions = {},
): boolean {
  if (!lastCapabilityCheck) {
    return false;
  }

  const checkedAt =
    lastCapabilityCheck instanceof Date
      ? lastCapabilityCheck.getTime()
      : new Date(lastCapabilityCheck).getTime();

  if (Number.isNaN(checkedAt)) {
    return false;
  }

  const now = options.now ?? Date.now();
  const staleAfterMs =
    options.capabilityStaleAfterMs ?? ELECTRUM_CAPABILITY_STALE_AFTER_MS;

  return now - checkedAt <= staleAfterMs;
}

function featureSatisfied(
  server: ElectrumServerCapabilityState,
  feature: ElectrumFeature,
  options: CapabilityFreshnessOptions,
): boolean {
  if (feature === "base_electrum") {
    return true;
  }

  if (server.lastCapabilityError) {
    return false;
  }

  if (!isCapabilityCheckFresh(server.lastCapabilityCheck, options)) {
    return false;
  }

  if (feature === "verbose_tx") {
    return server.supportsVerbose === true;
  }

  return server.supportsSilentPaymentsV0 === true;
}

export function serverSatisfiesRequiredFeatures(
  server: ElectrumServerCapabilityState,
  requiredFeatures: readonly ElectrumFeature[] | undefined,
  options: CapabilityFreshnessOptions = {},
): boolean {
  return normalizeRequiredFeatures(requiredFeatures).every((feature) =>
    featureSatisfied(server, feature, options),
  );
}

export function getCapabilityStatus(
  server: ElectrumServerCapabilityState,
  requiredFeatures: readonly ElectrumFeature[],
  options: CapabilityFreshnessOptions = {},
): "supported" | "unsupported" | "unknown" | "stale" | "error" {
  const features = normalizeRequiredFeatures(requiredFeatures).filter(
    (feature) => feature !== "base_electrum",
  );

  if (server.lastCapabilityError) {
    return "error";
  }

  if (features.length === 0) {
    return "supported";
  }

  if (!server.lastCapabilityCheck) {
    return "unknown";
  }

  if (!isCapabilityCheckFresh(server.lastCapabilityCheck, options)) {
    return "stale";
  }

  return serverSatisfiesRequiredFeatures(server, features, options)
    ? "supported"
    : "unsupported";
}
