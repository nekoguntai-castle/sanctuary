import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

interface DashboardTarget {
  expr?: string;
}

interface DashboardPanel {
  title?: string;
  targets?: DashboardTarget[];
}

interface Dashboard {
  panels: DashboardPanel[];
}

interface AlertRule {
  alert: string;
  expr: string;
}

interface AlertGroup {
  name: string;
  rules: AlertRule[];
}

interface AlertRulesFile {
  groups: AlertGroup[];
}

interface RootPackage {
  devDependencies?: Record<string, string>;
}

interface PromtailConfig {
  scrape_configs: Array<{
    pipeline_stages: Array<{
      drop?: {
        older_than?: string;
        drop_counter_reason?: string;
      };
    }>;
  }>;
}

interface LokiConfig {
  limits_config: {
    retention_period?: string;
    reject_old_samples_max_age?: string;
  };
}

const repoPath = (...parts: string[]): string => resolve(process.cwd(), ...parts);
const dashboard = JSON.parse(readFileSync(repoPath(
  'docker/monitoring/grafana/dashboards/sanctuary-wallet-sync.json',
), 'utf8')) as Dashboard;
const alertRules = parse(
  readFileSync(repoPath('docker/monitoring/alert_rules.yml'), 'utf8'),
) as AlertRulesFile;
const promtailConfig = parse(
  readFileSync(repoPath('docker/monitoring/promtail-config.yml'), 'utf8'),
) as PromtailConfig;
const lokiConfig = parse(
  readFileSync(repoPath('docker/monitoring/loki-config.yml'), 'utf8'),
) as LokiConfig;
const rootPackage = JSON.parse(readFileSync(repoPath('package.json'), 'utf8')) as RootPackage;

const dashboardExpressions = dashboard.panels.flatMap(panel => (
  panel.targets?.flatMap(target => target.expr ?? []) ?? []
));
const executionGroup = alertRules.groups.find(group => (
  group.name === 'sanctuary.wallet-sync-execution'
));
const alertExpressions = alertRules.groups.flatMap(group => group.rules.map(rule => rule.expr));

function requirePanel(title: string, metricNames: readonly string[]): void {
  const panel = dashboard.panels.find(candidate => candidate.title === title);
  expect(panel, `missing dashboard panel: ${title}`).toBeDefined();
  const expressions = panel?.targets?.flatMap(target => target.expr ?? []) ?? [];
  for (const metricName of metricNames) {
    expect(expressions.some(expression => expression.includes(metricName)),
      `${title} must query ${metricName}`).toBe(true);
  }
}

function requireAlert(name: string, metricName: string): AlertRule {
  const rule = executionGroup?.rules.find(candidate => candidate.alert === name);
  expect(rule, `missing alert: ${name}`).toBeDefined();
  expect(rule?.expr).toContain(metricName);
  return rule as AlertRule;
}

function queryLabelNames(expression: string): Set<string> {
  const names = new Set<string>();
  for (const match of expression.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:!?=~?)/g)) {
    names.add(match[1]);
  }
  for (const match of expression.matchAll(/\b(?:by|without)\s*\(([^)]*)\)/g)) {
    for (const name of match[1].split(',').map(value => value.trim()).filter(Boolean)) {
      names.add(name);
    }
  }
  return names;
}

