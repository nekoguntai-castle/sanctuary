import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  refusedResourceField, refusedResourceSummary,
} from '../../scripts/ownership/ci-cleanup-coordinator.mjs';

const IDENTITY = `sha256:${'a'.repeat(64)}`;
const REFUSAL = { resourceClass: 'oci_image', immutableIdentity: IDENTITY, failureClass: 'unregistered' };

function privateDirectoryWithInventory(resources) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'refused-summary-'));
  writeFileSync(path.join(directory, 'inventory.json'), JSON.stringify({ resources }));
  return path.join(directory, 'planning-receipt.json');
}

test('refused resources are named from the inventory next to the planning receipt', () => {
  const planningReceiptPath = privateDirectoryWithInventory([
    {
      resourceClass: 'oci_image', immutableIdentity: IDENTITY,
      locator: 'sanctuary-backend:ci-1-upgrade-15', ownershipState: 'unlabeled',
      classifications: ['unlabeled', 'protected'],
      runtime: { references: ['localhost/sanctuary-backend:ci-1-upgrade-15'] },
    },
    { resourceClass: 'compose_volume', immutableIdentity: `sha256:${'b'.repeat(64)}`, locator: 'other' },
  ]);
  assert.deepEqual(refusedResourceSummary([REFUSAL], planningReceiptPath), [{
    resourceClass: 'oci_image', immutableIdentity: IDENTITY, failureClass: 'unregistered',
    locator: 'sanctuary-backend:ci-1-upgrade-15', ownershipState: 'unlabeled',
    classifications: ['unlabeled', 'protected'],
    references: ['localhost/sanctuary-backend:ci-1-upgrade-15'],
  }]);
});

test('a missing or unmatched inventory still names the refusal', () => {
  const missing = path.join(mkdtempSync(path.join(os.tmpdir(), 'refused-summary-')), 'planning-receipt.json');
  const summary = refusedResourceSummary([REFUSAL], missing);
  assert.deepEqual(summary, [{
    ...REFUSAL, locator: null, ownershipState: null, classifications: [], references: [],
  }]);
  const unmatched = privateDirectoryWithInventory([{ resourceClass: 'oci_image', immutableIdentity: `sha256:${'c'.repeat(64)}` }]);
  assert.equal(refusedResourceSummary([REFUSAL], unmatched)[0].locator, null);
});

test('the summary field is omitted without refusals and bounded with many', () => {
  assert.deepEqual(refusedResourceField({ privateReceipt: { refusals: [] }, state: {} }), {});
  assert.deepEqual(refusedResourceField({ privateReceipt: {}, state: {} }), {});
  const many = Array.from({ length: 25 }, (_, index) => ({
    ...REFUSAL, immutableIdentity: `sha256:${String(index).padStart(64, '0')}`,
  }));
  const planningReceiptPath = privateDirectoryWithInventory([]);
  const field = refusedResourceField({ privateReceipt: { refusals: many }, state: { planningReceiptPath } });
  assert.equal(field.refusedResources.length, 20);
});
