import path from 'node:path';
import { escapeCell, formatBytes, summarizeDurations } from './common.mjs';

function relativePath(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath);
}

function displayPath(repoRoot, targetPath) {
  return path.isAbsolute(targetPath) ? relativePath(repoRoot, targetPath) : targetPath;
}

function markdownTableRow(values) {
  return `| ${values.join(' | ')} |`;
}

function totalRedisKeys(keyspace) {
  return Object.values(keyspace).reduce((sum, entry) => sum + (entry?.keys || 0), 0);
}

function buildMarkdownHeader(report) {
  return [
    '# Phase 3 Compose Benchmark Smoke',
    '',
    `Date: ${report.startedAt}`,
    `Status: ${report.passed ? 'Passed' : 'Failed'}`,
    `Compose project: ${report.projectName}`,
    `API URL: ${report.apiUrl}`,
    `Gateway URL: ${report.gatewayUrl}`,
    `WebSocket URL: ${report.wsUrl}`,
    '',
    '## Results',
    '',
    ...report.steps.map((step) => `- ${step.passed ? 'PASS' : 'FAIL'} ${step.name}: ${step.summary}`),
    '',
  ];
}

function buildBenchmarkEvidenceSection(report, repoRoot) {
  return [
    '## Benchmark Evidence',
    '',
    report.benchmarkEvidence?.mdPath
      ? `- Markdown: ${displayPath(repoRoot, report.benchmarkEvidence.mdPath)}`
      : '- Markdown: not recorded',
    report.benchmarkEvidence?.jsonPath
      ? `- JSON: ${displayPath(repoRoot, report.benchmarkEvidence.jsonPath)}`
      : '- JSON: not recorded',
    report.benchmarkProof
      ? `- Dataset: ${report.benchmarkProof.datasetLabel}`
      : '- Dataset: not recorded',
    '',
  ];
}

function buildCapacitySnapshotsSection(report) {
  const lines = ['## Capacity Snapshots', ''];

  if (report.capacitySnapshots?.length) {
    lines.push(
      '| Label | Postgres size | Connections | Transactions | Redis memory | Redis clients | Redis keys |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...report.capacitySnapshots.map((snapshot) => [
        escapeCell(snapshot.label),
        formatBytes(snapshot.postgres?.databaseSizeBytes),
        `${snapshot.postgres?.connections ?? ''}/${snapshot.postgres?.maxConnections ?? ''}`,
        snapshot.postgres?.rowCounts?.transactions ?? '',
        formatBytes(snapshot.redis?.usedMemoryBytes),
        snapshot.redis?.connectedClients ?? '',
        totalRedisKeys(snapshot.redis?.keyspace || {}),
      ]).map(markdownTableRow),
      ''
    );
  } else {
    lines.push('No capacity snapshots recorded.', '');
  }

  return lines;
}

function buildScenarioSummarySection(report) {
  const lines = ['## Scenario Summary', ''];

  if (report.benchmarkEvidence?.benchmark?.scenarios?.length) {
    lines.push(
      '| Scenario | Status | Requests | Successes | Errors | p95 ms | p99 ms |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
      ...report.benchmarkEvidence.benchmark.scenarios.map((scenario) => [
        escapeCell(scenario.name),
        scenario.status,
        scenario.requests,
        scenario.successes,
        scenario.errors,
        scenario.latency?.p95Ms ?? '',
        scenario.latency?.p99Ms ?? '',
      ]).map(markdownTableRow),
      ''
    );
  } else {
    lines.push('No benchmark scenarios recorded.', '');
  }

  return lines;
}

function buildLargeWalletHistorySection(report) {
  const lines = ['## Large Wallet Transaction-History Proof', ''];

  if (report.largeWalletHistoryProof) {
    lines.push(
      `Dataset: ${report.largeWalletHistoryProof.dataset.transactionCount} synthetic transactions`,
      `Wallet: ${report.largeWalletHistoryProof.wallet.name} (${report.largeWalletHistoryProof.wallet.id})`,
      `Traffic: ${report.largeWalletHistoryProof.traffic.requests} requests at concurrency ${report.largeWalletHistoryProof.traffic.concurrency}`,
      `Page size: ${report.largeWalletHistoryProof.dataset.pageSize}`,
      `p95: ${report.largeWalletHistoryProof.latency.p95Ms} ms`,
      `p99: ${report.largeWalletHistoryProof.latency.p99Ms} ms`,
      `Gate: p95 <= ${report.largeWalletHistoryProof.gate.p95BudgetMs} ms`,
      ''
    );
  } else {
    lines.push('No large-wallet transaction-history proof recorded.', '');
  }

  return lines;
}

