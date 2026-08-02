import { z } from 'zod';
import { PACKAGE_VERSION } from '../../config/packageInfo';
import {
  NOTIFICATION_FAILURE_CLASSES,
  NOTIFICATION_OUTCOMES,
} from '../notifications/outcomes';
import { readIncidentEvidence, type IncidentRoleEvidence, type IncidentSelectors } from './incident';
import { serializePrivacySafeArtifact, SupportPackagePrivacyError } from './privacy';
import type {
  CaptureEvidenceSnapshot,
  CaptureReadResult,
  CaptureSnapshotObservation,
} from './capture';

const evidenceBooleanSchema = z.enum([
  'observed_true', 'observed_false', 'not_observed', 'not_applicable',
]);
const timingSchema = z.enum([
  'predates_incident', 'within_window', 'postdates_incident', 'unknown', 'not_applicable',
]);
const ageSchema = z.enum([
  'lt_1m', 'one_to_five_minutes', 'five_minutes_to_one_hour',
  'one_to_twenty_four_hours', 'gte_twenty_four_hours', 'not_observed', 'not_applicable',
]);
const lookupSchema = z.enum(['observed', 'unavailable', 'timeout']);
const notificationOutcomeSchema = z.enum([...NOTIFICATION_OUTCOMES, 'not_observed']);
const notificationFailureSchema = z.enum([...NOTIFICATION_FAILURE_CLASSES, 'not_observed']);

const transactionRowSchema = z.object({
  lookupStatus: z.enum(['observed', 'unavailable']),
  present: evidenceBooleanSchema,
  directionMatches: evidenceBooleanSchema,
  timing: timingSchema,
}).strict();

const receiverMatchSchema = z.object({
  ownsSelectedOutput: evidenceBooleanSchema,
  networkMatches: evidenceBooleanSchema,
  addressTiming: timingSchema,
}).strict();

const eligibilitySchema = z.object({
  evidenceSource: z.enum(['capture_time', 'current_snapshot', 'not_observed']),
  coverage: z.enum(['none', 'some', 'all', 'unknown']),
}).strict();

const notificationJobSchema = z.object({
  lookupStatus: lookupSchema,
  presence: z.enum(['observed_true', 'not_retained', 'not_observed']),
  state: z.enum([
    'waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized',
    'waiting_children', 'unknown', 'not_observed',
  ]),
  attempts: z.enum(['none', 'one', 'two_to_three', 'four_to_five', 'six_plus', 'unknown']),
  enqueue: z.enum(['resolved', 'failed', 'not_observed']),
  handler: z.enum(['started', 'not_started', 'not_observed']),
  terminal: z.enum(['completed', 'failed', 'not_terminal', 'not_observed']),
  telegram: z.object({
    outcome: notificationOutcomeSchema,
    failureClass: notificationFailureSchema,
  }).strict(),
  ages: z.object({
    created: ageSchema,
    processed: ageSchema,
    finished: ageSchema,
  }).strict(),
  retention: z.object({
    record: z.enum(['retained', 'not_retained', 'not_observed']),
    horizon: z.literal('unsupported'),
    saturation: z.literal('unknown'),
  }).strict(),
}).strict();

function roleSchema(role: 'sender' | 'receiver', direction: 'sent' | 'received') {
  return z.object({
    role: z.literal(role),
    expectedDirection: z.literal(direction),
    transactionRow: transactionRowSchema,
    receiverMatch: receiverMatchSchema,
    eligibility: eligibilitySchema,
    notificationJob: notificationJobSchema,
  }).strict();
}

export const incidentProfileSchema = z.object({
  version: z.literal('1.0.0'),
  profile: z.literal('single_incident'),
  generatedAt: z.iso.datetime(),
  serverVersion: z.string().min(1).max(64),
  collectors: z.object({
    incident: z.object({
      status: z.literal('ok'),
      durationMs: z.number().int().min(0).max(60_000),
      truncated: z.literal(false),
      droppedCount: z.literal(0),
      provenance: z.object({
        collectorProcess: z.literal('api'),
        sourceProcess: z.literal('api'),
        sourceKind: z.literal('incident_correlation'),
        sampledAt: z.iso.datetime(),
        dataAsOf: z.iso.datetime(),
        observationWindow: z.literal('point_in_time'),
      }).strict(),
      data: z.object({
        sender: roleSchema('sender', 'sent'),
        receiver: roleSchema('receiver', 'received'),
        captureCoverage: z.enum(['not_observed', 'partial', 'complete', 'invalid']),
      }).strict(),
    }).strict(),
  }).strict(),
  meta: z.object({
    privacyValidation: z.literal('passed'),
    totalDurationMs: z.number().int().min(0).max(60_000),
  }).strict(),
}).strict();

