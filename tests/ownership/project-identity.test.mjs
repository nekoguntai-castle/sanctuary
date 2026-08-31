import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProjectIdentity } from '../../scripts/ownership/project-identity.mjs';

test('project identity accepts one matching canonical authority', () => {
  assert.equal(resolveProjectIdentity({ COMPOSE_PROJECT_NAME: 'lane-project' }), 'lane-project');
  assert.equal(resolveProjectIdentity({ SANCTUARY_PROJECT: 'lane-project' }), 'lane-project');
  assert.equal(resolveProjectIdentity({
    COMPOSE_PROJECT_NAME: 'lane-project', SANCTUARY_PROJECT: 'lane-project',
  }), 'lane-project');
});

test('project identity refuses disagreement and invalid values', () => {
  assert.throws(() => resolveProjectIdentity({
    COMPOSE_PROJECT_NAME: 'lane-project', SANCTUARY_PROJECT: 'workspace-project',
  }), /SANCTUARY_PROJECT and COMPOSE_PROJECT_NAME must match/);
  assert.throws(() => resolveProjectIdentity({ COMPOSE_PROJECT_NAME: '../escape' }), /invalid format/);
  assert.throws(() => resolveProjectIdentity({}), /project identity is required/);
});
