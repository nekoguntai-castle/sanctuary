/**
 * Contract test: the gateway-facing shared schema (MobilePushRegisterRequestSchema)
 * and the backend's runtime validation schema (PushRegisterBodySchema, exported from
 * ../../../../src/api/push.ts) must accept the same set of `deviceName` shapes.
 * A gap here means a request the gateway forwards can be rejected by the backend,
 * or vice versa. See iteration-16 plan, Phase 7 (P2 finding
 * push-register-devicename-null-rejected-by-gateway).
 */
import { describe, expect, it } from 'vitest';

import {
  MOBILE_API_REQUEST_LIMITS,
  MobilePushRegisterRequestSchema,
} from '@sanctuary/shared/schemas/mobileApiRequests';
import { PushRegisterBodySchema } from '../../../../src/api/push';

const validToken = 'a'.repeat(150);

const deviceNameShapes: Array<{ label: string; deviceName: unknown }> = [
  { label: 'undefined (omitted)', deviceName: undefined },
  { label: 'null', deviceName: null },
  { label: 'a valid string', deviceName: 'Pixel 7' },
  { label: 'an empty string', deviceName: '' },
  {
    label: 'a string over the shared length limit',
    deviceName: 'a'.repeat(MOBILE_API_REQUEST_LIMITS.deviceNameMaxLength + 1),
  },
  { label: 'a number', deviceName: 42 },
  { label: 'an object', deviceName: { name: 'Pixel 7' } },
];

describe('push registration deviceName contract parity', () => {
  it.each(deviceNameShapes)(
    'accepts/rejects $label the same way in both schemas',
    ({ deviceName }) => {
      const body: Record<string, unknown> = { token: validToken, platform: 'android' };
      if (deviceName !== undefined) {
        body.deviceName = deviceName;
      }

      const gatewayResult = MobilePushRegisterRequestSchema.safeParse(body);
      const backendResult = PushRegisterBodySchema.safeParse(body);

      expect(backendResult.success).toBe(gatewayResult.success);
    },
  );
});
