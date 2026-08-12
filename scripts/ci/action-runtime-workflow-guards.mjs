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
  inspectExhaustivePrDeduplication(workflow, relativePath, state);
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

function inspectExhaustivePrDeduplication(workflow, relativePath, state) {
  const mappings = [
    ['quick-frontend-tests', 'full-frontend-coverage-merge', 'frontend_changed'],
    ['quick-backend-typecheck', 'full-backend-typecheck', 'backend_changed'],
    ['quick-critical-mutation-shards', 'full-critical-mutation-shards', 'critical_mutation_changed'],
    ['quick-gateway-tests', 'full-gateway-tests', 'gateway_changed'],
    ['quick-llm-egress-proxy-tests', 'full-llm-egress-proxy-tests', 'llm_egress_proxy_changed'],
    ['quick-browser-smoke', 'full-browser-e2e-tests', 'browser_smoke_changed'],
    ['quick-render-regression', 'full-render-e2e-tests', 'render_changed'],
  ];

  for (const [quickJob, fullJob, relevantOutput] of mappings) {
    const quickBody = extractWorkflowJobBody(workflow, quickJob);
    if (!quickBody) {
      continue;
    }
    requireJobText(
      quickBody,
      relativePath,
      state,
      quickJob,
      "needs.detect-changes.outputs.full_scan != 'true'",
      'must skip when the exhaustive full-scan lane is required',
    );
    requireJobText(
      quickBody,
      relativePath,
      state,
      quickJob,
      "needs.detect-changes.outputs.test_suite_changed != 'true'",
      'must skip when the exhaustive test-suite lane is required',
    );

    const fullBody = requireJobBody(workflow, relativePath, state, fullJob);
    requireJobText(
      fullBody,
      relativePath,
      state,
      fullJob,
      "needs.detect-changes.outputs.full_scan == 'true'",
      `must cover full_scan before ${quickJob} can skip`,
    );
    requireJobText(
      fullBody,
      relativePath,
      state,
      fullJob,
      `needs.detect-changes.outputs.${relevantOutput} == 'true'`,
      `must cover ${relevantOutput} before ${quickJob} can skip`,
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
  const coverageMergeBody = requireJobBody(
    workflow,
    relativePath,
    state,
    'full-frontend-coverage-merge',
  );
  forbidJobNeeds(
    coverageMergeBody,
    relativePath,
    state,
    'full-frontend-coverage-merge',
    'full-frontend-coverage-merge',
  );
  requireJobTextInOrder(
    coverageMergeBody,
    relativePath,
    state,
    'full-frontend-coverage-merge',
    [
      'npm run test:coverage:shard -- 1 2',
      'test -s .vitest-reports/blob-1-2.json',
      'npm run test:coverage:shard -- 2 2',
      'test -s .vitest-reports/blob-2-2.json',
      'npm run test:coverage:merge -- .vitest-reports',
    ],
    'must run both frontend coverage shards sequentially, verify both blobs, and merge them',
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
  // Must stay sequential (one job, one Postgres) — mirrors full-browser-e2e-tests.
  // A matrix span up five concurrent Postgres `services:` containers that get
  // OOM-killed and recreated empty mid-run under shared-runner memory pressure
  // (schema vanishes -> "table public.users does not exist").
  if (/\n\s+matrix:/.test(backendIntegrationBody)) {
    addUniqueError(
      state,
      `${relativePath}: full-backend-integration-tests must stay sequential; concurrent Postgres "services:" containers are OOM-killed under shared-runner load. Loop the groups in one job instead.`,
    );
  }
  // Coverage of all groups is enforced by backend-integration-groups.sh --groups
  // (+ its --check guard, exercised by tests/ci/backend-integration-groups.test.sh),
  // so the single job must enumerate groups through that script rather than hard-code them.
  requireJobText(
    backendIntegrationBody,
    relativePath,
    state,
    'full-backend-integration-tests',
    'backend-integration-groups.sh',
    'must enumerate integration groups via backend-integration-groups.sh',
  );
  requireJobText(
    backendIntegrationBody,
    relativePath,
    state,
    'full-backend-integration-tests',
    '--groups',
    'must loop all integration groups via backend-integration-groups.sh --groups',
  );

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
    ['full-frontend-coverage-merge', 'full-frontend-typechecks'],
    ['full-gateway-tests', 'full-frontend-tests'],
    ['full-llm-egress-proxy-tests', 'full-gateway-tests'],
    ['full-critical-mutation', 'full-llm-egress-proxy-tests'],
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

function requireJobTextInOrder(jobBody, relativePath, state, jobId, texts, message) {
  let position = -1;
  for (const text of texts) {
    position = jobBody.indexOf(text, position + 1);
    if (position === -1) {
      addUniqueError(state, `${relativePath}: workflow job "${jobId}" ${message}`);
      return;
    }
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
