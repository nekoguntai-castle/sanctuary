import { describe, it, expect, vi, beforeEach } from "vitest";

const mockJobGetState = vi.fn().mockResolvedValue("waiting");
const mockJobRemove = vi.fn().mockResolvedValue(undefined);
const mockQueueGetJob = vi.fn();
const mockQueueAdd = vi.fn().mockResolvedValue({
  id: "job-1",
  getState: mockJobGetState,
  remove: mockJobRemove,
});
const mockQueueClose = vi.fn().mockResolvedValue(undefined);
const mockRecordNotificationTelemetry = vi.hoisted(() => vi.fn());

vi.mock("bullmq", () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: mockQueueAdd,
      close: mockQueueClose,
      getJob: mockQueueGetJob,
    };
  }),
}));

vi.mock("../../../src/infrastructure/redis", () => ({
  getRedisClient: vi.fn(() => ({
    options: { host: "localhost", port: 6379 },
  })),
  isRedisConnected: vi.fn(() => true),
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../src/services/notifications/telemetry", () => ({
  recordNotificationTelemetry: mockRecordNotificationTelemetry,
}));

import {
  queueConsolidationSuggestionNotification,
  queueDraftNotification,
  queueWebhookDeliveryNotification,
  queueTransactionNotification,
  shutdownNotificationDispatcher,
} from "../../../src/infrastructure/notificationDispatcher";
import { toBullMqJobId } from "../../../src/jobs/bullMqJobIds";
import {
  getRedisClient,
  isRedisConnected,
} from "../../../src/infrastructure/redis";

function createConsolidationSuggestionPayload() {
  return {
    walletId: "w1",
    walletName: "Treasury",
    feeRate: 5,
    utxoHealth: {
      totalUtxos: 20,
      dustCount: 3,
      dustValue: "15000",
      totalValue: "500000",
      avgUtxoSize: "25000",
      smallestUtxo: "500",
      largestUtxo: "100000",
      consolidationCandidates: 20,
    },
    estimatedSavings: "~20,400 sats",
    reason: "Fees are low.",
    notifyTelegram: true,
    notifyPush: false,
    queuedAt: "2026-04-25T00:00:00.000Z",
  };
}

