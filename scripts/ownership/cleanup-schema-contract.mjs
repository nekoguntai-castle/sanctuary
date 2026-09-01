export const CLEANUP_STATES = Object.freeze([
  'dry_run', 'no_op', 'cleaned', 'partial', 'cancelled', 'refused', 'ambiguous', 'recovered',
]);
export const CLEANUP_RESULTS = Object.freeze([
  'pending', 'cleaned', 'absent', 'retained', 'refused', 'ambiguous', 'failed',
]);
export const CLEANUP_ACTIONS = Object.freeze(['stop', 'remove', 'reconcile', 'retain']);
export const CLEANUP_FAILURE_CLASSES = Object.freeze([
  'none', 'identity_changed', 'active', 'current', 'shared', 'protected', 'data', 'unlabeled',
  'unregistered', 'referenced', 'default_builder', 'policy_retained', 'policy_mismatch', 'malformed',
  'query_failed', 'unsupported', 'mutation_failed', 'postcondition_failed', 'cancelled',
]);
export const CLEANUP_LOCATOR_KINDS = Object.freeze([
  'authority', 'engine_id', 'name', 'path', 'provider_id', 'reference',
]);
export const MAX_CLEANUP_JOURNAL_BYTES = 16 * 1024 * 1024;
