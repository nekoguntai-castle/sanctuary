import { expect, type Locator, type Page } from '@playwright/test';
import { ADMIN_USER, DEVICE_ID, MAINNET_WALLET_ID, RENDER_DEVICE, RENDER_FIXED_NOW, mockAuthenticatedApi } from './renderRegressionHarness';
import { json, waitForThemeUtilityPaint } from '../helpers';
import { addReading, checkReadings, type TextReading } from './renderRegressionTextContrast';

const OWNERS = {
  dashboard: 'src/components/Dashboard/PriceChart/TimeframeControls.tsx',
  systemSettings: 'src/components/SystemSettings/index.tsx',
  display: 'src/components/Settings/sections/DisplaySection.tsx',
  theme: 'src/components/Settings/sections/ThemeSection/panels/ColorThemePanel.tsx',
  backgrounds: 'src/components/Settings/sections/ThemeSection/panels/BackgroundsPanel/BackgroundsPanelView.tsx',
  deviceTabs: 'src/components/DeviceDetail/DeviceDetail/DeviceDetailTabs.tsx',
  deviceAccounts: 'src/components/DeviceDetail/DeviceDetail/DeviceAccountsSection.tsx',
  progress: 'src/components/CreateWallet/CreateWalletProgress.tsx',
} as const;

async function setup(page: Page, darkMode: boolean) {
  const initialPreferences = { ...ADMIN_USER.preferences, darkMode, theme: 'sanctuary' };
  const unhandled = await mockAuthenticatedApi(page, {
    failures: {
      'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: initialPreferences } },
      [`GET /devices/${DEVICE_ID}`]: { status: 200, body: RENDER_DEVICE },
      'GET /admin/support-package/incident-capture': { status: 200, body: { state: 'inactive' } },
      'GET /admin/agents/dashboard': { status: 200, body: [] },
    },
  });
  let preferences = initialPreferences;
  await page.route('**/auth/me/preferences', async route => {
    if (route.request().method() !== 'PATCH') return route.fallback();
    preferences = { ...preferences, ...(route.request().postDataJSON() as Partial<typeof preferences>) };
    await json(route, { ...ADMIN_USER, preferences });
  });
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.clock.setSystemTime(RENDER_FIXED_NOW);
  return { unhandled };
}


async function settle(page: Page) {
  await waitForThemeUtilityPaint(page);
  await page.waitForTimeout(700);
}


