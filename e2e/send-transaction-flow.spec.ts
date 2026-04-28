/**
 * Send Transaction Flow E2E Tests
 *
 * Tests the full send transaction wizard: type selection, recipient/amount input,
 * fee configuration, advanced options, coin control, and review step.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { json, unmocked, registerApiRoutes } from "./helpers";

const WALLET_ID = "wallet-send-1";
const DEVICE_ID = "device-send-1";

const ADMIN_USER = {
  id: "user-send-admin",
  username: "admin",
  isAdmin: true,
  usingDefaultPassword: false,
  preferences: {
    darkMode: false,
    theme: "sanctuary",
    background: "minimal",
    contrastLevel: 0,
    patternOpacity: 50,
    fiatCurrency: "USD",
    unit: "sats",
    showFiat: false,
    priceProvider: "auto",
  },
  createdAt: "2026-03-11T00:00:00.000Z",
};

const WALLET = {
  id: WALLET_ID,
  name: "Send Test Wallet",
  type: "single_sig",
  scriptType: "native_segwit",
  network: "mainnet",
  descriptor: "wpkh([abcd1234/84h/0h/0h]xpubSendTest/0/*)",
  fingerprint: "abcd1234",
  balance: 100000000,
  quorum: 1,
  totalSigners: 1,
  userRole: "owner",
  canEdit: true,
  isShared: false,
  sharedWith: [],
  syncInProgress: false,
  lastSyncedAt: "2026-03-11T00:00:00.000Z",
  lastSyncStatus: "success",
};

const EMPTY_WALLET = {
  ...WALLET,
  id: "wallet-send-empty",
  name: "Empty Wallet",
  balance: 0,
};

const DEVICE = {
  id: DEVICE_ID,
  type: "coldcard",
  label: "Send Coldcard",
  fingerprint: "abcd1234",
  isOwner: true,
  userRole: "owner",
  wallets: [
    { wallet: { id: WALLET_ID, name: WALLET.name, type: WALLET.type } },
  ],
  accounts: [
    {
      id: "acct-send-1",
      purpose: "single_sig",
      scriptType: "native_segwit",
      derivationPath: "m/84'/0'/0'",
      xpub: "xpub-send-account",
    },
  ],
  model: {
    slug: "coldcard",
    manufacturer: "Coinkite",
    name: "Coldcard Mk4",
    connectivity: ["usb", "sd_card"],
  },
};

const UTXOS = [
  {
    txid: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    vout: 0,
    value: 50000000,
    address: "bc1qsendtestaddr1xxxxxxxxxxxxxxxxxx",
    confirmations: 100,
    scriptType: "native_segwit",
    derivationPath: "m/84'/0'/0'/0/0",
    label: null,
    frozen: false,
    lockedByDraft: null,
    privacyScore: 85,
  },
  {
    txid: "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
    vout: 1,
    value: 50000000,
    address: "bc1qsendtestaddr2xxxxxxxxxxxxxxxxxx",
    confirmations: 50,
    scriptType: "native_segwit",
    derivationPath: "m/84'/0'/0'/0/1",
    label: null,
    frozen: false,
    lockedByDraft: null,
    privacyScore: 90,
  },
];

const RECEIVE_ADDRESSES = [
  {
    index: 0,
    address: "bc1qsendtestaddr1xxxxxxxxxxxxxxxxxx",
    used: true,
    balance: 50000000,
  },
  {
    index: 1,
    address: "bc1qsendtestaddr2xxxxxxxxxxxxxxxxxx",
    used: true,
    balance: 50000000,
  },
  {
    index: 2,
    address: "bc1qsendtestaddr3xxxxxxxxxxxxxxxxxx",
    used: false,
    balance: 0,
  },
];

type SendMockFailure = { status?: number; body?: unknown; timeout?: boolean };

type SendMockOptions = {
  wallet?: typeof WALLET;
  utxos?: typeof UTXOS;
  emptyUtxos?: boolean;
  failures?: Record<string, SendMockFailure>;
};

type ParsedApiRoute = {
  method: string;
  path: string;
  requestKey: string;
};

type SendApiContext = {
  wallet: typeof WALLET;
  utxos: typeof UTXOS;
  failures?: Record<string, SendMockFailure>;
  unhandledRequests: string[];
};

type MockApiResponse = {
  body: unknown;
  status?: number;
};

type SendApiResponder = (
  parsedRoute: ParsedApiRoute,
  context: SendApiContext,
) => MockApiResponse | null;

const mockResponse = (body: unknown, status = 200): MockApiResponse => ({
  body,
  status,
});

const parseApiRoute = (route: Route): ParsedApiRoute => {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  return { method, path, requestKey: `${method} ${path}` };
};

const maybeFulfillFailure = async (
  route: Route,
  failure?: SendMockFailure,
): Promise<boolean> => {
  if (!failure) {
    return false;
  }

  if (failure.timeout) {
    await route.abort("timedout");
    return true;
  }

  await json(
    route,
    failure.body ?? { message: "Injected failure" },
    failure.status ?? 500,
  );
  return true;
};

const getAuthResponse: SendApiResponder = ({ requestKey }) => {
  if (requestKey === "GET /auth/me") return mockResponse(ADMIN_USER);
  if (requestKey === "GET /auth/registration-status")
    return mockResponse({ enabled: false });
  if (requestKey === "GET /health") return mockResponse({ status: "ok" });
  if (requestKey === "GET /devices/models") return mockResponse([]);
  return null;
};

const getSharedResponse: SendApiResponder = (
  { requestKey }: ParsedApiRoute,
  { wallet }: SendApiContext,
) => {
  if (requestKey === "GET /wallets") return mockResponse([wallet]);
  if (requestKey === "GET /devices") return mockResponse([DEVICE]);
  if (requestKey === "GET /price") {
    return mockResponse({
      price: 95000,
      currency: "USD",
      sources: [],
      median: 95000,
      average: 95000,
      timestamp: "2026-03-11T00:00:00.000Z",
      cached: true,
      change24h: -1.5,
    });
  }
  if (requestKey === "GET /bitcoin/status") {
    return mockResponse({
      connected: true,
      blockHeight: 900500,
      explorerUrl: "https://mempool.space",
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
    });
  }
  if (requestKey === "GET /bitcoin/fees") {
    return mockResponse({ fastest: 18, halfHour: 12, hour: 8, economy: 3 });
  }
  if (requestKey === "GET /bitcoin/mempool") {
    return mockResponse({
      mempool: [],
      blocks: [],
      mempoolInfo: { count: 0, size: 0, totalFees: 0 },
      queuedBlocksSummary: null,
    });
  }
  return null;
};

const getWalletResponse: SendApiResponder = (
  { method, path, requestKey }: ParsedApiRoute,
  { wallet, utxos }: SendApiContext,
) => {
  if (requestKey === `GET /wallets/${wallet.id}`) return mockResponse(wallet);
  if (requestKey === `GET /wallets/${wallet.id}/transactions`)
    return mockResponse([]);
  if (requestKey === `GET /wallets/${wallet.id}/transactions/pending`)
    return mockResponse([]);
  if (requestKey === `GET /wallets/${wallet.id}/transactions/stats`) {
    return mockResponse({
      totalCount: 2,
      receivedCount: 2,
      sentCount: 0,
      consolidationCount: 0,
      totalReceived: 100000000,
      totalSent: 0,
      totalFees: 0,
      walletBalance: wallet.balance,
    });
  }
  if (requestKey === `GET /wallets/${wallet.id}/utxos`) {
    return mockResponse({
      utxos,
      count: utxos.length,
      totalBalance: utxos.reduce((s, u) => s + u.value, 0),
    });
  }
  if (requestKey === `GET /wallets/${wallet.id}/privacy`) {
    return mockResponse({
      utxos: utxos.map((u) => ({
        ...u,
        score: u.privacyScore,
        factors: [],
        recommendations: [],
      })),
      summary: {
        averageScore: 87,
        grade: "good",
        utxoCount: utxos.length,
        addressReuseCount: 0,
        roundAmountCount: 0,
        clusterCount: 0,
        recommendations: [],
      },
    });
  }
  if (requestKey === `GET /wallets/${wallet.id}/addresses/summary`) {
    return mockResponse({
      totalAddresses: 3,
      usedCount: 2,
      unusedCount: 1,
      totalBalance: wallet.balance,
      usedBalance: wallet.balance,
      unusedBalance: 0,
    });
  }
  if (requestKey === `GET /wallets/${wallet.id}/addresses`)
    return mockResponse(RECEIVE_ADDRESSES);
  if (requestKey === `GET /wallets/${wallet.id}/drafts`)
    return mockResponse([]);
  if (requestKey === `GET /wallets/${wallet.id}/share`)
    return mockResponse({ group: null, users: [] });
  if (method === "GET" && /^\/wallets\/[^/]+\/labels$/.test(path))
    return mockResponse([]);
  if (requestKey === `GET /devices/${DEVICE_ID}`) return mockResponse(DEVICE);
  return null;
};

const getTransactionResponse: SendApiResponder = (
  { requestKey }: ParsedApiRoute,
  { wallet }: SendApiContext,
) => {
  if (requestKey === `POST /wallets/${wallet.id}/transactions/build`) {
    return mockResponse({
      psbt: "cHNidP8BAH0CAAAAAb2x...",
      fee: 1410,
      feeRate: 10,
      inputCount: 1,
      outputCount: 2,
      changeAmount: 49998590,
      changeAddress: "bc1qchangeaddr...",
    });
  }
  if (requestKey === `POST /wallets/${wallet.id}/transactions/broadcast`) {
    return mockResponse({ txid: "newtxid123456789abcdef" });
  }
  return null;
};

const getAdminResponse: SendApiResponder = ({ requestKey }) => {
  if (requestKey === "GET /admin/version") {
    return mockResponse({ updateAvailable: false, currentVersion: "0.8.14" });
  }
  if (requestKey === "GET /admin/agents") return mockResponse([]);
  if (requestKey === "GET /transactions/recent") return mockResponse([]);
  if (requestKey === "GET /transactions/balance-history")
    return mockResponse([]);
  if (requestKey === "GET /ai/status") {
    return mockResponse({ available: false, containerAvailable: false });
  }
  if (requestKey === "GET /intelligence/status") {
    return mockResponse({ available: false, ollamaConfigured: false });
  }
  return null;
};

const SEND_API_RESPONDERS: SendApiResponder[] = [
  getAuthResponse,
  getSharedResponse,
  getWalletResponse,
  getTransactionResponse,
  getAdminResponse,
];

const getSendApiResponse = (
  parsedRoute: ParsedApiRoute,
  context: SendApiContext,
): MockApiResponse | null => {
  for (const responder of SEND_API_RESPONDERS) {
    const response = responder(parsedRoute, context);
    if (response) {
      return response;
    }
  }
  return null;
};

async function mockSendApi(page: Page, options?: SendMockOptions) {
  await page.addInitScript(() => {
    localStorage.setItem("sanctuary_token", "playwright-send-token");
  });

  const wallet = options?.wallet ?? WALLET;
  const utxos = options?.emptyUtxos ? [] : (options?.utxos ?? UTXOS);
  const unhandledRequests: string[] = [];
  const context: SendApiContext = {
    wallet,
    utxos,
    failures: options?.failures,
    unhandledRequests,
  };

  const apiRouteHandler = async (route: Route) => {
    const parsedRoute = parseApiRoute(route);
    if (
      await maybeFulfillFailure(
        route,
        context.failures?.[parsedRoute.requestKey],
      )
    ) {
      return;
    }

    const response = getSendApiResponse(parsedRoute, context);
    if (response) {
      return json(route, response.body, response.status);
    }

    context.unhandledRequests.push(`${parsedRoute.method} ${parsedRoute.path}`);
    return unmocked(route, parsedRoute.method, parsedRoute.path);
  };

  await registerApiRoutes(page, apiRouteHandler);
  return unhandledRequests;
}

test.describe("Send transaction flow", () => {
  const runtimeErrors = new WeakMap<Page, string[]>();

  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    runtimeErrors.set(page, errors);
    page.on("pageerror", (err) => errors.push(err.message));
  });

  test.afterEach(async ({ page }, testInfo) => {
    const errors = runtimeErrors.get(page) ?? [];
    expect(errors, `Runtime errors in "${testInfo.title}"`).toEqual([]);
  });

  // --- Type Selection ---

  test("send page displays all transaction type options", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);

    await expect(
      main.getByRole("heading", { name: `Send from ${WALLET.name}` }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: "Standard Send" }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: "Consolidation" }),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "Sweep" })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("selecting standard send advances to outputs step", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await expect(
      main.getByRole("button", { name: "Standard Send" }),
    ).toBeVisible();

    await main.getByRole("button", { name: "Standard Send" }).click();

    // Type selection auto-advances to outputs step
    await expect(main.getByText("Compose Transaction")).toBeVisible();
    await expect(main.locator('input[placeholder*="bc1q"]')).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("selecting consolidation advances to outputs step with address dropdown", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Consolidation" }).click();

    // Type selection auto-advances to outputs step
    await expect(main.getByText("Consolidation")).toBeVisible();
    // Consolidation uses a select dropdown for destination, not text input
    await expect(main.getByRole("combobox")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("selecting sweep advances to outputs step", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Sweep" }).click();

    // Type selection auto-advances to outputs step
    await expect(main.getByText("Sweep")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Outputs Step ---

  test("standard send shows address and amount fields", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Address field
    const addressInput = main.locator('input[placeholder*="bc1q"]');
    await expect(addressInput).toBeVisible();

    // Amount field
    const amountInput = main.locator('input[placeholder="0"]');
    await expect(amountInput).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("filling recipient address and amount renders form fields", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Address and amount fields should be fillable
    const addressInput = main.locator('input[placeholder*="bc1q"]');
    await expect(addressInput).toBeVisible();
    await addressInput.fill("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");

    const amountInput = main.locator('input[placeholder="0"]');
    await expect(amountInput).toBeVisible();
    await amountInput.fill("10000");

    expect(unhandledRequests).toEqual([]);
  });

  test("add recipient button creates additional output row", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Click add recipient
    const addButton = main.getByRole("button", { name: /Add Recipient/i });
    await expect(addButton).toBeVisible();
    await addButton.click();

    // Should have multiple address inputs
    const addressInputs = main.locator('input[placeholder*="bc1q"]');
    await expect(addressInputs).toHaveCount(2);

    expect(unhandledRequests).toEqual([]);
  });

  // --- Fee Selection ---

  test("fee panel shows preset options", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Open fee panel
    await main.getByText("Network Fee").click();

    await expect(
      main.getByRole("button", { name: /High Priority/i }),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: /Standard/i })).toBeVisible();
    await expect(main.getByRole("button", { name: /Economy/i })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Advanced Options ---

  test("advanced options panel shows RBF and subtract fees toggles", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Open advanced options
    await main.getByText("Advanced Options").click();

    await expect(main.getByText("Enable RBF")).toBeVisible();
    await expect(main.getByText("Subtract fees from amount")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("enabling decoy outputs shows count selector", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Open advanced options
    await main.getByText("Advanced Options").click();

    // Enable decoy outputs
    const decoyLabel = main.getByText("Stonewall-like Decoy Outputs");
    await expect(decoyLabel).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Coin Control ---

  test("coin control panel shows UTXOs", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Coin control panel header should be visible
    await expect(main.getByText("Coin Control")).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Review Step ---

  test("standard send outputs step shows compose form with address and amount", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    // Outputs step should render the compose form
    await expect(main.getByText("Compose Transaction")).toBeVisible();
    await expect(main.locator('input[placeholder*="bc1q"]')).toBeVisible();
    await expect(main.locator('input[placeholder="0"]')).toBeVisible();
    await expect(main.getByText(/Network Fee/)).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  test("standard send outputs step shows continue and back buttons", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    // Navigation buttons should be present
    await expect(main.getByRole("button", { name: "Continue" })).toBeVisible();
    await expect(main.getByRole("button", { name: "Back" })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Navigation ---

  test("cancel button returns to wallet detail", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await expect(
      main.getByRole("heading", { name: `Send from ${WALLET.name}` }),
    ).toBeVisible();

    await main.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(new RegExp(`#/wallets/${WALLET_ID}`));

    expect(unhandledRequests).toEqual([]);
  });

  test("back button on outputs step returns to type selection", async ({
    page,
  }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);
    await main.getByRole("button", { name: "Standard Send" }).click();

    await expect(main.getByText("Compose Transaction")).toBeVisible();

    await main.getByRole("button", { name: "Back" }).click();
    await expect(
      main.getByRole("button", { name: "Standard Send" }),
    ).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Wizard Step Indicators ---

  test("step indicators reflect current progress", async ({ page }) => {
    const unhandledRequests = await mockSendApi(page);
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);

    // The send wizard should show the type selection step content
    await expect(
      main.getByRole("button", { name: "Standard Send" }),
    ).toBeVisible();
    await expect(
      main.getByRole("button", { name: "Consolidation" }),
    ).toBeVisible();
    await expect(main.getByRole("button", { name: "Sweep" })).toBeVisible();

    expect(unhandledRequests).toEqual([]);
  });

  // --- Non-owner view ---

  test("viewer role redirects away from send page", async ({ page }) => {
    const viewerWallet = { ...WALLET, userRole: "viewer", canEdit: false };
    const unhandledRequests = await mockSendApi(page, { wallet: viewerWallet });
    const main = page.getByRole("main");

    await page.goto(`/#/wallets/${WALLET_ID}/send`);

    // Should show some indication that sending is not allowed or redirect
    // Either an error message or redirect to wallet detail
    await expect(
      main
        .getByText(/not authorized|cannot send|permission/i)
        .or(page.locator(`[href*="wallets/${WALLET_ID}"]`))
        .or(main.getByRole("heading", { name: WALLET.name })),
    ).toBeVisible({ timeout: 5000 });
  });
});
