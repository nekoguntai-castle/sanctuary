/**
 * Shared E2E test utilities.
 *
 * Provides common mock helpers so individual spec files don't duplicate
 * boilerplate like json(), route registration, or unmocked-route handling.
 */

import type { Page, Route } from "@playwright/test";
import { getSharedApiResponse } from "./fixtures/apiBaseline";

const THEME_UTILITY_PROBE_ATTRIBUTE = "data-theme-utility-probe";
const THEME_UTILITY_PROBE_CLASS = "bg-primary-800";
const THEME_UTILITY_TIMEOUT_MS = 15_000;
const REQUIRED_THEME_VARIABLES = ["--color-primary-800", "--color-primary-600", "--color-bg-50"];

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

/** Wait until Tailwind's asynchronous runtime has generated and painted theme utilities. */
export async function waitForThemeUtilityPaint(page: Page): Promise<void> {
  await page.evaluate(({ attributeName, probeClass }) => {
    if (!document.body || document.querySelector(`[${attributeName}="true"]`)) return;

    const probe = document.createElement("span");
    probe.setAttribute(attributeName, "true");
    probe.setAttribute("aria-hidden", "true");
    probe.className = probeClass;
    probe.style.cssText =
      "position: fixed; top: -100px; left: 0; width: 1px; height: 1px; pointer-events: none;";
    document.body.appendChild(probe);
  }, { attributeName: THEME_UTILITY_PROBE_ATTRIBUTE, probeClass: THEME_UTILITY_PROBE_CLASS });

  try {
    await page.waitForFunction(
      ({ attributeName, requiredVariables }) => {
        const probe = document.querySelector(`[${attributeName}="true"]`);
        if (!(probe instanceof HTMLElement)) return false;

        const rootStyles = getComputedStyle(document.documentElement);
        const variablesReady = requiredVariables.every(
          variableName => rootStyles.getPropertyValue(variableName).trim() !== "",
        );
        const themeReady = Array.from(document.body.classList).some(className =>
          className.startsWith("theme-"),
        );
        const probeColor = getComputedStyle(probe).backgroundColor;
        return variablesReady && themeReady && !["", "transparent", "rgba(0, 0, 0, 0)"].includes(probeColor);
      },
      { attributeName: THEME_UTILITY_PROBE_ATTRIBUTE, requiredVariables: REQUIRED_THEME_VARIABLES },
      { timeout: THEME_UTILITY_TIMEOUT_MS },
    );
  } finally {
    await page
      .evaluate(attributeName => document.querySelector(`[${attributeName}="true"]`)?.remove(),
        THEME_UTILITY_PROBE_ATTRIBUTE)
      .catch(() => undefined);
  }

  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

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

function parseApiRoute(route: Route) {
  const request = route.request();
  const method = request.method();
  const url = new URL(request.url());
  const path = url.pathname.replace(/^\/api\/v1(?=\/|$)/, "");
  return { method, path };
}

export async function registerStrictApiRoutes(
  page: Page,
  handler: (route: Route) => Promise<void> | void,
) {
  await page.route("**/api/v1/**", handler);
  if (API_ORIGIN) {
    await page.route(`${API_ORIGIN}/**`, handler);
  }
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
    const commonResponse = getSharedApiResponse(method, path);
    if (commonResponse) {
      await json(route, commonResponse.body, commonResponse.status);
      return;
    }

    await handler(route);
  };

  await registerStrictApiRoutes(page, routeHandler);
}
