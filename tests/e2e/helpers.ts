/**
 * Shared E2E test utilities.
 *
 * Provides common mock helpers so individual spec files don't duplicate
 * boilerplate like json(), route registration, or unmocked-route handling.
 */

import type { Page, Route } from "@playwright/test";

type CommonApiResponse = {
  status?: number;
  body: unknown;
};

/**
 * Explicit fail-closed defaults for wallet-remediation routes in broad E2E
 * harnesses. A workflow test that exercises remediation must intercept these
 * routes before this fallback and supply an exact immutable proposal fixture.
 */
export function getFailClosedWalletRemediationResponse(
  method: string,
  path: string,
): CommonApiResponse | null {
  if (method === "POST" && /^\/wallets\/[^/]+\/remediation\/proposals$/.test(path)) {
    return { status: 409, body: { message: "No wallet remediation preview fixture is configured" } };
  }
  if (method === "POST" && /^\/wallets\/[^/]+\/remediation\/proposals\/[^/]+\/approve$/.test(path)) {
    return { status: 409, body: { message: "Wallet remediation approval is not configured" } };
  }
  if (method === "POST" && /^\/wallets\/[^/]+\/remediation\/proposals\/[^/]+\/cancel$/.test(path)) {
    return { status: 409, body: { message: "Wallet remediation cancellation is not configured" } };
  }
  if (method === "GET" && /^\/wallets\/[^/]+\/remediation\/proposals\/[^/]+\/export$/.test(path)) {
    return { status: 404, body: { message: "Wallet remediation evidence is not configured" } };
  }
  return null;
}

/** Parsed origin of VITE_API_URL, or null when unavailable. */
const API_ORIGIN = (() => {
  const apiUrl = process.env.VITE_API_URL;
  if (!apiUrl || !/^https?:\/\//.test(apiUrl)) {
    return null;
  }
  try {
    return new URL(apiUrl).origin;
  } catch {
    return null;
  }
})();

/** Fulfill a route with a JSON response. */
export function json(route: Route, data: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(data),
  });
}

/** Return a standardised 404 for an unmocked API route. */
export function unmocked(route: Route, method: string, path: string) {
  return json(route, { message: `Unmocked: ${method} ${path}` }, 404);
}

const PRICE_PROVIDER_INFOS = [
  {
    name: "mempool",
    priority: 100,
    supportedCurrencies: ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY"],
    enabled: true,
  },
  {
    name: "coingecko",
    priority: 90,
    supportedCurrencies: [
      "USD",
      "EUR",
      "GBP",
      "CAD",
      "CHF",
      "AUD",
      "JPY",
      "CNY",
      "KRW",
      "INR",
    ],
    enabled: true,
  },
  {
    name: "kraken",
    priority: 80,
    supportedCurrencies: ["USD", "EUR", "GBP", "CAD", "CHF", "AUD", "JPY"],
    enabled: true,
  },
  {
    name: "coinbase",
    priority: 70,
    supportedCurrencies: ["USD", "EUR", "GBP", "CAD"],
    enabled: true,
  },
  {
    name: "binance",
    priority: 60,
    supportedCurrencies: ["USD", "EUR", "GBP"],
    enabled: false,
  },
];

const ENABLED_PRICE_PROVIDERS = PRICE_PROVIDER_INFOS.filter(
  (provider) => provider.enabled,
).map((provider) => provider.name);

function parseApiRoute(route: Route) {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1/, "");
  return { method, path };
}

function getCommonApiResponse(
  method: string,
  path: string,
): CommonApiResponse | null {
  if (method === "GET" && path === "/price/providers") {
    return {
      body: {
        providers: ENABLED_PRICE_PROVIDERS,
        count: ENABLED_PRICE_PROVIDERS.length,
      },
    };
  }

  if (method === "GET" && path === "/price/providers/status") {
    return {
      body: {
        providers: PRICE_PROVIDER_INFOS,
        count: PRICE_PROVIDER_INFOS.length,
      },
    };
  }

  return null;
}

/**
 * Register an API route handler on both the glob pattern and the explicit
 * API_ORIGIN (when set), so mocks work regardless of how the app issues
 * requests.
 */
export async function registerApiRoutes(
  page: Page,
  handler: (route: Route) => Promise<void> | void,
) {
  const routeHandler = async (route: Route) => {
    const { method, path } = parseApiRoute(route);
    const commonResponse = getCommonApiResponse(method, path);
    if (commonResponse) {
      await json(route, commonResponse.body, commonResponse.status);
      return;
    }

    await handler(route);
  };

  await page.route("**/api/v1/**", routeHandler);
  if (API_ORIGIN) {
    await page.route(`${API_ORIGIN}/**`, routeHandler);
  }
}
