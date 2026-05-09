const WORKSPACE_ABSOLUTE_HELPERS = [
  'ensure-node',
  'ensure-python',
  'install-semgrep',
];

export function addUniqueError(state, error) {
  if (state.errorSet.has(error)) {
    return;
  }
  state.errorSet.add(error);
  state.errors.push(error);
}

export function inspectWorkspaceAbsoluteHelperCalls(workflow, relativePath, state) {
  const helperPattern = new RegExp(
    `\\bbash\\s+scripts/ci/(${WORKSPACE_ABSOLUTE_HELPERS.join('|')})\\.sh\\b`,
  );

  workflow.split(/\r?\n/).forEach((line, index) => {
    const match = line.match(helperPattern);
    if (!match) {
      return;
    }

    addUniqueError(
      state,
      `${relativePath}:${index + 1}: root CI helper scripts/ci/${match[1]}.sh must be ` +
        'invoked through ${{ github.workspace }}/scripts/... so job working-directory changes ' +
        'cannot break it',
    );
  });
}

export function inspectStrictFullTestSummaryGate(workflow, relativePath, state) {
  if (relativePath !== '.github/workflows/test.yml') {
    return;
  }

  inspectTestSuiteWorkflowName(workflow, relativePath, state);
  if (workflow.includes('Test Suite / Full Test Summary (pull_request)')) {
    addUniqueError(
      state,
      `${relativePath}: required Full Test Summary pull_request context must be emitted by the ` +
        'real full-test-summary job, not posted manually from another job',
    );
  }

  const fullLaneSection = workflow.split(/\n\s+# Full Lane /)[1] ?? '';
  if (fullLaneSection.includes("github.event_name != 'pull_request'")) {
    addUniqueError(
      state,
      `${relativePath}: strict full-lane jobs must run on pull_request so merged code is tested before merge`,
    );
  }

  if (/needs\.[A-Za-z0-9_-]+\.result\s*!=\s*'failure'/.test(fullLaneSection)) {
    addUniqueError(
      state,
      `${relativePath}: full-lane dependency gates must not treat skipped prerequisites as success; ` +
        'require success or explicitly prove the prerequisite lane is out of scope',
    );
  }

  const summaryJobMatch = workflow.match(
    /\n\s{2}full-test-summary:\n(?<body>[\s\S]*?)(?:\n\s{2}[A-Za-z0-9_-]+:\n|$)/,
  );
  const summaryJobBody = summaryJobMatch?.groups?.body ?? '';
  if (!summaryJobBody.includes('name: Full Test Summary')) {
    addUniqueError(
      state,
      `${relativePath}: full-test-summary job must be named "Full Test Summary" to satisfy the required PR context`,
    );
  }
  if (summaryJobBody.includes("github.event_name != 'pull_request'")) {
    addUniqueError(
      state,
      `${relativePath}: full-test-summary job must not exclude pull_request events`,
    );
  }

  inspectFullLaneParallelization(workflow, relativePath, state);
  inspectFalseFullLaneDependencies(workflow, relativePath, state);

  const browserJobBody =
    extractWorkflowJobBody(workflow, 'full-browser-e2e-tests');
  if (/\n\s+matrix:/.test(browserJobBody)) {
    addUniqueError(
      state,
      `${relativePath}: full-browser-e2e-tests must stay sequential; Forgejo matrix children have failed before checkout on the shared runner`,
    );
  }
}

function inspectTestSuiteWorkflowName(workflow, relativePath, state) {
  if (!/^\s*name:\s*Test Suite\s*$/m.test(workflow)) {
    addUniqueError(
      state,
      `${relativePath}: workflow must be named "Test Suite" so required check contexts stay stable`,
    );
  }
}

function inspectFullLaneParallelization(workflow, relativePath, state) {
  const coverageShard1Body = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-frontend-coverage-shard-1',
  );
  forbidJobNeeds(
    coverageShard1Body,
    relativePath,
    state,
    'full-frontend-coverage-shard-1',
    'full-frontend-coverage-shard-1',
  );
  const coverageShard2Body = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-frontend-coverage-shard-2',
  );
  requireJobNeeds(
    coverageShard2Body,
    relativePath,
    state,
    'full-frontend-coverage-shard-2',
    'full-frontend-coverage-shard-1',
  );
  requireJobText(
    coverageShard2Body,
    relativePath,
    state,
    'full-frontend-coverage-shard-2',
    "needs.full-frontend-coverage-shard-1.result == 'success'",
    'must run shard 2 only after shard 1 succeeds to avoid concurrent V8 coverage cleanup and worker crashes',
  );

  const coverageMergeBody = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-frontend-coverage-merge',
  );
  requireJobNeeds(
    coverageMergeBody,
    relativePath,
    state,
    'full-frontend-coverage-merge',
    'full-frontend-coverage-shard-1',
  );
  requireJobNeeds(
    coverageMergeBody,
    relativePath,
    state,
    'full-frontend-coverage-merge',
    'full-frontend-coverage-shard-2',
  );
  requireJobText(
    coverageMergeBody,
    relativePath,
    state,
    'full-frontend-coverage-merge',
    "needs.full-frontend-coverage-shard-1.result == 'success'",
    'must require shard 1 success before merging frontend coverage',
  );
  requireJobText(
    coverageMergeBody,
    relativePath,
    state,
    'full-frontend-coverage-merge',
    "needs.full-frontend-coverage-shard-2.result == 'success'",
    'must require shard 2 success before merging frontend coverage',
  );

  const frontendAggregateBody = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-frontend-tests',
  );
  requireJobNeeds(
    frontendAggregateBody,
    relativePath,
    state,
    'full-frontend-tests',
    'full-frontend-typechecks',
  );
  requireJobNeeds(
    frontendAggregateBody,
    relativePath,
    state,
    'full-frontend-tests',
    'full-frontend-coverage-merge',
  );

  const backendIntegrationBody = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-backend-integration-tests',
  );
  for (const group of ['flows', 'ops-workers', 'repositories-core', 'repositories-sharing']) {
    requireJobText(
      backendIntegrationBody,
      relativePath,
      state,
      'full-backend-integration-tests',
      group,
      `must include backend integration group "${group}"`,
    );
  }

  const backendAggregateBody = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-backend-tests',
  );
  requireJobNeeds(
    backendAggregateBody,
    relativePath,
    state,
    'full-backend-tests',
    'full-backend-integration-tests',
  );
}