function buildSizedBackupRestoreSection(report) {
  const lines = ['## Sized Backup Restore Proof', ''];

  if (report.sizedBackupRestoreProof) {
    lines.push(
      `Backup size: ${formatBytes(report.sizedBackupRestoreProof.backup.sizeBytes)}`,
      `Backup records: ${report.sizedBackupRestoreProof.backup.totalRecords}`,
      `Transaction records: ${report.sizedBackupRestoreProof.backup.recordCounts?.transaction ?? 'unknown'}`,
      `Backup create duration: ${report.sizedBackupRestoreProof.backup.durationMs} ms`,
      `Validation duration: ${report.sizedBackupRestoreProof.validation.durationMs} ms`,
      `Restore duration: ${report.sizedBackupRestoreProof.restore.durationMs} ms`,
      `Restore result: ${report.sizedBackupRestoreProof.restore.success ? 'success' : 'failed'}; tables=${report.sizedBackupRestoreProof.restore.tablesRestored}; records=${report.sizedBackupRestoreProof.restore.recordsRestored}`,
      ''
    );
  } else {
    lines.push('No sized backup restore proof recorded.', '');
  }

  return lines;
}

function buildWorkerQueueSection(report) {
  const lines = ['## Worker Queue Proof', ''];

  if (report.workerQueueProof?.jobs?.length) {
    const durations = summarizeDurations(report.workerQueueProof.jobs.map((job) => job.durationMs));
    lines.push(
      `Total duration: ${report.workerQueueProof.totalDurationMs} ms`,
      `Repeat profile: ${report.workerQueueProof.repeatCount || 1}x`,
      `Job p95: ${durations.p95Ms} ms`,
      '',
      '| Repeat | Category | Queue | Job | State | Duration ms |',
      '| ---: | --- | --- | --- | --- | ---: |',
      ...report.workerQueueProof.jobs.map((job) => [
        job.repeat ?? 0,
        job.category,
        job.queue,
        escapeCell(job.name),
        job.state,
        job.durationMs,
      ]).map(markdownTableRow),
      '',
      'Queue counts after proof:',
      ''
    );

    for (const [queueName, stats] of Object.entries(report.workerQueueProof.metricsAfter?.queues || {})) {
      lines.push(`- ${queueName}: waiting=${stats.waiting} active=${stats.active} delayed=${stats.delayed} failed=${stats.failed} completed=${stats.completed}`);
    }
    lines.push('');
  } else {
    lines.push('No worker queue proof recorded.', '');
  }

  return lines;
}

function getWorkerScaleOutProcessorIds(proof) {
  return [...new Set(
    proof.jobs
      .filter((job) => job.name === 'diagnostics:worker-ping')
      .map((job) => job.returnvalue?.worker?.hostname)
      .filter(Boolean)
  )];
}

function getWorkerScaleOutOwner(proof) {
  return proof.metricsAfter.find((entry) => (
    entry.metrics?.worker?.electrumSubscriptionOwner || entry.metrics?.electrum?.isRunning
  ));
}

function buildWorkerScaleOutSection(report) {
  const lines = ['## Worker Scale-Out Proof', ''];

  if (report.workerScaleOutProof?.jobs?.length) {
    const processorIds = getWorkerScaleOutProcessorIds(report.workerScaleOutProof);
    const owner = getWorkerScaleOutOwner(report.workerScaleOutProof);
    lines.push(
      `Worker replicas: ${report.workerScaleOutProof.workers?.length || 0}`,
      `Diagnostic job processors: ${processorIds.join(', ')}`,
      `Electrum subscription owner: ${owner?.target?.name || 'unknown'}`,
      `Locked diagnostic result: ${report.workerScaleOutProof.lockProof.jobs.filter((job) => job.returnvalue?.success).length} executed, ${report.workerScaleOutProof.lockProof.jobs.filter((job) => job.returnvalue?.skipped).length} skipped by lock`,
      '',
      '| Category | Job | State | Processor | Duration ms |',
      '| --- | --- | --- | --- | ---: |',
      ...report.workerScaleOutProof.jobs.map((job) => [
        job.category,
        escapeCell(job.name),
        job.state,
        job.returnvalue?.worker?.hostname || '',
        job.durationMs,
      ]).map(markdownTableRow),
      '',
      'Repeatable job ownership:',
      ''
    );

    for (const job of report.workerScaleOutProof.repeatableJobs || []) {
      lines.push(`- ${job.queue}:${job.name}: repeatable definitions=${job.count}`);
    }
    lines.push('');
  } else {
    lines.push('No worker scale-out proof recorded.', '');
  }

  return lines;
}

