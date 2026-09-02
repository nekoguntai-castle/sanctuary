const EXPECTED_TARGETS = Object.freeze([
  ['ci-99604-1-fresh-install', '49184c09339de320437cffeb2636aa6b9c6e17fd'],
  ['ci-99605-1-fresh-install', '49184c09339de320437cffeb2636aa6b9c6e17fd'],
  ['ci-99606-1-fresh-install', 'fc2c6e8cb0c906aa5c5fff72cb9de77b1575c46f'],
  ['ci-99607-1-fresh-install', '03ee72036885a096dbfcd4797c72e2c97898e15b'],
]);
const EXPECTED_EXCLUSIONS = Object.freeze([
  'ci-local-3469272-1788333412-1-install-upgrade', 'sanctuary',
]);

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error(`${label} fields are invalid`);
  }
  return value;
}

function validateCounts(value) {
  exact(value, ['compose_container', 'compose_network', 'compose_volume'], 'incident target counts');
  if (value.compose_container !== 9 || value.compose_network !== 2 || value.compose_volume !== 4) {
    throw new Error('incident target counts must be exactly 9 containers, 2 networks, and 4 volumes');
  }
}

function validateExclusionCounts(value) {
  exact(value, EXPECTED_EXCLUSIONS, 'incident exclusion counts');
  for (const project of EXPECTED_EXCLUSIONS) {
    exact(value[project], ['compose_container', 'compose_network', 'compose_volume'], 'incident exclusion project counts');
    const expected = project === 'sanctuary' ? [16, 3, 9] : [9, 2, 4];
    if (['compose_container', 'compose_network', 'compose_volume']
      .some((resourceClass, index) => value[project][resourceClass] !== expected[index])) {
      throw new Error('operator recovery incident exclusion counts are not exact');
    }
  }
}

function validateTarget(value, [expectedProject, expectedCommit]) {
  exact(value, [
    'project', 'deploymentId', 'ownerId', 'sourceCommit', 'sourceExecutionId', 'expectedCounts',
  ], 'incident target');
  if (value.project !== expectedProject
      || value.deploymentId !== `${expectedProject}-deploy`
      || value.ownerId !== `${expectedProject}-owner`
      || value.sourceExecutionId !== `${expectedProject}-cleanup`
      || value.sourceCommit !== expectedCommit) {
    throw new Error('incident target tuple is not the approved exact target');
  }
  validateCounts(value.expectedCounts);
}

/** Validate the checked, incident-specific four-stack allowlist. */
export function validateOperatorRecoveryIncident(value) {
  exact(value, [
    'schemaVersion', 'incidentId', 'targets', 'exclusionProjects', 'exclusionExpectedCounts',
  ], 'operator recovery incident');
  if (value.schemaVersion !== '1.0.0'
      || value.incidentId !== 'lost-authority-fresh-install-2026-09-02') {
    throw new Error('operator recovery incident identity is invalid');
  }
  if (!Array.isArray(value.targets) || value.targets.length !== EXPECTED_TARGETS.length) {
    throw new Error('operator recovery incident requires exactly four targets');
  }
  value.targets.forEach((target, index) => validateTarget(target, EXPECTED_TARGETS[index]));
  if (!Array.isArray(value.exclusionProjects)
      || value.exclusionProjects.length !== EXPECTED_EXCLUSIONS.length
      || value.exclusionProjects.some((entry, index) => entry !== EXPECTED_EXCLUSIONS[index])) {
    throw new Error('operator recovery incident exclusion projects are not exact');
  }
  validateExclusionCounts(value.exclusionExpectedCounts);
  return value;
}

export function incidentTarget(incident, request) {
  validateOperatorRecoveryIncident(incident);
  exact(request, [
    'target', 'expectedCounts', 'sourceCommit', 'sourceExecutionId',
  ], 'requested incident target');
  exact(request.target, ['project', 'deploymentId', 'ownerId'], 'requested target');
  const approved = incident.targets.find((entry) => entry.project === request.target.project);
  if (!approved || ['project', 'deploymentId', 'ownerId'].some((key) => request.target[key] !== approved[key])
      || request.sourceCommit !== approved.sourceCommit
      || request.sourceExecutionId !== approved.sourceExecutionId
      || JSON.stringify(request.expectedCounts) !== JSON.stringify(approved.expectedCounts)) {
    throw new Error('requested recovery does not match the checked incident allowlist');
  }
  return approved;
}

export function operatorRecoveryIncidentProjects() {
  return EXPECTED_TARGETS.map(([project]) => project);
}