describe('wallet-sync operational observability', () => {
  it('uses the root-pinned YAML parser to validate alert rules', () => {
    expect(rootPackage.devDependencies?.yaml).toBe('^2.9.0');
    expect(alertRules.groups.length).toBeGreaterThan(0);
  });

  it('drops replayed Docker logs before Loki can reject a current batch', () => {
    const dropStages = promtailConfig.scrape_configs.flatMap(config => (
      config.pipeline_stages.flatMap(stage => stage.drop ?? [])
    ));

    expect(dropStages).toContainEqual({
      older_than: '168h',
      drop_counter_reason: 'outside_loki_retention',
    });
    expect(lokiConfig.limits_config).toMatchObject({
      retention_period: '168h',
      reject_old_samples_max_age: '169h',
    });
  });

  it('provides every required low-cardinality execution panel', () => {
    requirePanel('Active Attempts by Stage', ['sanctuary_wallet_sync_active_stage']);
    requirePanel('Oldest Active Stage Age', [
      'sanctuary_wallet_sync_active_stage_oldest_seconds',
    ]);
    requirePanel('Completed Stage Duration P50 / P95', [
      'sanctuary_wallet_sync_stage_duration_seconds_bucket',
    ]);
    requirePanel('Candidate Evidence Fetched / Rejected', [
      'sanctuary_wallet_sync_candidates_total',
    ]);
    requirePanel('Fallback and Budget Expiry', [
      'sanctuary_wallet_sync_fallback_total',
      'sanctuary_wallet_sync_budget_expiry_total',
    ]);
    requirePanel('Timeout, Abort, and Abort Grace', [
      'sanctuary_wallet_sync_terminal_total',
      'sanctuary_wallet_sync_abort_grace_exhausted_total',
    ]);
    requirePanel('Lock Ownership Loss', ['sanctuary_wallet_sync_lock_loss_total']);
    requirePanel('Cleanup Outcomes', ['sanctuary_wallet_sync_cleanup_total']);

    const durationPanel = dashboard.panels.find(panel => (
      panel.title === 'Completed Stage Duration P50 / P95'
    ));
    const durationQuery = durationPanel?.targets?.map(target => target.expr).join('\n') ?? '';
    expect(durationQuery).toContain('histogram_quantile(0.50');
    expect(durationQuery).toContain('histogram_quantile(0.95');
    expect(durationQuery).toContain('outcome="completed"');
  });

  it('pins execution alerts and the exact slow-stage budget matrix', () => {
    expect(executionGroup).toBeDefined();
    const overBudget = requireAlert(
      'WalletSyncActiveStageOverBudget',
      'sanctuary_wallet_sync_active_stage_oldest_seconds',
    );
    const slowMatcher = overBudget.expr.match(/stage=~"([^"]+)"/);
    const normalMatcher = overBudget.expr.match(/stage!~"([^"]+)"/);
    expect(slowMatcher?.[1].split('|').sort()).toEqual([
      'address_history',
      'candidate_fetch',
      'initial_network',
      'parent_fetch',
      'timestamp_fetch',
    ]);
    expect(normalMatcher?.[1]).toBe(slowMatcher?.[1]);
    expect(overBudget.expr).toMatch(/\)\s*>\s*330\b/);
    expect(overBudget.expr).toMatch(/\)\s*>\s*1830\b/);

    requireAlert(
      'WalletSyncAbortGraceExhausted',
      'sanctuary_wallet_sync_abort_grace_exhausted_total',
    );
    requireAlert('WalletSyncLockOwnershipLost', 'sanctuary_wallet_sync_lock_loss_total');
    const cleanup = requireAlert('WalletSyncCleanupError', 'sanctuary_wallet_sync_cleanup_total');
    expect(cleanup.expr).toContain('outcome="error"');

    const repeatedTimeouts = requireAlert(
      'WalletSyncRepeatedTimeouts',
      'sanctuary_wallet_sync_terminal_total',
    );
    expect(repeatedTimeouts.expr).toContain('outcome="timeout"');
    expect(repeatedTimeouts.expr).toMatch(/\[15m\]/);
    expect(repeatedTimeouts.expr).toMatch(/>=\s*3\b/);
  });

  it('guards wallet-sync ratios against a zero denominator', () => {
    const ratioExpressions = [...dashboardExpressions, ...alertExpressions].filter(expression => (
      expression.includes('sanctuary_wallet_sync') && expression.includes('/')
    ));
    expect(ratioExpressions.length).toBeGreaterThan(0);
    for (const expression of ratioExpressions) {
      expect(expression).toContain('clamp_min(');
    }
  });

  it('rejects high-cardinality labels from wallet-sync dashboard and alert queries', () => {
    const expressions = [...dashboardExpressions, ...alertExpressions]
      .filter(expression => expression.includes('sanctuary_wallet_sync'));
    const allowedLabels = new Set([
      'le',
      'loss',
      'mode',
      'network',
      'outcome',
      'scope',
      'stage',
      'status',
      'walletType',
    ]);
    for (const expression of expressions) {
      for (const label of queryLabelNames(expression)) {
        expect(allowedLabels.has(label), `high-cardinality or unknown label: ${label}`).toBe(true);
      }
    }
  });
});
