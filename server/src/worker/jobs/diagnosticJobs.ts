/**
 * Worker diagnostic jobs.
 *
 * These jobs are intentionally small and side-effect free. They give operators
 * and scale-out proof runs a way to verify BullMQ worker routing and distributed
 * lock behavior without touching wallets or user data.
 */

import os from 'node:os';
import type { Job } from 'bullmq';
import type { WorkerJobHandler } from './types';

interface DiagnosticPingJobData {
  proofId?: string;
  sequence?: number;
  delayMs?: number;
  lockKey?: string;
}

interface DiagnosticPingJobResult {
  success: true;
  proofId: string | null;
  sequence: number | null;
  worker: {
    hostname: string;
    pid: number;
  };
  durationMs: number;
}

const MAX_DIAGNOSTIC_DELAY_MS = 5_000;
const LOCKED_PING_LOCK_TTL_MS = 30_000;

function normalizeDelayMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), MAX_DIAGNOSTIC_DELAY_MS);
}

async function maybeDelay(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runDiagnosticPing(job: Job<DiagnosticPingJobData>): Promise<DiagnosticPingJobResult> {
  const startedAt = Date.now();
  await maybeDelay(normalizeDelayMs(job.data?.delayMs));

  return {
    success: true,
    proofId: job.data?.proofId ?? null,
    sequence: job.data?.sequence ?? null,
    worker: {
      hostname: os.hostname(),
      pid: process.pid,
    },
    durationMs: Date.now() - startedAt,
  };
}

export const workerDiagnosticPingJob: WorkerJobHandler<DiagnosticPingJobData, DiagnosticPingJobResult> = {
  name: 'diagnostics:worker-ping',
  queue: 'maintenance',
  options: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
  handler: runDiagnosticPing,
};

export const workerDiagnosticLockedPingJob: WorkerJobHandler<DiagnosticPingJobData, DiagnosticPingJobResult> = {
  name: 'diagnostics:locked-worker-ping',
  queue: 'maintenance',
  options: {
    attempts: 1,
    removeOnComplete: 100,
    removeOnFail: 100,
  },
  lockOptions: {
    /* v8 ignore start -- diagnostics jobs normally provide proofId; defaults support manual runs */
    lockKey: (data) => `diagnostics:worker-ping:${data.lockKey ?? data.proofId ?? 'default'}`,
    /* v8 ignore stop */
    lockTtlMs: LOCKED_PING_LOCK_TTL_MS,
  },
  handler: runDiagnosticPing,
};

export const diagnosticJobs: WorkerJobHandler<unknown, unknown>[] = [
  workerDiagnosticPingJob as WorkerJobHandler<unknown, unknown>,
  workerDiagnosticLockedPingJob as WorkerJobHandler<unknown, unknown>,
];