export type IncidentProfile = z.infer<typeof incidentProfileSchema>;

function capturedStage(
  evidence: readonly CaptureEvidenceSnapshot[],
  role: 'sender' | 'receiver',
  stage: 'enqueue' | 'handler' | 'terminal',
): Exclude<CaptureSnapshotObservation, { outcome: 'not_observed' }> | undefined {
  return evidence
    .flatMap(snapshot => snapshot.roles[role])
    .find((observation): observation is Exclude<
      CaptureSnapshotObservation,
      { outcome: 'not_observed' }
    > => observation.stage === stage && observation.outcome !== 'not_observed');
}

function publicRole(
  role: IncidentRoleEvidence,
  captureEvidence: readonly CaptureEvidenceSnapshot[],
) {
  const job = role.notificationJob;
  const presence = job.present === 'observed_true'
    ? 'observed_true' as const
    : job.retention.record === 'not_retained'
      ? 'not_retained' as const
      : 'not_observed' as const;
  const enqueue = capturedStage(captureEvidence, role.role, 'enqueue');
  const handler = capturedStage(captureEvidence, role.role, 'handler');
  const terminal = capturedStage(captureEvidence, role.role, 'terminal');
  return {
    role: role.role,
    expectedDirection: role.expectedDirection,
    transactionRow: {
      lookupStatus: role.transaction.lookupStatus,
      ...role.transaction.transactionRow,
    },
    receiverMatch: role.receiverMatch,
    eligibility: role.eligibility,
    notificationJob: {
      lookupStatus: job.lookupStatus,
      presence,
      state: job.state,
      attempts: job.attempts,
      enqueue: enqueue?.stage === 'enqueue'
        ? (enqueue.outcome === 'accepted' ? 'resolved' : 'failed')
        : job.enqueue,
      handler: handler?.stage === 'handler' ? 'started' : job.handler,
      terminal: terminal?.stage === 'terminal' ? terminal.terminalState : job.terminal,
      telegram: terminal?.stage === 'terminal'
        ? {
            outcome: terminal.telegramOutcome,
            failureClass: terminal.telegramFailureClass,
          }
        : job.telegram,
      ages: job.ages,
      retention: job.retention,
    },
  };
}

export async function generateSerializedIncidentProfile(
  selectors: IncidentSelectors,
  capture?: CaptureReadResult,
): Promise<Buffer> {
  const startedAt = Date.now();
  const generatedAt = new Date();
  const evidence = await readIncidentEvidence(selectors);
  const captureEvidence = capture?.evidence ?? [];
  const captureCoverage = capture?.status.state === 'invalid'
    ? 'invalid'
    : capture?.status.state === 'ready'
      ? 'complete'
      : capture?.status.state === 'partial'
        ? 'partial'
        : 'not_observed';
  const durationMs = Date.now() - startedAt;
  const candidate = {
    version: '1.0.0',
    profile: 'single_incident',
    generatedAt: generatedAt.toISOString(),
    serverVersion: PACKAGE_VERSION,
    collectors: {
      incident: {
        status: 'ok',
        durationMs,
        truncated: false,
        droppedCount: 0,
        provenance: {
          collectorProcess: 'api',
          sourceProcess: 'api',
          sourceKind: 'incident_correlation',
          sampledAt: generatedAt.toISOString(),
          dataAsOf: new Date().toISOString(),
          observationWindow: 'point_in_time',
        },
        data: {
          sender: publicRole(evidence.roles[0], captureEvidence),
          receiver: publicRole(evidence.roles[1], captureEvidence),
          captureCoverage,
        },
      },
    },
    meta: { privacyValidation: 'passed', totalDurationMs: durationMs },
  };
  let validated: IncidentProfile;
  try {
    validated = incidentProfileSchema.parse(candidate);
  } catch {
    throw new SupportPackagePrivacyError('incident_profile_contract_failed');
  }
  return serializePrivacySafeArtifact(validated, [
    selectors.txid,
    selectors.senderWalletId,
    selectors.receiverWalletId,
  ]);
}
