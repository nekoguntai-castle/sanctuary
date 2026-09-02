import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  incidentTarget, validateOperatorRecoveryIncident,
} from '../../scripts/ownership/operator-recovery-incident.mjs';

const incident = JSON.parse(readFileSync('config/operator-recovery-incident.json'));

test('checked incident binds exactly four target tuples and two exclusions', () => {
  assert.equal(validateOperatorRecoveryIncident(incident), incident);
  assert.throws(() => validateOperatorRecoveryIncident({
    ...incident, targets: incident.targets.slice(0, 3),
  }), /exactly four/);
  assert.throws(() => validateOperatorRecoveryIncident({
    ...incident, exclusionProjects: ['sanctuary'],
  }), /exclusion/);
  assert.throws(() => validateOperatorRecoveryIncident({
    ...incident, exclusionExpectedCounts: {
      ...incident.exclusionExpectedCounts,
      sanctuary: { ...incident.exclusionExpectedCounts.sanctuary, compose_container: 15 },
    },
  }), /counts/);
  assert.throws(() => validateOperatorRecoveryIncident({
    ...incident, targets: incident.targets.map((entry, index) => index === 0
      ? { ...entry, ownerId: 'wrong-owner' } : entry),
  }), /approved exact target/);
});

test('per-stack request must match one complete checked target', () => {
  const approved = incident.targets[0];
  const request = {
    target: { project: approved.project, deploymentId: approved.deploymentId, ownerId: approved.ownerId },
    expectedCounts: approved.expectedCounts, sourceCommit: approved.sourceCommit,
    sourceExecutionId: approved.sourceExecutionId,
  };
  assert.equal(incidentTarget(incident, request), approved);
  assert.throws(() => incidentTarget(incident, {
    ...request, sourceExecutionId: 'ci-99605-1-fresh-install-cleanup',
  }), /allowlist/);
});