describe("notificationDispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockJobGetState.mockResolvedValue("waiting");
    mockJobRemove.mockResolvedValue(undefined);
    mockQueueAdd.mockResolvedValue({
      id: "job-1",
      getState: mockJobGetState,
      remove: mockJobRemove,
    });
    // Reset the module-level queue by shutting down between tests
    return shutdownNotificationDispatcher();
  });

  it("queues a transaction notification and returns a safe resolved outcome", async () => {
    const result = await queueTransactionNotification({
      walletId: "w1",
      txid: "tx1",
      type: "received",
      amount: "100000",
    });

    expect(result).toEqual({
      outcome: "resolved",
      failureClass: "none",
      deduplication: "unknown",
    });
    expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith({
      family: "transaction",
      stage: "enqueue_resolved",
      path: "queued",
      channel: "none",
      outcome: "none",
      failureClass: "none",
    });
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "transaction-notify",
      { walletId: "w1", txid: "tx1", type: "received", amount: "100000" },
      { jobId: toBullMqJobId("txnotify:w1:tx1") },
    );
  });

  it("queues a consolidation suggestion notification and returns true", async () => {
    const result = await queueConsolidationSuggestionNotification(
      createConsolidationSuggestionPayload(),
    );

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "consolidation-suggestion-notify",
      expect.objectContaining({
        walletId: "w1",
        walletName: "Treasury",
        notifyTelegram: true,
        notifyPush: false,
      }),
      {
        jobId: toBullMqJobId(
          "consolidation-suggestion:w1:2026-04-25T00:00:00.000Z",
        ),
      },
    );
  });

  it("queues a draft notification with the full agent-context payload", async () => {
    const result = await queueDraftNotification({
      walletId: "w1",
      draftId: "draft-1",
      creatorUserId: "user-1",
      creatorUsername: "alice",
      creatorLabel: "Autopilot",
      agentId: "agent-7",
      agentName: "Autopilot",
      agentOperationalWalletId: "op-9",
      agentSigned: true,
      dedupeKey: "agent:agent-7:w1:op-9:bc1q...:1500",
    });

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "draft-notify",
      expect.objectContaining({
        walletId: "w1",
        draftId: "draft-1",
        agentId: "agent-7",
        creatorLabel: "Autopilot",
      }),
      {
        jobId: toBullMqJobId(
          "draftnotify:w1:agent:agent-7:w1:op-9:bc1q...:1500",
        ),
      },
    );
  });

  it("queues a webhook delivery notification with retry delay", async () => {
    const result = await queueWebhookDeliveryNotification(
      { deliveryId: "delivery-1", attempt: 2 },
      { delayMs: 5000 },
    );

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "webhook-delivery",
      { deliveryId: "delivery-1", attempt: 2 },
      {
        jobId: toBullMqJobId("webhook-delivery:delivery-1:2"),
        delay: 5000,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it("uses attempt zero in webhook delivery job ids when attempt is absent", async () => {
    const result = await queueWebhookDeliveryNotification({ deliveryId: "delivery-2" });

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "webhook-delivery",
      { deliveryId: "delivery-2" },
      {
        jobId: toBullMqJobId("webhook-delivery:delivery-2:0"),
        delay: undefined,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it.each(["completed", "failed", "unknown"])(
    "revives a retained %s webhook attempt with the same deterministic id",
    async (state) => {
      mockJobGetState.mockResolvedValueOnce(state);

      const result = await queueWebhookDeliveryNotification({
        deliveryId: "retained-delivery",
        attempt: 1,
      });

      expect(result).toBe(true);
      expect(mockJobRemove).toHaveBeenCalledTimes(1);
      expect(mockQueueAdd).toHaveBeenCalledTimes(2);
      expect(mockQueueAdd.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
        jobId: toBullMqJobId("webhook-delivery:retained-delivery:1"),
      }));
    },
  );

  it.each(["waiting", "delayed", "active"])(
    "accepts an existing %s webhook attempt without duplicating it",
    async (state) => {
      mockJobGetState.mockResolvedValueOnce(state);

      await expect(queueWebhookDeliveryNotification({
        deliveryId: "live-delivery",
        attempt: 2,
      })).resolves.toBe(true);

      expect(mockJobRemove).not.toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    },
  );

  it("accepts a replacement queued concurrently after retained-job removal loses the race", async () => {
    const replacement = {
      id: "replacement",
      getState: vi.fn().mockResolvedValue("waiting"),
      remove: vi.fn(),
    };
    mockJobGetState.mockResolvedValueOnce("completed");
    mockJobRemove.mockRejectedValueOnce(new Error("job no longer exists"));
    mockQueueGetJob.mockResolvedValueOnce(replacement);

    await expect(queueWebhookDeliveryNotification({
      deliveryId: "raced-delivery",
      attempt: 1,
    })).resolves.toBe(true);

    expect(mockQueueGetJob).toHaveBeenCalledWith(
      toBullMqJobId("webhook-delivery:raced-delivery:1"),
    );
    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("requeues when a retained job disappears during removal", async () => {
    mockJobGetState.mockResolvedValueOnce("completed");
    mockJobRemove.mockRejectedValueOnce(new Error("job no longer exists"));
    mockQueueGetJob.mockResolvedValueOnce(undefined);

    await expect(queueWebhookDeliveryNotification({
      deliveryId: "removed-delivery",
      attempt: 1,
    })).resolves.toBe(true);

    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
  });

  it("returns false when a retained terminal job cannot be removed", async () => {
    const retained = {
      id: "retained",
      getState: vi.fn().mockResolvedValue("failed"),
      remove: vi.fn(),
    };
    mockJobGetState.mockResolvedValueOnce("failed");
    mockJobRemove.mockRejectedValueOnce(new Error("Redis removal failed"));
    mockQueueGetJob.mockResolvedValueOnce(retained);

    await expect(queueWebhookDeliveryNotification({
      deliveryId: "stuck-delivery",
      attempt: 1,
    })).resolves.toBe(false);

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
  });

  it("returns false for webhook delivery notifications when Redis is not connected", async () => {
    vi.mocked(isRedisConnected).mockReturnValueOnce(false);

    const result = await queueWebhookDeliveryNotification({ deliveryId: "delivery-1", attempt: 1 });

    expect(result).toBe(false);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns false when webhook delivery queue add fails", async () => {
    await queueTransactionNotification({
      walletId: "w1",
      txid: "tx-ok",
      type: "received",
      amount: "100",
    });
    mockQueueAdd.mockRejectedValueOnce(new Error("Redis timeout"));

    const result = await queueWebhookDeliveryNotification({ deliveryId: "delivery-1", attempt: 1 });

    expect(result).toBe(false);
  });

  it("falls back to a draft+creator job id when no dedupeKey is provided", async () => {
    const result = await queueDraftNotification({
      walletId: "w1",
      draftId: "draft-2",
      creatorUserId: "user-1",
    });

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "draft-notify",
      expect.objectContaining({ draftId: "draft-2" }),
      { jobId: toBullMqJobId("draftnotify:w1:draft-2:user-1") },
    );
  });

  it('uses "system" suffix when both dedupeKey and creatorUserId are absent', async () => {
    const result = await queueDraftNotification({
      walletId: "w1",
      draftId: "draft-3",
      creatorUserId: null,
    });

    expect(result).toBe(true);
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "draft-notify",
      expect.anything(),
      { jobId: toBullMqJobId("draftnotify:w1:draft-3:system") },
    );
  });

  it("returns false for draft notifications when Redis is not connected", async () => {
    vi.mocked(isRedisConnected).mockReturnValueOnce(false);

    const result = await queueDraftNotification({
      walletId: "w1",
      draftId: "d1",
      creatorUserId: "u1",
    });

    expect(result).toBe(false);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("returns false when draft queue add fails", async () => {
    await queueTransactionNotification({
      walletId: "w1",
      txid: "tx-ok",
      type: "received",
      amount: "100",
    });
    mockQueueAdd.mockRejectedValueOnce(new Error("Redis timeout"));

    const result = await queueDraftNotification({
      walletId: "w1",
      draftId: "d1",
      creatorUserId: "u1",
    });

    expect(result).toBe(false);
  });

  it("returns false for consolidation suggestions when Redis is not connected", async () => {
    vi.mocked(isRedisConnected).mockReturnValueOnce(false);

    const result = await queueConsolidationSuggestionNotification(
      createConsolidationSuggestionPayload(),
    );

    expect(result).toBe(false);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("classifies disconnected Redis without exposing connection details", async () => {
    vi.mocked(isRedisConnected).mockReturnValueOnce(false);

    const result = await queueTransactionNotification({
      walletId: "w1",
      txid: "tx1",
      type: "received",
      amount: "100000",
    });

    expect(result).toEqual({
      outcome: "failed",
      failureClass: "redis_unavailable",
      deduplication: "unknown",
    });
    expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "enqueue_failed",
        failureClass: "redis_unavailable",
      }),
    );
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });

  it("classifies a missing Redis client as unavailable", async () => {
    vi.mocked(getRedisClient).mockReturnValueOnce(null as any);

    const result = await queueTransactionNotification({
      walletId: "w1",
      txid: "tx1",
      type: "received",
      amount: "100000",
    });

    expect(result).toEqual({
      outcome: "failed",
      failureClass: "redis_unavailable",
      deduplication: "unknown",
    });
    expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "enqueue_failed",
        failureClass: "redis_unavailable",
      }),
    );
  });

  it("returns false when consolidation suggestion queue add fails", async () => {
    await queueTransactionNotification({
      walletId: "w1",
      txid: "tx-ok",
      type: "received",
      amount: "100",
    });
    mockQueueAdd.mockRejectedValueOnce(new Error("Redis timeout"));

    const result = await queueConsolidationSuggestionNotification(
      createConsolidationSuggestionPayload(),
    );

    expect(result).toBe(false);
  });

  it("classifies queue-add failures without returning the thrown detail", async () => {
    // First call succeeds to create the queue
    await queueTransactionNotification({
      walletId: "w1",
      txid: "tx-ok",
      type: "received",
      amount: "100",
    });

    // Now make add fail
    mockQueueAdd.mockRejectedValueOnce(new Error("Redis timeout"));

    const result = await queueTransactionNotification({
      walletId: "w1",
      txid: "tx-fail",
      type: "received",
      amount: "200",
    });

    expect(result).toEqual({
      outcome: "failed",
      failureClass: "queue_add_failed",
      deduplication: "unknown",
    });
    expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "enqueue_failed",
        failureClass: "queue_add_failed",
      }),
    );
  });

  it("shutdownNotificationDispatcher closes the queue", async () => {
    // Create the queue by queueing something
    await queueTransactionNotification({
      walletId: "w1",
      txid: "tx1",
      type: "received",
      amount: "100",
    });

    await shutdownNotificationDispatcher();
    expect(mockQueueClose).toHaveBeenCalled();

    // Calling again is a no-op
    mockQueueClose.mockClear();
    await shutdownNotificationDispatcher();
    expect(mockQueueClose).not.toHaveBeenCalled();
  });
});
