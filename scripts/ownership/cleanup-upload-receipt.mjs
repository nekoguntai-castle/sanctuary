import { canonicalSha256 } from './canonical-json.mjs';
import { assertUploadSafe } from './privacy.mjs';
import { validateArtifact } from './schemas.mjs';

const AMBIGUOUS_FAILURES = new Set([
  'identity_changed', 'malformed', 'query_failed', 'unsupported',
  'mutation_failed', 'postcondition_failed', 'cancelled',
]);

function emptyCounts(total = 0) {
  return { total, cleaned: 0, retained: 0, refused: 0, ambiguous: 0 };
}

function resultCategory(entry) {
  if (['cleaned', 'absent'].includes(entry.result)) return 'cleaned';
  if (entry.result === 'retained') return 'retained';
  if (entry.result === 'refused') return 'refused';
  if (entry.result === 'ambiguous' || AMBIGUOUS_FAILURES.has(entry.failureClass)) {
    return 'ambiguous';
  }
  return null;
}

function identityKey(entry) {
  return `${entry.resourceClass}\0${entry.immutableIdentity}`;
}

function aggregateResults(results, resultCounts, resources) {
  for (const result of results) {
    const category = resultCategory(result);
    if (category) resultCounts[category] += 1;
    resources.set(identityKey(result), category);
  }
}

function aggregateRefusals(refusals, resultCounts, resources) {
  for (const refusal of refusals) {
    const category = AMBIGUOUS_FAILURES.has(refusal.failureClass) ? 'ambiguous' : 'refused';
    resultCounts[category] += 1;
    const key = identityKey(refusal);
    if (!resources.has(key) || category === 'ambiguous') resources.set(key, category);
  }
}

function includeActionResources(actions, resources) {
  for (const action of actions) {
    if (!resources.has(identityKey(action))) resources.set(identityKey(action), null);
  }
}

function aggregateResourceCounts(resources) {
  const resourceCounts = emptyCounts(resources.size);
  for (const category of resources.values()) {
    if (category) resourceCounts[category] += 1;
  }
  return resourceCounts;
}

function aggregateRows(receipt) {
  const results = receipt.results ?? [];
  const refusals = receipt.refusals ?? [];
  const resultCounts = emptyCounts(results.length + refusals.length);
  const resources = new Map();
  aggregateResults(results, resultCounts, resources);
  aggregateRefusals(refusals, resultCounts, resources);
  includeActionResources(receipt.actions ?? [], resources);
  return { resourceCounts: aggregateResourceCounts(resources), resultCounts };
}

export function buildCleanupUploadReceipt(privateReceipt) {
  validateArtifact(privateReceipt);
  if (privateReceipt.artifactType !== 'cleanup_receipt') {
    throw new Error('upload projection requires a private cleanup receipt');
  }
  const counts = aggregateRows(privateReceipt);
  const failureClasses = [...new Set([
    privateReceipt.failureClass,
    ...(privateReceipt.results ?? []).map((entry) => entry.failureClass),
    ...(privateReceipt.refusals ?? []).map((entry) => entry.failureClass),
    ...(privateReceipt.postconditions ?? []).map((entry) => entry.failureClass),
  ].filter((entry) => entry && entry !== 'none'))].sort();
  const projection = {
    schemaVersion: '1.0.0', artifactType: 'cleanup_receipt_upload',
    privateReceiptDigest: canonicalSha256(privateReceipt), state: privateReceipt.state,
    resourceCounts: counts.resourceCounts, resultCounts: counts.resultCounts,
    failureClasses, policyDigest: privateReceipt.policyDigest,
    signerKeyId: privateReceipt.signerKeyId,
  };
  validateArtifact(projection);
  assertUploadSafe(projection);
  return Object.freeze(projection);
}
