import { beforeEach, vi } from 'vitest';
/**
 * Authentication Middleware Test Harness
 *
 * Shared mocks and payload fixtures for auth middleware contract tests.
 */

const hoistedMocks = vi.hoisted(() => ({
  userRepository: {
    findByIdWithSelect: vi.fn(),
  },
  emailService: {
    isVerificationRequired: vi.fn(),
  },
}));
export const mockUserRepository = hoistedMocks.userRepository;
export const mockIsVerificationRequired = hoistedMocks.emailService.isVerificationRequired;

vi.mock('../../../../src/utils/jwt');
vi.mock('../../../../src/services/tokenRevocation');
vi.mock('../../../../src/repositories', () => ({
  userRepository: mockUserRepository,
}));
vi.mock('../../../../src/services/email', () => ({
  isVerificationRequired: mockIsVerificationRequired,
}));
vi.mock('../../../../src/utils/requestContext', () => ({
  requestContext: {
    setUser: vi.fn(),
  },
}));

export const validPayload = {
  userId: 'user-123',
  username: 'testuser',
  isAdmin: false,
  sessionVersion: 0,
  jti: 'token-jti-123',
};

export const adminPayload = {
  userId: 'admin-456',
  username: 'adminuser',
  isAdmin: true,
  sessionVersion: 0,
  jti: 'token-jti-456',
};

export function registerAuthTestSetup() {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserRepository.findByIdWithSelect.mockReset();
    mockUserRepository.findByIdWithSelect.mockImplementation(async (userId: string) => {
      const payload = userId === adminPayload.userId ? adminPayload : validPayload;
      return {
        id: payload.userId,
        username: payload.username,
        isAdmin: payload.isAdmin,
        sessionVersion: payload.sessionVersion,
        email: `${payload.username}@example.com`,
        emailVerified: true,
      };
    });
    mockIsVerificationRequired.mockReset();
    mockIsVerificationRequired.mockResolvedValue(true);
  });
}
