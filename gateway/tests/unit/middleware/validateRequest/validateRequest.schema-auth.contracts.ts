import { expect, it } from 'vitest';

import {
  loginSchema,
  pushRegisterSchema,
  pushUnregisterSchema,
  refreshTokenSchema,
  twoFactorVerifySchema,
  userPreferencesSchema,
} from '../../../../src/middleware/validateRequest';

export function registerLoginSchemaContracts() {
  it('should validate correct login data', () => {
    const result = loginSchema.safeParse({
      username: 'testuser',
      password: 'mypassword',
    });

    expect(result.success).toBe(true);
  });

  it('should reject non-string username', () => {
    const result = loginSchema.safeParse({
      username: 123,
      password: 'mypassword',
    });

    expect(result.success).toBe(false);
  });
}

export function registerRefreshTokenSchemaContracts() {
  it('should validate refresh token with optional rotate', () => {
    const result = refreshTokenSchema.safeParse({
      refreshToken: 'token123',
      rotate: true,
    });

    expect(result.success).toBe(true);
  });

  it('should validate refresh token without rotate', () => {
    const result = refreshTokenSchema.safeParse({
      refreshToken: 'token123',
    });

    expect(result.success).toBe(true);
  });
}

export function registerPushRegisterSchemaContracts() {
  it('should validate complete push registration', () => {
    const result = pushRegisterSchema.safeParse({
      token: 'token123',
      platform: 'ios',
      deviceName: 'My iPhone',
    });

    expect(result.success).toBe(true);
  });

  it('should validate push registration without optional deviceName', () => {
    const result = pushRegisterSchema.safeParse({
      token: 'token123',
      platform: 'android',
    });

    expect(result.success).toBe(true);
  });
}

export function registerPushUnregisterSchemaContracts() {
  it('should validate push unregistration payloads', () => {
    const result = pushUnregisterSchema.safeParse({
      token: 'token123',
    });

    expect(result.success).toBe(true);
  });
}

export function registerTwoFactorVerifySchemaContracts() {
  it('should validate 2FA verification payloads', () => {
    const result = twoFactorVerifySchema.safeParse({
      tempToken: 'temp-token',
      code: '123456',
    });

    expect(result.success).toBe(true);
  });
}

export function registerUserPreferencesSchemaContracts() {
  it('should validate known user preference payloads and allow unknown preferences', () => {
    const result = userPreferencesSchema.safeParse({
      fiatCurrency: 'usd',
      customPreference: true,
    });

    expect(result.success).toBe(true);
  });
}
