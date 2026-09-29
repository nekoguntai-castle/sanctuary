import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN_USER, DEVICE_ID, MAINNET_WALLET_ID, RENDER_FIXED_NOW, mockAuthenticatedApi } from './renderRegressionHarness';
import { waitForThemeUtilityPaint } from '../helpers';
import { addReading, checkReadings, type TextReading } from './renderRegressionTextContrast';

const OWNERS = {
  chart: 'src/components/WalletList/BalanceChart.tsx',
  settings: 'src/components/Settings/Settings.tsx',
  notifications: 'src/components/Settings/sections/NotificationsSection.tsx',
  access: 'src/components/WalletDetail/tabs/access/AccessSubTabs.tsx',
  addresses: 'src/components/WalletDetail/tabs/AddressesTab/AddressSubTabs.tsx',
  deviceAccounts: 'src/components/DeviceDetail/DeviceDetail/DeviceAccountsSection.tsx',
  deviceHeader: 'src/components/DeviceDetail/DeviceDetail/DeviceDetailHeader.tsx',
  createProgress: 'src/components/CreateWallet/CreateWalletProgress.tsx',
  importProgress: 'src/components/ImportWallet/ImportWalletProgress.tsx',
  connectHeader: 'src/components/ConnectDevice/ConnectDeviceFlow/ConnectDeviceHeader.tsx',
} as const;

