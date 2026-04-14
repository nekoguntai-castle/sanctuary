import { vi, Mock } from 'vitest';
/**
 * Device Access Control Middleware Tests
 *
 * Tests for permission enforcement on device operations.
 * Mirrors the wallet access middleware pattern.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
} from '../../helpers/testUtils';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock device access service
vi.mock('../../../src/services/deviceAccess', () => ({
  checkDeviceAccess: vi.fn(),
  checkDeviceOwnerAccess: vi.fn(),
  getUserDeviceRole: vi.fn(),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import after mocks
import { requireDeviceAccess, getDeviceAccessRole } from '../../../src/middleware/deviceAccess';
import {
  checkDeviceAccess,
  checkDeviceOwnerAccess,
  getUserDeviceRole,
} from '../../../src/services/deviceAccess';

describe('Device Access Middleware', () => {
  const deviceId = 'test-device-id';
  const userId = 'test-user-id';
  const username = 'testuser';

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  describe('requireDeviceAccess - View Level', () => {
    const middleware = requireDeviceAccess('view');

    it('should allow access when user has view permission', async () => {
      (checkDeviceAccess as Mock).mockResolvedValue(true);
      (getUserDeviceRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).deviceId).toBe(deviceId);
      expect((req as any).deviceRole).toBe('viewer');
    });

    it('should allow access for owner role', async () => {
      (checkDeviceAccess as Mock).mockResolvedValue(true);
      (getUserDeviceRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).deviceRole).toBe('owner');
    });

    it('should deny access when user has no permission', async () => {
      (getUserDeviceRole as Mock).mockResolvedValue(null);

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(response.body.error).toBe('Forbidden');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 when device ID is missing', async () => {
      const req = createMockRequest({
        params: {},
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('Device ID');
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', async () => {
      const req = createMockRequest({
        params: { id: deviceId },
        // No user attached
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('requireDeviceAccess - Owner Level', () => {
    const middleware = requireDeviceAccess('owner');

    it('should allow owner access only for owner', async () => {
      (checkDeviceOwnerAccess as Mock).mockResolvedValue(true);
      (getUserDeviceRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect(next).toHaveBeenCalled();
      expect((req as any).deviceRole).toBe('owner');
    });

    it('should deny owner access for viewer', async () => {
      (getUserDeviceRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Parameter Handling', () => {
    it('should accept deviceId from params.id', async () => {
      (checkDeviceAccess as Mock).mockResolvedValue(true);
      (getUserDeviceRole as Mock).mockResolvedValue('viewer');

      const middleware = requireDeviceAccess('view');
      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect((req as any).deviceId).toBe(deviceId);
    });

    it('should accept deviceId from params.deviceId', async () => {
      (checkDeviceAccess as Mock).mockResolvedValue(true);
      (getUserDeviceRole as Mock).mockResolvedValue('viewer');

      const middleware = requireDeviceAccess('view');
      const req = createMockRequest({
        params: { deviceId: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      expect((req as any).deviceId).toBe(deviceId);
    });
  });

  describe('Error Handling', () => {
    it('should return 500 on database error', async () => {
      (getUserDeviceRole as Mock).mockRejectedValue(new Error('Database error'));

      const middleware = requireDeviceAccess('view');
      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });
      const { res, getResponse } = createMockResponse();
      const next = createMockNext();

      await middleware(req as any, res as any, next);

      const response = getResponse();
      expect(response.statusCode).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Role Hierarchy', () => {
    it('owner should have all access levels', async () => {
      (checkDeviceAccess as Mock).mockResolvedValue(true);
      (checkDeviceOwnerAccess as Mock).mockResolvedValue(true);
      (getUserDeviceRole as Mock).mockResolvedValue('owner');

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });

      // Test view
      let middleware = requireDeviceAccess('view');
      let { res } = createMockResponse();
      let next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test owner
      middleware = requireDeviceAccess('owner');
      ({ res } = createMockResponse());
      next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();
    });

    it('viewer should only have view access', async () => {
      (checkDeviceAccess as Mock).mockResolvedValue(true);
      (checkDeviceOwnerAccess as Mock).mockResolvedValue(false);
      (getUserDeviceRole as Mock).mockResolvedValue('viewer');

      const req = createMockRequest({
        params: { id: deviceId },
        user: { userId, username, isAdmin: false },
      });

      // Test view - should pass
      let middleware = requireDeviceAccess('view');
      let { res } = createMockResponse();
      let next = createMockNext();
      await middleware(req as any, res as any, next);
      expect(next).toHaveBeenCalled();

      // Test owner - should fail
      middleware = requireDeviceAccess('owner');
      const response = createMockResponse();
      next = createMockNext();
      await middleware(req as any, response.res as any, next);
      expect(response.getResponse().statusCode).toBe(403);
    });
  });

  describe('getDeviceAccessRole', () => {
    it('should delegate to getUserDeviceRole', async () => {
      (getUserDeviceRole as Mock).mockResolvedValue('viewer');

      const role = await getDeviceAccessRole(deviceId, userId);

      expect(getUserDeviceRole).toHaveBeenCalledWith(deviceId, userId);
      expect(role).toBe('viewer');
    });
  });
});
