/**
 * Canonical hardware-device role values.
 *
 * Device roles intentionally stay narrower than wallet roles. Do not add signer
 * or approver semantics here unless device sharing gains those capabilities.
 */

export const DEVICE_ROLE_VALUES = [
  'owner',
  'viewer',
] as const;

export type DeviceRoleValue = (typeof DEVICE_ROLE_VALUES)[number];
export type DeviceRole = DeviceRoleValue | null;

function includesString<T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

export function isDeviceRole(value: unknown): value is DeviceRoleValue {
  return includesString(DEVICE_ROLE_VALUES, value);
}

export function parseDeviceRole(value: unknown): DeviceRole {
  return isDeviceRole(value) ? value : null;
}

export function canDeviceRoleView(role: DeviceRole): role is DeviceRoleValue {
  return role !== null;
}

export function canDeviceRoleOwn(role: DeviceRole): boolean {
  return role === 'owner';
}
