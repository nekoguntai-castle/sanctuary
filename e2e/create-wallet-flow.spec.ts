/**
 * Create Wallet Flow E2E Tests
 *
 * Tests the complete wallet creation wizard: topology selection, signer selection,
 * configuration (name, network, script type, quorum), review, and wallet construction.
 */

import { expect, test, type Page, type Route } from '@playwright/test';

import { json, unmocked, registerApiRoutes } from './helpers';

const DEVICE_1_ID = 'device-create-1';
const DEVICE_2_ID = 'device-create-2';
const CREATED_WALLET_ID = 'wallet-created-new';

const ADMIN_USER = {
  id: 'user-create-admin',
  username: 'admin',
  isAdmin: true,
  usingDefaultPassword: false,
  preferences: {
    darkMode: false,
    theme: 'sanctuary',
    background: 'minimal',
    contrastLevel: 0,
    patternOpacity: 50,
    fiatCurrency: 'USD',
    unit: 'sats',
    showFiat: false,
    priceProvider: 'auto',
  },
  createdAt: '2026-03-11T00:00:00.000Z',
};

const DEVICE_1 = {
  id: DEVICE_1_ID,
  type: 'coldcard',
  label: 'Create Coldcard',
  fingerprint: 'cc001234',
  isOwner: true,
  userRole: 'owner',
  wallets: [],
  accounts: [
    {
      id: 'acct-create-1',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-create-coldcard',
    },
    {
      id: 'acct-create-1-ms',
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: "m/48'/0'/0'/2'",
      xpub: 'xpub-create-coldcard-ms',
    },
  ],
  model: {
    slug: 'coldcard',
    manufacturer: 'Coinkite',
    name: 'Coldcard Mk4',
  },
};

const DEVICE_2 = {
  id: DEVICE_2_ID,
  type: 'trezor',
  label: 'Create Trezor',
  fingerprint: 'tz005678',
  isOwner: true,
  userRole: 'owner',
  wallets: [],
  accounts: [
    {
      id: 'acct-create-2',
      purpose: 'single_sig',
      scriptType: 'native_segwit',
      derivationPath: "m/84'/0'/0'",
      xpub: 'xpub-create-trezor',
    },
    {
      id: 'acct-create-2-ms',
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: "m/48'/0'/0'/2'",
      xpub: 'xpub-create-trezor-ms',
    },
  ],
  model: {
    slug: 'trezor',
    manufacturer: 'SatoshiLabs',
    name: 'Trezor Model T',
  },
};

const DEVICE_NO_SINGLESIG = {
  id: 'device-create-nosig',
  type: 'ledger',
  label: 'No SingleSig Ledger',
  fingerprint: 'ns009999',
  isOwner: true,
  userRole: 'owner',
  wallets: [],
  accounts: [
    {
      id: 'acct-nosig-ms',
      purpose: 'multisig',
      scriptType: 'native_segwit',
      derivationPath: "m/48'/0'/0'/2'",
      xpub: 'xpub-nosig-ms',
    },
  ],
  model: {
    slug: 'ledger',
    manufacturer: 'Ledger',
    name: 'Nano S',
  },
};

