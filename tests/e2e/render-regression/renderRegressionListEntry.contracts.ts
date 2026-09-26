import { expect, test, type Locator, type Page } from '@playwright/test';
import { json, waitForThemeUtilityPaint } from '../helpers';
import {
  ADMIN_USER, DEVICE_ID, MAINNET_WALLET, MAINNET_WALLET_ID,
  RENDER_DEVICE, TESTNET_WALLET, mockAuthenticatedApi,
} from './renderRegressionHarness';

const LONG_NAME = 'ColdStorage'.repeat(8);

async function setupListEntry(page: Page, darkMode: boolean) {
  const preferences = {
    ...ADMIN_USER.preferences, darkMode,
    viewSettings: { wallets: { layout: 'grid' }, devices: { layout: 'grouped' } },
  };
  const unhandled = await mockAuthenticatedApi(page, {
    failures: {
      'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences } },
      'GET /wallets': { status: 200, body: [MAINNET_WALLET, { ...TESTNET_WALLET, network: 'mainnet', name: LONG_NAME, lastSyncStatus: 'failed', lastSyncError: 'Connection interrupted' }] },
      'GET /devices': { status: 200, body: [RENDER_DEVICE, { ...RENDER_DEVICE, id: 'device-long', label: LONG_NAME, isOwner: false }] },
    },
  });
  // The common mock starts with light preferences. Keep each PATCH response
  // faithful to this test's theme while allowing layout/sort changes to persist.
  let currentPreferences: Record<string, unknown> = preferences;
  await page.route('**/auth/me/preferences', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    currentPreferences = { ...currentPreferences, ...route.request().postDataJSON() };
    await json(route, { ...ADMIN_USER, preferences: currentPreferences });
  });
  return unhandled;
}

async function captureMain(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.getByRole('main').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function expectTheme(page: Page, darkMode: boolean) {
  await waitForThemeUtilityPaint(page);
  await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(darkMode);
}

async function expectFitsMain(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  const main = await page.getByRole('main').boundingBox();
  const box = await control.boundingBox();
  expect(main).not.toBeNull();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(main!.x - 1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(main!.x + main!.width + 1);
}

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  // Start in the document, then use the actual sequential keyboard navigation
  // algorithm. Calling target.focus() would miss a removed tab stop.
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate(element => element === document.activeElement)) break;
  }
  await expect(target).toBeFocused();
  await expect.poll(() => target.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(':focus-visible') && (
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
      style.boxShadow !== 'none' || getComputedStyle(element, '::after').boxShadow !== 'none'
    );
  })).toBe(true);
}

