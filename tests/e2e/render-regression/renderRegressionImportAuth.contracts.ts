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

export async function renderImportWalletRouteRendersFormatSelectionOptions({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await expect(main.getByText('Select Import Format')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Output Descriptor' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'JSON/Text File' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Hardware Device' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'QR Code' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Next Step' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Cancel' })).toBeVisible();

  await main.getByRole('button', { name: 'Output Descriptor' }).click();
  await expect(main.getByRole('button', { name: 'Next Step' })).toBeEnabled();

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletRouteRendersValidationFailureFeedbackWhenAPIReturns500({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      'POST /wallets/import/validate': {
        status: 500,
        body: { message: 'Import validation failed in test' },
      },
    },
  });
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'Output Descriptor' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();
  await main.locator('textarea').first().fill("wpkh([deadbeef/84h/0h/0h]xpub-render-test/0/*)");
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByText('Import validation failed in test')).toBeVisible({ timeout: 20000 });

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletDescriptorStepRejectsOversizedUploadFile({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'Output Descriptor' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();
  await page.locator('#file-upload').setInputFiles({
    name: 'wallet-descriptor.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('a'.repeat(1_200_000)),
  });

  await expect(main.getByText(/File too large/)).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletDescriptorStepRejectsInvalidUploadExtension({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'Output Descriptor' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();
  await page.locator('#file-upload').setInputFiles({
    name: 'wallet.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"wallet":"test"}'),
  });

  await expect(main.getByText('Invalid file type. Expected: .txt')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletRouteRendersHardwareImportStepShell({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'Hardware Device' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
  await expect(main.getByText('Device Type', { exact: true })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Ledger' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Trezor' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Connect Device' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletRouteRendersQrScanStepShell({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'QR Code' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByRole('heading', { name: 'Scan Wallet QR Code' })).toBeVisible();
  await expect(main.getByRole('button', { name: 'Start Camera' })).toBeVisible();
  await expect(main.getByText('Supported formats:')).toBeVisible();
  await expect(main.getByText('Foundation Passport (animated UR:BYTES QR)')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletHardwareStepShowsHTTPSRequirementInInsecureContext({ page }: { page: Page }): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    });
  });
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'Hardware Device' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
  await expect(main.getByText('Requires HTTPS connection')).toBeVisible();
  await expect(main.getByRole('button', { name: /Ledger/ })).toBeDisabled();

  expect(unhandledRequests).toEqual([]);
}

export async function renderImportWalletQrStepShowsHTTPSCameraWarningInInsecureContext({ page }: { page: Page }): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: false,
    });
  });
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/wallets/import');

  await main.getByRole('button', { name: 'QR Code' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();

  await expect(main.getByRole('heading', { name: 'Scan Wallet QR Code' })).toBeVisible();
  await expect(main.getByText('Camera access requires HTTPS. Please use https://localhost:8443')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderAccountRouteRendersProfilePasswordAnd2faSections({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);
  const main = page.getByRole('main');

  await page.goto('/#/account');

  await expect(main.getByRole('heading', { name: 'Account Settings' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Profile Information' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Change Password' })).toBeVisible();
  await expect(main.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();
  await expect(main.getByText('Username')).toBeVisible();
  await expect(main.getByText('admin', { exact: true })).toBeVisible();
  await expect(main.getByText('Account Type')).toBeVisible();
  await expect(main.getByText('Administrator')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Enable 2FA' })).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderUnknownAuthenticatedRouteRedirectsToDashboard({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page);

  await page.goto('/#/route-that-does-not-exist');

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByText('Bitcoin Price')).toBeVisible();
  await expect(page.getByText('Fee Estimation')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderExpiredAuthenticatedSessionRedirectsToLoginWhenAuthMeReturns401({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockAuthenticatedApi(page, {
    failures: {
      'GET /auth/me': {
        status: 401,
        body: { message: 'Unauthorized' },
      },
    },
  });

  await page.goto('/#/wallets');

  await expect(page.getByRole('heading', { name: 'Sanctuary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByText('Backend API:')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}

export async function renderUnauthenticatedRootRouteRendersLoginScreen({ page }: { page: Page }): Promise<void> {
  const unhandledRequests = await mockPublicApi(page);

  await page.goto('/#/');

  await expect(page.getByRole('heading', { name: 'Sanctuary' })).toBeVisible();
  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByText('Backend API:')).toBeVisible();
  await expect(page.getByText('Contact administrator for account access')).toBeVisible();

  expect(unhandledRequests).toEqual([]);
}
