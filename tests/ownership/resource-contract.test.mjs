import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseStrictJson } from '../../scripts/ownership/canonical-json.mjs';
import { validateApplicationAuthorities, validateCallsiteInventory, validateOwnershipContract } from '../../scripts/ownership/contracts.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const load = (name) => parseStrictJson(readFileSync(path.join(root, 'config', name)));

test('tracked ownership and callsite contracts validate', () => {
  const contract = validateOwnershipContract(load('resource-ownership-contract.json'));
  assert.equal(contract.resourceClasses.length, 14);
  assert.doesNotThrow(() => validateCallsiteInventory(load('resource-lifecycle-callsites.json'), contract));
  assert.doesNotThrow(() => validateApplicationAuthorities(load('application-lifecycle-authorities.json')));
});

test('ownership contract rejects unknown fields, duplicates, cycles, and unsafe paths', () => {
  const original = load('resource-ownership-contract.json');
  const mutate = (callback) => { const value = structuredClone(original); callback(value); return value; };
  assert.throws(() => validateOwnershipContract({ ...original, surprise: true }), /exactly/);
  assert.throws(() => validateOwnershipContract(mutate((value) => { value.resourceClasses[1].classId = value.resourceClasses[0].classId; })), /duplicates|missing/);
  assert.throws(() => validateOwnershipContract(mutate((value) => { value.resourceClasses[0].dependsOn = ['application_lease_fence']; value.resourceClasses[1].dependsOn = ['wallet_mutation']; })), /cycle/);
  assert.throws(() => validateOwnershipContract(mutate((value) => { value.resourceClasses[0].canonicalPaths = ['../private']; })), /canonical/);
});

test('callsite contract rejects unknown fields and duplicate semantic identities', () => {
  const contract = load('resource-ownership-contract.json');
  const inventory = load('resource-lifecycle-callsites.json');
  assert.throws(() => validateCallsiteInventory({ ...inventory, extra: true }, contract), /exactly/);
  const duplicate = structuredClone(inventory);
  duplicate.callsites.push(structuredClone(duplicate.callsites[0]));
  assert.throws(() => validateCallsiteInventory(duplicate, contract), /duplicates/);

  const dockerDeferred = structuredClone(inventory);
  const dockerEntry = dockerDeferred.callsites.find((entry) => entry.resourceClass === 'compose_container');
  dockerEntry.disposition = 'deferred';
  dockerEntry.safetyContract = 'Phase 6 should not defer a Docker cleanup callsite.';
  assert.throws(
    () => validateCallsiteInventory(dockerDeferred, contract),
    /reserved for an explicit Phase 6 host-artifact migration/,
  );

  const vagueHostDeferred = structuredClone(inventory);
  const hostEntry = vagueHostDeferred.callsites.find((entry) => entry.resourceClass === 'temporary_artifact');
  hostEntry.disposition = 'deferred';
  hostEntry.safetyContract = 'Later work will migrate this host artifact.';
  assert.throws(
    () => validateCallsiteInventory(vagueHostDeferred, contract),
    /reserved for an explicit Phase 6 host-artifact migration/,
  );
});
