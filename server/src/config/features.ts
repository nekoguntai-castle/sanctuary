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

import type { FeatureFlags, ExperimentalFeatures } from './types';

/**
 * Default experimental feature values
 */
export const defaultExperimentalFlags: ExperimentalFeatures = {
  taprootAddresses: false,
  silentPayments: false,
  coinJoin: false,
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

/**
 * Load feature flags from environment variables
 * Environment variables override defaults
 */
export function loadFeatureFlags(): FeatureFlags {
  return {
    // Core wallet features
    hardwareWalletSigning: parseBoolEnv('FEATURE_HARDWARE_WALLET', defaultFeatureFlags.hardwareWalletSigning),
    qrCodeSigning: parseBoolEnv('FEATURE_QR_SIGNING', defaultFeatureFlags.qrCodeSigning),
    multisigWallets: parseBoolEnv('FEATURE_MULTISIG', defaultFeatureFlags.multisigWallets),
    batchSync: parseBoolEnv('FEATURE_BATCH_SYNC', defaultFeatureFlags.batchSync),

    // Transaction features
    payjoinSupport: parseBoolEnv('FEATURE_PAYJOIN', defaultFeatureFlags.payjoinSupport),
    batchTransactions: parseBoolEnv('FEATURE_BATCH_TX', defaultFeatureFlags.batchTransactions),
    rbfTransactions: parseBoolEnv('FEATURE_RBF', defaultFeatureFlags.rbfTransactions),

    // Integration features
    priceAlerts: parseBoolEnv('FEATURE_PRICE_ALERTS', defaultFeatureFlags.priceAlerts),
    aiAssistant: parseBoolEnv('FEATURE_AI_ASSISTANT', defaultFeatureFlags.aiAssistant),
    sanctuaryConsole: parseBoolEnv('FEATURE_SANCTUARY_CONSOLE', defaultFeatureFlags.sanctuaryConsole),
    telegramNotifications: parseBoolEnv('FEATURE_TELEGRAM', defaultFeatureFlags.telegramNotifications),
    treasuryAutopilot: parseBoolEnv('FEATURE_TREASURY_AUTOPILOT', defaultFeatureFlags.treasuryAutopilot),
    treasuryIntelligence: parseBoolEnv('FEATURE_TREASURY_INTELLIGENCE', defaultFeatureFlags.treasuryIntelligence),

    // Protocol features
    websocketV2Events: parseBoolEnv('FEATURE_WS_V2', defaultFeatureFlags.websocketV2Events),

    // Experimental features
    experimental: {
      taprootAddresses: parseBoolEnv('FEATURE_EXP_TAPROOT', defaultExperimentalFlags.taprootAddresses),
      silentPayments: parseBoolEnv('FEATURE_EXP_SILENT_PAYMENTS', defaultExperimentalFlags.silentPayments),
      coinJoin: parseBoolEnv('FEATURE_EXP_COINJOIN', defaultExperimentalFlags.coinJoin),
    },
  };
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
