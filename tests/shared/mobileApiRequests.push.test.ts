import { describe, expect, it } from 'vitest';

import {
  MOBILE_API_REQUEST_LIMITS,
  MobilePushRegisterRequestSchema,
} from '../../shared/schemas/mobileApiRequests';

const validToken = 'device-token-evidence';

describe('mobile push registration request schema', () => {
  it('accepts a null deviceName', () => {
    const result = MobilePushRegisterRequestSchema.safeParse({
      token: validToken,
      platform: 'ios',
      deviceName: null,
    });

    expect(result.success).toBe(true);
  });

  it('accepts an omitted deviceName', () => {
    expect(MobilePushRegisterRequestSchema.safeParse({
      token: validToken,
      platform: 'android',
    }).success).toBe(true);
  });

  it('accepts a valid deviceName string', () => {
    expect(MobilePushRegisterRequestSchema.safeParse({
      token: validToken,
      platform: 'ios',
      deviceName: 'iPhone 15',
    }).success).toBe(true);
  });

  it('rejects a deviceName over the shared length limit', () => {
    const result = MobilePushRegisterRequestSchema.safeParse({
      token: validToken,
      platform: 'ios',
      deviceName: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.deviceNameMaxLength + 1),
    });

    expect(result.success).toBe(false);
  });
});
