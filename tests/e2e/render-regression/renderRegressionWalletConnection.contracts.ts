import { expect, type Page, type Route } from '@playwright/test';
import { ADMIN_USER, RENDER_DEVICE, mockAuthenticatedApi } from './renderRegressionHarness';
import { json, registerStrictApiRoutes } from '../helpers';

function apiPathname(route: Route): string {
  return new URL(route.request().url()).pathname.replace(/^\/api\/v1(?=\/|$)/, '');
}

async function switchWalletNetwork(page: Page, name: 'Mainnet' | 'Testnet3'): Promise<void> {
  if ((page.viewportSize()?.width ?? 1440) >= 768) {
    await page.getByRole('tab', { name }).click();
    return;
  }
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  const navigation = page.getByRole('dialog', { name: 'Main navigation' });
  await navigation.getByRole('tab', { name }).click();
  await navigation.getByRole('button', { name: 'Close navigation' }).click();
  await expect(navigation).toBeHidden();
}

export async function renderWalletConnectionKeepsSignerDraft(page: Page, darkMode: boolean): Promise<void> {
  const longLabel = `Render Ledger ${'ColdStorage'.repeat(8)}`;
  const unhandled = await mockAuthenticatedApi(page, { failures: {
    'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: { ...ADMIN_USER.preferences, darkMode } } },
    'GET /devices': { status: 200, body: [{ ...RENDER_DEVICE, label: longLabel }] },
  } });
  const main = page.getByRole('main');
  await page.goto('/#/wallets/create');
  await main.getByRole('button', { name: 'Single Signature' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();
  const signer = main.getByRole('button', { name: /Select signer Render Ledger/ });
  await expect.poll(() => signer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect.poll(() => main.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(signer).toHaveAttribute('aria-pressed', 'false');
  await signer.focus();
  await page.keyboard.press('Space');
  await expect(signer).toHaveAttribute('aria-pressed', 'true');
  await main.getByRole('button', { name: 'Connect New Device' }).click();
  await expect(main.getByRole('button', { name: 'Return to Signers' })).toBeVisible();
  await main.getByRole('button', { name: 'Return to Signers' }).click();
  await expect(main.getByRole('heading', { name: 'Select Signers' })).toBeVisible();
  await expect(signer).toHaveAttribute('aria-pressed', 'true');
  await expect(main.getByRole('button', { name: 'Connect New Device' })).toBeFocused();
  await expect(page).toHaveURL(/#\/wallets\/create$/);
  await switchWalletNetwork(page, 'Testnet3');
  await expect(main.getByRole('button', { name: /Select signer Render Ledger/ })).toHaveAttribute('aria-pressed', 'false');
  await switchWalletNetwork(page, 'Mainnet');
  await expect(main.getByRole('button', { name: /Select signer Render Ledger/ })).toHaveAttribute('aria-pressed', 'false');
  expect(unhandled).toEqual([]);
}

type SaveOutcome = 'created' | 'auto-merged' | 'explicit-merge' | 'conflict-return';

export async function renderWalletEmbeddedSave(page: Page, darkMode: boolean, outcome: SaveOutcome): Promise<void> {
  const unhandled = await mockAuthenticatedApi(page, { failures: {
    'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: { ...ADMIN_USER.preferences, darkMode } } },
  } });
  const imported = {
    ...RENDER_DEVICE, id: 'imported-device', label: 'Imported signer', fingerprint: 'deadbeef',
    accounts: [{ ...RENDER_DEVICE.accounts[0], id: 'imported-account' }],
  };
  let saved = false;
  let posts = 0;
  await registerStrictApiRoutes(page, async route => {
    const method = route.request().method();
    if (apiPathname(route) !== '/devices') return route.fallback();
    if (method === 'GET') {
      return json(route, saved ? [RENDER_DEVICE, imported] : [RENDER_DEVICE]);
    }
    if (method !== 'POST') return route.fallback();
    posts += 1;
    const request = route.request().postDataJSON() as { merge?: boolean };
    if (outcome === 'conflict-return' || (outcome === 'explicit-merge' && !request.merge)) {
      return json(route, {
        error: 'Conflict', message: 'Device already exists', existingDevice: RENDER_DEVICE,
        comparison: { newAccounts: [{ purpose: 'single_sig', scriptType: 'native_segwit', derivationPath: "m/84'/0'/1'", xpub: 'xpub-new' }], matchingAccounts: [], conflictingAccounts: [] },
      }, 409);
    }
    saved = true;
    const result = outcome === 'created' ? imported : { message: 'Accounts merged', device: RENDER_DEVICE, added: 1 };
    return json(route, result);
  });
  const main = page.getByRole('main');
  await page.goto('/#/wallets/create');
  await main.getByRole('button', { name: 'Single Signature' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();
  const original = main.getByRole('button', { name: /Select signer Render Ledger/ });
  await original.click();
  await main.getByRole('button', { name: 'Connect New Device' }).click();
  await expect(main.getByRole('heading', { name: 'Connect Hardware Device' })).toBeVisible();
  await main.getByRole('button', { name: /Nano X/i }).first().click();
  await main.getByRole('button', { name: 'SD Card' }).click();
  await main.locator('input[type="file"]').setInputFiles({
    name: 'ledger-account.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ xfp: 'deadbeef', deriv: "m/84'/0'/0'", xpub: `xpub${'a'.repeat(108)}` })),
  });
  await expect(main.getByText('File Imported Successfully')).toBeVisible();
  await main.getByRole('button', { name: 'Save Device' }).click();
  if (outcome === 'explicit-merge' || outcome === 'conflict-return') {
    await expect(main.getByRole('heading', { name: 'Device Already Exists' })).toBeVisible();
    if (outcome === 'explicit-merge') await main.getByRole('button', { name: /Merge 1 New Account/ }).click();
    else await main.getByRole('button', { name: 'Return to Signers' }).last().click();
  }
  await expect(main.getByRole('heading', { name: 'Select Signers' })).toBeVisible();
  await expect(original).toHaveAttribute('aria-pressed', 'true');
  if (outcome === 'created') await expect(main.getByRole('button', { name: /Select signer Imported signer/ })).toHaveAttribute('aria-pressed', 'false');
  expect(posts).toBe(outcome === 'explicit-merge' ? 2 : 1);
  expect(unhandled).toEqual([]);
}

export async function renderWalletRefreshRetry(page: Page, darkMode: boolean): Promise<void> {
  const unhandled = await mockAuthenticatedApi(page, { failures: {
    'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: { ...ADMIN_USER.preferences, darkMode } } },
  } });
  // The safe-read client retries three times, so one logical failed refresh
  // must return four server errors before the wizard can expose Retry.
  let failuresRemaining = 0;
  let failedRequests = 0;
  await registerStrictApiRoutes(page, async route => {
    if (apiPathname(route) !== '/devices' || route.request().method() !== 'GET') return route.fallback();
    const fail = failuresRemaining > 0;
    if (fail) {
      failuresRemaining -= 1;
      failedRequests += 1;
    }
    return json(route, fail ? { message: 'Offline' } : [RENDER_DEVICE], fail ? 500 : 200);
  });
  const main = page.getByRole('main');
  await page.goto('/#/wallets/create');
  await main.getByRole('button', { name: 'Single Signature' }).click();
  await main.getByRole('button', { name: 'Next Step' }).click();
  const signer = main.getByRole('button', { name: /Select signer Render Ledger/ });
  await signer.click();
  await main.getByRole('button', { name: 'Connect New Device' }).click();
  await expect(main.getByRole('button', { name: 'Return to Signers' })).toBeVisible();
  failuresRemaining = 4;
  await main.getByRole('button', { name: 'Return to Signers' }).click();
  await expect(main.getByRole('alert')).toContainText('Could not refresh available signers', { timeout: 15000 });
  expect(failedRequests).toBe(4);
  await expect(main.getByRole('button', { name: 'Next Step' })).toBeDisabled();
  await main.getByRole('button', { name: 'Retry signer refresh' }).click();
  await expect(main.getByRole('alert')).toHaveCount(0);
  await expect(signer).toHaveAttribute('aria-pressed', 'true');
  await expect(main.getByRole('button', { name: 'Next Step' })).toBeEnabled();
  expect(unhandled).toEqual([]);
}
