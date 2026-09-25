import { expect, type Locator, type Page } from '@playwright/test';
import { waitForThemeUtilityPaint } from '../helpers';
import { ADMIN_USER, DEVICE_ID, MAINNET_WALLET_ID, RENDER_DEVICE, mockAuthenticatedApi } from './renderRegressionHarness';

export async function setupVisualConsistency(page: Page, darkMode: boolean, device = RENDER_DEVICE) {
  return mockAuthenticatedApi(page, {
    failures: {
      [`GET /devices/${DEVICE_ID}`]: { status: 200, body: device },
      'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: { ...ADMIN_USER.preferences, darkMode } } },
      [`GET /wallets/${MAINNET_WALLET_ID}/autopilot`]: { status: 404 },
      [`GET /wallets/${MAINNET_WALLET_ID}/autopilot/status`]: { status: 404 },
    },
  });
}

async function expectMainFits(page: Page) {
  await expect.poll(() => page.getByRole('main').evaluate(element =>
    element.scrollWidth - element.clientWidth
  )).toBeLessThanOrEqual(1);
}

async function expectReadableSelectedTab(tab: Locator) {
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => tab.evaluate(element => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    // These selected tabs have their own opaque background, so no ancestor
    // compositing or screenshot-pixel inference is involved.
    if (!style.backgroundColor.startsWith('rgb(')) return 0;
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  })).toBeGreaterThanOrEqual(4.5);
}

export async function renderSettingsSelectedContrast(page: Page, darkMode: boolean) {
  const unhandled = await setupVisualConsistency(page, darkMode);
  await page.goto('/#/settings');
  const sections = page.getByRole('tablist', { name: 'Settings sections', exact: true });
  await expect(sections).toBeVisible();
  await waitForThemeUtilityPaint(page);
  for (const name of ['Appearance', 'Display', 'Notifications']) {
    const tab = sections.getByRole('tab', { name, exact: true });
    await tab.click();
    await expectReadableSelectedTab(tab);
  }
  const notifications = page.getByRole('tablist', { name: 'Notification settings sections' });
  for (const name of ['Sound', 'Telegram']) {
    const tab = notifications.getByRole('tab', { name, exact: true });
    await tab.click();
    await expectReadableSelectedTab(tab);
  }
  expect(unhandled).toEqual([]);
}

export async function renderWalletSettingsOverflow(page: Page, darkMode: boolean) {
  const unhandled = await setupVisualConsistency(page, darkMode);
  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  await waitForThemeUtilityPaint(page);
  await expectMainFits(page);
  const sections = page.getByRole('tablist', { name: 'Wallet settings sections', exact: true });
  await sections.getByRole('tab', { name: 'General', exact: true }).focus();
  await page.keyboard.press('End');
  const lastTab = sections.getByRole('tab', { name: 'Autopilot', exact: true });
  await expect(lastTab).toBeFocused();
  await expect(lastTab).toHaveAttribute('aria-selected', 'true');
  await expect(lastTab).toBeInViewport({ ratio: 1 });
  await expectMainFits(page);
  await page.keyboard.press('Home');
  await expect(sections.getByRole('tab', { name: 'General', exact: true })).toBeInViewport({ ratio: 1 });
  expect(unhandled).toEqual([]);
}

export async function renderDeviceResponsiveLayout(page: Page, darkMode: boolean, longLabel = false) {
  const device = longLabel ? {
    ...RENDER_DEVICE,
    label: 'ColdStorage'.repeat(8),
    accounts: [...RENDER_DEVICE.accounts, { ...RENDER_DEVICE.accounts[0], id: 'acct-extra', derivationPath: "m/84'/0'/1'" }],
  } : RENDER_DEVICE;
  const unhandled = await setupVisualConsistency(page, darkMode, device);
  await page.goto(`/#/devices/${DEVICE_ID}`);
  await expect(page.getByRole('heading', { name: device.label })).toBeVisible();
  await waitForThemeUtilityPaint(page);
  await expectMainFits(page);
  const addPath = page.getByRole('button', { name: 'Add Derivation Path' });
  await addPath.scrollIntoViewIfNeeded();
  await expect(addPath).toBeInViewport({ ratio: 1 });
  await expectMainFits(page);
  await page.getByRole('button', { name: 'Edit label', exact: true }).click();
  await expectMainFits(page);
  await page.getByRole('button', { name: 'Cancel editing' }).click();
  expect(unhandled).toEqual([]);
}

export async function renderRelationshipKeyboardJourney(page: Page, darkMode: boolean) {
  const unhandled = await setupVisualConsistency(page, darkMode);
  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
  await page.getByRole('tab', { name: 'Settings', exact: true }).click();
  const devices = page.getByRole('tab', { name: 'Devices', exact: true });
  await devices.click();
  await waitForThemeUtilityPaint(page);
  await devices.focus();
  await page.keyboard.press('Tab');
  const deviceLink = page.getByRole('main').getByRole('link', { name: /Render Ledger/ });
  await expect(deviceLink).toBeFocused();
  await expect(deviceLink).toHaveAttribute('href', `#/devices/${DEVICE_ID}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: RENDER_DEVICE.label })).toBeVisible();
  await page.getByRole('tab', { name: 'Details', exact: true }).focus();
  await page.keyboard.press('Tab');
  const walletLink = page.getByRole('main').getByRole('link', { name: /Render Main Wallet/ });
  await expect(walletLink).toBeFocused();
  await expect(walletLink).toHaveAttribute('href', `#/wallets/${MAINNET_WALLET_ID}`);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Render Main Wallet' })).toBeVisible();
  await page.goto(`/#/devices/${DEVICE_ID}`);
  await expect(page.getByRole('button', { name: 'Back to Devices' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to Devices' }).click();
  await expect(page).toHaveURL(/#\/devices$/);
  expect(unhandled).toEqual([]);
}
