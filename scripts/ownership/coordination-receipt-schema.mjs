import {
  array, digest, enumeration, identifier, integer, object, timestamp,
} from './validation.mjs';

export function validateCoordinationReceipt(value, now) {
  object(value, '$', [
    'schemaVersion', 'artifactType', 'phase', 'deploymentId', 'operationRunId',
    'state', 'operationStartedAt', 'operationEndedAt', 'receiptCoreFinalizedAt',
    'policyDigest', 'authorityCoreDigest', 'ownershipAuthorityEstablished',
    'deploymentManifestDigest', 'runManifestDigest', 'actions', 'results',
    'refusals', 'failureClass', 'subjectExitStatus', 'signerKeyId',
  ]);
  if (value.schemaVersion !== '1.3.0' || value.artifactType !== 'cleanup_receipt'
      || value.phase !== 'coordination') {
    throw new Error('coordination receipt type or version is invalid');
  }
  identifier(value.deploymentId, '$.deploymentId');
  identifier(value.operationRunId, '$.operationRunId');
  enumeration(value.state, '$.state', ['refused', 'ambiguous']);
  const started = timestamp(value.operationStartedAt, '$.operationStartedAt');
  const ended = timestamp(value.operationEndedAt, '$.operationEndedAt');
  const finalized = timestamp(value.receiptCoreFinalizedAt, '$.receiptCoreFinalizedAt');
  if (started > ended || ended > finalized || finalized > now.getTime()) {
    throw new Error('coordination receipt timestamps are out of order');
  }
  for (const key of ['policyDigest', 'authorityCoreDigest', 'signerKeyId']) {
    digest(value[key], `$.${key}`);
  }
  if (value.ownershipAuthorityEstablished !== false
      || value.deploymentManifestDigest !== null || value.runManifestDigest !== null) {
    throw new Error('pre-bind coordination receipt must not assert deployment ownership');
  }
  for (const key of ['actions', 'results', 'refusals']) {
    if (array(value[key], `$.${key}`, { max: 0 }).length !== 0) {
      throw new Error(`$.${key} must be empty before ownership authority is established`);
    }
  }
  enumeration(value.failureClass, '$.failureClass', ['unregistered', 'query_failed']);
  if ((value.state === 'ambiguous') !== (value.failureClass === 'query_failed')) {
    throw new Error('coordination state and failureClass are inconsistent');
  }
  integer(value.subjectExitStatus, '$.subjectExitStatus', { min: 0, max: 255 });
}
