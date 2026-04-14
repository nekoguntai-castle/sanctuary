import { beforeEach, vi } from 'vitest';
/**
 * Authentication Middleware Test Harness
 *
 * Shared mocks and payload fixtures for auth middleware contract tests.
 */

vi.mock('../../../../src/utils/jwt');
vi.mock('../../../../src/services/tokenRevocation');
vi.mock('../../../../src/utils/requestContext', () => ({
  requestContext: {
    setUser: vi.fn(),
  },
}));

export const validPayload = {
  userId: 'user-123',
  username: 'testuser',
  isAdmin: false,
  jti: 'token-jti-123',
};

export const adminPayload = {
  userId: 'admin-456',
  username: 'adminuser',
  isAdmin: true,
  jti: 'token-jti-456',
};

export function registerAuthTestSetup() {
  beforeEach(() => {
    vi.clearAllMocks();
  });
}
