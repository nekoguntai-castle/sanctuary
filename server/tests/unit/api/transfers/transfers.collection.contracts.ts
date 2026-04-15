import { describe, expect, it } from 'vitest';

import {
  authHeader,
  getTransfersApp,
  mockGetAwaitingConfirmationCount,
  mockGetPendingIncomingCount,
  mockGetTransfer,
  mockGetUserTransfers,
  mockInitiateTransfer,
  recipientId,
  request,
  transferId,
  userId,
  walletId,
} from './transfersTestHarness';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../../../src/errors';

export function registerTransferCollectionTests(): void {
  describe('POST /api/v1/transfers', () => {
    it('should initiate a transfer successfully', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: 'test-user-123',
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: 'test-user-123', username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockInitiateTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      expect(res.body.resourceType).toBe('wallet');
      expect(mockInitiateTransfer).toHaveBeenCalled();
    });

    it('should return 400 when resourceType is missing', async () => {
      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('resourceType');
    });

    it('should return 400 when resourceId is missing', async () => {
      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          toUserId: recipientId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('resourceId');
    });

    it('should return 400 when toUserId is missing', async () => {
      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('toUserId');
    });

    it('should return 400 for invalid resource type', async () => {
      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'invalid',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('wallet');
    });

    it('should return 404 when resource not found', async () => {
      mockInitiateTransfer.mockRejectedValue(new NotFoundError('Resource', 'non-existent'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: 'non-existent',
          toUserId: recipientId,
        });

      expect(res.status).toBe(404);
    });

    it('should return 403 when user is not owner', async () => {
      mockInitiateTransfer.mockRejectedValue(new ForbiddenError('You are not the owner of this wallet'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(403);
    });

    it('should return 409 when transfer already pending', async () => {
      mockInitiateTransfer.mockRejectedValue(new ConflictError('This wallet already has a pending transfer'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(409);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(401);
    });

    it('should include optional fields in transfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'device',
        resourceId: 'device-123',
        fromUserId: 'test-user-123',
        toUserId: recipientId,
        status: 'pending',
        message: 'Here is my device',
        keepExistingUsers: true,
      };

      mockInitiateTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'device',
          resourceId: 'device-123',
          toUserId: recipientId,
          message: 'Here is my device',
          keepExistingUsers: true,
          expiresInDays: 7,
        });

      expect(res.status).toBe(201);
      expect(mockInitiateTransfer).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({
          resourceType: 'device',
          message: 'Here is my device',
          keepExistingUsers: true,
          expiresInDays: 7,
        }),
      );
    });
  });

  describe('GET /api/v1/transfers', () => {
    it('should return user transfers', async () => {
      const mockTransfers = {
        transfers: [
          {
            id: transferId,
            resourceType: 'wallet',
            status: 'pending',
            fromUser: { id: userId, username: 'owner' },
            toUser: { id: recipientId, username: 'recipient' },
          },
        ],
        total: 1,
      };

      mockGetUserTransfers.mockResolvedValue(mockTransfers);

      const res = await request(getTransfersApp())
        .get('/api/v1/transfers')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.transfers).toHaveLength(1);
      expect(res.body.total).toBe(1);
    });

    it('should filter transfers by role', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(getTransfersApp())
        .get('/api/v1/transfers?role=initiator')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({ role: 'initiator' }),
      );
    });

    it('should ignore invalid role filter', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(getTransfersApp())
        .get('/api/v1/transfers?role=invalid')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith('test-user-123', {});
    });

    it('should filter transfers by status', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(getTransfersApp())
        .get('/api/v1/transfers?status=pending')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('should filter transfers by resourceType', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(getTransfersApp())
        .get('/api/v1/transfers?resourceType=wallet')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith(
        'test-user-123',
        expect.objectContaining({ resourceType: 'wallet' }),
      );
    });

    it('should ignore invalid resourceType filter', async () => {
      mockGetUserTransfers.mockResolvedValue({ transfers: [], total: 0 });

      await request(getTransfersApp())
        .get('/api/v1/transfers?resourceType=invalid')
        .set('Authorization', authHeader);

      expect(mockGetUserTransfers).toHaveBeenCalledWith('test-user-123', {});
    });

    it('should return 500 on service error', async () => {
      mockGetUserTransfers.mockRejectedValue(new Error('Database error'));

      const res = await request(getTransfersApp())
        .get('/api/v1/transfers')
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
    });

    it('should return 401 without authentication', async () => {
      const res = await request(getTransfersApp()).get('/api/v1/transfers');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/transfers/counts', () => {
    it('should return transfer counts', async () => {
      mockGetPendingIncomingCount.mockResolvedValue(3);
      mockGetAwaitingConfirmationCount.mockResolvedValue(2);

      const res = await request(getTransfersApp())
        .get('/api/v1/transfers/counts')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        pendingIncoming: 3,
        awaitingConfirmation: 2,
        total: 5,
      });
    });

    it('should return zero counts when no transfers', async () => {
      mockGetPendingIncomingCount.mockResolvedValue(0);
      mockGetAwaitingConfirmationCount.mockResolvedValue(0);

      const res = await request(getTransfersApp())
        .get('/api/v1/transfers/counts')
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(0);
    });

    it('should return 500 on service error', async () => {
      mockGetPendingIncomingCount.mockRejectedValue(new Error('Database error'));

      const res = await request(getTransfersApp())
        .get('/api/v1/transfers/counts')
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
    });
  });

  describe('GET /api/v1/transfers/:id', () => {
    it('should return transfer details for initiator', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        fromUserId: 'test-user-123',
        toUserId: recipientId,
        status: 'pending',
        fromUser: { id: 'test-user-123', username: 'owner' },
        toUser: { id: recipientId, username: 'recipient' },
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(transferId);
    });

    it('should return transfer details for recipient', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: userId,
        toUserId: 'test-user-123',
        status: 'pending',
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
    });

    it('should return 404 for non-existent transfer', async () => {
      mockGetTransfer.mockResolvedValue(null);

      const res = await request(getTransfersApp())
        .get('/api/v1/transfers/non-existent')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 for non-involved user', async () => {
      const mockTransfer = {
        id: transferId,
        fromUserId: userId,
        toUserId: recipientId,
        status: 'pending',
      };

      mockGetTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 500 on service error', async () => {
      mockGetTransfer.mockRejectedValue(new Error('Database error'));

      const res = await request(getTransfersApp())
        .get(`/api/v1/transfers/${transferId}`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
    });
  });
}
