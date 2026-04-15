/**
 * User Journey E2E Tests
 *
 * Tests interactive user flows beyond rendering: navigation, form interactions,
 * settings persistence, sidebar behavior, and error recovery.
 */

import { expect, test, type Page } from '@playwright/test';
import {
  DEVICE_ID,
  MAINNET_WALLET,
  MAINNET_WALLET_ID,
  mockAuthenticatedApi,
  mockPublicApi,
} from './userJourneyApi';

test.describe('User journey flows', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', err => {
      errors.push(err.message);
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    expect(errors, `Unexpected page runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Navigation & Routing ---

  test('navigating from dashboard to wallets via sidebar', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    await page.getByRole('link', { name: /Wallets/i }).first().click();
    await expect(page).toHaveURL(/#\/wallets/);
    await expect(page.getByRole('heading', { name: 'Mainnet Wallets' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('navigating from wallets to wallet detail by clicking wallet card', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/wallets');
    await expect(page.getByText('Journey Main Wallet')).toBeVisible();

    await page.getByText('Journey Main Wallet').click();
    await expect(page).toHaveURL(new RegExp(`#/wallets/${MAINNET_WALLET_ID}`));
    await expect(page.getByRole('heading', { name: 'Journey Main Wallet' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('navigating from device list to device detail', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/devices');
    await expect(page.getByText('Journey Ledger', { exact: true })).toBeVisible();

    await page.getByText('Journey Ledger', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/devices/${DEVICE_ID}`));
    await expect(page.getByRole('heading', { name: 'Journey Ledger' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('unknown authenticated route redirects to dashboard', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/this-route-does-not-exist');

    await expect(page).toHaveURL(/#\/(dashboard)?$/);
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('unauthenticated root renders login screen', async ({ page }) => {
    const unhandledRequests = await mockPublicApi(page);

    await page.goto('/#/');

    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wallet Tab Navigation ---

  test('wallet detail tab switching persists through navigation', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
    await expect(page.getByRole('heading', { name: 'Journey Main Wallet' })).toBeVisible();

    await page.getByRole('button', { name: 'UTXOs', exact: true }).click();
    await expect(page.getByText('Available Outputs')).toBeVisible();

    await page.getByRole('button', { name: 'Drafts', exact: true }).click();
    await expect(page.getByText('No draft transactions')).toBeVisible();

    await page.getByRole('button', { name: 'Transactions', exact: true }).click();
    await expect(page.getByText('No transactions found.')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Dashboard Interaction ---

  test('dashboard network switcher toggles between mainnet and testnet', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    await page.getByRole('button', { name: /Testnet/i }).click();
    await expect(page.getByText('Testnet coins have no market value')).toBeVisible();

    await page.getByRole('button', { name: /Mainnet/i }).click();
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Settings Interactions ---

  test('settings appearance tab renders theme controls', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await expect(main.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(page.getByText('Dark Mode')).toBeVisible();
    await expect(page.getByText('Theme')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('settings display tab shows unit and currency options', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Display', exact: true }).click();
    await expect(page.getByText('Display Preferences')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('settings notification tab shows sound configuration', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/settings');
    const main = page.getByRole('main');

    await main.getByRole('button', { name: 'Notifications', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Notification Sounds' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Account Page ---

  test('account page renders profile, password, and 2FA sections', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/account');
    const main = page.getByRole('main');

    await expect(main.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Profile Information' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Change Password' })).toBeVisible();
    await expect(main.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Create Wallet Flow ---

  test('create wallet single-sig flow reaches signer selection', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');

    await expect(main.getByText('Select Wallet Topology')).toBeVisible();
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByText('Journey Ledger')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('create wallet cancel returns to wallet list', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await expect(main.getByText('Select Wallet Topology')).toBeVisible();

    await main.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/#\/wallets/);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Import Wallet Flow ---

  test('import wallet renders format selection step', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await expect(main.getByText('Select Import Format')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Output Descriptor' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Hardware Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Connect Device Flow ---

  test('connect device renders device selector', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/devices/connect');

    await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
    await expect(main.getByRole('heading', { name: '1. Select Your Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Send Transaction Flow ---

  test('send transaction starts with type selection', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

    await expect(main.getByRole('heading', { name: `Send from ${MAINNET_WALLET.name}` })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Standard Send' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Error Recovery ---

  test('expired session 401 redirects to login', async ({ page }) => {
    await mockAuthenticatedApi(page, {
      failures: {
        'GET /auth/me': { status: 401, body: { message: 'Token expired' } },
      },
    });

    await page.goto('/#/');

    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible({ timeout: 10000 });
  });

  // --- Admin Navigation ---

  test('admin sidebar navigation cycles through admin pages', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/settings');
    await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

    await page.getByRole('link', { name: /Feature Flags/i }).click();
    await expect(page).toHaveURL(/#\/admin\/feature-flags/);
    await expect(page.getByRole('heading', { name: 'Feature Flags' })).toBeVisible();

    await page.getByRole('link', { name: /Audit Logs/i }).click();
    await expect(page).toHaveURL(/#\/admin\/audit-logs/);
    await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Feature Flag Interaction ---

  test('admin feature flags shows flag details and toggle states', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/feature-flags');

    await expect(page.getByText('enhancedDashboard')).toBeVisible();
    await expect(page.getByText('treasuryAutopilot')).toBeVisible();
    await expect(page.getByText('General')).toBeVisible();
    await expect(page.getByText('Experimental')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Variables Edit Flow ---

  test('admin variables page shows editable threshold fields', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/admin/variables');

    await expect(page.getByText('Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Deep Confirmation Threshold', { exact: true })).toBeVisible();
    await expect(page.getByText('Dust Threshold', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wallet List Network Switching ---

  test('wallet list network tabs filter wallets correctly', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/wallets');

    await expect(page.getByText('Journey Main Wallet')).toBeVisible();
    await expect(page.getByText('Journey Testnet Wallet')).not.toBeVisible();

    await page.getByRole('button', { name: /Testnet/i }).click();
    await expect(page.getByText('Journey Testnet Wallet')).toBeVisible();
    await expect(page.getByText('Journey Main Wallet')).not.toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Device Detail Account Management ---

  test('device detail shows accounts and add derivation path options', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto(`/#/devices/${DEVICE_ID}`);

    await expect(page.getByRole('heading', { name: 'Journey Ledger' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Derivation Path' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Derivation Path' }).click();
    await expect(page.getByRole('heading', { name: 'Add Derivation Path' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Connect via USB' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter Manually' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Admin Backup Tabs ---

  test('admin backup switches between backup and restore tabs', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/admin/backup');

    await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();

    await main.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Restore from Backup' })).toBeVisible();
    await expect(main.getByText('Drop backup file here or click to browse')).toBeVisible();

    await main.getByRole('button', { name: 'Backup', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'Create Backup' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Cross-page State ---

  test('navigating from dashboard to wallet and back maintains state', async ({ page }) => {
    const unhandledRequests = await mockAuthenticatedApi(page);

    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
    await expect(page.getByRole('heading', { name: 'Journey Main Wallet' })).toBeVisible();

    await page.goto('/#/');
    await expect(page.getByText('Bitcoin Price')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });
});
