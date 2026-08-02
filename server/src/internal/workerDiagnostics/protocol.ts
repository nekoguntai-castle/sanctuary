import { z } from 'zod';

export const WORKER_DIAGNOSTICS_PATH = '/internal/diagnostics/v1/snapshot';
export const WORKER_DIAGNOSTICS_PROTOCOL_VERSION = 1 as const;

export const WorkerDiagnosticsRequestSchema = z.object({
  protocolVersion: z.literal(WORKER_DIAGNOSTICS_PROTOCOL_VERSION),
}).strict();

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

export const WorkerDiagnosticsResponseSchema = z.object({
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

export type WorkerDiagnosticsRequest = z.infer<typeof WorkerDiagnosticsRequestSchema>;
export type WorkerDiagnosticsResponse = z.infer<typeof WorkerDiagnosticsResponseSchema>;
export type CountBucket = z.infer<typeof CountBucketSchema>;
export type AgeBucket = z.infer<typeof AgeBucketSchema>;
