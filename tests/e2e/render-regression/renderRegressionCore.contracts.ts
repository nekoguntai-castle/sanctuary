import { expect, test, type Page } from "@playwright/test";

import {
  DEVICE_ID,
  MAINNET_WALLET,
  MAINNET_WALLET_ID,
  TESTNET_WALLET_ID,
  expectChromiumMainScreenshot,
  mockAuthenticatedApi,
  mockPublicApi,
} from "./renderRegressionHarness";

export async function renderDashboardRendersCoreCardsAndNetworkSpecificPlaceholders({
  page,
}: {
  page: Page;
}): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto("/#/");

  await expect(page.getByText("Update Available: v0.9.0")).toBeVisible();
  await expect(page.getByText("Bitcoin Price")).toBeVisible();

  // Recent Activity is a preview of a larger set, so it renders no statistics
  // tiles — they would describe only the loaded page. Wallet Detail keeps them.
  await expect(page.getByTestId("transaction-stats-grid")).toHaveCount(0);
  await expect(page.getByText("Fee Estimation")).toBeVisible();
  await expect(page.getByText("Node Status")).toBeVisible();
  await expect(page.getByTitle("Mainnet block height")).toBeVisible();
  // The unit is stated once on the fee card header now, not per tier.
  await expect(page.getByText("sat/vB")).toBeVisible();
  await expect(page.getByRole("main").getByText("22", { exact: true })).toBeVisible();

  await page
    .getByRole("tablist", { name: "Network tabs" })
    .getByRole("tab", { name: "Testnet3" })
    .click();
  // Bitcoin Price is mainnet-only: on Testnet3 the card is omitted outright, and
  // the telemetry row reflows to two cards rather than leaving a blank slot.
  await expect(page.getByText("Bitcoin Price")).toHaveCount(0);
  await expect(page.getByText("Fee Estimation")).toBeVisible();
  await expect(page.getByText(/^Connected$/)).toBeVisible();
  await expect(page.getByRole("main").getByText("900,123").last()).toBeVisible();
  // The Pool:/Height: label column collapsed into one support line.
  await expect(page.getByText("2/3")).toBeVisible();
  await expectChromiumMainScreenshot(page, "dashboard-testnet-shell.png");

  expect(unhandledRequests).toEqual([]);
}

/**
 * Wallets and Recent Activity used to share a two-column row above 1800px, fed
 * by the dashboard route's `contentWidth: "wide"`. Both are gone: the sections
 * are full-width stacked siblings at every viewport, and the route is back on
 * the default cap.
 *
 * This case runs at the wide viewport because that is the width where the old
 * layout differed — if the two-column row ever comes back, it comes back here
 * first and nowhere else in the suite (everything else runs at 1280x720).
 *
 * Deliberately assertion-only, no screenshot: the computed-style checks are what
 * catch a regression, and a baseline PNG would add a calibration loop and a
 * recharts animation to fight for no extra coverage.
 *
 * The width is derived, not observed — keep this arithmetic in sync if the
 * layout constants move:
 *   main    = 1920 - 256 sidebar (LayoutShell `lg:w-64`)              = 1664
 *   wrapper = min(1664, 1280 default `max-w-7xl`)                     = 1280
 *   content = 1280 - 64 (`md:px-8`, 32 each side)                     = 1216
 *   card    = 1216 - 2 (Card `border`, 1 each side; clientWidth
 *             excludes borders)                                       = 1214
 */
export async function renderDashboardWideViewportStacksSections({
  page,
}: {
  page: Page;
}): Promise<void> {
  // chromium only, matching expectChromiumMainScreenshot: exact pixel widths are
  // calibrated for one engine, not a cross-browser contract. Guarding here
  // rather than with test.skip() keeps the suite free of disabled tests
  // (scripts/test-hygiene.mjs).
  if (test.info().project.name !== "chromium") {
    return;
  }

  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto("/#/");
  await expect(page.getByText("Bitcoin Price")).toBeVisible();

  // The two-column row is gone outright, not merely collapsed to one column.
  await expect(page.getByTestId("dashboard-primary-row")).toHaveCount(0);

  const activity = page.getByTestId("dashboard-recent-activity");
  await expect(activity).toBeVisible();

  // Poll rather than assert once: Tailwind here is the CDN build whose JIT
  // emits classes asynchronously after first paint.
  //
  // Pins both halves of the change at once — full width (not a ~688px column)
  // and the default content cap (not the 1472px "wide" one).
  await expect
    .poll(() => activity.evaluate((el) => el.clientWidth), { timeout: 15_000 })
    .toBe(1214);

  expect(unhandledRequests).toEqual([]);
}

