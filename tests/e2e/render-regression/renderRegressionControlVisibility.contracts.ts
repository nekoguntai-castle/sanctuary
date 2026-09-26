import { expect, test, type Locator, type Page } from '@playwright/test';
import { json, waitForThemeUtilityPaint } from '../helpers';
import { ADMIN_USER, MAINNET_WALLET, MAINNET_WALLET_ID, RENDER_DEVICE, mockAuthenticatedApi } from './renderRegressionHarness';

const WALLET_ROUTE = `/#/wallets/${MAINNET_WALLET_ID}`;
const LONG_WALLET_NAME = 'Cold storage inheritance wallet '.repeat(6).trim();

function addressFixtures(receiveCount: number, changeCount: number) {
  return [false, true].flatMap(isChange => Array.from({ length: isChange ? changeCount : receiveCount }, (_, index) => ({
    address: `bc1qrender${isChange ? 'change' : 'receive'}${String(index).padStart(30, '0')}`,
    derivationPath: `m/84h/0h/0h/${isChange ? 1 : 0}/${index}`,
    index, used: false, balance: 0, isChange,
  })));
}

async function setupControls(page: Page, darkMode: boolean, receiveCount = 1, changeCount = 1, devices = [RENDER_DEVICE]) {
  const preferences = { ...ADMIN_USER.preferences, darkMode, viewSettings: { devices: { layout: 'list' } } };
  const addresses = addressFixtures(receiveCount, changeCount);
  const unhandled = await mockAuthenticatedApi(page, {
    failures: {
      'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences } },
      'GET /devices': { status: 200, body: devices },
      [`GET /wallets/${MAINNET_WALLET_ID}/addresses`]: { status: 200, body: addresses },
      [`GET /wallets/${MAINNET_WALLET_ID}/addresses/summary`]: { status: 200, body: {
        totalAddresses: addresses.length, usedCount: 0, unusedCount: addresses.length,
        totalBalance: 0, usedBalance: 0, unusedBalance: 0,
      } },
    },
  });
  let currentPreferences: Record<string, unknown> = preferences;
  await page.route('**/auth/me/preferences', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    currentPreferences = { ...currentPreferences, ...route.request().postDataJSON() };
    await json(route, { ...ADMIN_USER, preferences: currentPreferences });
  });
  return unhandled;
}

async function themeReady(page: Page, darkMode: boolean) {
  await waitForThemeUtilityPaint(page);
  await expect(page.locator('html')).toHaveClass(darkMode ? /dark/ : /^(?!.*\bdark\b)/);
}

async function capture(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.getByRole('main').screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

// Composite transparent/alpha backgrounds only through solid ancestor surfaces.
// Fail closed for gradients/images instead of reporting invented contrast.
async function expectReadable(control: Locator) {
  await expect.poll(() => control.evaluate(element => {
    const rgba = (value: string) => {
      const channels = value.match(/[\d.]+/g)!.map(Number);
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const blend = (front: number[], back: number[]) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
    const luminance = (rgb: number[]) => {
      const linear = rgb.slice(0, 3).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const layers: number[][] = [];
    let ancestor: Element | null = element;
    while (ancestor) {
      const style = getComputedStyle(ancestor);
      if (style.backgroundImage !== 'none') return 0;
      const background = rgba(style.backgroundColor);
      layers.push(background);
      if (background[3] === 1) break;
      ancestor = ancestor.parentElement;
    }
    if (layers.at(-1)?.[3] !== 1) return 0;
    const background = layers.reverse().reduce((back, front) => blend(front, back), [0, 0, 0]);
    const foreground = blend(rgba(getComputedStyle(element).color), background);
    const values = [luminance(foreground), luminance(background)];
    return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
  })).toBeGreaterThanOrEqual(4.5);
}

async function expectInitiallyBounded(control: Locator) {
  await expect(control).toBeVisible();
  // No focus/hover/scroll before this read: Playwright can otherwise scroll
  // overflow:hidden ancestors and conceal the initial-layout regression.
  const violations = await control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const errors: string[] = [];
    let parent = element.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== 'visible' || parent.tagName === 'MAIN') {
        const bounds = parent.getBoundingClientRect();
        const left = bounds.left + parent.clientLeft;
        const right = left + parent.clientWidth;
        if (box.left < left - 1 || box.right > right + 1) errors.push(`${parent.tagName}: ${box.left}..${box.right} outside ${left}..${right}`);
      }
      parent = parent.parentElement;
    }
    return errors;
  });
  expect(violations).toEqual([]);
}

