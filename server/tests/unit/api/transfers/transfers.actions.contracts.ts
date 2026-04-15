import { describe, expect, it } from 'vitest';

import {
  authHeader,
  getTransfersApp,
  mockAcceptTransfer,
  mockCancelTransfer,
  mockConfirmTransfer,
  mockDeclineTransfer,
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
  InvalidInputError,
  NotFoundError,
} from '../../../../src/errors';

export function registerTransferActionTests(): void {
  describe('POST /api/v1/transfers/:id/accept', () => {
    it('should accept a pending transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
        fromUser: { id: userId, username: 'owner' },
        toUser: { id: 'test-user-123', username: 'recipient' },
      };

      mockAcceptTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('accepted');
      expect(mockAcceptTransfer).toHaveBeenCalledWith('test-user-123', transferId);
    });

    it('should return 404 when transfer not found', async () => {
      mockAcceptTransfer.mockRejectedValue(new NotFoundError('Transfer', 'non-existent'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers/non-existent/accept')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not recipient', async () => {
      mockAcceptTransfer.mockRejectedValue(new ForbiddenError('Only the recipient can accept this transfer'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be accepted', async () => {
      mockAcceptTransfer.mockRejectedValue(new InvalidInputError('Transfer cannot be accepted'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('should return 400 when transfer expired', async () => {
      mockAcceptTransfer.mockRejectedValue(new InvalidInputError('Transfer has expired'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/accept`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/transfers/:id/decline', () => {
    it('should decline a pending transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'declined',
        declineReason: 'Not interested',
      };

      mockDeclineTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader)
        .send({ reason: 'Not interested' });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('declined');
      expect(mockDeclineTransfer).toHaveBeenCalledWith('test-user-123', transferId, 'Not interested');
    });

    it('should decline without reason', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'declined',
      };

      mockDeclineTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(mockDeclineTransfer).toHaveBeenCalledWith('test-user-123', transferId, undefined);
    });

    it('should return 404 when transfer not found', async () => {
      mockDeclineTransfer.mockRejectedValue(new NotFoundError('Transfer', 'non-existent'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers/non-existent/decline')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not recipient', async () => {
      mockDeclineTransfer.mockRejectedValue(new ForbiddenError('Only the recipient can decline this transfer'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be declined', async () => {
      mockDeclineTransfer.mockRejectedValue(new InvalidInputError('Transfer cannot be declined'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/decline`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/transfers/:id/cancel', () => {
    it('should cancel a transfer', async () => {
      const mockTransfer = {
        id: transferId,
        status: 'cancelled',
        cancelledAt: new Date().toISOString(),
      };

      mockCancelTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/cancel`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('cancelled');
      expect(mockCancelTransfer).toHaveBeenCalledWith('test-user-123', transferId);
    });

    it('should return 404 when transfer not found', async () => {
      mockCancelTransfer.mockRejectedValue(new NotFoundError('Transfer', 'non-existent'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers/non-existent/cancel')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not initiator', async () => {
      mockCancelTransfer.mockRejectedValue(new ForbiddenError('Only the transfer initiator can cancel'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/cancel`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 400 when transfer cannot be cancelled', async () => {
      mockCancelTransfer.mockRejectedValue(new InvalidInputError('Transfer cannot be cancelled'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/cancel`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/transfers/:id/confirm', () => {
    it('should confirm an accepted transfer', async () => {
      const mockTransfer = {
        id: transferId,
        resourceType: 'wallet',
        resourceId: walletId,
        status: 'completed',
        confirmedAt: new Date().toISOString(),
      };

      mockConfirmTransfer.mockResolvedValue(mockTransfer);

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('completed');
      expect(mockConfirmTransfer).toHaveBeenCalledWith('test-user-123', transferId);
    });

    it('should return 404 when transfer not found', async () => {
      mockConfirmTransfer.mockRejectedValue(new NotFoundError('Transfer', 'non-existent'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers/non-existent/confirm')
        .set('Authorization', authHeader);

      expect(res.status).toBe(404);
    });

    it('should return 403 when not initiator', async () => {
      mockConfirmTransfer.mockRejectedValue(new ForbiddenError('Only the transfer initiator can confirm'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(403);
    });

    it('should return 409 when no longer owner', async () => {
      mockConfirmTransfer.mockRejectedValue(new ConflictError('Transfer failed: owner no longer owns this wallet'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(409);
    });

    it('should return 400 when transfer cannot be confirmed', async () => {
      mockConfirmTransfer.mockRejectedValue(new InvalidInputError('Transfer cannot be confirmed'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('should return 400 when transfer expired', async () => {
      mockConfirmTransfer.mockRejectedValue(new InvalidInputError('Transfer has expired'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(400);
    });

    it('should return 500 when transfer execution fails', async () => {
      mockConfirmTransfer.mockRejectedValue(new Error('Transfer failed during execution'));

      const res = await request(getTransfersApp())
        .post(`/api/v1/transfers/${transferId}/confirm`)
        .set('Authorization', authHeader);

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('Error Handling', () => {
    it('should return 500 for unexpected errors', async () => {
      mockInitiateTransfer.mockRejectedValue(new Error('Unexpected error'));

      const res = await request(getTransfersApp())
        .post('/api/v1/transfers')
        .set('Authorization', authHeader)
        .send({
          resourceType: 'wallet',
          resourceId: walletId,
          toUserId: recipientId,
        });

      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });
  });
}