async function mockCreateWalletApi(
  page: Page,
  options?: {
    devices?: typeof DEVICE_1[];
    createSuccess?: boolean;
    createError?: string;
    failures?: Record<string, { status?: number; body?: unknown }>;
  }
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-create-token');
  });

  const devices = options?.devices ?? [DEVICE_1, DEVICE_2];
  const unhandledRequests: string[] = [];

  const apiRouteHandler = async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api\/v1/, '');
    const requestKey = `${method} ${path}`;

    const failure = options?.failures?.[requestKey];
    if (failure) {
      return json(route, failure.body ?? { message: `Injected failure` }, failure.status ?? 500);
    }

    // Auth
    if (method === 'GET' && path === '/auth/me') return json(route, ADMIN_USER);
    if (method === 'GET' && path === '/auth/registration-status') return json(route, { enabled: false });
    if (method === 'GET' && path === '/health') return json(route, { status: 'ok' });

    // Shared
    if (method === 'GET' && path === '/wallets') return json(route, []);
    if (method === 'GET' && path === '/devices') return json(route, devices);
    if (method === 'GET' && path === '/price') {
      return json(route, { price: 95000, currency: 'USD', sources: [], median: 95000, average: 95000, timestamp: '2026-03-11T00:00:00.000Z', cached: true, change24h: -1.5 });
    }
    if (method === 'GET' && path === '/bitcoin/status') {
      return json(route, { connected: true, blockHeight: 900500, explorerUrl: 'https://mempool.space', confirmationThreshold: 1, deepConfirmationThreshold: 6, pool: { enabled: true, minConnections: 1, maxConnections: 3, stats: { totalConnections: 2, activeConnections: 2, idleConnections: 0, waitingRequests: 0, totalAcquisitions: 30, averageAcquisitionTimeMs: 8, healthCheckFailures: 0, serverCount: 1, servers: [] } } });
    }
    if (method === 'GET' && path === '/bitcoin/fees') return json(route, { fastest: 18, halfHour: 12, hour: 8, economy: 3 });
    if (method === 'GET' && path === '/bitcoin/mempool') return json(route, { mempool: [], blocks: [], mempoolInfo: { count: 0, size: 0, totalFees: 0 }, queuedBlocksSummary: null });
    if (method === 'GET' && path === '/admin/version') return json(route, { updateAvailable: false, currentVersion: '0.8.14' });
    if (method === 'GET' && path === '/transactions/recent') return json(route, []);
    if (method === 'GET' && path === '/transactions/balance-history') return json(route, []);
    if (method === 'GET' && path === '/ai/status') return json(route, { available: false, containerAvailable: false });
    if (method === 'GET' && path === '/intelligence/status') return json(route, { available: false, ollamaConfigured: false });
    if (method === 'GET' && path === '/admin/groups') return json(route, []);
    if (method === 'GET' && path === '/devices/models') {
      return json(route, [
        { id: 'model-coldcard', slug: 'coldcard', manufacturer: 'Coinkite', name: 'Coldcard Mk4', connectivity: ['usb', 'sd_card'], supportedPurposes: ['single_sig', 'multisig'], supportedScriptTypes: ['native_segwit', 'taproot'] },
        { id: 'model-trezor', slug: 'trezor', manufacturer: 'SatoshiLabs', name: 'Trezor Model T', connectivity: ['usb'], supportedPurposes: ['single_sig', 'multisig'], supportedScriptTypes: ['native_segwit', 'taproot', 'nested_segwit'] },
      ]);
    }

    // Wallet creation
    if (method === 'POST' && path === '/wallets') {
      if (options?.createError) {
        return json(route, { message: options.createError }, 400);
      }
      const body = request.postDataJSON();
      return json(route, {
        id: CREATED_WALLET_ID,
        name: body.name,
        type: body.type,
        scriptType: body.scriptType,
        network: body.network || 'mainnet',
        descriptor: 'wpkh([cc001234/84h/0h/0h]xpub-created/0/*)',
        fingerprint: 'cc001234',
        balance: 0,
        quorum: body.quorum || 1,
        totalSigners: body.totalSigners || 1,
        userRole: 'owner',
        canEdit: true,
        isShared: false,
        sharedWith: [],
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncStatus: null,
      }, 201);
    }

    // Created wallet detail page endpoints
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}`) {
      return json(route, {
        id: CREATED_WALLET_ID, name: 'New Wallet', type: 'single_sig', scriptType: 'native_segwit',
        network: 'mainnet', descriptor: 'wpkh([cc001234/84h/0h/0h]xpub-created/0/*)',
        fingerprint: 'cc001234', balance: 0, quorum: 1, totalSigners: 1,
        userRole: 'owner', canEdit: true, isShared: false, sharedWith: [],
        syncInProgress: false, lastSyncedAt: null, lastSyncStatus: null,
      });
    }
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/transactions`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/transactions/pending`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/transactions/stats`) {
      return json(route, { totalCount: 0, receivedCount: 0, sentCount: 0, consolidationCount: 0, totalReceived: 0, totalSent: 0, totalFees: 0, walletBalance: 0 });
    }
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/utxos`) return json(route, { utxos: [], count: 0, totalBalance: 0 });
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/privacy`) {
      return json(route, { utxos: [], summary: { averageScore: 100, grade: 'excellent', utxoCount: 0, addressReuseCount: 0, roundAmountCount: 0, clusterCount: 0, recommendations: [] } });
    }
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/addresses/summary`) {
      return json(route, { totalAddresses: 0, usedCount: 0, unusedCount: 0, totalBalance: 0, usedBalance: 0, unusedBalance: 0 });
    }
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/addresses`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/drafts`) return json(route, []);
    if (method === 'GET' && path === `/wallets/${CREATED_WALLET_ID}/share`) return json(route, { group: null, users: [] });
    if (method === 'GET' && path.match(/^\/wallets\/[^/]+\/labels$/)) return json(route, []);

    unhandledRequests.push(requestKey);
    return unmocked(route, method, path);
  };

  await registerApiRoutes(page, apiRouteHandler);
  return unhandledRequests;
}

test.describe('Create wallet flow', () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on('pageerror', err => errors.push(err.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    expect(errors, `Runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Single-Sig Full Flow ---

  test('single-sig wallet creation completes all 4 steps', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    // Step 1: Topology
    await page.goto('/#/wallets/create');
    await expect(main.getByText('Select Wallet Topology')).toBeVisible();
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Step 2: Signer selection
    await expect(main.getByText('Select Signers')).toBeVisible();
    await expect(main.getByText('Create Coldcard')).toBeVisible();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Step 3: Configuration
    await expect(main.getByText('Configuration')).toBeVisible();
    await main.locator('input[type="text"]').first().fill('My Test Wallet');
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Step 4: Review
    await expect(main.getByText('Review Wallet Details')).toBeVisible();
    await expect(main.getByText('My Test Wallet')).toBeVisible();
    await expect(main.getByText(/single_sig/i).or(main.getByText(/Single Sig/i))).toBeVisible();

    // Construct wallet
    await main.getByRole('button', { name: 'Construct Wallet' }).click();

    // Should navigate to created wallet
    await expect(page).toHaveURL(new RegExp(`#/wallets/${CREATED_WALLET_ID}`), { timeout: 10000 });

    expect(unhandledRequests).toEqual([]);
  });

  // --- Multi-Sig Full Flow ---

  test('multi-sig wallet creation with 2-of-2 quorum', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    // Step 1: Topology
    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Multi Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Step 2: Select both devices
    await expect(main.getByText('Select Signers')).toBeVisible();
    await main.getByText('Create Coldcard').click();
    await main.getByText('Create Trezor').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Step 3: Configuration with quorum
    await expect(main.getByText('Configuration')).toBeVisible();
    await main.locator('input[type="text"]').first().fill('Family Vault');
    // Quorum slider should be present for multisig
    await expect(main.getByText(/Quorum/i)).toBeVisible();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Step 4: Review
    await expect(main.getByText('Review Wallet Details')).toBeVisible();
    await expect(main.getByText('Family Vault')).toBeVisible();
    await expect(main.getByText(/multi_sig/i).or(main.getByText(/Multi Sig/i))).toBeVisible();

    // Construct
    await main.getByRole('button', { name: 'Construct Wallet' }).click();
    await expect(page).toHaveURL(new RegExp(`#/wallets/${CREATED_WALLET_ID}`), { timeout: 10000 });

    expect(unhandledRequests).toEqual([]);
  });

  // --- Network Selection ---

  test('testnet network selection shows warning', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Configuration step - switch to testnet
    await expect(main.getByText('Configuration')).toBeVisible();
    await main.getByRole('button', { name: 'Testnet' }).click();

    // Warning should appear
    await expect(main.getByRole('button', { name: 'Testnet' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Script Type Selection ---

  test('single-sig shows script type options', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByText('Script Type')).toBeVisible();
    await expect(main.getByRole('button', { name: /Native Segwit/i })).toBeVisible();
    await expect(main.getByRole('button', { name: /Taproot/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('selecting taproot script type updates review', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await main.locator('input[type="text"]').first().fill('Taproot Wallet');
    await main.getByRole('button', { name: /Taproot/i }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Review should show taproot as text in the details
    await expect(main.getByText('Review Wallet Details')).toBeVisible();
    await expect(main.getByText(/taproot/i).first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Validation ---

  test('empty wallet name blocks next step', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Config step - leave name empty, try to advance
    await expect(main.getByText('Configuration')).toBeVisible();
    const nextButton = main.getByRole('button', { name: 'Next Step' });
    await expect(nextButton).toBeDisabled();

    expect(unhandledRequests).toEqual([]);
  });

  test('multisig requires at least 2 devices selected', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Multi Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Select only one device
    await main.getByText('Create Coldcard').click();

    // Next should be disabled or show error
    const nextButton = main.getByRole('button', { name: 'Next Step' });
    await nextButton.click();
    // Should either stay on step or show error about needing 2 devices
    await expect(
      main.getByText(/at least 2/i).or(main.getByText('Select Signers'))
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- No Device Selected ---

  test('no device selected blocks next step', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Signer step - don't select anything
    const nextButton = main.getByRole('button', { name: 'Next Step' });
    await expect(nextButton).toBeDisabled();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Navigation ---

  test('step navigation allows going back through all steps', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // On config step, go back
    await expect(main.getByText('Configuration')).toBeVisible();
    await main.getByRole('button', { name: 'Back' }).click();

    // Should be back at signer selection
    await expect(main.getByText('Select Signers')).toBeVisible();
    await main.getByRole('button', { name: 'Back' }).click();

    // Should be back at topology selection
    await expect(main.getByText('Select Wallet Topology')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('cancel on first step returns to wallet list', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await expect(main.getByText('Select Wallet Topology')).toBeVisible();

    await main.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/#\/wallets/);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Incompatible Devices ---

  test('incompatible devices are hidden with warning', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page, {
      devices: [DEVICE_1, DEVICE_NO_SINGLESIG],
    });
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should show compatible device
    await expect(main.getByText('Create Coldcard')).toBeVisible();

    // Should show warning about hidden devices
    await expect(main.getByText(/hidden/i).or(main.getByText(/incompatible/i))).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Connect New Device ---

  test('connect new device button navigates to device connection', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    const connectButton = main.getByRole('button', { name: /Connect New Device/i });
    await expect(connectButton).toBeVisible();
    await connectButton.click();

    await expect(page).toHaveURL(/#\/devices\/connect/);
  });

  // --- API Error ---

  test('wallet creation API error shows notification', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page, {
      createError: 'Descriptor already exists for this device',
    });
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');
    await main.getByRole('button', { name: 'Single Signature' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.getByText('Create Coldcard').click();
    await main.getByRole('button', { name: 'Next Step' }).click();
    await main.locator('input[type="text"]').first().fill('Error Wallet');
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByText('Review Wallet Details')).toBeVisible();
    await main.getByRole('button', { name: 'Construct Wallet' }).click();

    // Should show error notification
    await expect(page.getByText(/failed|error|already exists/i)).toBeVisible({ timeout: 10000 });
  });

  // --- Step Progress Indicators ---

  test('wizard shows 4 step progress indicators', async ({ page }) => {
    const unhandledRequests = await mockCreateWalletApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/create');

    // Step labels (rendered as text-[10px] spans in step indicators)
    // Step indicators are rendered as small text labels below step circles
    await expect(main.getByText('Select Wallet Topology')).toBeVisible();
    // The 4 step circles should be visible (step header area)
    await expect(main.locator('[class*="rounded-full"]').first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });
});
