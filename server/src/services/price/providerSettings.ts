import { z } from "zod";

import {
  getValue,
  setJson,
  SystemSettingKeys,
} from "../../repositories/systemSettingRepository";
import { InvalidInputError } from "../../errors/ApiError";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import {
  DEFAULT_ENABLED_PRICE_PROVIDER_NAMES,
  hasLegacyPriceProviderEnv,
  isPriceProviderName,
  normalizePriceProviderNames,
  PRICE_PROVIDER_NAMES,
  resolveEnabledPriceProviderNames,
  type PriceProviderName,
} from "./providers";

export const PRICE_PROVIDER_CONFIG_VERSION = 1;

export interface PriceProviderConfig {
  version: typeof PRICE_PROVIDER_CONFIG_VERSION;
  enabled: PriceProviderName[];
  updatedAt: string;
  updatedBy: string | null;
}

const PriceProviderConfigSchema = z.object({
  version: z.literal(PRICE_PROVIDER_CONFIG_VERSION),
  enabled: z.array(z.string()),
  updatedAt: z.string().optional(),
  updatedBy: z.string().nullable().optional(),
});

const log = createLogger("PRICE:PROVIDER_SETTINGS");

let legacyEnvDeprecationLogged = false;

function createPriceProviderConfig(
  enabledProviderNames: readonly string[],
  updatedBy: string | null = null,
  updatedAt: string = new Date().toISOString(),
): PriceProviderConfig {
  const enabled = normalizePriceProviderNames(enabledProviderNames);

  return {
    version: PRICE_PROVIDER_CONFIG_VERSION,
    enabled:
      enabled.length > 0 ? enabled : [...DEFAULT_ENABLED_PRICE_PROVIDER_NAMES],
    updatedAt,
    updatedBy,
  };
}

function parseStoredConfig(rawValue: string): PriceProviderConfig | null {
  try {
    const parsedJson = JSON.parse(rawValue) as unknown;
    const parsedConfig = PriceProviderConfigSchema.safeParse(parsedJson);
    if (!parsedConfig.success) return null;

    return createPriceProviderConfig(
      parsedConfig.data.enabled,
      parsedConfig.data.updatedBy ?? null,
      parsedConfig.data.updatedAt,
    );
  } catch {
    return null;
  }
}

function getBootstrapEnabledProviderNames(
  env: NodeJS.ProcessEnv,
): PriceProviderName[] {
  if (!hasLegacyPriceProviderEnv(env)) {
    return [...DEFAULT_ENABLED_PRICE_PROVIDER_NAMES];
  }

  const enabled = resolveEnabledPriceProviderNames(env);
  if (enabled.length > 0) return enabled;

  log.warn("Legacy price provider env resolved no enabled providers", {
    fallbackProviders: DEFAULT_ENABLED_PRICE_PROVIDER_NAMES,
  });
  return [...DEFAULT_ENABLED_PRICE_PROVIDER_NAMES];
}

function warnForLegacyEnvAfterBootstrap(env: NodeJS.ProcessEnv): void {
  if (legacyEnvDeprecationLogged || !hasLegacyPriceProviderEnv(env)) return;

  legacyEnvDeprecationLogged = true;
  log.warn(
    "PRICE_PROVIDERS env values are bootstrap-only after DB provider config exists",
  );
}

export async function readPriceProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PriceProviderConfig> {
  try {
    const rawValue = await getValue(SystemSettingKeys.PRICE_PROVIDER_CONFIG);
    if (rawValue !== null) {
      warnForLegacyEnvAfterBootstrap(env);
      const parsed = parseStoredConfig(rawValue);
      if (parsed) return parsed;

      log.warn("Invalid price provider config in system settings", {
        key: SystemSettingKeys.PRICE_PROVIDER_CONFIG,
      });
      return createPriceProviderConfig(getBootstrapEnabledProviderNames(env));
    }

    const config = createPriceProviderConfig(
      getBootstrapEnabledProviderNames(env),
    );
    await setJson(SystemSettingKeys.PRICE_PROVIDER_CONFIG, config);
    return config;
  } catch (error) {
    log.warn("Failed to read or bootstrap price provider config", {
      error: getErrorMessage(error),
    });
    return createPriceProviderConfig(getBootstrapEnabledProviderNames(env));
  }
}

export async function writePriceProviderConfig(
  enabledProviderNames: readonly string[],
  updatedBy: string | null = null,
): Promise<PriceProviderConfig> {
  const enabled = normalizePriceProviderNames(enabledProviderNames);
  if (enabled.length === 0) {
    throw new InvalidInputError(
      "At least one price provider must remain enabled",
    );
  }

  const config = createPriceProviderConfig(enabled, updatedBy);
  await setJson(SystemSettingKeys.PRICE_PROVIDER_CONFIG, config);
  return config;
}

export async function setPriceProviderEnabled(
  providerName: string,
  enabled: boolean,
  updatedBy: string | null = null,
): Promise<PriceProviderConfig> {
  const normalizedProviderName = providerName.trim().toLowerCase();
  if (!isPriceProviderName(normalizedProviderName)) {
    throw new InvalidInputError(
      `Unknown price provider: ${providerName}`,
      "provider",
    );
  }

  const current = await readPriceProviderConfig();
  const nextEnabled = new Set(current.enabled);
  if (enabled) {
    nextEnabled.add(normalizedProviderName);
  } else {
    nextEnabled.delete(normalizedProviderName);
  }

  const orderedEnabled = PRICE_PROVIDER_NAMES.filter((name) =>
    nextEnabled.has(name),
  );
  return writePriceProviderConfig(orderedEnabled, updatedBy);
}