function getBackendScaleOutTargetCount(proof) {
  return new Set(
    (proof.websocket?.targets || [])
      .map((target) => target.target?.name)
      .filter(Boolean)
  ).size;
}

function buildBackendScaleOutFanoutLine(proof) {
  if (!proof.fanout) {
    return `WebSocket target: ${proof.websocketTarget.name} (${proof.websocketTarget.ip})`;
  }

  const targetCount = getBackendScaleOutTargetCount(proof);
  return `WebSocket clients: ${proof.fanout.successes}/${proof.fanout.clientCount} received the event across ${targetCount} backend replicas`;
}

function buildBackendScaleOutEventLine(proof) {
  if (proof.fanout) {
    return `Fanout p95: ${proof.fanout.latency.p95Ms} ms`;
  }

  return `Event: ${proof.event.event} on ${proof.event.channel} in ${proof.event.durationMs} ms`;
}

function buildBackendScaleOutSection(report) {
  const lines = ['## Backend Scale-Out Proof', ''];

  if (report.backendScaleOutProof?.event?.ok) {
    lines.push(
      `Backend replicas: ${report.backendScaleOutProof.backends?.length || 0}`,
      buildBackendScaleOutFanoutLine(report.backendScaleOutProof),
      `Trigger target: ${report.backendScaleOutProof.triggerTarget.name} (${report.backendScaleOutProof.triggerTarget.ip})`,
      `Wallet: ${report.backendScaleOutProof.wallet.name} (${report.backendScaleOutProof.wallet.id})`,
      `Trigger status: ${report.backendScaleOutProof.trigger.status}`,
      buildBackendScaleOutEventLine(report.backendScaleOutProof),
      ''
    );
  } else {
    lines.push('No backend scale-out proof recorded.', '');
  }

  return lines;
}

function buildContainerSection(report) {
  return [
    '## Containers',
    '',
    ...report.composePs.map((container) => `- ${container.service}: state=${container.state}${container.health ? ` health=${container.health}` : ''}`),
    '',
  ];
}

function buildNotesSection() {
  return [
    '## Notes',
    '',
    '- This proof starts a disposable full-stack Docker Compose project with frontend, backend, gateway, worker, Redis, and PostgreSQL services.',
    '- The smoke waits for database migration and seed completion, then runs the existing Phase 3 benchmark harness with local fixture provisioning.',
    '- The run proves authenticated wallet list, transaction-history, WebSocket subscription fanout, wallet-sync queue, and admin backup-validation paths execute end to end on a local seeded stack.',
    '- Capacity snapshots capture PostgreSQL row counts, database size, connection use, selected memory settings, Redis memory, client count, and keyspace counts for the tested local topology.',
    '- The large-wallet transaction-history proof seeds synthetic transaction rows into the disposable PostgreSQL database and measures the authenticated wallet transaction-history endpoint against a strict local p95 gate.',
    '- The sized backup restore proof creates, validates, and restores a generated backup after the synthetic transaction data is present in the disposable PostgreSQL database.',
    '- The worker queue proof enqueues and waits for BullMQ jobs across sync, confirmations, notifications, maintenance, autopilot, and intelligence handlers in the running worker container.',
    '- The worker scale-out proof runs two worker replicas, verifies diagnostic BullMQ jobs complete on both replicas, proves a shared diagnostic lock skips one concurrent duplicate, checks recurring jobs have one repeatable definition, and requires exactly one worker to own Electrum subscriptions.',
    '- The backend scale-out proof runs two backend replicas, opens multiple wallet subscription WebSockets across the replicas, triggers wallet sync on one replica, and requires the Redis bridge to deliver the sync event to every client.',
    '- The local generated wallets and two-replica topology are repository-controlled proof; A-grade scale claims still require privacy-safe calibrated datasets and topologies, such as synthetic/regtest fixtures or operator-owned testnet wallets, without third-party wallet profiling.',
    '- The disposable wrapper enables backup restore by default because the PostgreSQL database is temporary; set `PHASE3_COMPOSE_ALLOW_RESTORE=false` only when explicitly testing non-destructive mode.'
  ];
}

export function buildMarkdown(report, { repoRoot }) {
  const lines = [
    ...buildMarkdownHeader(report),
    ...buildBenchmarkEvidenceSection(report, repoRoot),
    ...buildCapacitySnapshotsSection(report),
    ...buildScenarioSummarySection(report),
    ...buildLargeWalletHistorySection(report),
    ...buildSizedBackupRestoreSection(report),
    ...buildWorkerQueueSection(report),
    ...buildWorkerScaleOutSection(report),
    ...buildBackendScaleOutSection(report),
    ...buildContainerSection(report),
    ...buildNotesSection(),
  ];

  return `${lines.join('\n')}\n`;
}