async function setup(page: Page, darkMode: boolean) {
  const addresses = [false, true].map((isChange, index) => ({
    address: `bc1qrender${String(index).padStart(30, '0')}`,
    derivationPath: `m/84h/0h/0h/${isChange ? 1 : 0}/0`,
    index: 0,
    used: false,
    balance: 0,
    isChange,
  }));
  const unhandled = await mockAuthenticatedApi(page, {
    failures: {
      'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: { ...ADMIN_USER.preferences, darkMode } } },
      [`GET /wallets/${MAINNET_WALLET_ID}/addresses`]: { status: 200, body: addresses },
      [`GET /wallets/${MAINNET_WALLET_ID}/addresses/summary`]: {
        status: 200,
        body: { totalAddresses: 2, usedCount: 0, unusedCount: 2, totalBalance: 0, usedBalance: 0, unusedBalance: 0 },
      },
      'GET /transfers': { status: 200, body: { transfers: [], total: 0 } },
    },
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.routeWebSocket('**/*', socket => socket.close());
  const viewport = page.viewportSize();
  if (viewport) await page.setViewportSize({ width: viewport.width, height: 900 });
  await page.clock.setSystemTime(RENDER_FIXED_NOW);
  return { errors, unhandled };
}

async function settle(page: Page) {
  await waitForThemeUtilityPaint(page);
  await page.waitForTimeout(700);
}

function record(readings: TextReading[], locator: Locator, name: string, owner: string) {
  return addReading(readings, locator, name, owner);
}

async function measureChart(page: Page, readings: TextReading[]) {
  await page.goto('/#/wallets');
  await settle(page);
  const labels = ['1D', '1W', '1M', '1Y', 'ALL'];
  const choices = labels.map(label => page.getByRole('button', { name: label, exact: true }));
  await expect(choices[2]).toHaveAttribute('aria-pressed', 'true');
  for (const [index, choice] of choices.entries()) {
    if (index === 2) continue;
    await expect(choice).toHaveAttribute('aria-pressed', 'false');
    await record(readings, choice, `Wallet chart inactive ${labels[index]}`, OWNERS.chart);
  }
  checkReadings(readings.slice(-4), []);
  for (const [index, choice] of choices.entries()) {
    await choice.click();
    await settle(page);
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await record(readings, choice, `Wallet chart selected ${labels[index]}`, OWNERS.chart);
  }
  await record(readings, choices[2], 'Wallet chart inactive 1M after selecting ALL', OWNERS.chart);
}

async function measureTabs(
  page: Page,
  readings: TextReading[],
  role: 'tab' | 'button',
  names: string[],
  owner: string,
  groupName?: string,
) {
  const group = groupName ? page.getByRole('tablist', { name: groupName, exact: true }) : page;
  const choices = names.map(name => group.getByRole(role, { name: new RegExp(`^${name}`, 'i') }));
  for (const [index, choice] of choices.entries()) {
    await record(readings, choice, `${names[index]} resting`, owner);
    if (index === 0) await expect(choice).toHaveAttribute('aria-selected', 'true');
  }
  checkReadings(readings.slice(-choices.length), []);
  const last = choices[choices.length - 1];
  await choices[0].focus();
  await page.keyboard.press('End');
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(choices[0]).toBeFocused();
  await expect(choices[0]).toHaveAttribute('aria-selected', 'true');
  for (const [index, choice] of choices.entries()) {
    await choice.click();
    await settle(page);
    await expect(choice).toHaveAttribute('aria-selected', 'true');
    await record(readings, choice, `${names[index]} selected`, owner);
  }
  await record(readings, choices[0], `${names[0]} inactive after selecting ${names[names.length - 1]}`, owner);
}

async function measureAddressTabs(page: Page, readings: TextReading[]) {
  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
  await page.getByRole('tab', { name: 'Addresses', exact: true }).click();
  await settle(page);
  const list = page.getByRole('tablist', { name: 'Address type', exact: true });
  for (const label of ['Receive', 'Change']) {
    const tab = list.getByRole('tab', { name: new RegExp(`^${label}`) });
    await record(readings, tab.locator('span').first(), `${label} address label`, OWNERS.addresses);
    await record(readings, tab.locator('span').nth(1), `${label} address count`, OWNERS.addresses);
  }
  checkReadings(readings.slice(-4), []);
  const receiveTab = list.getByRole('tab', { name: /^Receive/ });
  await list.getByRole('tab', { name: /^Change/ }).click();
  await settle(page);
  await record(readings, receiveTab.locator('span').first(), 'Receive address label inactive after selecting Change', OWNERS.addresses);
  await record(readings, receiveTab.locator('span').nth(1), 'Receive address count inactive after selecting Change', OWNERS.addresses);
  for (const label of ['Change', 'Receive']) {
    const tab = list.getByRole('tab', { name: new RegExp(`^${label}`) });
    if (label === 'Receive') {
      await tab.click();
      await settle(page);
    }
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await record(readings, tab.locator('span').first(), `${label} address label selected`, OWNERS.addresses);
    await record(readings, tab.locator('span').nth(1), `${label} address count selected`, OWNERS.addresses);
  }
}

async function readActionStates(page: Page, readings: TextReading[], control: Locator, name: string, owner: string) {
  await expect(control).toBeEnabled();
  await expect(control).not.toHaveAttribute('aria-disabled', 'true');
  await record(readings, control, `${name} resting`, owner);
  await control.hover();
  await settle(page);
  await record(readings, control, `${name} hover`, owner);
  await page.mouse.move(0, 0);
  await control.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  await expect.poll(() => control.evaluate(element => element.matches(':focus-visible'))).toBe(true);
  await expect.poll(() => control.evaluate(element => {
    const style = getComputedStyle(element);
    return Number.parseFloat(style.outlineWidth) >= 2 && (style.boxShadow !== 'none' || style.outlineStyle !== 'none');
  })).toBe(true);
  await settle(page);
  await record(readings, control, `${name} keyboard focus`, owner);
}

async function measureDeviceActions(page: Page, readings: TextReading[]) {
  await page.goto(`/#/devices/${DEVICE_ID}`);
  await settle(page);
  const back = page.getByRole('button', { name: 'Back to Devices', exact: true });
  await readActionStates(page, readings, back, 'Device Back to Devices', OWNERS.deviceHeader);
  await back.press('Enter');
  await expect(page).toHaveURL(/#\/devices$/);

  await page.goto(`/#/devices/${DEVICE_ID}`);
  await settle(page);
  const add = page.getByRole('button', { name: 'Add Derivation Path', exact: true });
  await readActionStates(page, readings, add, 'Add Derivation Path', OWNERS.deviceAccounts);
  await add.press('Enter');
  await expect(page.getByRole('heading', { name: /Add Derivation Path/ })).toBeVisible();

  await page.goto(`/#/devices/${DEVICE_ID}`);
  await settle(page);
  const multisig = page.getByRole('tablist', { name: 'Device account purposes' }).getByRole('tab').filter({ hasText: 'Multisig' });
  await expect(multisig).toHaveAttribute('aria-disabled', 'true');
}

async function measureWorkflowReturn(page: Page, readings: TextReading[], route: string, owner: string, destination: RegExp) {
  await page.goto(`/#${route}`);
  await settle(page);
  const control = page.getByRole('button', { name: /^(Cancel|Back to Devices)$/ });
  const name = await control.innerText();
  await readActionStates(page, readings, control, `${route} ${name.trim()}`, owner);
  await control.press('Enter');
  await expect(page).toHaveURL(destination);
}

async function finalizeContract(
  readings: TextReading[],
  expectedCount: number,
  errors: string[],
  unhandled: string[],
) {
  expect(readings).toHaveLength(expectedCount);
  await test.info().attach('VC28-10 contrast readings.json', {
    body: JSON.stringify(readings, null, 2),
    contentType: 'application/json',
  });
  checkReadings(readings, []);
  expect({ unhandled, errors }).toEqual({ unhandled: [], errors: [] });
}

export async function renderSecondarySelectorContrast(page: Page, darkMode: boolean) {
  const { errors, unhandled } = await setup(page, darkMode);
  const readings: TextReading[] = [];
  await measureChart(page, readings);

  await page.goto('/#/settings');
  await settle(page);
  await measureTabs(page, readings, 'tab', ['Appearance', 'Display', 'Services', 'Notifications'], OWNERS.settings, 'Settings sections');
  await page.getByRole('tab', { name: 'Notifications', exact: true }).click();
  await settle(page);
  await measureTabs(page, readings, 'tab', ['Sound', 'Telegram'], OWNERS.notifications, 'Notification settings sections');

  await page.goto(`/#/wallets/${MAINNET_WALLET_ID}`);
  await page.getByRole('tab', { name: 'Access', exact: true }).click();
  await settle(page);
  await measureTabs(page, readings, 'tab', ['Ownership', 'Sharing', 'Transfers'], OWNERS.access, 'Wallet access sections');
  await measureAddressTabs(page, readings);

  await finalizeContract(readings, 41, errors, unhandled);
}

export async function renderSecondaryActionContrast(page: Page, darkMode: boolean) {
  const { errors, unhandled } = await setup(page, darkMode);
  const readings: TextReading[] = [];
  await measureDeviceActions(page, readings);
  await measureWorkflowReturn(page, readings, '/wallets/create', OWNERS.createProgress, /#\/wallets$/);
  await measureWorkflowReturn(page, readings, '/wallets/import', OWNERS.importProgress, /#\/wallets$/);
  await measureWorkflowReturn(page, readings, '/devices/connect', OWNERS.connectHeader, /#\/devices$/);

  await finalizeContract(readings, 15, errors, unhandled);
}
