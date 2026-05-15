/**
 * Feature Flags Configuration
 *
 * Defines feature flags for runtime feature toggling.
 * All flags default to their current behavior (enabled for existing features).
 *
 * Environment Variables:
 *   FEATURE_<FLAG_NAME>=true|false
 *
 * Categories:
 *   - Core: Essential wallet functionality (enabled by default)
 *   - Transaction: Transaction-related features
 *   - Integration: External service integrations
 *   - Protocol: Internal protocol features
 *   - Experimental: Unstable features (disabled by default)
 */

import type { FeatureFlags, ExperimentalFeatures, FeatureFlagKey } from './types';

type TopLevelFeatureFlagKey = keyof Omit<FeatureFlags, 'experimental'>;
type ExperimentalFeatureFlagKey = keyof ExperimentalFeatures;

interface FeatureFlagEnvBinding {
  key: FeatureFlagKey;
  env: string;
}

/**
 * Default experimental feature values
 */
export const defaultExperimentalFlags: ExperimentalFeatures = {
  taprootAddresses: false,
  silentPayments: false,
};

/**
 * Default feature flag values
 * Existing features default to true to preserve current behavior
 * New/experimental features default to false
 */
export const defaultFeatureFlags: FeatureFlags = {
  // Core wallet features (enabled by default)
  hardwareWalletSigning: true,
  qrCodeSigning: true,
  multisigWallets: true,
  batchSync: true,

  // Transaction features (enabled by default, except payjoin)
  payjoinSupport: false,
  batchTransactions: true,
  rbfTransactions: true,

  // Integration features (disabled by default)
  priceAlerts: false,
  aiAssistant: false,
  sanctuaryConsole: false,
  telegramNotifications: false,
  treasuryAutopilot: false,
  treasuryIntelligence: false,

  // Protocol features
  websocketV2Events: false,

  // Experimental features (nested)
  experimental: defaultExperimentalFlags,
};

export const FEATURE_FLAG_ENV_BINDINGS = [
  { key: 'hardwareWalletSigning', env: 'FEATURE_HARDWARE_WALLET' },
  { key: 'qrCodeSigning', env: 'FEATURE_QR_SIGNING' },
  { key: 'multisigWallets', env: 'FEATURE_MULTISIG' },
  { key: 'batchSync', env: 'FEATURE_BATCH_SYNC' },
  { key: 'payjoinSupport', env: 'FEATURE_PAYJOIN' },
  { key: 'batchTransactions', env: 'FEATURE_BATCH_TX' },
  { key: 'rbfTransactions', env: 'FEATURE_RBF' },
  { key: 'priceAlerts', env: 'FEATURE_PRICE_ALERTS' },
  { key: 'aiAssistant', env: 'FEATURE_AI_ASSISTANT' },
  { key: 'sanctuaryConsole', env: 'FEATURE_SANCTUARY_CONSOLE' },
  { key: 'telegramNotifications', env: 'FEATURE_TELEGRAM' },
  { key: 'treasuryAutopilot', env: 'FEATURE_TREASURY_AUTOPILOT' },
  { key: 'treasuryIntelligence', env: 'FEATURE_TREASURY_INTELLIGENCE' },
  { key: 'websocketV2Events', env: 'FEATURE_WS_V2' },
  { key: 'experimental.taprootAddresses', env: 'FEATURE_EXP_TAPROOT' },
  { key: 'experimental.silentPayments', env: 'FEATURE_EXP_SILENT_PAYMENTS' },
] as const satisfies readonly FeatureFlagEnvBinding[];

export const FEATURE_FLAG_ENV_KEYS = Object.freeze(
  FEATURE_FLAG_ENV_BINDINGS.map(({ env }) => env),
);

/**
 * Load feature flags from environment variables
 * Environment variables override defaults
 */
export function loadFeatureFlags(): FeatureFlags {
  const flags: FeatureFlags = {
    ...defaultFeatureFlags,
    experimental: { ...defaultExperimentalFlags },
  };

  for (const binding of FEATURE_FLAG_ENV_BINDINGS) {
    setFeatureFlagValue(
      flags,
      binding.key,
      parseBoolEnv(binding.env, getFeatureFlagValue(defaultFeatureFlags, binding.key)),
    );
  }

  return flags;
}

/**
 * Flatten nested feature config into the persistent feature flag key format.
 */
export function flattenFeatureFlags(features: FeatureFlags): Record<FeatureFlagKey, boolean> {
  return Object.fromEntries(
    FEATURE_FLAG_ENV_BINDINGS.map(({ key }) => [key, getFeatureFlagValue(features, key)]),
  ) as Record<FeatureFlagKey, boolean>;
}

/**
 * Read top-level and experimental.* feature keys, failing closed for unknown values.
 */
export function getFeatureFlagValue(features: FeatureFlags, key: FeatureFlagKey): boolean {
  if (isExperimentalFeatureFlagKey(key)) {
    const experimentalKey = key.slice('experimental.'.length) as ExperimentalFeatureFlagKey;
    return features.experimental[experimentalKey] ?? false;
  }

  return features[key as TopLevelFeatureFlagKey] ?? false;
}

function setFeatureFlagValue(features: FeatureFlags, key: FeatureFlagKey, enabled: boolean): void {
  if (isExperimentalFeatureFlagKey(key)) {
    const experimentalKey = key.slice('experimental.'.length) as ExperimentalFeatureFlagKey;
    features.experimental[experimentalKey] = enabled;
    return;
  }

  features[key as TopLevelFeatureFlagKey] = enabled;
}

function isExperimentalFeatureFlagKey(key: FeatureFlagKey): boolean {
  return key.startsWith('experimental.');
}

/**
 * Parse boolean from environment variable
 */
function parseBoolEnv(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue;
  }
  return value.toLowerCase() === 'true' || value === '1';
}
