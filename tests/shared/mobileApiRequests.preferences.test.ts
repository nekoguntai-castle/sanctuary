import { describe, expect, it } from 'vitest';

import {
  UserPreferencesPatchSchema,
  canonicalizeUserPreferencesPatch,
} from '../../shared/schemas/mobileApiRequests';

describe('mobile API preference request schema', () => {
  it('canonicalizes fiat currency and legacy selected network values', () => {
    expect(canonicalizeUserPreferencesPatch({
      fiatCurrency: ' usd ',
      selectedNetwork: 'testnet',
      customPreference: true,
    })).toEqual({
      fiatCurrency: 'USD',
      selectedNetwork: 'testnet3',
      customPreference: true,
    });
  });

  it('leaves values without canonical storage changes untouched', () => {
    const preferences = {
      fiatCurrency: 123,
      selectedNetwork: 'mainnet',
      customPreference: true,
    };

    expect(canonicalizeUserPreferencesPatch(preferences)).toEqual(preferences);
  });

  it('validates known preference bounds while preserving extension keys', () => {
    const result = UserPreferencesPatchSchema.safeParse({
      unit: 'sats',
      fiatCurrency: 'eur',
      patternOpacity: 0,
      flyoutOpacity: 100,
      notificationSounds: {
        enabled: true,
        volume: 100,
        confirmation: {
          sound: 'chime',
          extension: 'kept',
        },
      },
      extensionKey: { enabled: true },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.extensionKey).toEqual({ enabled: true });
    expect(result.data.notificationSounds?.confirmation).toEqual({
      sound: 'chime',
      extension: 'kept',
    });
  });

  it('rejects unsupported known preference values', () => {
    expect(UserPreferencesPatchSchema.safeParse({
      unit: 'mbtc',
      fiatCurrency: 'US1',
      patternOpacity: -1,
      flyoutOpacity: 49,
      extensionKey: true,
    }).success).toBe(false);
  });
});
