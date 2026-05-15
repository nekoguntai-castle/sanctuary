import { afterEach, describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_ENV_BINDINGS,
  FEATURE_FLAG_ENV_KEYS,
  defaultExperimentalFlags,
  defaultFeatureFlags,
  flattenFeatureFlags,
  getFeatureFlagValue,
  loadFeatureFlags,
} from '../../../src/config/features';
import { FEATURE_FLAG_KEYS } from '../../../src/services/featureFlags/definitions';

const ORIGINAL_FEATURE_ENV = Object.fromEntries(
  FEATURE_FLAG_ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const key of FEATURE_FLAG_ENV_KEYS) {
    const originalValue = ORIGINAL_FEATURE_ENV[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe('Feature Flags Config', () => {
  it('keeps env bindings aligned with known feature flag keys', () => {
    const bindingKeys = FEATURE_FLAG_ENV_BINDINGS.map(({ key }) => key);
    const bindingEnvs = FEATURE_FLAG_ENV_BINDINGS.map(({ env }) => env);

    expect(bindingKeys).toEqual([...FEATURE_FLAG_KEYS]);
    expect(new Set(bindingKeys).size).toBe(bindingKeys.length);
    expect(new Set(bindingEnvs).size).toBe(bindingEnvs.length);
    expect(bindingEnvs.every((env) => env.startsWith('FEATURE_'))).toBe(true);
  });

  it('returns default flags when feature env vars are unset', () => {
    for (const key of FEATURE_FLAG_ENV_KEYS) {
      delete process.env[key];
    }

    const flags = loadFeatureFlags();

    expect(flags).toEqual(defaultFeatureFlags);
    expect(flags.experimental).toEqual(defaultExperimentalFlags);
  });

  it('parses boolean env values including numeric true and empty fallback', () => {
    process.env.FEATURE_HARDWARE_WALLET = 'false';
    process.env.FEATURE_QR_SIGNING = 'true';
    process.env.FEATURE_MULTISIG = '1';
    process.env.FEATURE_BATCH_SYNC = '';
    process.env.FEATURE_PAYJOIN = 'FALSE';
    process.env.FEATURE_BATCH_TX = 'TRUE';
    process.env.FEATURE_RBF = '0';
    process.env.FEATURE_PRICE_ALERTS = 'true';
    process.env.FEATURE_AI_ASSISTANT = '1';
    process.env.FEATURE_SANCTUARY_CONSOLE = 'true';
    process.env.FEATURE_TELEGRAM = 'false';
    process.env.FEATURE_TREASURY_AUTOPILOT = 'true';
    process.env.FEATURE_TREASURY_INTELLIGENCE = 'true';
    process.env.FEATURE_WS_V2 = '1';
    process.env.FEATURE_EXP_TAPROOT = '1';
    process.env.FEATURE_EXP_SILENT_PAYMENTS = 'TRUE';

    const flags = loadFeatureFlags();

    expect(flags.hardwareWalletSigning).toBe(false);
    expect(flags.qrCodeSigning).toBe(true);
    expect(flags.multisigWallets).toBe(true);
    expect(flags.batchSync).toBe(defaultFeatureFlags.batchSync);
    expect(flags.payjoinSupport).toBe(false);
    expect(flags.batchTransactions).toBe(true);
    expect(flags.rbfTransactions).toBe(false);
    expect(flags.priceAlerts).toBe(true);
    expect(flags.aiAssistant).toBe(true);
    expect(flags.sanctuaryConsole).toBe(true);
    expect(flags.telegramNotifications).toBe(false);
    expect(flags.treasuryAutopilot).toBe(true);
    expect(flags.treasuryIntelligence).toBe(true);
    expect(flags.websocketV2Events).toBe(true);
    expect(flags.experimental).toEqual({
      taprootAddresses: true,
      silentPayments: true,
    });
  });

  it('reads current env values at load time instead of snapshotting them', () => {
    for (const key of FEATURE_FLAG_ENV_KEYS) {
      delete process.env[key];
    }

    process.env.FEATURE_TREASURY_AUTOPILOT = 'true';
    expect(loadFeatureFlags().treasuryAutopilot).toBe(true);

    process.env.FEATURE_TREASURY_AUTOPILOT = 'false';
    expect(loadFeatureFlags().treasuryAutopilot).toBe(false);
  });

  it('flattens feature flags using the env binding key set', () => {
    const flags = {
      ...defaultFeatureFlags,
      treasuryAutopilot: true,
      experimental: {
        ...defaultExperimentalFlags,
        silentPayments: true,
      },
    };

    expect(flattenFeatureFlags(flags)).toEqual({
      hardwareWalletSigning: defaultFeatureFlags.hardwareWalletSigning,
      qrCodeSigning: defaultFeatureFlags.qrCodeSigning,
      multisigWallets: defaultFeatureFlags.multisigWallets,
      batchSync: defaultFeatureFlags.batchSync,
      payjoinSupport: defaultFeatureFlags.payjoinSupport,
      batchTransactions: defaultFeatureFlags.batchTransactions,
      rbfTransactions: defaultFeatureFlags.rbfTransactions,
      priceAlerts: defaultFeatureFlags.priceAlerts,
      aiAssistant: defaultFeatureFlags.aiAssistant,
      sanctuaryConsole: defaultFeatureFlags.sanctuaryConsole,
      telegramNotifications: defaultFeatureFlags.telegramNotifications,
      treasuryAutopilot: true,
      treasuryIntelligence: defaultFeatureFlags.treasuryIntelligence,
      websocketV2Events: defaultFeatureFlags.websocketV2Events,
      'experimental.taprootAddresses': defaultExperimentalFlags.taprootAddresses,
      'experimental.silentPayments': true,
    });
  });

  it('returns false for unknown feature keys in defensive fallbacks', () => {
    expect(getFeatureFlagValue(defaultFeatureFlags, 'notAFlag' as any)).toBe(false);
    expect(getFeatureFlagValue(defaultFeatureFlags, 'experimental.notAFlag' as any)).toBe(false);
  });
});
