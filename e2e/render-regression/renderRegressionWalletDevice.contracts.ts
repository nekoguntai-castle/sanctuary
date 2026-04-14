import { expect, type Page } from '@playwright/test';

import {
  DEVICE_ID,
  MAINNET_WALLET,
  MAINNET_WALLET_ID,
  TESTNET_WALLET_ID,
  expectChromiumMainScreenshot,
  mockAuthenticatedApi,
  mockPublicApi,
} from './renderRegressionHarness';

export async function renderDeviceListRouteRendersTableShellAndPrimaryActions({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/devices');

  await expect(main.getByRole('heading', { name: 'Hardware Devices' })).toBeVisible();
  await expect(main.getByText('Manage your signers and keys')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Connect New Device' })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Label' })).toBeVisible();
  await expect(main.getByRole('columnheader', { name: 'Fingerprint' })).toBeVisible();
  await expect(main.getByText('Render Ledger', { exact: true })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderCreateWalletRouteRendersTopologyStepAndActions({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/create');

  await expect(main.getByText('Select Wallet Topology')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Single Signature' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Multi Signature' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Next Step' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Cancel' })).toBeVisible();

  await main.getByRole('button', { name: 'Single Signature' }).click();
  await expect(main.getByRole('button', { name: 'Next Step' })).toBeEnabled();

  expect(unhandledRequests).toEqual([]);
}

export async function renderCreateWalletRouteShowsNoCompatibleDeviceMessageForMultisigSelection({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/create');

  await main.getByRole('button', { name: 'Multi Signature' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByRole('heading', { name: 'Select Signers' })).toBeVisible();
  await expect(main.getByText('No devices with multisig accounts found.')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Connect New Device' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderCreateWalletRouteConfigurationShowsNetworkWarningForTestnet({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/create');

  await main.getByRole('button', { name: 'Single Signature' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await main.getByText('Render Ledger', { exact: true }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByRole('heading', { name: 'Configuration' })).toBeVisible();
  await expect(main.getByText('Script Type')).toBeVisible();
  await main.getByRole('button', { name: 'Testnet' }).click();
  await expect(main.getByText('Testnet coins have no real-world value.')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderSendTransactionRouteRendersTransactionTypeSelectionShell({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

  await expect(main.getByRole('heading', { name: `Send from ${MAINNET_WALLET.name}` })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'What would you like to do?' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Standard Send' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Consolidation' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Sweep' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Cancel' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderSendTransactionRouteRedirectsViewersBackToWalletDetail({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      [`GET /wallets/${MAINNET_WALLET_ID}`]: {
        status: 200,
        body: {
          ...MAINNET_WALLET,
          userRole: 'viewer',
        },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

  await expect(page).toHaveURL(new RegExp(`#\\/wallets\\/${MAINNET_WALLET_ID}$`));
  await expect(main.getByRole('heading', { name: MAINNET_WALLET.name })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Transactions', exact: true })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderSendTransactionRouteRendersFailureStateWhenWalletFetchReturns500({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      [`GET /wallets/${MAINNET_WALLET_ID}`]: {
        status: 500,
        body: { message: 'Wallet fetch failed in test' },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

  await expect(main.getByRole('heading', { name: 'Failed to Load' })).toBeVisible({ timeout: 20000 });
  await expect(main.getByText('Wallet fetch failed in test')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Go Back' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderSendTransactionRouteRendersFailureStateWhenWalletFetchTimesOut({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      [`GET /wallets/${MAINNET_WALLET_ID}`]: {
        timeout: true,
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}/send`);

  await expect(main.getByRole('heading', { name: 'Failed to Load' })).toBeVisible({ timeout: 20000 });
  await expect(main.getByRole('button', { name: 'Go Back' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderConnectDeviceRouteRendersSelectorAndMethodShells({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/devices/connect');

  await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
  await expect(main.getByRole('heading', { name: '1. Select Your Device' })).toBeVisible();
  await expect(main.getByPlaceholder('Search devices...')).toBeVisible();
  await expect(main.getByRole('button', { name: 'All' })).toBeVisible();

  const modelCard = main.getByRole('button', { name: /Nano X/i }).first();
  await expect(modelCard).toBeVisible();
  await modelCard.click();

  await expect(main.getByRole('heading', { name: '2. Connection Method' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'USB' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'SD Card' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Manual Entry' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderConnectDeviceRouteSearchHandlesEmptyResultsAndClearFiltersRecovery({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/devices/connect');

  await main.getByPlaceholder('Search devices...').fill('zzzz-unmatched-model');
  await expect(main.getByText('No devices match your search')).toBeVisible();
  await main.getByRole('button', { name: 'Clear filters' }).click();
  await expect(main.getByRole('button', { name: /Nano X/i }).first()).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderConnectDeviceRouteHidesUsbAndQrOptionsWhenContextIsNotSecure({ page }: { page: Page }): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    });
  });
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/devices/connect');

  await main.getByRole('button', { name: /Nano X/i }).first().click();

  await expect(main.getByRole('heading', { name: '2. Connection Method' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'SD Card' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Manual Entry' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'USB' })).toHaveCount(0);
  await expect(main.getByRole('button', { name: 'QR Code' })).toHaveCount(0);

  expect(unhandledRequests).toEqual([]);
}

export async function renderConnectDeviceRouteRendersSaveFailureFeedbackWhenAPIReturns500({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      'POST /devices': {
        status: 500,
        body: { message: 'Device save failed in test' },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto('/#/devices/connect');

  await main.getByRole('button', { name: /Nano X/i }).first().click();
  await main.getByRole('button', { name: 'Manual Entry' }).click();
  await main.getByPlaceholder('00000000').fill('deadbeef');
  await main.getByPlaceholder('xpub... / ypub... / zpub...').fill('xpub-render-test');
  await main.getByRole('button', { name: 'Save Device' }).click();

  await expect(main.getByText('Device save failed in test')).toBeVisible({ timeout: 20000 });

  expect(unhandledRequests).toEqual([]);
}
