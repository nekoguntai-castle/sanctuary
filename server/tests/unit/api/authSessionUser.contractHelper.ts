import { expect } from 'vitest';

export const AUTH_SESSION_USER_KEYS = [
  'email',
  'emailVerified',
  'id',
  'isAdmin',
  'preferences',
  'twoFactorEnabled',
  'username',
  'usingDefaultPassword',
] as const;

export function expectCanonicalAuthSessionUser(
  user: Record<string, unknown>,
  expected: {
    id: string;
    username: string;
    email: string | null;
    emailVerified: boolean;
    isAdmin: boolean;
    preferences: unknown;
    twoFactorEnabled: boolean;
    usingDefaultPassword: boolean;
  },
): void {
  expect(Object.keys(user).sort()).toEqual([...AUTH_SESSION_USER_KEYS].sort());
  expect(user.id).toBe(expected.id);
  expect(user.username).toBe(expected.username);
  expect(user.email).toBe(expected.email);
  expect(user.emailVerified).toBe(expected.emailVerified);
  expect(user.isAdmin).toBe(expected.isAdmin);
  expect(user.preferences).toEqual(expected.preferences);
  expect(user.twoFactorEnabled).toBe(expected.twoFactorEnabled);
  expect(user.usingDefaultPassword).toBe(expected.usingDefaultPassword);
}
