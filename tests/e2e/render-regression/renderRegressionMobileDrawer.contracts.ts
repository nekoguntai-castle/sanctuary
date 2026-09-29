import { expect, type Page, type Route } from '@playwright/test';
import { ADMIN_USER, mockAuthenticatedApi } from './renderRegressionHarness';
import { json, registerStrictApiRoutes } from '../helpers';

function apiPathname(route: Route): string {
  return new URL(route.request().url()).pathname.replace(/^\/api\/v1(?=\/|$)/, '');
}

async function enterDashboard(page: Page, width: number, darkMode: boolean, withDraftAction = false) {
  const initialPreferences = { ...ADMIN_USER.preferences, darkMode, theme: 'sanctuary' };
  const unhandled = await mockAuthenticatedApi(page, {
    failures: {
      'GET /auth/me': { status: 200, body: { ...ADMIN_USER, preferences: initialPreferences } },
    },
  });
  await page.routeWebSocket('**/*', (socket) => socket.close());
  if (withDraftAction) {
    await registerStrictApiRoutes(page, (route) => {
      if (route.request().method() !== 'GET' || !/^\/wallets\/[^/]+\/drafts$/.test(apiPathname(route))) {
        return route.fallback();
      }
      return json(route, [{
        id: 'notification-draft-1',
        walletId: 'wallet-mainnet-1',
        psbtBase64: 'cHNidP8=',
        amount: 1,
        feeRate: 1,
        fee: 1,
        totalInput: 1,
        totalOutput: 1,
        changeAmount: 0,
        status: 'unsigned',
        signedDeviceIds: [],
      }]);
    });
  }
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/#/');
  await page.getByRole('heading', { name: /dashboard/i }).waitFor();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
  return unhandled;
}

async function openDrawer(page: Page) {
  const trigger = page.locator('button[aria-controls="mobile-sidebar-dialog"]');
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Main navigation' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  return { dialog, trigger, panel: page.getByTestId('mobile-sidebar-panel') };
}

export async function renderMobileDrawerKeyboardLifecycle(
  page: Page,
  darkMode: boolean,
  width: number,
) {
  const unhandled = await enterDashboard(page, width, darkMode);
  const { dialog, trigger, panel } = await openDrawer(page);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger).toHaveAttribute('aria-controls', 'mobile-sidebar-dialog');
  const focusTrace: Array<Record<string, string | number | boolean | null>> = [];
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press('Tab');
    const observation = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? null,
        id: active instanceof HTMLElement ? active.id : null,
        label: active instanceof HTMLElement ? active.getAttribute('aria-label') : null,
        text: active?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 70) ?? null,
        documentHasFocus: document.hasFocus(),
        insideDialog: !!active?.closest('dialog[aria-label="Main navigation"]'),
        insidePanel: !!active?.closest('[data-testid="mobile-sidebar-panel"]'),
        dialogOpen: document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')?.open ?? false,
        dialogModal: document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')?.matches(':modal') ?? false,
        dialogDisplay: document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')
          ? getComputedStyle(document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')!).display
          : null,
      };
    });
    focusTrace.push({ key: 'Tab', index: index + 1, ...observation });
  }
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Shift+Tab');
    const observation = await page.evaluate(() => {
      const active = document.activeElement;
      return {
        tag: active?.tagName ?? null,
        id: active instanceof HTMLElement ? active.id : null,
        label: active instanceof HTMLElement ? active.getAttribute('aria-label') : null,
        text: active?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 70) ?? null,
        documentHasFocus: document.hasFocus(),
        insideDialog: !!active?.closest('dialog[aria-label="Main navigation"]'),
        insidePanel: !!active?.closest('[data-testid="mobile-sidebar-panel"]'),
        dialogOpen: document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')?.open ?? false,
        dialogModal: document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')?.matches(':modal') ?? false,
        dialogDisplay: document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')
          ? getComputedStyle(document.querySelector<HTMLDialogElement>('dialog[aria-label="Main navigation"]')!).display
          : null,
      };
    });
    focusTrace.push({ key: 'Shift+Tab', index: index + 1, ...observation });
  }
  expect(focusTrace.every((observation) => observation.insidePanel
    || (observation.tag === 'BODY' && observation.documentHasFocus === false)),
    `Tab focus trace: ${JSON.stringify(focusTrace)}`).toBe(true);
  const backgroundStayedInert = await page.evaluate(() => {
    const mainControl = document.querySelector<HTMLElement>('main button, main a');
    const dialogElement = document.querySelector('dialog[aria-label="Main navigation"]');
    mainControl?.focus();
    return !!document.activeElement?.closest('dialog[aria-label="Main navigation"]')
      && !!dialogElement?.matches(':modal');
  });
  expect(backgroundStayedInert).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await expect.poll(() => unhandled).toEqual([]);
}