export async function renderChoiceContrastAndSemantics(page: Page, darkMode: boolean) {
  const { unhandled } = await setup(page, darkMode);
  const readings: TextReading[] = [];
  const semanticFailures: string[] = [];

  await page.goto('/#/');
  await settle(page);
  const timeframeButtons = ['1D', '1W', '1M', '1Y', 'ALL'].map(name => page.getByRole('button', { name, exact: true }));
  for (const [index, button] of timeframeButtons.entries()) {
    await button.click();
    await settle(page);
    const pressed = await button.getAttribute('aria-pressed');
    if (pressed !== 'true') semanticFailures.push(`dashboard ${['1D', '1W', '1M', '1Y', 'ALL'][index]} did not expose aria-pressed=true`);
    await addReading(readings, button, `Dashboard selected ${['1D', '1W', '1M', '1Y', 'ALL'][index]}`, OWNERS.dashboard);
  }
  await addReading(readings, timeframeButtons[0], 'Dashboard unselected 1D', OWNERS.dashboard);

  await page.goto('/#/admin/settings');
  await settle(page);
  for (const name of ['Access Control', 'WebSocket', 'Support']) {
    const button = page.getByRole('tab', { name, exact: true });
    await button.click();
    await settle(page);
    await addReading(readings, button.locator('span').filter({ hasText: name }), `System Settings selected ${name}`, OWNERS.systemSettings);
  }

  await page.goto('/#/settings');
  await settle(page);
  await page.getByRole('tab', { name: 'Display', exact: true }).click();
  await settle(page);
  for (const name of ['Sats', 'BTC']) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click();
    await settle(page);
    const pressed = await button.getAttribute('aria-pressed');
    if (pressed !== 'true') semanticFailures.push(`display ${name} did not expose aria-pressed=true`);
    await addReading(readings, button, `Display selected ${name}`, OWNERS.display);
  }
  await addReading(readings, page.getByRole('button', { name: 'Sats', exact: true }), 'Display unselected Sats', OWNERS.display);

  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  const colorThemeCard = page.getByRole('heading', { name: 'Color Theme', exact: true }).locator('xpath=../..');
  for (const name of ['Sanctuary', 'Cyber']) {
    const button = colorThemeCard.getByRole('button', { name, exact: true });
    await button.click();
    await settle(page);
    const pressed = await button.getAttribute('aria-pressed');
    if (pressed !== 'true') semanticFailures.push(`theme ${name} did not expose aria-pressed=true`);
    await addReading(readings, button.getByText(name, { exact: true }), `Color Theme selected ${name}`, OWNERS.theme);
  }
  await colorThemeCard.getByRole('button', { name: 'Sanctuary', exact: true }).click();
  await settle(page);

  const backgroundCard = page.getByRole('heading', { name: 'Backgrounds', exact: true }).locator('xpath=../..');
  for (const name of ['All', 'Favorites']) {
    const label = backgroundCard.getByText(name, { exact: true });
    const button = label.locator('xpath=..');
    await button.click();
    await settle(page);
    const pressed = await button.getAttribute('aria-pressed');
    if (pressed !== 'true') semanticFailures.push(`background filter ${name} did not expose aria-pressed=true`);
    await addReading(readings, label, `Background category selected ${name}`, OWNERS.backgrounds);
    await addReading(readings, button.locator('span').last(), `Background category ${name} count`, OWNERS.backgrounds);
  }

  await page.goto(`/#/devices/${DEVICE_ID}`);
  await settle(page);
  const details = page.getByRole('tab', { name: 'Details', exact: true });
  await addReading(readings, details, 'Device Details selected', OWNERS.deviceTabs);
  const networkTabs = page.getByRole('tablist', { name: 'Device account networks' });
  for (const name of ['Mainnet', 'Testnet-family / Signet']) {
    const button = networkTabs.getByRole('tab').filter({ hasText: name });
    await button.click();
    await settle(page);
    await addReading(readings, button, `Device network selected ${name}`, OWNERS.deviceAccounts);
    await addReading(readings, button.locator('span'), `Device network ${name} count`, OWNERS.deviceAccounts);
  }
  const purposeTabs = page.getByRole('tablist', { name: 'Device account purposes' });
  const disabledMultisig = purposeTabs.getByRole('tab').filter({ hasText: 'Multisig' });
  const disabled = await disabledMultisig.getAttribute('aria-disabled');
  if (disabled !== 'true') semanticFailures.push('empty Multisig purpose was not kept disabled');
  await addReading(readings, disabledMultisig, 'Disabled zero-count Multisig (contrast exempt)', OWNERS.deviceAccounts);

  await page.goto('/#/wallets/create');
  await settle(page);
  for (const [step, name] of ['Type', 'Signers', 'Config', 'Review'].entries()) {
    await addReading(readings, page.getByText(name, { exact: true }), `Create wallet step ${step + 1} ${name}`, OWNERS.progress);
  }

  expect(unhandled).toEqual([]);
  checkReadings(readings.filter(reading => !reading.name.includes('contrast exempt')), semanticFailures);
}

