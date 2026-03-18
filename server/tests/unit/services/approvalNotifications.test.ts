/**
 * Approval Notifications Tests
 *
 * Tests notification dispatch for approval workflow events.
 * Covers all branches: no handlers, disabled handlers, missing notifyDraft,
 * successful dispatch, error handling, and mixed handler scenarios.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

const { mockLog, mockRegistry, mockGetErrorMessage } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  mockRegistry: {
    getDraftCapable: vi.fn(),
  },
  mockGetErrorMessage: vi.fn((err: unknown) => String(err)),
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLog,
}));

// Mock notification channel registry
vi.mock('../../../src/services/notifications/channels', () => ({
  notificationChannelRegistry: mockRegistry,
}));

// Mock error utility
vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: mockGetErrorMessage,
}));

import {
  notifyApprovalRequested,
  notifyApprovalResolved,
} from '../../../src/services/vaultPolicy/approvalNotifications';

describe('approvalNotifications', () => {
  const walletId = faker.string.uuid();
  const draftId = faker.string.uuid();
  const createdByUserId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // notifyApprovalRequested
  // ========================================

  describe('notifyApprovalRequested', () => {
    it('does nothing when no draft-capable handlers exist', async () => {
      mockRegistry.getDraftCapable.mockReturnValue([]);

      await notifyApprovalRequested(walletId, draftId, createdByUserId);

      expect(mockRegistry.getDraftCapable).toHaveBeenCalledTimes(1);
      expect(mockLog.debug).toHaveBeenCalledWith(
        'Sending approval requested notification',
        { walletId, draftId }
      );
    });

    it('skips handler that is not enabled', async () => {
      const handler = {
        id: 'test-channel',
        isEnabled: vi.fn().mockResolvedValue(false),
        notifyDraft: vi.fn(),
      };
      mockRegistry.getDraftCapable.mockReturnValue([handler]);

      await notifyApprovalRequested(walletId, draftId, createdByUserId);

      expect(handler.isEnabled).toHaveBeenCalledTimes(1);
      expect(handler.notifyDraft).not.toHaveBeenCalled();
    });

    it('skips handler that has no notifyDraft method', async () => {
      const handler = {
        id: 'no-draft-channel',
        isEnabled: vi.fn().mockResolvedValue(true),
        notifyDraft: undefined,
      };
      mockRegistry.getDraftCapable.mockReturnValue([handler]);

      await notifyApprovalRequested(walletId, draftId, createdByUserId);

      expect(handler.isEnabled).toHaveBeenCalledTimes(1);
    });

    it('calls notifyDraft with correct arguments when handler is enabled', async () => {
      const handler = {
        id: 'enabled-channel',
        isEnabled: vi.fn().mockResolvedValue(true),
        notifyDraft: vi.fn().mockResolvedValue(undefined),
      };
      mockRegistry.getDraftCapable.mockReturnValue([handler]);

      await notifyApprovalRequested(walletId, draftId, createdByUserId);

      expect(handler.notifyDraft).toHaveBeenCalledTimes(1);
      expect(handler.notifyDraft).toHaveBeenCalledWith(
        walletId,
        {
          id: draftId,
          amount: BigInt(0),
          recipient: '',
          label: '[Approval Required]',
          feeRate: 0,
        },
        createdByUserId
      );
    });

    it('catches error from handler and logs warning', async () => {
      const testError = new Error('channel exploded');
      const handler = {
        id: 'failing-channel',
        isEnabled: vi.fn().mockResolvedValue(true),
        notifyDraft: vi.fn().mockRejectedValue(testError),
      };
      mockRegistry.getDraftCapable.mockReturnValue([handler]);
      mockGetErrorMessage.mockReturnValue('channel exploded');

      await notifyApprovalRequested(walletId, draftId, createdByUserId);

      expect(mockGetErrorMessage).toHaveBeenCalledWith(testError);
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Failed to send approval notification via failing-channel',
        { error: 'channel exploded' }
      );
    });

    it('processes multiple handlers with mixed enabled/disabled states', async () => {
      const disabledHandler = {
        id: 'disabled',
        isEnabled: vi.fn().mockResolvedValue(false),
        notifyDraft: vi.fn(),
      };
      const enabledHandler = {
        id: 'enabled',
        isEnabled: vi.fn().mockResolvedValue(true),
        notifyDraft: vi.fn().mockResolvedValue(undefined),
      };
      const noDraftHandler = {
        id: 'no-draft',
        isEnabled: vi.fn().mockResolvedValue(true),
        notifyDraft: undefined,
      };
      const failingHandler = {
        id: 'failing',
        isEnabled: vi.fn().mockResolvedValue(true),
        notifyDraft: vi.fn().mockRejectedValue(new Error('boom')),
      };

      mockRegistry.getDraftCapable.mockReturnValue([
        disabledHandler,
        enabledHandler,
        noDraftHandler,
        failingHandler,
      ]);

      await notifyApprovalRequested(walletId, draftId, createdByUserId);

      // Disabled handler: checked isEnabled, notifyDraft not called
      expect(disabledHandler.isEnabled).toHaveBeenCalledTimes(1);
      expect(disabledHandler.notifyDraft).not.toHaveBeenCalled();

      // Enabled handler: notifyDraft called
      expect(enabledHandler.notifyDraft).toHaveBeenCalledTimes(1);

      // No-draft handler: isEnabled checked, but no notifyDraft to call
      expect(noDraftHandler.isEnabled).toHaveBeenCalledTimes(1);

      // Failing handler: notifyDraft called, error caught and logged
      expect(failingHandler.notifyDraft).toHaveBeenCalledTimes(1);
      expect(mockLog.warn).toHaveBeenCalledWith(
        'Failed to send approval notification via failing',
        expect.objectContaining({ error: expect.any(String) })
      );
    });
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
