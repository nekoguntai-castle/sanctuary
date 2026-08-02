/**
 * Notification Dispatcher
 *
 * Thin wrapper around a BullMQ Queue that dispatches notification jobs
 * to the worker's `notifications` queue for retry-capable delivery.
 *
 * Falls back to inline delivery when Redis is unavailable.
 */

import {
  Queue,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
} from "bullmq";
import { getRedisClient, isRedisConnected } from "./redis";
import { createLogger } from "../utils/logger";
import { getErrorMessage } from "../utils/errors";
import { toBullMqJobId } from "../jobs/bullMqJobIds";
import type { NotificationFailureClass } from "../services/notifications/outcomes";
import { recordNotificationTelemetry } from "../services/notifications/telemetry";
import { controlledCaptureObservations } from "../services/supportPackage/capture";
import {
  DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS,
  notificationRetentionJobOptions,
} from "../internal/notificationRetention";

const log = createLogger("INFRA:NOTIFY_DISPATCH");

const QUEUE_NAME = "notifications";
const QUEUE_PREFIX = "sanctuary:worker";

let notificationQueue: Queue | null = null;

/**
 * Get or lazily create the BullMQ notifications queue.
 * Returns null if Redis is unavailable.
 */
function getQueue(): Queue | null {
  if (notificationQueue) return notificationQueue;

  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return null;

  const connection: ConnectionOptions = {
    host: redis.options.host,
    port: redis.options.port,
    password: redis.options.password,
    db: redis.options.db,
  };

  notificationQueue = new Queue(QUEUE_NAME, {
    connection,
    prefix: QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      ...DEFAULT_NOTIFICATION_RETENTION_JOB_OPTIONS,
    },
  });

  log.info("Notification dispatch queue created");
  return notificationQueue;
}

export interface TransactionNotificationPayload {
  walletId: string;
  txid: string;
  type: "received" | "sent" | "consolidation";
  amount: string;
  feeSats?: string | null;
}

export interface TransactionEnqueueResult {
  outcome: "resolved" | "failed";
  failureClass: Extract<
    NotificationFailureClass,
    "none" | "redis_unavailable" | "queue_add_failed"
  >;
  /** BullMQ does not authoritatively distinguish creation from stable-ID reuse here. */
  deduplication: "unknown";
}

export interface DraftNotificationPayload {
  walletId: string;
  draftId: string;
  creatorUserId: string | null;
  creatorUsername?: string;
  creatorLabel?: string;
  agentId?: string | null;
  agentName?: string | null;
  agentOperationalWalletId?: string | null;
  agentSigned?: boolean;
  dedupeKey?: string;
}

export interface ConsolidationSuggestionNotificationPayload {
  walletId: string;
  walletName: string;
  feeRate: number;
  utxoHealth: {
    totalUtxos: number;
    dustCount: number;
    dustValue: string;
    totalValue: string;
    avgUtxoSize?: string;
    smallestUtxo?: string;
    largestUtxo?: string;
    consolidationCandidates?: number;
  };
  estimatedSavings: string;
  reason: string;
  notifyTelegram: boolean;
  notifyPush: boolean;
  queuedAt: string;
}

export interface WebhookDeliveryNotificationPayload {
  deliveryId: string;
  attempt?: number;
}

type WebhookQueueJob = Job<WebhookDeliveryNotificationPayload>;

/**
 * Queue a transaction notification for retry-capable delivery.
 * Reports queue resolution without claiming whether BullMQ created or reused
 * the stable-ID job.
 */
export async function queueTransactionNotification(
  payload: TransactionNotificationPayload,
): Promise<TransactionEnqueueResult> {
  const queue = getQueue();
  if (!queue) {
    recordEnqueueTelemetry("enqueue_failed", "redis_unavailable");
    controlledCaptureObservations.recordProducer({
      walletId: payload.walletId,
      txid: payload.txid,
      outcome: 'rejected',
      failureClass: 'redis_unavailable',
      path: 'queued',
    });
    return {
      outcome: "failed",
      failureClass: "redis_unavailable",
      deduplication: "unknown",
    };
  }

  try {
    await queue.add("transaction-notify", payload, {
      jobId: toBullMqJobId(`txnotify:${payload.walletId}:${payload.txid}`),
    });
    log.debug("Transaction notification queued", {
      walletId: payload.walletId,
      txid: payload.txid,
    });
    recordEnqueueTelemetry("enqueue_resolved", "none");
    controlledCaptureObservations.recordProducer({
      walletId: payload.walletId,
      txid: payload.txid,
      outcome: 'accepted',
      failureClass: 'none',
      path: 'queued',
    });
    return {
      outcome: "resolved",
      failureClass: "none",
      deduplication: "unknown",
    };
  } catch (error) {
    log.warn(
      "Failed to queue transaction notification, caller should fall back to inline",
      {
        error: getErrorMessage(error),
        txid: payload.txid,
      },
    );
    recordEnqueueTelemetry("enqueue_failed", "queue_add_failed");
    controlledCaptureObservations.recordProducer({
      walletId: payload.walletId,
      txid: payload.txid,
      outcome: 'rejected',
      failureClass: 'queue_add_failed',
      path: 'queued',
    });
    return {
      outcome: "failed",
      failureClass: "queue_add_failed",
      deduplication: "unknown",
    };
  }
}

