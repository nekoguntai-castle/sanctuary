import { expect, it, vi } from "vitest";
import {
  mockGetWorkerHealthStatus,
  type SyncServiceTestContext,
} from "./syncServiceTestHarness";

export function registerSyncServicePollingModeTests(
  context: SyncServiceTestContext,
): void {
  describe("polling mode", () => {
    it("should start in-process polling when worker is unhealthy", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).not.toBeNull();
      expect(context.syncService["confirmationInterval"]).not.toBeNull();
    });

    it("should defer polling to worker when worker is healthy", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();
    });

    it("should always start reconciliation interval regardless of worker health", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService["reconciliationInterval"]).not.toBeNull();
    });

    it("should always start workerHealthPollTimer", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService["workerHealthPollTimer"]).not.toBeNull();
    });

    it("should transition from worker-delegated to in-process when worker goes down", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).not.toBeNull();
      expect(context.syncService["confirmationInterval"]).not.toBeNull();
    });

    it("should transition from in-process to worker-delegated when worker recovers", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();
    });

    it("should not double-start polling intervals", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      const firstSyncInterval = context.syncService["syncInterval"];
      const firstConfirmInterval = context.syncService["confirmationInterval"];

      context.syncService["startPollingIntervals"]();

      expect(context.syncService["syncInterval"]).toBe(firstSyncInterval);
      expect(context.syncService["confirmationInterval"]).toBe(
        firstConfirmInterval,
      );
    });

    it("should not evaluate polling mode when service is stopped", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();
      await context.syncService.stop();

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService["syncInterval"]).toBeNull();
    });

    it("should be no-op when worker stays healthy (already delegated)", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
    });

    it("should be no-op when worker stays unhealthy (already in-process)", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      const firstSyncInterval = context.syncService["syncInterval"];

      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).toBe(firstSyncInterval);
    });

    it("should clear workerHealthPollTimer on stop", async () => {
      await context.syncService.start();

      expect(context.syncService["workerHealthPollTimer"]).not.toBeNull();

      await context.syncService.stop();

      expect(context.syncService["workerHealthPollTimer"]).toBeNull();
    });

    it("should trigger evaluatePollingMode via the 30s timer", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
    });

    it("should handle full round-trip: healthy → unhealthy → healthy via timer", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).not.toBeNull();
      expect(context.syncService["confirmationInterval"]).not.toBeNull();
      const syncIntervalRef = context.syncService["syncInterval"];

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();
      expect(context.syncService["syncInterval"]).not.toBe(syncIntervalRef);
    });

    it("should increment transition metric on mode change", async () => {
      const { syncPollingModeTransitions } =
        await import("../../../../src/observability/metrics");
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      context.syncService["evaluatePollingMode"]();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: "worker-delegated",
        to: "in-process",
      });

      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService["evaluatePollingMode"]();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: "in-process",
        to: "worker-delegated",
      });
    });
  });
}
