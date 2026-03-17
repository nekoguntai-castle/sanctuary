/**
 * Shared E2E test utilities.
 *
 * Provides common mock helpers so individual spec files don't duplicate
 * boilerplate like json(), route registration, or unmocked-route handling.
 */

import type { Page, Route } from '@playwright/test';

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
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
}

/** Return a standardised 404 for an unmocked API route. */
export function unmocked(route: Route, method: string, path: string) {
  return json(route, { message: `Unmocked: ${method} ${path}` }, 404);
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
  await page.route('**/api/v1/**', handler);
  if (API_ORIGIN) {
    await page.route(`${API_ORIGIN}/**`, handler);
  }
}