function recordEnqueueTelemetry(
  stage: "enqueue_resolved" | "enqueue_failed",
  failureClass: TransactionEnqueueResult["failureClass"],
): void {
  recordNotificationTelemetry({
    family: "transaction",
    stage,
    path: "queued",
    channel: "none",
    outcome: "none",
    failureClass,
  });
}

/**
 * Queue a draft notification for retry-capable delivery.
 * Returns true if the job was queued, false if Redis was unavailable.
 *
 * The worker re-fetches the draft from the database at delivery time
 * (so updates between queue and delivery are picked up), but the
 * runtime-context fields below — only known at queue time — are passed
 * through the job payload.
 */
export async function queueDraftNotification(
  payload: DraftNotificationPayload,
): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;

  try {
    const jobIdSuffix =
      payload.dedupeKey ??
      `${payload.draftId}:${payload.creatorUserId ?? "system"}`;
    await queue.add("draft-notify", payload, {
      jobId: toBullMqJobId(`draftnotify:${payload.walletId}:${jobIdSuffix}`),
    });
    log.debug("Draft notification queued", {
      walletId: payload.walletId,
      draftId: payload.draftId,
    });
    return true;
  } catch (error) {
    log.warn(
      "Failed to queue draft notification, caller should fall back to inline",
      {
        error: getErrorMessage(error),
        draftId: payload.draftId,
      },
    );
    return false;
  }
}

/**
 * Queue a low-fee consolidation suggestion notification for retry-capable delivery.
 * Returns true if the job was queued, false if Redis was unavailable.
 */
export async function queueConsolidationSuggestionNotification(
  payload: ConsolidationSuggestionNotificationPayload,
): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;

  try {
    await queue.add("consolidation-suggestion-notify", payload, {
      jobId: toBullMqJobId(
        `consolidation-suggestion:${payload.walletId}:${payload.queuedAt}`,
      ),
    });
    log.debug("Consolidation suggestion notification queued", {
      walletId: payload.walletId,
      feeRate: payload.feeRate,
    });
    return true;
  } catch (error) {
    log.warn(
      "Failed to queue consolidation suggestion notification, caller should fall back to inline",
      {
        error: getErrorMessage(error),
        walletId: payload.walletId,
      },
    );
    return false;
  }
}

/**
 * Queue an outbound webhook delivery attempt.
 * Returns true if the job was queued, false if Redis was unavailable.
 */
export async function queueWebhookDeliveryNotification(
  payload: WebhookDeliveryNotificationPayload,
  options: { delayMs?: number } = {},
): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;

  try {
    const jobOptions: JobsOptions = {
      jobId: toBullMqJobId(
        `webhook-delivery:${payload.deliveryId}:${payload.attempt ?? 0}`,
      ),
      delay: options.delayMs,
      ...notificationRetentionJobOptions("webhook"),
    };
    await addOrReviveWebhookJob(queue, payload, jobOptions);
    log.debug("Webhook delivery queued", {
      deliveryId: payload.deliveryId,
    });
    return true;
  } catch (error) {
    log.warn(
      "Failed to queue webhook delivery notification; persisted delivery remains recoverable",
      {
        error: getErrorMessage(error),
        deliveryId: payload.deliveryId,
      },
    );
    return false;
  }
}

async function addOrReviveWebhookJob(
  queue: Queue,
  payload: WebhookDeliveryNotificationPayload,
  options: JobsOptions,
): Promise<void> {
  const job = await queue.add("webhook-delivery", payload, options);
  if (!(await webhookJobNeedsRevival(job))) return;

  try {
    await job.remove();
  } catch (error) {
    const currentJob = (await queue.getJob(String(options.jobId))) as
      WebhookQueueJob | undefined;
    if (currentJob && !(await webhookJobNeedsRevival(currentJob))) return;
    if (currentJob) throw error;
  }

  await queue.add("webhook-delivery", payload, options);
}

async function webhookJobNeedsRevival(job: WebhookQueueJob): Promise<boolean> {
  const state = await job.getState();
  return state === "completed" || state === "failed" || state === "unknown";
}

/**
 * Shut down the notification dispatch queue (for graceful shutdown).
 */
export async function shutdownNotificationDispatcher(): Promise<void> {
  if (notificationQueue) {
    await notificationQueue.close();
    notificationQueue = null;
  }
}