export async function renderWalletListActionsFit(page: Page, darkMode: boolean) {
  const unhandled = await setupListEntry(page, darkMode);
  await page.goto('/#/wallets');
  const main = page.getByRole('main');
  await main.getByRole('combobox').selectOption('balance-asc');
  for (const layout of ['grid', 'table', 'grid']) {
    const toggle = main.getByRole('button', { name: `Show wallet ${layout}` });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expectTheme(page, darkMode);
    for (const name of ['Show wallet grid', 'Show wallet table', 'Import', 'Create']) {
      await expectFitsMain(page, main.getByRole('button', { name, exact: true }));
    }
    for (const title of ['Sync all Mainnet wallets', 'Full resync all Mainnet wallets']) {
      await expectFitsMain(page, main.getByTitle(title, { exact: true }));
    }
    if (layout === 'grid') {
      await expectFitsMain(page, main.getByRole('combobox'));
      await expect(main.getByRole('combobox')).toHaveValue('balance-asc');
    }
    if (layout === 'table') await expectFitsMain(page, main.getByTitle('Configure columns'));
    await expect.poll(() => main.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await captureMain(page, `wallet-${layout}`);
  }
  expect(unhandled).toEqual([]);
}

export async function renderWalletCardEntry(page: Page, darkMode: boolean) {
  const unhandled = await setupListEntry(page, darkMode);
  await page.goto('/#/wallets');
  await expectTheme(page, darkMode);
  const main = page.getByRole('main');
  const link = main.getByRole('link', { name: MAINNET_WALLET.name, exact: true });
  await expect(link).toHaveAttribute('href', `#/wallets/${MAINNET_WALLET_ID}`);
  await expectFitsMain(page, main.getByRole('link', { name: LONG_NAME, exact: true }));
  const card = main.locator('.card-interactive').filter({ has: page.getByRole('link', { name: MAINNET_WALLET.name, exact: true }) });
  const synced = main.getByTitle('Synced', { exact: true });
  if (page.viewportSize()!.width === 1440) {
    const statusBox = await synced.boundingBox();
    const metadataBox = await card.getByText('native segwit', { exact: true }).boundingBox();
    expect(statusBox).not.toBeNull();
    expect(metadataBox).not.toBeNull();
    expect(Math.abs(statusBox!.y + statusBox!.height / 2 - metadataBox!.y - metadataBox!.height / 2)).toBeLessThanOrEqual(2);
  }
  await synced.scrollIntoViewIfNeeded();
  await expect.poll(() => synced.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit?.closest('[title]')?.getAttribute('title');
  })).toBe('Synced');
  const status = main.getByRole('button', { name: /^Sync status:/ });
  await status.click();
  await expect(page).toHaveURL(/#\/wallets$/);
  await status.focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await tabTo(page, link);
  await captureMain(page, 'record-keyboard-focus');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/wallets/${MAINNET_WALLET_ID}$`));
  await expect(page.getByRole('heading', { name: MAINNET_WALLET.name, exact: true })).toBeVisible();
  await page.goto('/#/wallets');
  // A padding hit checks the full card, independently of the title link.
  await card.click({ position: { x: 10, y: 10 } });
  await expect(page).toHaveURL(new RegExp(`#/wallets/${MAINNET_WALLET_ID}$`));
  await page.goto('/#/wallets');
  const sparkline = card.getByRole('img', { name: /^Balance history/ });
  await sparkline.scrollIntoViewIfNeeded();
  const sparklineBox = await sparkline.boundingBox();
  expect(sparklineBox).not.toBeNull();
  // Use an actual coordinate hit: Locator.click on the SVG would reject an
  // intentional link overlay, while dispatchEvent would bypass hit testing.
  await page.mouse.click(sparklineBox!.x + sparklineBox!.width / 2, sparklineBox!.y + sparklineBox!.height / 2);
  await expect(page).toHaveURL(new RegExp(`#/wallets/${MAINNET_WALLET_ID}$`));
  expect(unhandled).toEqual([]);
}

export async function renderGroupedDeviceEntry(page: Page, darkMode: boolean) {
  const unhandled = await setupListEntry(page, darkMode);
  await page.goto('/#/devices');
  await expectTheme(page, darkMode);
  const main = page.getByRole('main');
  const link = main.getByRole('link', { name: RENDER_DEVICE.label, exact: true });
  await expect(link).toHaveAttribute('href', `#/devices/${DEVICE_ID}`);
  await expectFitsMain(page, main.getByRole('link', { name: LONG_NAME, exact: true }));
  await tabTo(page, link);
  await captureMain(page, 'record-keyboard-focus');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`#/devices/${DEVICE_ID}$`));
  await expect(page.getByRole('heading', { name: RENDER_DEVICE.label, exact: true })).toBeVisible();
  await page.goto('/#/devices');
  const item = main.getByRole('listitem').filter({ has: page.getByRole('link', { name: RENDER_DEVICE.label, exact: true }) });
  await item.hover();
  await item.getByRole('button', { name: 'Edit device', exact: true }).click();
  await expect(main.getByRole('textbox')).toBeVisible();
  await expect(page).toHaveURL(/#\/devices$/);
  await main.getByRole('button', { name: 'Cancel editing' }).click();
  await expect(link).toBeVisible();
  await item.click({ position: { x: 5, y: 5 } });
  await expect(page).toHaveURL(new RegExp(`#/devices/${DEVICE_ID}$`));
  expect(unhandled).toEqual([]);
}
