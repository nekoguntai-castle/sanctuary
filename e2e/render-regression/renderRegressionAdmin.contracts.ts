import { expect, type Page } from '@playwright/test';

import {
  DEVICE_ID,
  MAINNET_WALLET,
  MAINNET_WALLET_ID,
  TESTNET_WALLET_ID,
  expectChromiumMainScreenshot,
  mockAuthenticatedApi,
  mockPublicApi,
} from './renderRegressionHarness';

export async function renderAdminSystemSettingsRouteRendersAccessAndWebsocketPanels({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/admin/settings');

  await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Access Control', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'WebSocket', exact: true })).toBeVisible();
  await expect(page.getByText('Public Registration', { exact: true })).toBeVisible();
  await expect(page.getByText('Public registration is disabled. Only admins can create accounts.')).toBeVisible();

  await main.getByRole('button', { name: 'WebSocket', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'WebSocket Status' })).toBeVisible();
  await expect(page.getByText('Rate Limit Configuration')).toBeVisible();
  await expect(page.getByText('Max subscriptions/connection')).toBeVisible();

  await page.getByText('Rate Limit Events', { exact: true }).click();
  await expect(page.getByText('No rate limit events recorded')).toBeVisible();
  await expectChromiumMainScreenshot(page, 'admin-settings-websocket-shell.png');

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminFeatureFlagsRouteRendersGroupedFlagsAndAuditPanel({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto('/#/admin/feature-flags');

  await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();
  await expect(page.getByText('General')).toBeVisible();
  await expect(page.getByText('Experimental')).toBeVisible();
  await expect(page.getByText('enhancedDashboard')).toBeVisible();
  await expect(page.getByText('treasuryAutopilot')).toBeVisible();
  await expect(page.getByText('Toggle features without restarting the server.')).toBeVisible();

  await page.getByRole('button', { name: 'Change History' }).click();
  await expect(page.getByText('No changes recorded yet.')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminNodeConfigRouteRendersCollapsibleSectionsAndKeyControls({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto('/#/admin/node-config');

  await expect(page.getByRole('heading', { name: 'Node Configuration' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save All Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: /External Services/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Network Connections/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Proxy \/ Tor/i })).toBeVisible();

  await page.getByRole('button', { name: /External Services/i }).click();
  await expect(page.getByText('Block Explorer')).toBeVisible();
  await expect(page.getByText('Fee Estimation')).toBeVisible();
  await expect(page.getByText('Mempool API URL')).toBeVisible();

  await page.getByRole('button', { name: /Network Connections/i }).click();
  await expect(page.getByText('Connection Mode')).toBeVisible();
  await expect(page.getByRole('button', { name: 'mainnet (1)' })).toBeVisible();

  await page.getByRole('button', { name: /Proxy \/ Tor/i }).click();
  await expect(page.locator('span', { hasText: 'Bundled Tor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify Connection' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminMonitoringRouteRendersServiceCardsAndCredentials({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto('/#/admin/monitoring');

  await expect(page.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh Status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grafana' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prometheus' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Jaeger' })).toBeVisible();
  await expect(page.getByText('Anonymous viewing')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'About Monitoring' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminMonitoringRouteRendersErrorPanelWhenServicesAPIFails({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      'GET /admin/monitoring/services': {
        status: 500,
        body: { message: 'Monitoring services failed in test' },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto('/#/admin/monitoring');

  await expect(main.getByText('Monitoring services failed in test')).toBeVisible({ timeout: 20000 });
  await expect(main.getByRole('heading', { name: 'Monitoring', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'About Monitoring' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminVariablesRouteRendersSystemVariableControls({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto('/#/admin/variables');

  await expect(page.getByRole('heading', { name: 'System Variables' })).toBeVisible();
  await expect(page.getByText('Advanced Settings')).toBeVisible();
  await expect(page.getByText('Confirmation Threshold', { exact: true })).toBeVisible();
  await expect(page.getByText('Deep Confirmation Threshold', { exact: true })).toBeVisible();
  await expect(page.getByText('Dust Threshold', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminBaseRouteRedirectsToAdminSystemSettings({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto('/#/admin');

  await expect(page).toHaveURL(/#\/admin\/settings$/);
  await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminUsersAndGroupsRouteRendersUserAndGroupPanels({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/admin/users-groups');

  await expect(main.getByRole('heading', { name: 'Users & Groups' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Groups', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Add User' })).toBeVisible();
  await expect(main.getByPlaceholder('New group name')).toBeVisible();
  await expect(main.getByText('admin', { exact: true })).toBeVisible();
  await expect(main.getByRole('paragraph').filter({ hasText: 'alice' }).first()).toBeVisible();
  await expect(main.getByText('Operators', { exact: true })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminBackupRouteRendersTabsAndEncryptionKeysPanel({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/admin/backup');

  await expect(main.getByRole('heading', { name: 'Backup & Restore' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Backup', exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Restore', exact: true })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Encryption Keys' })).toBeVisible();
  await expect(main.getByText('Enter your password to reveal encryption keys.')).toBeVisible();

  // Reveal encryption keys via password entry
  await main.getByPlaceholder('Enter your password').fill('test-password');
  await main.getByRole('button', { name: 'Reveal' }).click();
  await expect(main.getByText('ENCRYPTION_KEY', { exact: true })).toBeVisible();

  await main.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(main.getByRole('heading', { name: 'Restore from Backup' })).toBeVisible();
  await expect(main.getByText('Drop backup file here or click to browse')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminAuditLogsRouteRendersStatsAndTableShell({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/admin/audit-logs');

  await expect(main.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Filters' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(main.getByText('Total Events (30d)')).toBeVisible();
  await expect(main.getByText('Failed Events')).toBeVisible();
  await expect(main.getByText('Events by Category')).toBeVisible();
  await expect(main.getByText('No audit logs found')).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Time' })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'User' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminAuditLogsRouteRendersErrorPanelWhenLogsAPIFails({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      'GET /admin/audit-logs': {
        status: 500,
        body: { message: 'Audit logs failed in test' },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto('/#/admin/audit-logs');

  await expect(main.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();
  await expect(main.getByText('Audit logs failed in test')).toBeVisible({ timeout: 20000 });
  await expect(main.getByRole('button', { name: 'Refresh' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminAiRouteRendersStatusWorkflowShell({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/admin/ai');

  await expect(main.getByRole('heading', { name: 'AI Settings' })).toBeVisible();
  await expect(main.getByText('AI Data Boundary')).toBeVisible();
  await expect(main.getByText('Enable AI Features')).toBeVisible();
  await expect(main.getByText('Bundled Container: Stopped')).toBeVisible();
  await expect(main.getByText('AI Status')).toBeVisible();
  await expect(main.getByRole('heading', { name: 'What AI Can Do' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Transaction Labeling' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Natural Language Queries' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAdminSettingsRouteRendersWebsocketErrorPanelWhenStatsAPIFails({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      'GET /admin/websocket/stats': {
        status: 500,
        body: { message: 'WebSocket stats failed in test' },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto('/#/admin/settings');

  await main.getByRole('button', { name: 'WebSocket', exact: true }).click();
  await expect(main.getByText('WebSocket stats failed in test')).toBeVisible({ timeout: 20000 });

  expect(unhandledRequests).toEqual([]);
}
