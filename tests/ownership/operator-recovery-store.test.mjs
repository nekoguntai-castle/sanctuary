import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  loadExecutedOperatorRecovery, loadPreparedOperatorRecovery,
  persistExecutedOperatorRecovery, persistPreparedOperatorRecovery,
} from '../../scripts/ownership/operator-recovery-store.mjs';

test('recovery store persists exact prepared envelopes create-only outside checkout', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'operator-recovery-store-'));
  const prepared = Object.fromEntries([
    'correlationEnvelope', 'assertionEnvelope', 'scopeEnvelope', 'dryRunEnvelope', 'approvalEnvelope',
  ].map((key) => [key, { key, value: 'bounded' }]));
  persistPreparedOperatorRecovery(root, prepared, process.cwd());
  assert.deepEqual(loadPreparedOperatorRecovery(root, process.cwd()), prepared);
  assert.doesNotThrow(() => persistPreparedOperatorRecovery(root, prepared, process.cwd()));
  assert.throws(() => persistPreparedOperatorRecovery(root, {
    ...prepared, scopeEnvelope: { key: 'scopeEnvelope', value: 'changed' },
  }, process.cwd()), /collision/);
  const executed = {
    freshCorrelationEnvelope: { artifact: 'fresh' },
    receiptEnvelope: { artifact: 'receipt' },
  };
  persistExecutedOperatorRecovery(root, executed, process.cwd());
  assert.deepEqual(loadExecutedOperatorRecovery(root, process.cwd()), {
    scopeEnvelope: prepared.scopeEnvelope, approvalEnvelope: prepared.approvalEnvelope,
    ...executed,
  });
  assert.doesNotThrow(() => persistExecutedOperatorRecovery(root, executed, process.cwd()));
  assert.throws(() => persistExecutedOperatorRecovery(root, {
    ...executed, receiptEnvelope: { artifact: 'changed' },
  }, process.cwd()), /collision/);
});
