import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultExperimentalFlags,
  defaultFeatureFlags,
  loadFeatureFlags,
} from '../../../src/config/features';

const FEATURE_ENV_KEYS = [
  'FEATURE_HARDWARE_WALLET',
  'FEATURE_QR_SIGNING',
  'FEATURE_MULTISIG',
  'FEATURE_BATCH_SYNC',
  'FEATURE_PAYJOIN',
  'FEATURE_BATCH_TX',
  'FEATURE_RBF',
  'FEATURE_PRICE_ALERTS',
  'FEATURE_AI_ASSISTANT',
  'FEATURE_SANCTUARY_CONSOLE',
  'FEATURE_TELEGRAM',
  'FEATURE_WS_V2',
  'FEATURE_TREASURY_INTELLIGENCE',
  'FEATURE_EXP_TAPROOT',
  'FEATURE_EXP_SILENT_PAYMENTS',
  'FEATURE_EXP_COINJOIN',
] as const;

const ORIGINAL_FEATURE_ENV = Object.fromEntries(
  FEATURE_ENV_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  for (const key of FEATURE_ENV_KEYS) {
    const originalValue = ORIGINAL_FEATURE_ENV[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
});

describe('Feature Flags Config', () => {
  it('returns default flags when feature env vars are unset', () => {
    for (const key of FEATURE_ENV_KEYS) {
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
    process.env.FEATURE_WS_V2 = '1';
    process.env.FEATURE_TREASURY_INTELLIGENCE = 'true';
    process.env.FEATURE_EXP_TAPROOT = '1';
    process.env.FEATURE_EXP_SILENT_PAYMENTS = 'TRUE';
    process.env.FEATURE_EXP_COINJOIN = 'false';

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
    expect(flags.websocketV2Events).toBe(true);
    expect(flags.treasuryIntelligence).toBe(true);
    expect(flags.experimental).toEqual({
      taprootAddresses: true,
      silentPayments: true,
      coinJoin: false,
    });
  });
});
