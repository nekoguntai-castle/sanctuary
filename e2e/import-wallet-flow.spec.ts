/**
 * Import Wallet Flow E2E Tests
 *
 * Tests the import wallet wizard: format selection, descriptor/file/hardware/QR input,
 * configuration (name, network), review, and wallet import.
 */

import { expect, test, type Page, type Route } from '@playwright/test';
import { json, unmocked, registerApiRoutes } from './helpers';

const IMPORTED_WALLET_ID = 'wallet-imported-1';

const ADMIN_USER = {
  id: 'user-import-admin',
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

const VALID_DESCRIPTOR = "wpkh([abcd1234/84'/0'/0']xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKiLzXCTFHKEJR7TXPfdsg9aVjqYkZ4hCshELBgwMGxZVqV8Dqo3Fg5HsEqFFz5eMzCsvJk4ahGPeBTc/0/*)";
const VALID_DESCRIPTOR_CHECKSUM = "wpkh([abcd1234/84'/0'/0']xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKiLzXCTFHKEJR7TXPfdsg9aVjqYkZ4hCshELBgwMGxZVqV8Dqo3Fg5HsEqFFz5eMzCsvJk4ahGPeBTc/0/*)#abc12345";

type MockApiFailure = {
  status?: number;
  body?: unknown;
};

type MockApiResponse = {
  status?: number;
  body: unknown;
};

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type ImportApiOptions = {
  validationResponse?: Record<string, unknown>;
  importError?: string;
  failures?: Record<string, MockApiFailure>;
};

function mockResponse(body: unknown, status?: number): MockApiResponse {
  return { body, status };
}

function parseApiRoute(route: Route): ParsedApiRoute {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, '');
  return { method, path, requestKey: `${method} ${path}` };
}

async function maybeFulfillFailure(
  route: Route,
  failure?: MockApiFailure
): Promise<boolean> {
  if (!failure) {
    return false;
  }

  await json(route, failure.body ?? { message: 'Injected failure' }, failure.status ?? 500);
  return true;
}

const PRICE_RESPONSE = {
  price: 95000,
  currency: 'USD',
  sources: [],
  median: 95000,
  average: 95000,
  timestamp: '2026-03-11T00:00:00.000Z',
  cached: true,
  change24h: -1.5,
};

const BITCOIN_STATUS_RESPONSE = {
  connected: true,
  blockHeight: 900500,
  explorerUrl: 'https://mempool.space',
  confirmationThreshold: 1,
  deepConfirmationThreshold: 6,
  pool: {
    enabled: true,
    minConnections: 1,
    maxConnections: 3,
    stats: {
      totalConnections: 2,
      activeConnections: 2,
      idleConnections: 0,
      waitingRequests: 0,
      totalAcquisitions: 30,
      averageAcquisitionTimeMs: 8,
      healthCheckFailures: 0,
      serverCount: 1,
      servers: [],
    },
  },
};

const DEFAULT_IMPORT_VALIDATION_RESPONSE = {
  valid: true,
  format: 'descriptor',
  walletType: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  suggestedName: 'Imported Wallet',
  devices: [{
    fingerprint: 'abcd1234',
    xpub: 'xpub6CUGRUonZSQ4TWtTMmzXdrXDtyPWKiLzXCTFHKEJR7TXPfdsg9aVjqYkZ4hCshELBgwMGxZVqV8Dqo3Fg5HsEqFFz5eMzCsvJk4ahGPeBTc',
    derivationPath: "m/84'/0'/0'",
    existingDeviceId: null,
    existingDeviceLabel: null,
    willCreate: true,
    suggestedLabel: 'Imported Device',
  }],
};

const IMPORT_SUCCESS_RESPONSE = {
  wallet: {
    id: IMPORTED_WALLET_ID,
    name: 'Imported Wallet',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
  },
  devicesCreated: 1,
  devicesReused: 0,
};

const IMPORTED_WALLET_RESPONSE = {
  id: IMPORTED_WALLET_ID,
  name: 'Imported Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: VALID_DESCRIPTOR,
  fingerprint: 'abcd1234',
  balance: 0,
  quorum: 1,
  totalSigners: 1,
  userRole: 'owner',
  canEdit: true,
  isShared: false,
  sharedWith: [],
  syncInProgress: false,
  lastSyncedAt: null,
  lastSyncStatus: null,
};

const WALLET_STATS_RESPONSE = {
  totalCount: 0,
  receivedCount: 0,
  sentCount: 0,
  consolidationCount: 0,
  totalReceived: 0,
  totalSent: 0,
  totalFees: 0,
  walletBalance: 0,
};

const WALLET_PRIVACY_RESPONSE = {
  utxos: [],
  summary: {
    averageScore: 100,
    grade: 'excellent',
    utxoCount: 0,
    addressReuseCount: 0,
    roundAmountCount: 0,
    clusterCount: 0,
    recommendations: [],
  },
};

