/**
 * Push Notification API Routes Tests
 *
 * Tests for /api/v1/push routes that handle device token registration
 * for iOS (APNs) and Android (FCM) push notifications.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createHmac, createHash } from 'crypto';

// Mock config before imports
vi.mock('../../../src/config', () => ({
  default: {
    gatewaySecret: 'test-gateway-secret',
  },
}));

// Mock repositories - all mock functions defined inside the factory
vi.mock('../../../src/repositories', () => ({
  pushDeviceRepository: {
    upsert: vi.fn(),
    findByToken: vi.fn(),
    findByUserId: vi.fn(),
    findById: vi.fn(),
    deleteByToken: vi.fn(),
    deleteById: vi.fn(),
  },
  auditLogRepository: {
    create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
  },
}));

// Mock authenticate middleware
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      const userId = (req.headers['x-test-user-id'] as string) || 'test-user-123';
      req.user = { userId, username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
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

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

// Import router and mocked modules after mocks
import pushRouter from '../../../src/api/push';
import { errorHandler } from '../../../src/errors/errorHandler';
import { pushDeviceRepository, auditLogRepository } from '../../../src/repositories';

// Get typed references to mocked functions
const mockUpsert = pushDeviceRepository.upsert as ReturnType<typeof vi.fn>;
const mockFindByToken = pushDeviceRepository.findByToken as ReturnType<typeof vi.fn>;
const mockFindByUserId = pushDeviceRepository.findByUserId as ReturnType<typeof vi.fn>;
const mockFindById = pushDeviceRepository.findById as ReturnType<typeof vi.fn>;
const mockDeleteByToken = pushDeviceRepository.deleteByToken as ReturnType<typeof vi.fn>;
const mockDeleteById = pushDeviceRepository.deleteById as ReturnType<typeof vi.fn>;
const mockAuditLogCreate = auditLogRepository.create as ReturnType<typeof vi.fn>;

// Helper to generate valid gateway signature
function generateGatewaySignature(
  method: string,
  path: string,
  body: unknown,
  secret: string
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();

  let bodyHash = '';
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  const message = `${method.toUpperCase()}${path}${timestamp}${bodyHash}`;
  const signature = createHmac('sha256', secret).update(message).digest('hex');

  return { signature, timestamp };
}

describe('Push API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/push', pushRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Valid token fixtures
  const validAndroidToken = 'a'.repeat(150); // FCM tokens are 100-500 chars
  const validIosToken = 'a'.repeat(64); // APNs tokens are 64+ hex chars

  type HandlerResponse = {
    status: number;
    headers: Record<string, string>;
    body?: any;
  };

  class RequestBuilder {
    private headers: Record<string, string> = {};
    private body: unknown;

    constructor(private method: string, private url: string) {}

    set(key: string, value: string): this {
      this.headers[key] = value;
      return this;
    }

    send(body?: unknown): Promise<HandlerResponse> {
      this.body = body;
      return this.exec();
    }

    then<TResult1 = HandlerResponse, TResult2 = never>(
      onfulfilled?: ((value: HandlerResponse) => TResult1 | PromiseLike<TResult1>) | undefined | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2> {
      return this.exec().then(onfulfilled, onrejected);
    }

    private async exec(): Promise<HandlerResponse> {
      const normalizedUrl = this.url.replace(/^\/api\/v1\/push/, '') || '/';
      const [pathOnly] = normalizedUrl.split('?');
      const headers = Object.fromEntries(
        Object.entries(this.headers).map(([key, value]) => [key.toLowerCase(), value])
      );

      return new Promise<HandlerResponse>((resolve, reject) => {
        const req: any = {
          method: this.method,
          url: normalizedUrl,
          originalUrl: this.url,
          path: pathOnly,
          headers,
          body: this.body ?? {},
        };

        const res: any = {
          statusCode: 200,
          headers: {},
          setHeader: (key: string, value: string) => {
            res.headers[key.toLowerCase()] = value;
          },
          status: (code: number) => {
            res.statusCode = code;
            return res;
          },
          json: (body: unknown) => {
            res.body = body;
            resolve({ status: res.statusCode, headers: res.headers, body: res.body });
          },
          send: (body?: unknown) => {
            res.body = body;
            resolve({ status: res.statusCode, headers: res.headers, body: res.body });
          },
        };

        pushRouter.handle(req, res, (err?: any) => {
          if (err) {
            // Simulate errorHandler: ApiErrors get their status code, generic errors get 500
            const statusCode = err.statusCode || 500;
            const body = err.toResponse
              ? err.toResponse()
              : { error: 'Internal', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
            res.statusCode = statusCode;
            res.body = body;
            resolve({ status: statusCode, headers: res.headers, body });
            return;
          }
          reject(new Error(`Route not handled: ${this.method} ${normalizedUrl}`));
        });
      });
    }
  }

  const request = (_app: unknown) => ({
    get: (url: string) => new RequestBuilder('GET', url),
    post: (url: string) => new RequestBuilder('POST', url),
    delete: (url: string) => new RequestBuilder('DELETE', url),
  });

  describe('POST /api/v1/push/register', () => {
    it('should register a new Android device successfully', async () => {
      const now = new Date();
      mockUpsert.mockResolvedValue({
        id: 'device-1',
        token: validAndroidToken,
        platform: 'android',
        userId: 'test-user-123',
        deviceName: 'Pixel 7',
        createdAt: now,
        lastUsedAt: now,
      });

      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: validAndroidToken,
          platform: 'android',
          deviceName: 'Pixel 7',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deviceId).toBe('device-1');
      expect(res.body.message).toBe('Device registered for push notifications');
      expect(mockUpsert).toHaveBeenCalledWith({
        token: validAndroidToken,
        userId: 'test-user-123',
        platform: 'android',
        deviceName: 'Pixel 7',
      });
    });

    it('should register a new iOS device successfully', async () => {
      const now = new Date();
      mockUpsert.mockResolvedValue({
        id: 'device-2',
        token: validIosToken,
        platform: 'ios',
        userId: 'test-user-123',
        deviceName: 'iPhone 15',
        createdAt: now,
        lastUsedAt: now,
      });

      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: validIosToken,
          platform: 'ios',
          deviceName: 'iPhone 15',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deviceId).toBe('device-2');
    });

    it('should accept APNs provider-style token format', async () => {
      const now = new Date();
      const providerToken = `${'a'.repeat(30)}.${'b'.repeat(33)}`; // 64 chars with dot

      mockUpsert.mockResolvedValue({
        id: 'device-3',
        token: providerToken,
        platform: 'ios',
        userId: 'test-user-123',
        deviceName: 'iPhone 15',
        createdAt: now,
        lastUsedAt: now,
      });

      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: providerToken,
          platform: 'ios',
          deviceName: 'iPhone 15',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpsert).toHaveBeenCalledWith({
        token: providerToken,
        userId: 'test-user-123',
        platform: 'ios',
        deviceName: 'iPhone 15',
      });
    });

    it('should update an existing device token', async () => {
      const createdAt = new Date('2024-01-01');
      const lastUsedAt = new Date(); // Different from createdAt = existing device
      mockUpsert.mockResolvedValue({
        id: 'device-1',
        token: validAndroidToken,
        platform: 'android',
        userId: 'test-user-123',
        deviceName: 'Pixel 7',
        createdAt,
        lastUsedAt,
      });

      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: validAndroidToken,
          platform: 'android',
        });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Device token updated');
    });

    it('should return 400 when token is missing', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          platform: 'android',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_INPUT');
      expect(res.body.message).toBe('Device token is required');
    });

    it('should return 400 when platform is missing', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: validAndroidToken,
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_INPUT');
      expect(res.body.message).toBe('Platform must be "ios" or "android"');
    });

    it('should return 400 for invalid platform', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: validAndroidToken,
          platform: 'windows',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Platform must be "ios" or "android"');
    });

    it('should return 400 for FCM token that is too short', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: 'short-token',
          platform: 'android',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('FCM token appears too short');
    });

    it('should return 400 for FCM token that is too long', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: 'a'.repeat(501),
          platform: 'android',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('FCM token appears too long');
    });

    it('should return 400 for FCM token with invalid characters', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: 'a'.repeat(100) + '!@#$%',
          platform: 'android',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('FCM token contains invalid characters');
    });

    it('should return 400 for APNs token that is too short', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: 'a'.repeat(50),
          platform: 'ios',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('APNs token appears too short');
    });

    it('should return 400 for APNs token that is too long', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: 'a'.repeat(501),
          platform: 'ios',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('APNs token appears too long');
    });

    it('should return 400 for APNs token with invalid characters', async () => {
      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: 'g'.repeat(64) + '!@#', // 'g' is not valid hex
          platform: 'ios',
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('APNs token contains invalid characters');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).post('/api/v1/push/register').send({
        token: validAndroidToken,
        platform: 'android',
      });

      expect(res.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockUpsert.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .post('/api/v1/push/register')
        .set('Authorization', 'Bearer test-token')
        .send({
          token: validAndroidToken,
          platform: 'android',
        });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  describe('DELETE /api/v1/push/unregister', () => {
    it('should unregister a device successfully', async () => {
      mockFindByToken.mockResolvedValue({
        id: 'device-1',
        token: validAndroidToken,
        platform: 'android',
        userId: 'test-user-123',
      });
      mockDeleteByToken.mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/api/v1/push/unregister')
        .set('Authorization', 'Bearer test-token')
        .send({ token: validAndroidToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Device token removed');
      expect(mockDeleteByToken).toHaveBeenCalledWith(validAndroidToken);
    });

    it('should return success when token not found (idempotent)', async () => {
      mockFindByToken.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/v1/push/unregister')
        .set('Authorization', 'Bearer test-token')
        .send({ token: 'non-existent-token' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Device token removed');
      expect(mockDeleteByToken).not.toHaveBeenCalled();
    });

    it('should return success when device owned by different user', async () => {
      mockFindByToken.mockResolvedValue({
        id: 'device-1',
        token: validAndroidToken,
        platform: 'android',
        userId: 'other-user',
      });

      const res = await request(app)
        .delete('/api/v1/push/unregister')
        .set('Authorization', 'Bearer test-token')
        .send({ token: validAndroidToken });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockDeleteByToken).not.toHaveBeenCalled();
    });

    it('should return 400 when token is missing', async () => {
      const res = await request(app)
        .delete('/api/v1/push/unregister')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Device token is required');
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete('/api/v1/push/unregister').send({ token: validAndroidToken });

      expect(res.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockFindByToken.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .delete('/api/v1/push/unregister')
        .set('Authorization', 'Bearer test-token')
        .send({ token: validAndroidToken });

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  describe('GET /api/v1/push/devices', () => {
    it('should return list of user devices', async () => {
      const now = new Date();
      mockFindByUserId.mockResolvedValue([
        {
          id: 'device-1',
          platform: 'android',
          deviceName: 'Pixel 7',
          lastUsedAt: now,
          createdAt: now,
        },
        {
          id: 'device-2',
          platform: 'ios',
          deviceName: 'iPhone 15',
          lastUsedAt: now,
          createdAt: now,
        },
      ]);

      const res = await request(app)
        .get('/api/v1/push/devices')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.devices).toHaveLength(2);
      expect(res.body.devices[0]).toEqual({
        id: 'device-1',
        platform: 'android',
        deviceName: 'Pixel 7',
        lastUsedAt: now.toISOString(),
        createdAt: now.toISOString(),
      });
    });

    it('should return empty array when no devices', async () => {
      mockFindByUserId.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/v1/push/devices')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.devices).toEqual([]);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).get('/api/v1/push/devices');

      expect(res.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockFindByUserId.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .get('/api/v1/push/devices')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  describe('DELETE /api/v1/push/devices/:id', () => {
    it('should delete a specific device', async () => {
      mockFindById.mockResolvedValue({
        id: 'device-1',
        platform: 'android',
        userId: 'test-user-123',
      });
      mockDeleteById.mockResolvedValue(undefined);

      const res = await request(app)
        .delete('/api/v1/push/devices/device-1')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Device removed');
      expect(mockDeleteById).toHaveBeenCalledWith('device-1');
    });

    it('should return 404 when device not found', async () => {
      mockFindById.mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/v1/push/devices/non-existent')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.message).toBe('Device not found');
    });

    it('should return 404 when device owned by different user', async () => {
      mockFindById.mockResolvedValue({
        id: 'device-1',
        platform: 'android',
        userId: 'other-user',
      });

      const res = await request(app)
        .delete('/api/v1/push/devices/device-1')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Device not found');
      expect(mockDeleteById).not.toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const res = await request(app).delete('/api/v1/push/devices/device-1');

      expect(res.status).toBe(401);
    });

    it('should return 500 on service error', async () => {
      mockFindById.mockRejectedValue(new Error('Database error'));

      const res = await request(app)
        .delete('/api/v1/push/devices/device-1')
        .set('Authorization', 'Bearer test-token');

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  describe('GET /api/v1/push/by-user/:userId (Gateway Internal)', () => {
    it('should return devices for a user with valid gateway signature', async () => {
      mockFindByUserId.mockResolvedValue([
        {
          id: 'device-1',
          platform: 'android',
          token: 'fcm-token-123',
          userId: 'user-456',
        },
      ]);

      const path = '/api/v1/push/by-user/user-456';
      const { signature, timestamp } = generateGatewaySignature('GET', path, null, 'test-gateway-secret');

      const res = await request(app)
        .get('/api/v1/push/by-user/user-456')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          id: 'device-1',
          platform: 'android',
          pushToken: 'fcm-token-123',
          userId: 'user-456',
        },
      ]);
    });

    it('should return 403 without gateway signature headers', async () => {
      const res = await request(app).get('/api/v1/push/by-user/user-456');

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Missing gateway authentication headers');
    });

    it('should return 403 with expired timestamp', async () => {
      const expiredTimestamp = (Date.now() - 10 * 60 * 1000).toString(); // 10 minutes ago
      const path = '/api/v1/push/by-user/user-456';
      const message = `GET${path}${expiredTimestamp}`;
      const signature = createHmac('sha256', 'test-gateway-secret').update(message).digest('hex');

      const res = await request(app)
        .get('/api/v1/push/by-user/user-456')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', expiredTimestamp);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Request timestamp expired or invalid');
    });

    it('should return 403 with invalid signature', async () => {
      const timestamp = Date.now().toString();
      const invalidSignature = 'invalid-signature-hash';

      const res = await request(app)
        .get('/api/v1/push/by-user/user-456')
        .set('X-Gateway-Signature', invalidSignature)
        .set('X-Gateway-Timestamp', timestamp);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Invalid gateway signature');
    });

    it('should return 500 on service error', async () => {
      mockFindByUserId.mockRejectedValue(new Error('Database error'));

      const path = '/api/v1/push/by-user/user-456';
      const { signature, timestamp } = generateGatewaySignature('GET', path, null, 'test-gateway-secret');

      const res = await request(app)
        .get('/api/v1/push/by-user/user-456')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  describe('DELETE /api/v1/push/device/:deviceId (Gateway Internal)', () => {
    it('should delete a device with valid gateway signature', async () => {
      mockFindById.mockResolvedValue({
        id: 'device-1',
        platform: 'android',
        userId: 'user-456',
      });
      mockDeleteById.mockResolvedValue(undefined);

      const path = '/api/v1/push/device/device-1';
      const { signature, timestamp } = generateGatewaySignature('DELETE', path, null, 'test-gateway-secret');

      const res = await request(app)
        .delete('/api/v1/push/device/device-1')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Device removed');
    });

    it('should return success when device not found (idempotent)', async () => {
      mockFindById.mockResolvedValue(null);

      const path = '/api/v1/push/device/non-existent';
      const { signature, timestamp } = generateGatewaySignature('DELETE', path, null, 'test-gateway-secret');

      const res = await request(app)
        .delete('/api/v1/push/device/non-existent')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Device not found or already removed');
    });

    it('should return 403 without gateway signature', async () => {
      const res = await request(app).delete('/api/v1/push/device/device-1');

      expect(res.status).toBe(403);
    });

    it('should return 500 on service error', async () => {
      mockFindById.mockRejectedValue(new Error('Database error'));

      const path = '/api/v1/push/device/device-1';
      const { signature, timestamp } = generateGatewaySignature('DELETE', path, null, 'test-gateway-secret');

      const res = await request(app)
        .delete('/api/v1/push/device/device-1')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  describe('POST /api/v1/push/gateway-audit (Gateway Internal)', () => {
    it('should log a successful gateway audit event', async () => {
      const body = {
        event: 'AUTH_SUCCESS',
        category: 'auth',
        severity: 'info',
        details: { method: 'jwt' },
        ip: '192.168.1.1',
        userAgent: 'MobileApp/1.0',
        userId: 'user-123',
        username: 'testuser',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        userId: 'user-123',
        username: 'testuser',
        action: 'gateway.auth_success',
        category: 'auth',
        details: {
          method: 'jwt',
          severity: 'info',
          source: 'gateway',
        },
        ipAddress: '192.168.1.1',
        userAgent: 'MobileApp/1.0',
        success: true,
        errorMsg: null,
      });
    });

    it('should log a failed event correctly', async () => {
      const body = {
        event: 'AUTH_FAILED',
        category: 'auth',
        severity: 'high',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'gateway.auth_failed',
          success: false,
          errorMsg: 'AUTH_FAILED',
        })
      );
    });

    it('should log rate limit exceeded as failure', async () => {
      const body = {
        event: 'RATE_LIMIT_EXCEEDED',
        category: 'security',
        ip: '10.0.0.1',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMsg: 'RATE_LIMIT_EXCEEDED',
        })
      );
    });

    it('should log blocked event as failure', async () => {
      const body = {
        event: 'IP_BLOCKED',
        category: 'security',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          errorMsg: 'IP_BLOCKED',
        })
      );
    });

    it.each([
      'AUTH_DENIED',
      'TOKEN_EXPIRED',
      'ACCESS_FORBIDDEN',
      'TOKEN_INVALID',
      'AUTH_MISSING_TOKEN',
      'API_MISUSE',
      'REQUEST_UNAUTHORIZED',
    ])('should log %s as failure', async (event) => {
      const body = {
        event,
        category: 'security',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: `gateway.${event.toLowerCase()}`,
          success: false,
          errorMsg: event,
        })
      );
    });

    it('should use defaults for missing optional fields', async () => {
      const body = {
        event: 'CONNECTION_OPENED',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(200);
      expect(mockAuditLogCreate).toHaveBeenCalledWith({
        userId: null,
        username: 'gateway',
        action: 'gateway.connection_opened',
        category: 'system',
        details: {
          severity: 'info',
          source: 'gateway',
        },
        ipAddress: null,
        userAgent: null,
        success: true,
        errorMsg: null,
      });
    });

    it('should return 400 when event is missing', async () => {
      const body = {
        category: 'auth',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Event type is required');
    });

    it('should return 403 without gateway signature', async () => {
      const res = await request(app).post('/api/v1/push/gateway-audit').send({
        event: 'AUTH_SUCCESS',
      });

      expect(res.status).toBe(403);
    });

    it('should return 500 on service error', async () => {
      mockAuditLogCreate.mockRejectedValueOnce(new Error('Database error'));

      const body = {
        event: 'AUTH_SUCCESS',
      };

      const path = '/api/v1/push/gateway-audit';
      const { signature, timestamp } = generateGatewaySignature('POST', path, body, 'test-gateway-secret');

      const res = await request(app)
        .post('/api/v1/push/gateway-audit')
        .set('X-Gateway-Signature', signature)
        .set('X-Gateway-Timestamp', timestamp)
        .send(body);

      expect(res.status).toBe(500);
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });
});
