import { z } from 'zod';
import { SYNC_EXECUTION_STAGES } from '@sanctuary/shared/schemas/syncProgress';

export const WORKER_DIAGNOSTICS_PATH = '/internal/diagnostics/v1/snapshot';
export const WORKER_DIAGNOSTICS_PROTOCOL_VERSION = 1 as const;

// Frozen wire-v1 inventory. Do not derive this from the expanded execution
// stages: strict rolling-update consumers require these exact five keys.
export const WALLET_SYNC_EXECUTION_V1_STAGES = [
  'candidate_fetch',
  'parent_fetch',
  'timestamp_fetch',
  'classification',
  'persistence',
] as const;

export const WorkerDiagnosticsRequestSchema = z.object({
  protocolVersion: z.literal(WORKER_DIAGNOSTICS_PROTOCOL_VERSION),
  walletSyncExecution: z.literal(true).optional(),
  walletSyncExecutionVersion: z.literal(2).optional(),
}).strict().superRefine((request, ctx) => {
  if (request.walletSyncExecutionVersion !== undefined && request.walletSyncExecution !== true) {
    ctx.addIssue({
      code: 'custom',
      path: ['walletSyncExecutionVersion'],
      message: 'walletSyncExecutionVersion requires walletSyncExecution',
    });
  }
});

const CountBucketSchema = z.enum(['0', '1', '2-5', '6-20', '21-100', '101+']);
const AgeBucketSchema = z.enum([
  'never',
  '<1m',
  '1m-15m',
  '15m-1h',
  '1h-24h',
  '1d+',
]);
const TelemetryDropBucketSchema = z.enum([
  'zero', 'one', 'two_to_five', 'six_to_twenty', 'over_twenty',
]);
const TelegramFailureClassSchema = z.enum([
  'none',
  'invalid_configuration',
  'authentication',
  'permission',
  'rate_limited',
  'provider_rejected',
  'provider_unavailable',
  'timeout',
  'circuit_open',
  'network',
  'unknown',
  'other',
]);

const WalletSyncExecutionCountersSchema = z.object({
  started: CountBucketSchema,
  stageTransitions: CountBucketSchema,
  completed: CountBucketSchema,
  failed: CountBucketSchema,
  timedOut: CountBucketSchema,
  aborted: CountBucketSchema,
  budgetExpired: CountBucketSchema,
  lockLost: CountBucketSchema,
  stalePruned: CountBucketSchema,
}).strict();

const WalletSyncExecutionAgreementSchema = z.discriminatedUnion('agreement', [
  z.object({
    agreement: z.literal('observed'),
    registryWithOwnedLock: CountBucketSchema,
    registryMissingOwnedLock: CountBucketSchema,
    registryOwnershipMismatch: CountBucketSchema,
  }).strict(),
  z.object({ agreement: z.literal('unavailable') }).strict(),
]);

function walletSyncExecutionDiagnosticsSchema<
  const Version extends 1 | 2,
  const Stage extends string,
>(version: Version, stages: readonly Stage[]) {
  const byStage = z.object(Object.fromEntries(
    stages.map(stage => [stage, CountBucketSchema]),
  ) as Record<Stage, typeof CountBucketSchema>).strict();
  return z.discriminatedUnion('observation', [
  z.object({
    version: z.literal(version),
    observation: z.literal('observed'),
    scope: z.literal('sampled_worker'),
    processEpochAge: AgeBucketSchema.exclude(['never']),
    countersResetAge: AgeBucketSchema.exclude(['never']),
    active: z.object({
      total: CountBucketSchema,
      byStage,
      oldestProgressAge: AgeBucketSchema,
    }).strict(),
    counters: WalletSyncExecutionCountersSchema,
    redisLockAgreement: WalletSyncExecutionAgreementSchema,
  }).strict(),
  z.object({
    version: z.literal(version),
    observation: z.literal('unavailable'),
    scope: z.literal('sampled_worker'),
  }).strict(),
  ]);
}