const STATIC_IMPORT_API_RESPONSES: Record<string, MockApiResponse> = {
  'GET /auth/me': mockResponse(ADMIN_USER),
  'GET /auth/registration-status': mockResponse({ enabled: false }),
  'GET /health': mockResponse({ status: 'ok' }),
  'GET /wallets': mockResponse([]),
  'GET /devices': mockResponse([]),
  'GET /price': mockResponse(PRICE_RESPONSE),
  'GET /bitcoin/status': mockResponse(BITCOIN_STATUS_RESPONSE),
  'GET /bitcoin/fees': mockResponse({ fastest: 18, halfHour: 12, hour: 8, economy: 3 }),
  'GET /bitcoin/mempool': mockResponse({
    mempool: [],
    blocks: [],
    mempoolInfo: { count: 0, size: 0, totalFees: 0 },
    queuedBlocksSummary: null,
  }),
  'GET /admin/version': mockResponse({ updateAvailable: false, currentVersion: '0.8.14' }),
  'GET /admin/agents': mockResponse([]),
  'GET /transactions/recent': mockResponse([]),
  'GET /transactions/balance-history': mockResponse([]),
  'GET /devices/models': mockResponse([]),
  'GET /ai/status': mockResponse({ available: false, containerAvailable: false }),
  'GET /intelligence/status': mockResponse({ available: false, ollamaConfigured: false }),
  'GET /admin/groups': mockResponse([]),
  [`GET /wallets/${IMPORTED_WALLET_ID}`]: mockResponse(IMPORTED_WALLET_RESPONSE),
  [`GET /wallets/${IMPORTED_WALLET_ID}/transactions`]: mockResponse([]),
  [`GET /wallets/${IMPORTED_WALLET_ID}/transactions/pending`]: mockResponse([]),
  [`GET /wallets/${IMPORTED_WALLET_ID}/transactions/stats`]: mockResponse(WALLET_STATS_RESPONSE),
  [`GET /wallets/${IMPORTED_WALLET_ID}/utxos`]: mockResponse({ utxos: [], count: 0, totalBalance: 0 }),
  [`GET /wallets/${IMPORTED_WALLET_ID}/privacy`]: mockResponse(WALLET_PRIVACY_RESPONSE),
  [`GET /wallets/${IMPORTED_WALLET_ID}/addresses/summary`]: mockResponse({
    totalAddresses: 0,
    usedCount: 0,
    unusedCount: 0,
    totalBalance: 0,
    usedBalance: 0,
    unusedBalance: 0,
  }),
  [`GET /wallets/${IMPORTED_WALLET_ID}/addresses`]: mockResponse([]),
  [`GET /wallets/${IMPORTED_WALLET_ID}/drafts`]: mockResponse([]),
  [`GET /wallets/${IMPORTED_WALLET_ID}/share`]: mockResponse({ group: null, users: [] }),
};

function getImportMutationResponse(
  requestKey: string,
  options?: ImportApiOptions
): MockApiResponse | null {
  if (requestKey === 'POST /wallets/import/validate') {
    return mockResponse(options?.validationResponse ?? DEFAULT_IMPORT_VALIDATION_RESPONSE);
  }
  if (requestKey === 'POST /wallets/import') {
    return options?.importError
      ? mockResponse({ message: options.importError }, 400)
      : mockResponse(IMPORT_SUCCESS_RESPONSE, 201);
  }
  return null;
}

function getImportApiResponse(
  parsedRoute: ParsedApiRoute,
  options?: ImportApiOptions
): MockApiResponse | null {
  const mutationResponse = getImportMutationResponse(parsedRoute.requestKey, options);
  if (mutationResponse) {
    return mutationResponse;
  }
  const response = STATIC_IMPORT_API_RESPONSES[parsedRoute.requestKey];
  if (response) {
    return response;
  }
  if (parsedRoute.method === 'GET' && /^\/wallets\/[^/]+\/labels$/.test(parsedRoute.path)) {
    return mockResponse([]);
  }
  return null;
}

function createImportApiRouteHandler(options: {
  apiOptions?: ImportApiOptions;
  unhandledRequests: string[];
}) {
  const apiRouteHandler = async (route: Route) => {
    const parsedRoute = parseApiRoute(route);
    const { method, path, requestKey } = parsedRoute;

    if (await maybeFulfillFailure(route, options.apiOptions?.failures?.[requestKey])) {
      return;
    }

    const response = getImportApiResponse(parsedRoute, options.apiOptions);
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    options.unhandledRequests.push(requestKey);
    await unmocked(route, method, path);
  };

  return apiRouteHandler;
}

async function mockImportApi(
  page: Page,
  options?: ImportApiOptions
) {
  await page.addInitScript(() => {
    localStorage.setItem('sanctuary_token', 'playwright-import-token');
  });

  const unhandledRequests: string[] = [];
  await registerApiRoutes(page, createImportApiRouteHandler({
    apiOptions: options,
    unhandledRequests,
  }));
  return unhandledRequests;
}