function inspectFalseFullLaneDependencies(workflow, relativePath, state) {
  const forbiddenNeeds = [
    ['full-frontend-typechecks', 'full-backend-tests'],
    ['full-frontend-coverage-shard-1', 'full-frontend-typechecks'],
    ['full-frontend-coverage-shard-2', 'full-frontend-typechecks'],
    ['full-gateway-tests', 'full-frontend-tests'],
    ['full-ai-proxy-tests', 'full-gateway-tests'],
    ['full-critical-mutation', 'full-ai-proxy-tests'],
    ['full-browser-e2e-tests', 'full-critical-mutation'],
    ['full-build-check', 'full-render-e2e-tests'],
  ];

  for (const [jobId, forbiddenNeed] of forbiddenNeeds) {
    forbidJobNeeds(
      extractWorkflowJobBody(workflow, jobId),
      relativePath,
      state,
      jobId,
      forbiddenNeed,
    );
  }
}

function requireJobBody(workflow, relativePath, state, jobId) {
  const body = extractWorkflowJobBody(workflow, jobId);
  if (!body) {
    addUniqueError(state, `${relativePath}: required workflow job "${jobId}" is missing`);
  }
  return body;
}

function extractWorkflowJobBody(workflow, jobId) {
  const escapedJobId = escapeRegExp(jobId);
  return workflow.match(
    new RegExp(`\\n\\s{2}${escapedJobId}:\\n(?<body>[\\s\\S]*?)(?:\\n\\s{2}[A-Za-z0-9_-]+:\\n|$)`),
  )?.groups?.body ?? '';
}

function requireJobNeeds(jobBody, relativePath, state, jobId, requiredNeed) {
  if (!jobBody || jobNeedsJob(jobBody, requiredNeed)) {
    return;
  }
  addUniqueError(
    state,
    `${relativePath}: workflow job "${jobId}" must need "${requiredNeed}"`,
  );
}

function forbidJobNeeds(jobBody, relativePath, state, jobId, forbiddenNeed) {
  if (!jobBody || !jobNeedsJob(jobBody, forbiddenNeed)) {
    return;
  }
  addUniqueError(
    state,
    `${relativePath}: workflow job "${jobId}" must not need "${forbiddenNeed}"`,
  );
}

function jobNeedsJob(jobBody, neededJob) {
  const needsMatch = jobBody.match(/\n\s+needs:\s*(?<needs>[^\n]*(?:\n\s+-\s*[A-Za-z0-9_-]+)*)/);
  return new RegExp(`\\b${escapeRegExp(neededJob)}\\b`).test(needsMatch?.groups?.needs ?? '');
}

function requireJobText(jobBody, relativePath, state, jobId, text, message) {
  if (!jobBody || jobBody.includes(text)) {
    return;
  }
  addUniqueError(state, `${relativePath}: workflow job "${jobId}" ${message}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