async function openAddresses(page: Page, darkMode: boolean) {
  await page.goto(WALLET_ROUTE);
  await page.getByRole('tab', { name: 'Addresses', exact: true }).click();
  await expect(page.getByRole('tablist', { name: 'Address type' })).toBeVisible();
  await themeReady(page, darkMode);
}

export async function renderGhostActionContrast(page: Page, darkMode: boolean, action: 'Generate' | 'Cancel') {
  const unhandled = await setupControls(page, darkMode);
  if (action === 'Generate') await openAddresses(page, darkMode);
  else {
    await page.goto(`${WALLET_ROUTE}/send`);
    await themeReady(page, darkMode);
  }
  const control = page.getByRole('button', { name: action, exact: true });
  await expectReadable(control);
  await control.hover();
  // Wait for the shared transition to finish; polling alone can sample the
  // readable resting color before the broken hover color has arrived.
  await page.waitForTimeout(350);
  await capture(page, `${action.toLowerCase()}-hover`);
  await expectReadable(control);
  await page.mouse.move(0, 0);
  await control.focus();
  await page.keyboard.press('Shift');
  await expect(control).toBeFocused();
  await page.waitForTimeout(350);
  await expect.poll(() => control.evaluate(element => {
    const style = getComputedStyle(element);
    const indicator = style.boxShadow !== 'none'
      || (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0);
    return element.matches(':focus-visible') && indicator;
  })).toBe(true);
  await capture(page, `${action.toLowerCase()}-focus`);
  await expectReadable(control);
  if (action === 'Cancel') {
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`#/wallets/${MAINNET_WALLET_ID}$`));
  }
  expect(unhandled).toEqual([]);
}

async function expectAddressFocusFits(tab: Locator) {
  await expect.poll(() => tab.evaluate(element => {
    const style = getComputedStyle(element);
    const extent = parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    const box = element.getBoundingClientRect();
    const strip = element.parentElement!;
    const bounds = strip.getBoundingClientRect();
    return element.matches(':focus-visible') && style.outlineStyle !== 'none'
      && box.left - extent >= bounds.left - 1 && box.right + extent <= bounds.right + 1
      && box.top - extent >= bounds.top - 1 && box.bottom + extent <= bounds.bottom + 1;
  })).toBe(true);
}

export async function renderAddressLabelContrast(page: Page, darkMode: boolean, receiveCount: number, changeCount: number) {
  const unhandled = await setupControls(page, darkMode, receiveCount, changeCount);
  await openAddresses(page, darkMode);
  const tabs = page.getByRole('tablist', { name: 'Address type' });
  for (const selectedName of ['Receive', 'Change']) {
    await tabs.getByRole('tab', { name: new RegExp(`^${selectedName}`) }).click();
    await page.mouse.move(0, 0);
    await capture(page, `addresses-${selectedName.toLowerCase()}`);
    const selected = tabs.getByRole('tab', { selected: true });
    await expectReadable(selected.locator('span').first());
    for (const name of ['Receive', 'Change']) await expectReadable(tabs.getByRole('tab', { name: new RegExp(`^${name}`) }).locator('span').last());
  }
  const receive = tabs.getByRole('tab', { name: `Receive ${receiveCount}`, exact: true });
  const change = tabs.getByRole('tab', { name: `Change ${changeCount}`, exact: true });
  await receive.click();
  for (const [key, target] of [['ArrowRight', change], ['Home', receive], ['End', change], ['ArrowLeft', receive]] as const) {
    await page.keyboard.press(key);
    await expect(target).toBeFocused();
    await expect(target).toHaveAttribute('aria-selected', 'true');
    await expectAddressFocusFits(target);
  }
  await change.click();
  if (changeCount === 0) await expect(page.getByText('No change addresses used yet.', { exact: false })).toBeVisible();
  else await expect(page.getByTitle(addressFixtures(0, 1)[0].address, { exact: true })).toBeVisible();
  expect(unhandled).toEqual([]);
}