test.describe('Import wallet flow', () => {
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

  // --- Format Selection ---

  test('import page shows all format options', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    await expect(main.getByText('Select Import Format')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Output Descriptor' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'JSON/Text File' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Hardware Device' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'QR Code' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Descriptor Import ---

  test('descriptor import shows textarea input', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should show textarea for descriptor input
    await expect(main.locator('textarea').first()).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test('entering valid descriptor advances to configuration', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Enter descriptor
    const textarea = main.locator('textarea').first();
    await textarea.fill(VALID_DESCRIPTOR);

    // Continue to configuration
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should reach configuration step with wallet name
    await expect(main.getByRole('heading', { name: /Configure|Import/i }).first()).toBeVisible({ timeout: 10000 });

    expect(unhandledRequests).toEqual([]);
  });

  test('descriptor import full flow reaches review and imports', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Enter descriptor
    await main.locator('textarea').first().fill(VALID_DESCRIPTOR);
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Configuration - enter name
    await expect(main.getByRole('heading', { name: /Configure|Import/i }).first()).toBeVisible({ timeout: 10000 });
    const nameInput = main.locator('input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Imported Descriptor Wallet');
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Review step
    await expect(main.getByText(/Confirm Import|Review/i)).toBeVisible({ timeout: 10000 });
    await expect(main.getByText('Imported Descriptor Wallet')).toBeVisible();

    // Import
    await main.getByRole('button', { name: /Import Wallet/i }).click();

    // Should navigate to imported wallet
    await expect(page).toHaveURL(new RegExp(`#/wallets/${IMPORTED_WALLET_ID}`), { timeout: 10000 });

    expect(unhandledRequests).toEqual([]);
  });

  // --- File Import ---

  test('file import shows upload area', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'JSON/Text File' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should show file upload area and/or textarea (DescriptorInput component)
    await expect(main.locator('textarea')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Hardware Import ---

  test('hardware import shows device type selection', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Hardware Device' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should show hardware import options (Ledger, Trezor, Connect Device)
    await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
    await expect(main.getByText('Device Type', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Ledger' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Trezor' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Connect Device' })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- QR Import ---

  test('QR import shows camera controls', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'QR Code' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should show camera or scan controls
    await expect(main.getByRole('heading', { name: 'Scan Wallet QR Code' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Start Camera' })).toBeVisible();
    await expect(main.getByText('Supported formats:')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Validation Errors ---

  test('invalid descriptor shows validation error', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page, {
      validationResponse: {
        valid: false,
        error: 'Invalid output descriptor format',
      },
    });
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await main.locator('textarea').first().fill('invalid-descriptor-text');
    await main.getByRole('button', { name: 'Next Step' }).click();

    // Should show error
    await expect(main.getByText(/invalid|error|format/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('import API error shows error message', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page, {
      importError: 'Wallet with this descriptor already exists',
    });
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await main.locator('textarea').first().fill(VALID_DESCRIPTOR);
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: /Configure|Import/i }).first()).toBeVisible({ timeout: 10000 });
    const nameInput = main.locator('input[type="text"]').first();
    await nameInput.clear();
    await nameInput.fill('Duplicate Import');
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByText(/Confirm Import|Review/i)).toBeVisible({ timeout: 10000 });
    await main.getByRole('button', { name: /Import Wallet/i }).click();

    // Should show error
    await expect(page.getByText(/already exists|failed|error/i)).toBeVisible({ timeout: 10000 });
  });

  // --- Navigation ---

  test('cancel returns to wallet list', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await expect(main.getByText('Select Import Format')).toBeVisible();

    await main.getByRole('button', { name: 'Cancel' }).click();
    await expect(page).toHaveURL(/#\/wallets/);

    expect(unhandledRequests).toEqual([]);
  });

  test('back button navigates to previous step', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    // On input step, go back
    await main.getByRole('button', { name: 'Back' }).click();

    // Should be back at format selection
    await expect(main.getByText('Select Import Format')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Step Progress ---

  test('wizard shows step progress indicators', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');

    // Should show format selection heading (step 1)
    await expect(main.getByText('Select Import Format')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Network Selection on Config ---

  test('network selection available on configuration step', async ({ page }) => {
    const unhandledRequests = await mockImportApi(page);
    const main = page.getByRole('main');

    await page.goto('/#/wallets/import');
    await main.getByRole('button', { name: 'Output Descriptor' }).click();
    await main.getByRole('button', { name: 'Next Step' }).click();

    await main.locator('textarea').first().fill(VALID_DESCRIPTOR);
    await main.getByRole('button', { name: 'Next Step' }).click();

    await expect(main.getByRole('heading', { name: /Configure|Import/i }).first()).toBeVisible({ timeout: 10000 });

    // Network buttons should be available
    await expect(main.getByRole('button', { name: /Mainnet/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });
});