function contrastRatio(first: string, second: string): number | null {
  const rgba = (color: string): [number, number, number, number] | null => {
    const match = color.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return null;
    const channels = match[1].split(/[,/ ]+/).filter(Boolean).map(Number);
    return channels.length >= 3 && channels.slice(0, 3).every(Number.isFinite)
      ? [channels[0], channels[1], channels[2], channels[3] ?? 1]
      : null;
  };
  const foreground = rgba(first);
  const background = rgba(second);
  if (!foreground || !background) return null;
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  const composite = [0, 1, 2].map(index => (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) / alpha);
  const luminance = (channels: number[]) => {
    const linear = channels.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const firstLuminance = luminance(composite);
  const secondLuminance = luminance(background.slice(0, 3));
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

async function focusWithKeyboard(page: Page, control: Locator) {
  await control.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  await waitForThemeUtilityPaint(page);
  await page.waitForTimeout(700);
  return control.evaluate(element => {
    const style = getComputedStyle(element);
    type RGBA = [number, number, number, number];
    const parse = (value: string): RGBA | null => {
      const match = value.match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const channels = match[1].split(/[,/ ]+/).filter(Boolean).map(Number);
      if (channels.length < 3 || channels.slice(0, 3).some(channel => !Number.isFinite(channel))) return null;
      return [channels[0], channels[1], channels[2], channels[3] ?? 1];
    };
    const over = (front: RGBA, back: RGBA): RGBA => {
      const alpha = front[3] + back[3] * (1 - front[3]);
      if (alpha === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map(index => (front[index] * front[3] + back[index] * back[3] * (1 - front[3])) / alpha).concat(alpha) as RGBA;
    };
    const paintedBackground = (start: Element | null) => {
      const layers: RGBA[] = [];
      let current = start;
      let unresolved: string | null = null;
      while (current) {
        const currentStyle = getComputedStyle(current);
        const color = parse(currentStyle.backgroundColor);
        if (currentStyle.backgroundImage !== 'none') unresolved ??= `background image ${currentStyle.backgroundImage}`;
        if (!color) unresolved ??= `unparsed background ${currentStyle.backgroundColor}`;
        else layers.push(color);
        if (Number(currentStyle.opacity) !== 1 && current !== start) unresolved ??= `ancestor opacity ${currentStyle.opacity}`;
        if (color?.[3] === 1) break;
        current = current.parentElement;
      }
      if (layers.at(-1)?.[3] !== 1) unresolved ??= 'no opaque solid ancestor';
      return { color: layers.reverse().reduce((back, front) => over(front, back), [0, 0, 0, 1] as RGBA), unresolved };
    };
    const backgrounds = paintedBackground(element);
    const parent = paintedBackground(element.parentElement);
    const shadowColors = Array.from(style.boxShadow.matchAll(/rgba?\([^)]+\)/g), match => match[0]);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineColor: style.outlineColor,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      ringColor: style.getPropertyValue('--tw-ring-color').trim(),
      ringOffsetColor: style.getPropertyValue('--tw-ring-offset-color').trim(),
      shadow: style.boxShadow,
      shadowColors,
      controlBackground: backgrounds.color,
      parentBackground: parent.color,
      unresolvedBackgrounds: [backgrounds.unresolved, parent.unresolved].filter(Boolean),
    };
  });
}

function focusSurfaceFailures(style: Awaited<ReturnType<typeof focusWithKeyboard>>) {
  const surfaces = [style.controlBackground, style.parentBackground];
  const colors = [style.outlineColor, ...style.shadowColors];
  return surfaces.map((background, index) => ({
    adjacentSurface: index === 0 ? 'control' : 'parent',
    background: `rgba(${background.slice(0, 3).map(Math.round).join(', ')}, ${background[3]})`,
    indicators: colors.map(color => ({ color, contrast: contrastRatio(color, `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`) })),
    maxContrast: Math.max(...colors.map(color => contrastRatio(color, `rgb(${background.slice(0, 3).map(Math.round).join(', ')})`) ?? 0)),
  })).filter(surface => surface.maxContrast < 3);
}

function focusPainted(style: Awaited<ReturnType<typeof focusWithKeyboard>>, requireShadow = true) {
  return style.focusVisible && Number.parseFloat(style.outlineWidth) >= 2 &&
    (!requireShadow || (style.shadow !== 'none' && style.shadowColors.length > 0)) &&
    style.unresolvedBackgrounds.length === 0;
}

export async function renderSharedActionKeyboardFocus(page: Page, darkMode: boolean) {
  const { unhandled } = await setup(page, darkMode);
  await page.goto('/#/admin/settings');
  await expect(page.getByRole('tab', { name: 'Access Control', exact: true })).toBeVisible();
  const globalFocus = await focusWithKeyboard(page, page.getByRole('tab', { name: 'Access Control', exact: true }));
  const globalFailures = focusSurfaceFailures(globalFocus);
  await page.goto('/#/admin/agent-wallets');
  await expect(page.getByRole('heading', { name: 'Agent Wallets', exact: true })).toBeVisible();
  const link = page.getByRole('link', { name: 'Add Agent Wallet', exact: true });
  const button = page.getByRole('button', { name: 'Refresh', exact: true });
  const failures: unknown[] = [];
  if (!focusPainted(globalFocus, false) || globalFailures.length > 0) failures.push({ name: 'global raw focus outline', style: globalFocus, surfaceFailures: globalFailures });
  for (const [name, control] of [['LinkButton primary', link], ['Button secondary', button]] as const) {
    const style = await focusWithKeyboard(page, control);
    const surfaceFailures = focusSurfaceFailures(style);
    if (!focusPainted(style) || surfaceFailures.length > 0) {
      failures.push({ name, style, surfaceFailures });
    }
  }
  expect({ focusFailures: failures, unhandled }).toEqual({ focusFailures: [], unhandled: [] });
}

export async function renderAllPaletteSharedActionFocus(page: Page, darkMode: boolean) {
  const { unhandled } = await setup(page, darkMode);
  await page.goto('/#/settings');
  await settle(page);
  await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await settle(page);
  await expect(page.getByRole('heading', { name: 'Color Theme', exact: true })).toBeVisible();
  const themeCard = page.getByRole('heading', { name: 'Color Theme', exact: true }).locator('xpath=../..');
  const themeNames = (await themeCard.getByRole('button').allTextContents()).map(name => name.trim()).filter(Boolean);
  const themeIdsByName: Record<string, string> = {
    Sanctuary: 'sanctuary', Serenity: 'serenity', Forest: 'forest', Cyber: 'cyber',
    'Sun+rise/set': 'sunrise', Ocean: 'ocean', Sakura: 'sakura',
    'Sakura Yoshino': 'sakura-yoshino', 'Sakura Sumi-e': 'sakura-sumie',
    Midnight: 'midnight', 'Bamboo Zen': 'bamboo', 'Copper Patina': 'copper',
    'Desert Canyon': 'desert', Seasonal: 'seasonal',
  };
  const orderedThemeNames = ['Cyber', ...themeNames.filter(name => name !== 'Cyber')];
  const focusFailures: unknown[] = [];
  const appliedThemeIds = new Set<string>();
  let previousThemeClass = await page.locator('body').evaluate(element => Array.from(element.classList).find(name => name.startsWith('theme-')) ?? '');
  for (const themeName of orderedThemeNames) {
    const themeId = themeIdsByName[themeName];
    expect(themeId, `theme registry mapping for ${themeName}`).toBeTruthy();
    await themeCard.getByRole('button', { name: themeName, exact: true }).click();
    await expect(themeCard.getByRole('button', { name: themeName, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await waitForThemeUtilityPaint(page);
    await expect.poll(() => page.locator('body').evaluate(element => Array.from(element.classList).find(name => name.startsWith('theme-')) ?? '')).toBe(`theme-${themeId}`);
    const themeClass = `theme-${themeId}`;
    if (themeClass === previousThemeClass) focusFailures.push({ themeName, themeClass, name: 'theme selection did not change the applied theme' });
    previousThemeClass = themeClass;
    appliedThemeIds.add(themeId);
    await page.waitForTimeout(700);
    await page.goto('/#/admin/settings');
    await settle(page);
    await expect(page.getByRole('tab', { name: 'Access Control', exact: true })).toBeVisible();
    const rawFocus = await focusWithKeyboard(page, page.getByRole('tab', { name: 'Access Control', exact: true }));
    const rawFailures = focusSurfaceFailures(rawFocus);
    if (!focusPainted(rawFocus) || rawFailures.length > 0) focusFailures.push({ themeName, themeClass, darkMode, name: 'global raw focus', style: rawFocus, surfaceFailures: rawFailures });
    await page.goto('/#/admin/agent-wallets');
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Agent Wallets', exact: true })).toBeVisible();
    for (const [name, control] of [
      ['LinkButton primary', page.getByRole('link', { name: 'Add Agent Wallet', exact: true })],
      ['Button secondary', page.getByRole('button', { name: 'Refresh', exact: true })],
    ] as const) {
      const style = await focusWithKeyboard(page, control);
      const surfaceFailures = focusSurfaceFailures(style);
      if (!focusPainted(style) || surfaceFailures.length > 0) {
        focusFailures.push({ themeName, darkMode, name, style, surfaceFailures });
      }
    }
    await page.goto('/#/settings');
    await settle(page);
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await settle(page);
    await expect(page.getByRole('heading', { name: 'Color Theme', exact: true })).toBeVisible();
  }
  expect({ themeCount: themeNames.length, appliedThemeCount: appliedThemeIds.size, focusFailures, unhandled }).toEqual({ themeCount: 14, appliedThemeCount: 14, focusFailures: [], unhandled: [] });
}
