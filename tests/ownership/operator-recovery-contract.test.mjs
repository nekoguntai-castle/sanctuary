import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateOperatorRecoveryContract,
} from '../../scripts/ownership/operator-recovery-contract.mjs';

test('tracked operator recovery contract is strict and preserves normal authority', () => {
  const contract = JSON.parse(readFileSync('config/operator-recovery-contract.json'));
  assert.equal(validateOperatorRecoveryContract(contract), contract);
  assert.throws(() => validateOperatorRecoveryContract({
    ...contract, normalCleanupAuthorityUnchanged: false,
  }), /unchanged/);
  assert.throws(() => validateOperatorRecoveryContract({
    ...contract, resourceClasses: contract.resourceClasses.slice(0, 2),
  }), /exactly/);
  assert.throws(() => validateOperatorRecoveryContract({ ...contract, schemaVersion: '2.0.0' }), /identity/);
  assert.throws(() => validateOperatorRecoveryContract({ ...contract, extra: true }), /fields/);
  assert.throws(() => validateOperatorRecoveryContract({
    ...contract, resourceClasses: [...contract.resourceClasses].reverse(),
  }), /not exact/);
  assert.throws(() => validateOperatorRecoveryContract({
    ...contract, resourceClasses: contract.resourceClasses.map((entry, index) => index === 0
      ? { ...entry, authority: [...entry.authority].reverse() } : entry),
  }), /exact recovery contract/);
  assert.throws(() => validateOperatorRecoveryContract({
    ...contract, resourceClasses: contract.resourceClasses.map((entry, index) => index === 2
      ? { ...entry, postconditions: [...entry.postconditions, 'unknown'] } : entry),
  }), /exact recovery contract/);
});
