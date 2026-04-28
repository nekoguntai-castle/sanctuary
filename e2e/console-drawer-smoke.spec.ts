import { expect, test, type Page, type Route } from "@playwright/test";
import { json, registerApiRoutes, unmocked } from "./helpers";

const USER = {
  id: "user-console-smoke",
  username: "admin",
  isAdmin: true,
  usingDefaultPassword: false,
  preferences: {
    darkMode: false,
    theme: "sanctuary",
    background: "minimal",
    contrastLevel: 0,
    patternOpacity: 50,
    flyoutOpacity: 92,
    fiatCurrency: "USD",
    unit: "sats",
    showFiat: false,
    priceProvider: "auto",
  },
  createdAt: "2026-04-28T00:00:00.000Z",
};

const WALLET_ID = "wallet-console-smoke-1";
const WALLET = {
  id: WALLET_ID,
  name: "Console Smoke Wallet",
  type: "single_sig",
  scriptType: "native_segwit",
  network: "mainnet",
  descriptor: "wpkh([abcd1234/84h/0h/0h]xpubConsoleSmoke/0/*)",
  fingerprint: "abcd1234",
  balance: 100000,
  quorum: 1,
  totalSigners: 1,
  userRole: "owner",
  canEdit: true,
  isShared: false,
  sharedWith: [],
  syncInProgress: false,
  lastSyncedAt: "2026-04-28T00:00:00.000Z",
  lastSyncStatus: "success",
};

const SESSION = {
  id: "session-console-smoke",
  userId: USER.id,
  title: "Console smoke",
  maxSensitivity: "wallet",
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
};

const PROMPT_HISTORY = {
  id: "prompt-console-smoke",
  userId: USER.id,
  sessionId: SESSION.id,
  prompt: "How long ago was block 900100?",
  title: "Block age",
  maxSensitivity: "wallet",
  saved: false,
  expiresAt: null,
  replayCount: 0,
  lastReplayedAt: null,
  createdAt: "2026-04-28T00:00:00.000Z",
  updatedAt: "2026-04-28T00:00:00.000Z",
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
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

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function mockResponse(body: unknown, status?: number): MockApiResponse {
  return { body, status };
}

function parseApiRoute(route: Route): ParsedApiRoute {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  return { method, path, requestKey: `${method} ${path}` };
}

const STATIC_RESPONSES: Record<string, MockApiResponse> = {
  "GET /auth/me": mockResponse(USER),
  "GET /auth/registration-status": mockResponse({ enabled: false }),
  "GET /wallets": mockResponse([WALLET]),
  "GET /devices": mockResponse([]),
  "GET /health": mockResponse({ status: "ok" }),
  "GET /price": mockResponse({
    price: 95000,
    currency: "USD",
    sources: [],
    median: 95000,
    average: 95000,
    timestamp: "2026-04-28T00:00:00.000Z",
    cached: true,
    change24h: 1.5,
  }),
  "GET /ai/status": mockResponse({
    enabled: true,
    available: true,
    containerAvailable: true,
  }),
  "GET /intelligence/status": mockResponse({
    available: false,
    ollamaConfigured: false,
  }),
  "GET /bitcoin/status": mockResponse({
    connected: true,
    blockHeight: 900100,
    explorerUrl: "https://mempool.space",
    confirmationThreshold: 1,
    deepConfirmationThreshold: 6,
    pool: { enabled: false },
  }),
  [`GET /wallets/${WALLET_ID}/drafts`]: mockResponse([]),
  [`GET /wallets/${WALLET_ID}/transactions/pending`]: mockResponse([]),
  "GET /transactions/balance-history": mockResponse([
    { name: "Start", value: WALLET.balance },
    { name: "Now", value: WALLET.balance },
  ]),
  "GET /console/sessions": mockResponse({ sessions: [] }),
  "GET /console/prompts": mockResponse({ prompts: [PROMPT_HISTORY] }),
  "GET /console/tools": mockResponse({
    tools: [
      {
        name: "get_bitcoin_network_status",
        title: "Bitcoin network status",
        description: "Reads Bitcoin network status",
        sensitivity: "public",
        requiredScope: "general",
        inputFields: [],
        available: true,
        budgets: {},
      },
    ],
  }),
};

function consoleTurnResponse() {
  return {
    session: SESSION,
    turn: {
      id: "turn-console-smoke",
      sessionId: SESSION.id,
      promptHistoryId: "prompt-current-block",
      state: "completed",
      prompt: "whats the current block?",
      response: "Current block height is 900100.",
      maxSensitivity: "public",
      createdAt: "2026-04-28T00:00:01.000Z",
      completedAt: "2026-04-28T00:00:02.000Z",
      toolTraces: [],
    },
    promptHistory: {
      ...PROMPT_HISTORY,
      id: "prompt-current-block",
      prompt: "whats the current block?",
      title: "Current block",
    },
    toolTraces: [],
  };
}

async function mockConsoleApi(
  page: Page,
  turnGate: Deferred<void>,
  clearHistoryCount: { value: number },
) {
  const unhandledRequests: string[] = [];

  await registerApiRoutes(page, async (route) => {
    const parsedRoute = parseApiRoute(route);

    if (parsedRoute.requestKey === "POST /console/turns") {
      await turnGate.promise;
      await json(route, consoleTurnResponse(), 201);
      return;
    }

    if (parsedRoute.requestKey === "DELETE /console/prompts") {
      clearHistoryCount.value += 1;
      await json(route, { success: true, deleted: 2 });
      return;
    }

    const response = STATIC_RESPONSES[parsedRoute.requestKey];
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    unhandledRequests.push(parsedRoute.requestKey);
    await unmocked(route, parsedRoute.method, parsedRoute.path);
  });

  return unhandledRequests;
}

test("Console drawer submits a prompt, shows thinking state, and clears display/history", async ({
  page,
}) => {
  const turnGate = deferred<void>();
  const clearHistoryCount = { value: 0 };
  const unhandledRequests = await mockConsoleApi(
    page,
    turnGate,
    clearHistoryCount,
  );

  await page.goto("/#/wallets");
  await page.getByRole("button", { name: "Open AI Console" }).click();

  await expect(
    page.getByRole("dialog", { name: "Sanctuary Console" }),
  ).toBeVisible();
  await expect(page.getByText("Block age")).toBeVisible();

  await page.getByLabel("Console prompt").fill("whats the current block?");
  await page.getByRole("button", { name: "Send prompt" }).click();

  await expect(page.getByText("whats the current block?")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "LLM is thinking" }),
  ).toBeVisible();

  turnGate.resolve();

  await expect(page.getByText("Current block height is 900100.")).toBeVisible();
  await expect(
    page.getByRole("status", { name: "LLM is thinking" }),
  ).toBeHidden();

  await page.getByRole("button", { name: "Clear Console display" }).click();
  await expect(page.getByText("Current block height is 900100.")).toBeHidden();
  await expect(page.getByText("Ready")).toBeVisible();

  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Clear prompt history" }).click();
  expect(clearHistoryCount.value).toBe(0);
  await expect(page.getByText("Block age")).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear prompt history" }).click();
  await expect(page.getByText("No prompt history")).toBeVisible();
  expect(clearHistoryCount.value).toBe(1);
  expect(unhandledRequests).toEqual([]);
});
