import { describe, expect, it } from 'vitest';
import { adminRoutesRequest, mockAuditService } from './adminRoutesTestHarness';

export function registerAdminRoutesAuditVersionContracts(): void {
  describe('GET /api/v1/admin/audit-logs', () => {
    it('should return audit logs from auditService', async () => {
      mockAuditService.query.mockResolvedValue({
        logs: [
          {
            id: 'log-1',
            action: 'login',
            category: 'auth',
            userId: 'user-1',
            username: 'admin',
            success: true,
            createdAt: new Date(),
          },
        ],
        total: 1,
      });

      const response = await adminRoutesRequest().get('/api/v1/admin/audit-logs');

      expect(response.status).toBe(200);
      expect(response.body.logs).toHaveLength(1);
      expect(response.body.total).toBe(1);
    });

    it('should support pagination via query params', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await adminRoutesRequest()
        .get('/api/v1/admin/audit-logs')
        .query({ offset: 10, limit: 20 });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          offset: 10,
          limit: 20,
        })
      );
    });

    it('should filter by category', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await adminRoutesRequest()
        .get('/api/v1/admin/audit-logs')
        .query({ category: 'auth' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'auth' })
      );
    });

    it('should filter by username', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await adminRoutesRequest()
        .get('/api/v1/admin/audit-logs')
        .query({ username: 'admin' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin' })
      );
    });

    it('should filter by success flag when provided', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await adminRoutesRequest()
        .get('/api/v1/admin/audit-logs')
        .query({ success: 'false' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
    });

    it('should filter by date range', async () => {
      mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });

      const response = await adminRoutesRequest()
        .get('/api/v1/admin/audit-logs')
        .query({ startDate: '2024-01-01', endDate: '2024-12-31' });

      expect(response.status).toBe(200);
      expect(mockAuditService.query).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: expect.any(Date),
          endDate: expect.any(Date),
        })
      );
    });

    it('should handle service error', async () => {
      mockAuditService.query.mockRejectedValue(new Error('Service error'));

      const response = await adminRoutesRequest().get('/api/v1/admin/audit-logs');

      expect(response.status).toBe(500);
    });
  });

  describe('GET /api/v1/admin/audit-logs/stats', () => {
    it('should return audit log statistics', async () => {
      mockAuditService.getStats.mockResolvedValue({
        total: 1000,
        byAction: { login: 500, logout: 300 },
        byCategory: { auth: 800, user: 200 },
      });

      const response = await adminRoutesRequest().get('/api/v1/admin/audit-logs/stats');

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1000);
      expect(response.body.byAction).toBeDefined();
    });

    it('should support days query parameter', async () => {
      mockAuditService.getStats.mockResolvedValue({ total: 0, byAction: {}, byCategory: {} });

      const response = await adminRoutesRequest()
        .get('/api/v1/admin/audit-logs/stats')
        .query({ days: 7 });

      expect(response.status).toBe(200);
      expect(mockAuditService.getStats).toHaveBeenCalledWith(7);
    });

    it('should handle service error', async () => {
      mockAuditService.getStats.mockRejectedValue(new Error('Service error'));

      const response = await adminRoutesRequest().get('/api/v1/admin/audit-logs/stats');

      expect(response.status).toBe(500);
    });
  });

  // ========================================
  // VERSION
  // ========================================

  describe('GET /api/v1/admin/version', () => {
    it('should return version info', async () => {
      const response = await adminRoutesRequest().get('/api/v1/admin/version');

      expect(response.status).toBe(200);
      expect(response.body.currentVersion).toBeDefined();
    });
  });
}