export async function renderAddressGenerateFits(page: Page, darkMode: boolean) {
  const unhandled = await setupControls(page, darkMode, 123, 123);
  const requests: unknown[] = [];
  await page.route(`**/wallets/${MAINNET_WALLET_ID}/addresses/generate`, async route => {
    requests.push(route.request().postDataJSON());
    await json(route, { generated: 10 });
  });
  await openAddresses(page, darkMode);
  const generate = page.getByRole('button', { name: 'Generate', exact: true });
  await capture(page, 'address-initial-layout');
  await expectInitiallyBounded(generate);
  for (const tab of await page.getByRole('tablist', { name: 'Address type' }).getByRole('tab').all()) await expectInitiallyBounded(tab);
  await generate.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ count: 10 });
  await expect(generate).toBeEnabled();
  expect(unhandled).toEqual([]);
}

function deviceFixtures(shared: boolean) {
  const wallets = [{ wallet: { id: MAINNET_WALLET_ID, name: LONG_WALLET_NAME, type: MAINNET_WALLET.type } }];
  const owned = { ...RENDER_DEVICE, wallets };
  return shared ? [owned, { ...owned, id: 'device-shared', label: 'Shared Ledger', isOwner: false, userRole: 'viewer' }] : [owned];
}

// A saved preference refreshes the device records and remounts the header.
// Wait for that existing lifecycle before opening another transient control.
async function changeDevicePreference(page: Page, control: Locator) {
  let saved = false;
  const save = page.waitForResponse(response => response.request().method() === 'PATCH'
    && response.url().endsWith('/auth/me/preferences')).then(() => { saved = true; });
  const refresh = page.waitForResponse(response => saved && response.request().method() === 'GET'
    && new URL(response.url()).pathname.endsWith('/devices'));
  await control.click();
  await save;
  await refresh;
  await expect(page.getByText('Loading devices...', { exact: true })).toHaveCount(0);
}

async function expectDeviceToolbarFits(page: Page) {
  for (const name of ['List View', 'Grouped View', 'Connect New Device']) await expectInitiallyBounded(page.getByRole('button', { name, exact: true }));
  await expect.poll(() => page.getByRole('main').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

export async function renderDeviceToolbarFits(page: Page, darkMode: boolean, state: 'owned' | 'shared' | 'empty') {
  const devices = state === 'empty' ? [] : deviceFixtures(state === 'shared');
  const unhandled = await setupControls(page, darkMode, 1, 1, devices);
  await page.goto('/#/devices');
  await themeReady(page, darkMode);
  await capture(page, `devices-${state}-initial`);
  if (state === 'empty') {
    const connect = page.getByRole('button', { name: 'Connect Your First Device', exact: true });
    await expectInitiallyBounded(connect);
    await connect.click();
    await expect(page).toHaveURL(/#\/devices\/connect$/);
    expect(unhandled).toEqual([]);
    return;
  }
  await expectDeviceToolbarFits(page);
  for (const layout of ['Grouped View', 'List View']) {
    await changeDevicePreference(page, page.getByRole('button', { name: layout, exact: true }));
    await expect(page.getByRole('button', { name: layout, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectDeviceToolbarFits(page);
  }
  await verifyWalletFilter(page);
  if (state === 'shared') {
    await changeDevicePreference(page, page.getByTitle('Show shared devices only', { exact: true }));
    await expect(page.getByText('Shared Ledger', { exact: true })).toBeVisible();
    await expect(page.getByText(RENDER_DEVICE.label, { exact: true })).toHaveCount(0);
    await expectDeviceToolbarFits(page);
  }
  await page.getByRole('button', { name: 'Connect New Device', exact: true }).click();
  await expect(page).toHaveURL(/#\/devices\/connect$/);
  expect(unhandled).toEqual([]);
}

async function verifyWalletFilter(page: Page) {
  const trigger = page.getByTitle('Filter by wallet', { exact: true });
  await trigger.click();
  const option = page.getByRole('button', { name: new RegExp(`^${LONG_WALLET_NAME} \\d+$`) });
  await expectInitiallyBounded(option);
  await changeDevicePreference(page, option);
  await expect(trigger).toContainText(LONG_WALLET_NAME);
  await expectInitiallyBounded(trigger);
  await expectDeviceToolbarFits(page);
  await trigger.click();
  await expectInitiallyBounded(option);
  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
}
