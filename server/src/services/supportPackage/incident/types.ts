import type {
  NotificationFailureClass,
  NotificationOutcome,
} from '../../notifications/outcomes';

export type IncidentRole = 'sender' | 'receiver';
export type IncidentExpectedDirection = 'sent' | 'received';
export type IncidentEvidenceBoolean =
  | 'observed_true'
  | 'observed_false'
  | 'not_observed'
  | 'not_applicable';
export type IncidentTimingRelation =
  | 'predates_incident'
  | 'within_window'
  | 'postdates_incident'
  | 'unknown'
  | 'not_applicable';
export type IncidentAgeBucket =
  | 'lt_1m'
  | 'one_to_five_minutes'
  | 'five_minutes_to_one_hour'
  | 'one_to_twenty_four_hours'
  | 'gte_twenty_four_hours'
  | 'not_observed'
  | 'not_applicable';
export type IncidentAttemptBucket =
  | 'none'
  | 'one'
  | 'two_to_three'
  | 'four_to_five'
  | 'six_plus'
  | 'unknown';
export type IncidentJobState =
  | 'waiting'
  | 'active'
  | 'delayed'
  | 'failed'
  | 'completed'
  | 'prioritized'
  | 'waiting_children'
  | 'unknown'
  | 'not_observed';
export type IncidentLookupStatus = 'observed' | 'unavailable' | 'timeout';

export interface IncidentSelectors {
  txid: string;
  senderWalletId: string;
  receiverWalletId: string;
  approximateIncidentAt: Date;
}

export interface IncidentTransactionEvidence {
  role: IncidentRole;
  expectedDirection: IncidentExpectedDirection;
  lookupStatus: Exclude<IncidentLookupStatus, 'timeout'>;
  transactionRow: {
    present: IncidentEvidenceBoolean;
    directionMatches: IncidentEvidenceBoolean;
    timing: IncidentTimingRelation;
  };
}

export interface IncidentReceiverMatchEvidence {
  ownsSelectedOutput: IncidentEvidenceBoolean;
  networkMatches: IncidentEvidenceBoolean;
  addressTiming: IncidentTimingRelation;
}

export interface IncidentTransactionEvidenceSnapshot {
  roles: readonly [IncidentTransactionEvidence, IncidentTransactionEvidence];
  receiverMatch: IncidentReceiverMatchEvidence;
}

export type IncidentTelegramOutcome = NotificationOutcome | 'not_observed';
export type IncidentTelegramFailureClass =
  | NotificationFailureClass
  | 'not_observed';

export interface IncidentJobEvidence {
  role: IncidentRole;
  expectedDirection: IncidentExpectedDirection;
  lookupStatus: IncidentLookupStatus;
  present: Extract<IncidentEvidenceBoolean, 'observed_true' | 'not_observed'>;
  state: IncidentJobState;
  attempts: IncidentAttemptBucket;
  enqueue: 'resolved' | 'not_observed';
  handler: 'started' | 'not_started' | 'not_observed';
  terminal: 'completed' | 'failed' | 'not_terminal' | 'not_observed';
  telegram: {
    outcome: IncidentTelegramOutcome;
    failureClass: IncidentTelegramFailureClass;
  };
  ages: {
    created: IncidentAgeBucket;
    processed: IncidentAgeBucket;
    finished: IncidentAgeBucket;
  };
  retention: {
    record: 'retained' | 'not_retained' | 'not_observed';
    horizon: 'unsupported';
    saturation: 'unknown';
  };
}

export interface IncidentRoleEvidence {
  role: IncidentRole;
  expectedDirection: IncidentExpectedDirection;
  transaction: IncidentTransactionEvidence;
  notificationJob: IncidentJobEvidence;
  receiverMatch: IncidentReceiverMatchEvidence;
  eligibility: {
    evidenceSource: 'capture_time' | 'current_snapshot' | 'not_observed';
    coverage: 'none' | 'some' | 'all' | 'unknown';
  };
}

export interface IncidentEvidenceSnapshot {
  roles: readonly [IncidentRoleEvidence, IncidentRoleEvidence];
}
