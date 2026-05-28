import { expect, type Page } from "@playwright/test";

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
  await expect(page.getByText("Fee Estimation")).toBeVisible();
  await expect(page.getByText("Node Status")).toBeVisible();
  await expect(page.getByTitle("Mainnet block height")).toBeVisible();
  await expect(page.getByText("22 sat/vB")).toBeVisible();

  await page
    .getByRole("tablist", { name: "Network tabs" })
    .getByRole("tab", { name: "Testnet3" })
    .click();
  await expect(
    page.getByText("Testnet3 coins have no market value"),
  ).toBeVisible();
  await expect(page.getByText(/^Connected$/)).toBeVisible();
  await expect(page.getByRole("main").getByText("900,123").last()).toBeVisible();
  await expect(page.getByText("2/3(active/total)")).toBeVisible();
  await expectChromiumMainScreenshot(page, "dashboard-testnet-shell.png");

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
  ).toBeVisible();

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
