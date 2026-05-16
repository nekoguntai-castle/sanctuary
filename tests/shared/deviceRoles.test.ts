import { describe, expect, it } from 'vitest';
import {
  DEVICE_ROLE_VALUES,
  canDeviceRoleOwn,
  canDeviceRoleView,
  isDeviceRole,
  parseDeviceRole,
} from '@sanctuary/shared/constants/deviceRoles';

describe('device role constants', () => {
  it('defines the intentionally narrow device role domain', () => {
    expect(DEVICE_ROLE_VALUES).toEqual(['owner', 'viewer']);
  });

  it('parses unknown roles as no role', () => {
    expect(parseDeviceRole('owner')).toBe('owner');
    expect(parseDeviceRole('viewer')).toBe('viewer');
    expect(parseDeviceRole('signer')).toBeNull();
    expect(parseDeviceRole('')).toBeNull();
    expect(parseDeviceRole(null)).toBeNull();
  });

  it('derives device role capabilities without wallet semantics', () => {
    expect(isDeviceRole('owner')).toBe(true);
    expect(isDeviceRole('approver')).toBe(false);
    expect(canDeviceRoleView('viewer')).toBe(true);
    expect(canDeviceRoleView(null)).toBe(false);
    expect(canDeviceRoleOwn('owner')).toBe(true);
    expect(canDeviceRoleOwn('viewer')).toBe(false);
  });
});