export const WalletSyncExecutionDiagnosticsV1Schema = walletSyncExecutionDiagnosticsSchema(
  1,
  WALLET_SYNC_EXECUTION_V1_STAGES,
);
export const WalletSyncExecutionDiagnosticsV2Schema = walletSyncExecutionDiagnosticsSchema(
  2,
  SYNC_EXECUTION_STAGES,
);
export const WalletSyncExecutionDiagnosticsSchema = z.union([
  WalletSyncExecutionDiagnosticsV1Schema,
  WalletSyncExecutionDiagnosticsV2Schema,
]);

const WorkerDiagnosticsBaseResponseSchema = z.object({
  protocolVersion: z.literal(WORKER_DIAGNOSTICS_PROTOCOL_VERSION),
  sampledAt: z.string().datetime(),
  worker: z.object({
    readiness: z.enum(['ready', 'degraded']),
    uptime: AgeBucketSchema.exclude(['never']),
    concurrency: CountBucketSchema,
  }).strict(),
  notificationPipeline: z.object({
    consumerRunning: z.boolean(),
    transactionHandlerRegistered: z.boolean(),
  }).strict(),
  redis: z.object({ state: z.enum(['connected', 'disconnected']) }).strict(),
  database: z.object({ state: z.enum(['connected', 'disconnected', 'unknown']) }).strict(),
  electrum: z.object({
    managerRunning: z.boolean(),
    connected: z.boolean(),
    subscriptionOwner: z.boolean(),
    subscribedAddresses: CountBucketSchema,
  }).strict(),
  telegram: z.object({
    circuitState: z.enum(['closed', 'half-open', 'open', 'not-registered']),
    failures: CountBucketSchema,
    totalRequests: CountBucketSchema,
    lastFailureAge: AgeBucketSchema,
    lastSuccessAge: AgeBucketSchema,
    lastFailureClass: TelegramFailureClassSchema,
  }).strict(),
  notificationTelemetryWriter: z.discriminatedUnion('observation', [
    z.object({
      observation: z.literal('observed'),
      circuit: z.enum(['closed', 'open']),
      droppedEvents: TelemetryDropBucketSchema,
    }).strict(),
    z.object({ observation: z.literal('unavailable') }).strict(),
  ]),
}).strict();

export const WorkerDiagnosticsBareResponseSchema = WorkerDiagnosticsBaseResponseSchema;
export const WorkerDiagnosticsResponseV1Schema = WorkerDiagnosticsBaseResponseSchema.extend({
  walletSyncExecution: WalletSyncExecutionDiagnosticsV1Schema,
}).strict();
export const WorkerDiagnosticsResponseV2Schema = WorkerDiagnosticsBaseResponseSchema.extend({
  walletSyncExecution: WalletSyncExecutionDiagnosticsV2Schema,
}).strict();
export const WorkerDiagnosticsResponseSchema = WorkerDiagnosticsBaseResponseSchema.extend({
  // Emitted only when the authenticated request opts in. This keeps responses
  // parseable by strict transport-v1 consumers during rolling deployment.
  walletSyncExecution: WalletSyncExecutionDiagnosticsSchema.optional(),
}).strict();

export type WorkerDiagnosticsRequest = z.infer<typeof WorkerDiagnosticsRequestSchema>;
export type WorkerDiagnosticsResponse = z.infer<typeof WorkerDiagnosticsResponseSchema>;
export type WorkerDiagnosticsBareResponse = z.infer<typeof WorkerDiagnosticsBareResponseSchema>;
export type CountBucket = z.infer<typeof CountBucketSchema>;
export type AgeBucket = z.infer<typeof AgeBucketSchema>;
export type WalletSyncExecutionDiagnostics = z.infer<
  typeof WalletSyncExecutionDiagnosticsSchema
>;
export type WalletSyncExecutionDiagnosticsVersion = WalletSyncExecutionDiagnostics['version'];
export type ObservedWalletSyncExecutionDiagnostics = Extract<
  WalletSyncExecutionDiagnostics,
  { observation: 'observed' }
>;
