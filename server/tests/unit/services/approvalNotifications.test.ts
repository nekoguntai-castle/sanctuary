/**
 * Approval Notifications Tests
 *
 * Tests notification dispatch for approval workflow events.
 * Covers the approval-resolved logging path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

import { notifyApprovalResolved } from '../../../src/services/vaultPolicy/approvalNotifications';

describe('approvalNotifications', () => {
  const walletId = faker.string.uuid();
  const draftId = faker.string.uuid();
  const createdByUserId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // notifyApprovalResolved
  // ========================================

  describe('notifyApprovalResolved', () => {
    it('logs the resolution with correct params', async () => {
      const resolvedByUserId = faker.string.uuid();

      await notifyApprovalResolved(walletId, draftId, 'approved', resolvedByUserId);

      expect(mockLog.debug).toHaveBeenCalledWith(
        'Sending approval resolved notification',
        { walletId, draftId, resolution: 'approved' }
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        'Approval resolved',
        { walletId, draftId, resolution: 'approved', resolvedByUserId }
      );
    });

    it('logs correctly when resolvedByUserId is null', async () => {
      await notifyApprovalResolved(walletId, draftId, 'vetoed', null);

      expect(mockLog.debug).toHaveBeenCalledWith(
        'Sending approval resolved notification',
        { walletId, draftId, resolution: 'vetoed' }
      );
      expect(mockLog.info).toHaveBeenCalledWith(
        'Approval resolved',
        { walletId, draftId, resolution: 'vetoed', resolvedByUserId: null }
      );
    });

    it('logs correctly for rejected resolution', async () => {
      const resolvedByUserId = faker.string.uuid();

      await notifyApprovalResolved(walletId, draftId, 'rejected', resolvedByUserId);

      expect(mockLog.info).toHaveBeenCalledWith(
        'Approval resolved',
        { walletId, draftId, resolution: 'rejected', resolvedByUserId }
      );
    });

    it('logs correctly for overridden resolution', async () => {
      const resolvedByUserId = faker.string.uuid();

      await notifyApprovalResolved(walletId, draftId, 'overridden', resolvedByUserId);

      expect(mockLog.info).toHaveBeenCalledWith(
        'Approval resolved',
        { walletId, draftId, resolution: 'overridden', resolvedByUserId }
      );
    });
  });
});
