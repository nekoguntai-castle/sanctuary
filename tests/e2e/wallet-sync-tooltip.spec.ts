/**
 * Wallet sync tooltip clipping — non-regression E2E.
 *
 * Shipped in 0.8.65 (#846), the sync-status Tooltip rendered its popup as an
 * absolutely-positioned sibling of the trigger. Every consumer sits inside an
 * ancestor that clips:
 *   - `WalletGridCard`      `relative overflow-hidden`
 *   - the wallet-detail Card `relative overflow-hidden`
 *   - `TableShell`           `overflow-hidden` + `overflow-x-auto`
 * so the failure reason a user hovered was cut off by the card outline.
 *
 * THIS TEST CANNOT BE A JSDOM UNIT TEST. jsdom has no layout engine,
 * `getBoundingClientRect()` returns zeroes, and `src/index.html` is never
 * loaded so `.tooltip-popup` is not even in the cascade.
 *
 * It also must not assert with `boundingBox()`. Playwright returns the *layout*
 * box, which is identical whether or not an ancestor clips the element — a
 * naive box comparison passes on the broken build. The assertion below walks
 * the ancestor chain, intersects the clip rect of every ancestor whose computed
 * `overflow` is not `visible`, and checks the popup is contained by it.
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { getFailClosedWalletRemediationResponse, json, registerApiRoutes, unmocked } from "./helpers";

const USER = {
  id: "user-tooltip",
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
  createdAt: "2026-08-20T00:00:00.000Z",
};

const WALLET_ID = "wallet-tooltip-1";

/** The real string from the 2026-08-20 incident: long, and it must wrap. */
const SYNC_ERROR =
  'Sync pipeline failed at phase "receiveEvidenceGate": Receive evidence ' +
  "authentication was incomplete; retry required (3 rejected: fetch_failed x 2, " +
  "txid_mismatch x 1)";

const WALLET = {
  id: WALLET_ID,
  name: "Tooltip Clip Wallet",
  type: "single_sig",
  scriptType: "native_segwit",
  network: "mainnet",
  descriptor: "wpkh([abcd1234/84h/0h/0h]xpubTooltipClip/0/*)",
  fingerprint: "abcd1234",
  balance: 100000,
  quorum: 1,
  totalSigners: 1,
  userRole: "owner",
  canEdit: true,
  isShared: false,
  sharedWith: [],
  deviceCount: 1,
  syncInProgress: false,
  lastSyncedAt: "2026-08-20T00:00:00.000Z",
  lastSyncStatus: "failed",
  lastSyncError: SYNC_ERROR,
};

type MockApiResponse = { status?: number; body: unknown };

const mockResponse = (body: unknown, status?: number): MockApiResponse => ({ body, status });

function parseApiRoute(route: Route) {
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
    timestamp: "2026-08-20T00:00:00.000Z",
    cached: true,
    change24h: 1.5,
  }),
  "GET /ai/status": mockResponse({ enabled: false, available: false, proxyAvailable: false }),
  "GET /intelligence/status": mockResponse({ available: false, ollamaConfigured: false }),
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
  "GET /transactions/activity-summary": mockResponse({
    count: 0, receivedSats: 0, sentSats: 0, latestAt: null,
  }),
  "GET /transactions/balance-history": mockResponse([
    { name: "Start", value: WALLET.balance },
    { name: "Now", value: WALLET.balance },
  ]),
};

async function mockWalletApi(page: Page) {
  const unhandledRequests: string[] = [];

  await registerApiRoutes(page, async (route) => {
    const parsed = parseApiRoute(route);

    const remediation = getFailClosedWalletRemediationResponse(parsed.method, parsed.path);
    if (remediation) {
      await json(route, remediation.body, remediation.status);
      return;
    }

    const response = STATIC_RESPONSES[parsed.requestKey];
    if (response) {
      await json(route, response.body, response.status);
      return;
    }

    unhandledRequests.push(parsed.requestKey);
    await unmocked(route, parsed.method, parsed.path);
  });

  return unhandledRequests;
}

/**
 * Is the popup fully inside the clip rect imposed by its ancestors?
 *
 * Runs in the page because it needs live computed styles and real geometry.
 * Returns a diagnostic object rather than a boolean so a failure names the
 * ancestor doing the clipping.
 */
async function measureClipping(page: Page) {
  return page.evaluate(() => {
    const popup = document.querySelector('[data-testid="tooltip-popup"]');
    if (!(popup instanceof HTMLElement)) return { found: false } as const;

    const rect = popup.getBoundingClientRect();
    let clip = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    let clipper: string | null = null;

    for (let node = popup.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clips = [style.overflow, style.overflowX, style.overflowY]
        .some((value) => value !== "visible");
      if (!clips) continue;

      const box = node.getBoundingClientRect();
      const next = {
        left: Math.max(clip.left, box.left),
        top: Math.max(clip.top, box.top),
        right: Math.min(clip.right, box.right),
        bottom: Math.min(clip.bottom, box.bottom),
      };
      if (next.top > clip.top || next.bottom < clip.bottom
        || next.left > clip.left || next.right < clip.right) {
        clipper = `${node.tagName.toLowerCase()}.${node.className}`.slice(0, 120);
      }
      clip = next;
    }

    return {
      found: true,
      clipper,
      // Positive values mean the popup pokes outside the clip rect.
      overflowTop: clip.top - rect.top,
      overflowBottom: rect.bottom - clip.bottom,
      overflowLeft: clip.left - rect.left,
      overflowRight: rect.right - clip.right,
      width: rect.width,
      height: rect.height,
    } as const;
  });
}

test.describe("wallet sync tooltip is not clipped by its card", () => {
  test("grid card: the failure reason is fully visible on hover", async ({ page }) => {
    const unhandledRequests = await mockWalletApi(page);

    await page.goto("/#/wallets");
    await expect(page.getByText("Tooltip Clip Wallet")).toBeVisible();

    const trigger = page.getByRole("button", { name: /^Sync status:/ }).first();
    await expect(trigger).toBeVisible();
    await trigger.hover();

    const popup = page.getByTestId("tooltip-popup").first();
    await expect.poll(async () => (
      popup.evaluate((el) => Number.parseFloat(getComputedStyle(el).opacity))
    ), { timeout: 5000 }).toBeGreaterThan(0.9);

    const measured = await measureClipping(page);
    expect(measured.found).toBe(true);
    expect(measured).toMatchObject({ clipper: null });
    expect(measured.overflowTop).toBeLessThanOrEqual(0);
    expect(measured.overflowBottom).toBeLessThanOrEqual(0);
    expect(measured.overflowLeft).toBeLessThanOrEqual(0);
    expect(measured.overflowRight).toBeLessThanOrEqual(0);

    // The reason must also actually wrap rather than render as one long line.
    expect(measured.height).toBeGreaterThan(20);

    expect(unhandledRequests).toEqual([]);
  });

  test("the popup escapes the card in the DOM, not just visually", async ({ page }) => {
    const unhandledRequests = await mockWalletApi(page);

    await page.goto("/#/wallets");
    await expect(page.getByText("Tooltip Clip Wallet")).toBeVisible();

    const parentIsBody = await page.evaluate(() => {
      const popup = document.querySelector('[data-testid="tooltip-popup"]');
      return popup?.parentElement === document.body;
    });
    expect(parentIsBody).toBe(true);

    expect(unhandledRequests).toEqual([]);
  });
});
