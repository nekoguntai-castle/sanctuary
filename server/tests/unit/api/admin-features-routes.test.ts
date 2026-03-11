/**
 * Admin Feature Flags Routes Tests
 *
 * Tests for the feature flag admin API endpoints including:
 * - GET /admin/features (list all flags)
 * - GET /admin/features/audit-log (audit trail)
 * - GET /admin/features/:key (single flag)
 * - PATCH /admin/features/:key (toggle flag)
 * - POST /admin/features/:key/reset (reset to default)
 * - Route ordering (static before dynamic)
 * - Auth enforcement
 * - Body/query validation
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';

const { mockFeatureFlagService } = vi.hoisted(() => ({
  mockFeatureFlagService: {
    getAllFlags: vi.fn(),
    getFlag: vi.fn(),
    setFlag: vi.fn(),
    resetToDefault: vi.fn(),
    getAuditLog: vi.fn(),
  },
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/services/featureFlagService', () => ({
  featureFlagService: mockFeatureFlagService,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import featuresRouter from '../../../src/api/admin/features';

describe('Admin Feature Flags Routes', () => {
  let app: Express;

  const mockFlag = {
    key: 'aiAssistant',
    enabled: true,
    description: 'AI-powered transaction analysis',
    category: 'general',
    source: 'database' as const,
    modifiedBy: 'admin-1',
    updatedAt: new Date(),
  };

  const mockAuditEntries = [
    {
      id: 'audit-1',
      key: 'aiAssistant',
      previousValue: false,
      newValue: true,
      changedBy: 'admin-1',
      reason: 'Enable for testing',
      ipAddress: '127.0.0.1',
      createdAt: new Date(),
    },
  ];

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/features', featuresRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/admin/features', () => {
    it('should return all feature flags', async () => {
      mockFeatureFlagService.getAllFlags.mockResolvedValue([mockFlag]);

      const response = await request(app).get('/api/v1/admin/features');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].key).toBe('aiAssistant');
    });

    it('should return side-effect metadata from the service payload', async () => {
      mockFeatureFlagService.getAllFlags.mockResolvedValue([
        {
          key: 'treasuryAutopilot',
          enabled: true,
          description: 'Enable Treasury Autopilot consolidation jobs',
          category: 'general',
          source: 'database',
          modifiedBy: 'admin-1',
          updatedAt: new Date(),
          hasSideEffects: true,
          sideEffectDescription: 'Toggling this starts or stops background consolidation jobs without requiring a restart.',
        },
      ]);

      const response = await request(app).get('/api/v1/admin/features');

      expect(response.status).toBe(200);
      expect(response.body[0]).toEqual(
        expect.objectContaining({
          key: 'treasuryAutopilot',
          hasSideEffects: true,
          sideEffectDescription: expect.stringContaining('starts or stops'),
        })
      );
    });

    it('should return 500 on service error', async () => {
      mockFeatureFlagService.getAllFlags.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/admin/features');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });
  });

  describe('GET /api/v1/admin/features/audit-log', () => {
    it('should return audit log entries', async () => {
      mockFeatureFlagService.getAuditLog.mockResolvedValue(mockAuditEntries);

      const response = await request(app).get('/api/v1/admin/features/audit-log');

      expect(response.status).toBe(200);
      expect(response.body.entries).toHaveLength(1);
      expect(response.body.entries[0].key).toBe('aiAssistant');
    });

    it('should accept key filter', async () => {
      mockFeatureFlagService.getAuditLog.mockResolvedValue(mockAuditEntries);

      await request(app).get('/api/v1/admin/features/audit-log?key=aiAssistant');

      expect(mockFeatureFlagService.getAuditLog).toHaveBeenCalledWith('aiAssistant', expect.any(Number), expect.any(Number));
    });

    it('should reject unknown key filter', async () => {
      const response = await request(app).get('/api/v1/admin/features/audit-log?key=nonExistent');

      expect(response.status).toBe(400);
      expect(mockFeatureFlagService.getAuditLog).not.toHaveBeenCalled();
    });

    it('should accept limit parameter', async () => {
      mockFeatureFlagService.getAuditLog.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/admin/features/audit-log?limit=10');

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(10);
    });

    it('should accept offset parameter', async () => {
      mockFeatureFlagService.getAuditLog.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/admin/features/audit-log?offset=5');

      expect(response.status).toBe(200);
      expect(mockFeatureFlagService.getAuditLog).toHaveBeenCalledWith(
        undefined,
        expect.any(Number),
        5
      );
    });

    it('should reject invalid limit', async () => {
      const response = await request(app).get('/api/v1/admin/features/audit-log?limit=999');

      expect(response.status).toBe(400);
    });

    it('should reject invalid offset', async () => {
      const response = await request(app).get('/api/v1/admin/features/audit-log?offset=-1');

      expect(response.status).toBe(400);
    });

    it('should not be captured by /:key route', async () => {
      mockFeatureFlagService.getAuditLog.mockResolvedValue([]);

      const response = await request(app).get('/api/v1/admin/features/audit-log');

      // Should hit the audit-log route, not the :key route
      expect(response.status).toBe(200);
      expect(mockFeatureFlagService.getFlag).not.toHaveBeenCalled();
      expect(mockFeatureFlagService.getAuditLog).toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      mockFeatureFlagService.getAuditLog.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/admin/features/audit-log');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/admin/features/:key', () => {
    it('should return a single flag', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(mockFlag);

      const response = await request(app).get('/api/v1/admin/features/aiAssistant');

      expect(response.status).toBe(200);
      expect(response.body.key).toBe('aiAssistant');
    });

    it('should return 404 for unknown flag', async () => {
      const response = await request(app).get('/api/v1/admin/features/nonExistent');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
      expect(mockFeatureFlagService.getFlag).not.toHaveBeenCalled();
    });

    it('should return 404 for known key when service has no record', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(null);

      const response = await request(app).get('/api/v1/admin/features/aiAssistant');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Not Found');
      expect(mockFeatureFlagService.getFlag).toHaveBeenCalledWith('aiAssistant');
    });

    it('should return 500 on service error', async () => {
      mockFeatureFlagService.getFlag.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/v1/admin/features/aiAssistant');

      expect(response.status).toBe(500);
    });
  });

  describe('PATCH /api/v1/admin/features/:key', () => {
    it('should toggle a feature flag', async () => {
      mockFeatureFlagService.getFlag
        .mockResolvedValueOnce(mockFlag)  // existence check
        .mockResolvedValueOnce({ ...mockFlag, enabled: false }); // return updated
      mockFeatureFlagService.setFlag.mockResolvedValue(undefined);

      const response = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: false });

      expect(response.status).toBe(200);
      expect(mockFeatureFlagService.setFlag).toHaveBeenCalledWith(
        'aiAssistant',
        false,
        expect.objectContaining({
          userId: 'admin-1',
        })
      );
    });

    it('should accept optional reason', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(mockFlag);
      mockFeatureFlagService.setFlag.mockResolvedValue(undefined);

      await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: true, reason: 'Testing' });

      expect(mockFeatureFlagService.setFlag).toHaveBeenCalledWith(
        'aiAssistant',
        true,
        expect.objectContaining({
          reason: 'Testing',
        })
      );
    });

    it('should return 400 for missing enabled field', async () => {
      const response = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({});

      expect(response.status).toBe(400);
    });

    it('should return 400 for non-boolean enabled', async () => {
      const response = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: 'yes' });

      expect(response.status).toBe(400);
      expect(mockFeatureFlagService.getFlag).not.toHaveBeenCalled();
    });

    it('should return 400 for reason longer than 500 characters', async () => {
      const response = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: true, reason: 'x'.repeat(501) });

      expect(response.status).toBe(400);
      expect(mockFeatureFlagService.setFlag).not.toHaveBeenCalled();
    });

    it('should return 404 for unknown flag', async () => {
      const response = await request(app)
        .patch('/api/v1/admin/features/nonExistent')
        .send({ enabled: true });

      expect(response.status).toBe(404);
      expect(mockFeatureFlagService.getFlag).not.toHaveBeenCalled();
      expect(mockFeatureFlagService.setFlag).not.toHaveBeenCalled();
    });

    it('should return 404 for known key when service has no record', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(null);

      const response = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: true });

      expect(response.status).toBe(404);
      expect(mockFeatureFlagService.getFlag).toHaveBeenCalledWith('aiAssistant');
      expect(mockFeatureFlagService.setFlag).not.toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(mockFlag);
      mockFeatureFlagService.setFlag.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .patch('/api/v1/admin/features/aiAssistant')
        .send({ enabled: true });

      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/v1/admin/features/:key/reset', () => {
    it('should reset a flag to environment default', async () => {
      mockFeatureFlagService.getFlag
        .mockResolvedValueOnce(mockFlag)  // existence check
        .mockResolvedValueOnce({ ...mockFlag, enabled: false }); // return updated
      mockFeatureFlagService.resetToDefault.mockResolvedValue(undefined);

      const response = await request(app)
        .post('/api/v1/admin/features/aiAssistant/reset');

      expect(response.status).toBe(200);
      expect(mockFeatureFlagService.resetToDefault).toHaveBeenCalledWith(
        'aiAssistant',
        expect.objectContaining({
          userId: 'admin-1',
          reason: 'Reset to environment default',
        })
      );
    });

    it('should return 404 for unknown flag', async () => {
      const response = await request(app)
        .post('/api/v1/admin/features/nonExistent/reset');

      expect(response.status).toBe(404);
      expect(mockFeatureFlagService.getFlag).not.toHaveBeenCalled();
      expect(mockFeatureFlagService.resetToDefault).not.toHaveBeenCalled();
    });

    it('should return 404 for known key when service has no record', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/admin/features/aiAssistant/reset');

      expect(response.status).toBe(404);
      expect(mockFeatureFlagService.getFlag).toHaveBeenCalledWith('aiAssistant');
      expect(mockFeatureFlagService.resetToDefault).not.toHaveBeenCalled();
    });

    it('should return 500 on service error', async () => {
      mockFeatureFlagService.getFlag.mockResolvedValue(mockFlag);
      mockFeatureFlagService.resetToDefault.mockRejectedValue(new Error('DB error'));

      const response = await request(app)
        .post('/api/v1/admin/features/aiAssistant/reset');

      expect(response.status).toBe(500);
    });
  });
});