export async function renderWalletDetailRendersTabShellsAndEmptyStateContent({
  page,
}: {
  page: Page;
}): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);

  await expect(
    page.getByRole("heading", { name: "Render Main Wallet" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Transactions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "UTXOs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Drafts", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("No transactions found.")).toBeVisible();

  await page.getByRole("tab", { name: "UTXOs", exact: true }).click();
  await expect(page.getByText("Available Outputs")).toBeVisible();

  await page.getByRole("tab", { name: "Drafts", exact: true }).click();
  await expect(page.getByText("No draft transactions")).toBeVisible();

  await page.getByRole("tab", { name: "Addresses", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No Addresses Available" }),
  ).toBeVisible();
  await expectChromiumMainScreenshot(
    page,
    "wallet-detail-addresses-empty-shell.png",
  );

  expect(unhandledRequests).toEqual([]);
}

export async function renderDeviceDetailRendersAddAccountFlowOptionsWithoutCrashing({
  page,
}: {
  page: Page;
}): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto(`/#/devices/${DEVICE_ID}`);

  await expect(
    page.getByRole("heading", { name: "Render Ledger" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add Derivation Path" }).click();

  await expect(
    page.getByRole("heading", { name: "Add Derivation Path" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect via USB" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import from SD Card" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Scan QR Code" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enter Manually" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Connect via USB" }).click();
  await expect(
    page.getByRole("button", { name: "Connect Device" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "← Back to options" }).click();
  await page.getByRole("button", { name: "Scan QR Code" }).click();
  await expect(
    page.getByRole("button", { name: "Camera", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "File", exact: true }),
  ).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderWalletListRendersNetworkScopedCardsAndControls({
  page,
}: {
  page: Page;
}): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto("/#/wallets");

  await expect(
    page.getByRole("heading", { name: "Mainnet Wallets" }),
  ).toBeVisible();
  await expect(page.getByText("Render Main Wallet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Render Testnet Wallet")).not.toBeVisible();

  await page
    .getByRole("tablist", { name: "Network tabs" })
    .getByRole("tab", { name: "Testnet3" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Testnet3 Wallets" }),
  ).toBeVisible();
  await expect(page.getByText("Render Testnet Wallet")).toBeVisible();
  await expectChromiumMainScreenshot(page, "wallet-list-testnet-shell.png");

  expect(unhandledRequests).toEqual([]);
}

export async function renderWalletListRouteRendersFirstWalletEmptyStateWhenNoWalletsExist({
  page,
}: {
  page: Page;
}): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      "GET /wallets": {
        status: 200,
        body: [],
      },
    },
  });
  const main = page.getByRole("main");

  await page.goto("/#/wallets");

  await expect(
    main.getByRole("heading", { name: "Wallet Overview" }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { name: "No Wallets Yet" }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Create Wallet" }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Import Wallet" }),
  ).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderSettingsRouteRendersTabPanelsAndNotificationSubTabs({
  page,
}: {
  page: Page;
}): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto("/#/settings");
  const main = page.getByRole("main");

  await expect(
    page.getByRole("heading", { name: "System Settings" }),
  ).toBeVisible();
  await expect(
    main.getByRole("tab", { name: "Appearance", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("tab", { name: "Display", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("tab", { name: "Services", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("tab", { name: "Notifications", exact: true }),
  ).toBeVisible();

  await main.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByText("Display Preferences")).toBeVisible();

  await main.getByRole("tab", { name: "Services", exact: true }).click();
  await expect(
    main.getByRole("heading", { name: "Price Provider", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Current Bitcoin Price")).toBeVisible();

  await main
    .getByRole("tab", { name: "Notifications", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Notification Sounds" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Telegram", exact: true }).click();
  await expect(page.getByText("Telegram Notifications")).toBeVisible();
  await expectChromiumMainScreenshot(
    page,
    "settings-notifications-telegram-shell.png",
  );

  expect(unhandledRequests).toEqual([]);
}