export async function renderMobileDrawerClosePaths(page: Page, darkMode: boolean, width: number) {
  const unhandled = await enterDashboard(page, width, darkMode);
  let { dialog, trigger } = await openDrawer(page);
  await page.getByRole('button', { name: 'Close navigation' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  ({ dialog, trigger } = await openDrawer(page));
  if (width > 320) {
    await page.mouse.click(width - 5, 120);
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  }
  await expect.poll(() => unhandled).toEqual([]);
}

export async function renderMobileDrawerNavigationFocus(page: Page, darkMode: boolean, width: number) {
  const unhandled = await enterDashboard(page, width, darkMode);
  await openDrawer(page);
  await page.getByRole('link', { name: 'Wallets' }).click();
  await expect(page).toHaveURL(/#\/wallets$/);
  await expect(page.getByRole('main')).toBeFocused();
  await expect.poll(() => unhandled).toEqual([]);
}

export async function renderMobileDrawerSiblingDialogs(page: Page, darkMode: boolean) {
  const unhandled = await enterDashboard(page, 390, darkMode);
  let { dialog } = await openDrawer(page);
  await page.getByRole('button', { name: 'Show keyboard shortcuts' }).click();
  await expect(dialog).toBeHidden();
  const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await expect(shortcuts).toBeVisible();
  await expect(shortcuts.getByRole('button', { name: 'Close keyboard shortcuts' })).toBeFocused();
  await page.getByRole('button', { name: 'Close keyboard shortcuts' }).click();
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeFocused();

  ({ dialog } = await openDrawer(page));
  await page.locator('[data-testid="mobile-sidebar-panel"] button[title="Version info & support"]').click();
  await expect(dialog).toBeHidden();
  const about = page.getByRole('dialog', { name: 'About Sanctuary' });
  await expect(about).toBeVisible();
  await expect(about.getByRole('button', { name: 'Close about' })).toBeFocused();
  await page.getByRole('button', { name: 'Close about' }).click();
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeFocused();
  await expect.poll(() => unhandled).toEqual([]);
}

export async function renderMobileDrawerNotificationsRemainInline(page: Page, darkMode: boolean) {
  const unhandled = await enterDashboard(page, 390, darkMode, true);
  const { dialog } = await openDrawer(page);
  await page.locator('[data-testid="mobile-sidebar-panel"] [title="Notifications"]').click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
  const mainnetDraft = page.getByText('Render Main Wallet: Resume or broadcast').locator('xpath=../../..');
  await expect(page.getByRole('heading', { name: 'Notifications', includeHidden: true })).toHaveCount(1);
  await mainnetDraft.getByRole('button', { name: 'View Drafts' }).click();
  await expect(page).toHaveURL(/#\/wallets\/wallet-mainnet-1$/);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('main')).toBeFocused();
  await expect.poll(() => unhandled).toEqual([]);
}

export async function renderMobileDrawerResizeCleanup(page: Page, darkMode: boolean) {
  const unhandled = await enterDashboard(page, 390, darkMode);
  const { dialog } = await openDrawer(page);
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('link', { name: 'Wallets' }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Wallets' }).first().click();
  await expect(page).toHaveURL(/#\/wallets$/);
  await expect.poll(() => unhandled).toEqual([]);
}
