function getRequiredBenchmarkScenarios(benchmark) {
  const scenarios = new Map([
    ['wallet list', ['200']],
    ['large wallet transaction history', ['200']],
    ['websocket subscription fanout', []],
    ['wallet sync queue', ['200']],
    ['backup validate', ['200']],
  ]);
  if (benchmark.environment?.allowRestore) {
    scenarios.set('backup restore', ['200']);
  }

  return scenarios;
}

function indexScenariosByName(scenarios) {
  return new Map((scenarios || []).map((scenario) => [scenario.name, scenario]));
}

function assertScenarioWasRecorded(scenarioName, scenario, skippedByName) {
  if (!scenario) {
    const skipped = skippedByName.get(scenarioName);
    const reason = skipped ? `; skipped because ${skipped.reason}` : '';
    throw new Error(`Required scenario "${scenarioName}" was not recorded${reason}`);
  }
}

function assertScenarioPassed(scenarioName, scenario) {
  if (scenario.status !== 'passed') {
    throw new Error(`Required scenario "${scenarioName}" did not pass: ${JSON.stringify(scenario)}`);
  }
}

function assertRequiredStatusCounts(scenarioName, scenario, requiredStatuses) {
  for (const status of requiredStatuses) {
    if (!scenario.statusCounts || !scenario.statusCounts[status]) {
      throw new Error(`Required scenario "${scenarioName}" did not record HTTP ${status}: ${JSON.stringify(scenario)}`);
    }
  }
}

function assertRequiredBenchmarkScenarios(benchmark, requiredScenarios) {
  const scenariosByName = indexScenariosByName(benchmark.scenarios);
  const skippedByName = indexScenariosByName(benchmark.skipped);

  for (const [scenarioName, requiredStatuses] of requiredScenarios) {
    const scenario = scenariosByName.get(scenarioName);
    assertScenarioWasRecorded(scenarioName, scenario, skippedByName);
    assertScenarioPassed(scenarioName, scenario);
    assertRequiredStatusCounts(scenarioName, scenario, requiredStatuses);
  }
}

function assertNoFailedBenchmarkScenarios(benchmark) {
  const failedScenarios = (benchmark.scenarios || []).filter((scenario) => scenario.status === 'failed');
  if (failedScenarios.length > 0) {
    throw new Error(`Benchmark recorded failed scenarios: ${failedScenarios.map((scenario) => scenario.name).join(', ')}`);
  }
}

function assertBenchmarkFixtureSources(benchmark) {
  if (benchmark.environment?.fixture?.tokenSource !== 'local-login') {
    throw new Error(`Benchmark did not use local-login fixture token: ${benchmark.environment?.fixture?.tokenSource || 'none'}`);
  }

  if (!['local-created', 'local-existing'].includes(benchmark.environment?.fixture?.walletSource)) {
    throw new Error(`Benchmark did not create/reuse a local wallet fixture: ${benchmark.environment?.fixture?.walletSource || 'none'}`);
  }

  if (benchmark.environment?.fixture?.backupSource !== 'local-admin-api') {
    throw new Error(`Benchmark did not create a backup fixture through the admin API: ${benchmark.environment?.fixture?.backupSource || 'none'}`);
  }
}

export function assertBenchmarkProof(benchmark) {
  const requiredScenarios = getRequiredBenchmarkScenarios(benchmark);
  assertRequiredBenchmarkScenarios(benchmark, requiredScenarios);
  assertNoFailedBenchmarkScenarios(benchmark);
  assertBenchmarkFixtureSources(benchmark);

  return {
    requiredScenarios: [...requiredScenarios.keys()],
    skipped: benchmark.skipped || [],
    datasetLabel: benchmark.environment?.datasetLabel || 'unknown',
  };
}
