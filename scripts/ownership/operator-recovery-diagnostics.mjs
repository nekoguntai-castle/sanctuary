const RECOVERY_CLASSES = Object.freeze([
  'compose_container', 'compose_network', 'compose_volume',
]);
const CATEGORIES = new Set([
  'command_unavailable', 'identity_changed', 'inventory_drift', 'malformed_output',
  'output_limit', 'permission_denied', 'query_failed', 'timeout',
]);
const OPERATIONS = new Set(RECOVERY_CLASSES.flatMap((resourceClass) => [
  'list', 'inspect', 'relist', 'reinspection', 'safety reinspection',
].map((operation) => `${resourceClass} ${operation}`)));
const MAX_DIAGNOSTICS = 64;

function safeOperation(value) {
  if (OPERATIONS.has(value)) return value;
  if (typeof value === 'string' && value.startsWith('Docker daemon/context authority')) {
    return 'Docker daemon/context authority';
  }
  return 'unknown';
}

function diagnostic(ambiguities, stage) {
  const bounded = Array.isArray(ambiguities) ? ambiguities.slice(0, MAX_DIAGNOSTICS) : [];
  const categories = [...new Set(bounded.map((entry) => (
    CATEGORIES.has(entry?.category) ? entry.category : 'unknown'
  )))].sort();
  const operations = [...new Set(bounded.map((entry) => safeOperation(entry?.operation)))].sort();
  return `stage=${stage}; categories=${categories.join(',') || 'none'}; operations=${operations.join(',') || 'none'}`;
}

export function ambiguousObservationError(message, ambiguities, stage) {
  return new Error(`${message} (${diagnostic(ambiguities, stage)})`);
}
