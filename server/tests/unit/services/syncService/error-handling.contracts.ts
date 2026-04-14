import { describe, expect, it } from 'vitest';
import {
  mockPrismaClient,
  mockSyncWallet,
  setupSyncServiceErrorHandlingTestHooks,
} from './syncServiceTestHarness';

export function registerSyncServiceErrorHandlingTests(): void {
  describe('SyncService - Error Handling', () => {
    const context = setupSyncServiceErrorHandlingTestHooks();

    it('should handle Electrum connection failure', async () => {
      context.syncService['isRunning'] = true;
      mockSyncWallet.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await context.syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
    });

    it('should handle timeout errors', async () => {
      context.syncService['isRunning'] = true;
      mockSyncWallet.mockRejectedValue(new Error('Sync timeout: exceeded 120s limit'));

      const result = await context.syncService.syncNow('wallet-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
    });

    it('should handle database errors', async () => {
      context.syncService['isRunning'] = true;
      mockPrismaClient.wallet.update.mockRejectedValue(new Error('Database connection lost'));

      await expect(context.syncService.syncNow('wallet-1')).rejects.toThrow();
    });
  });
}
