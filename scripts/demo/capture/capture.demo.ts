import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type APIRequestContext, type Page } from '@playwright/test';
import { csrfHeader, loadDemoCaptureEnv, repoRoot } from './demoEnv';
import { applyFundedOverlay, type FundedOverlay } from './overlays';

interface Shot {
  name: string;
  route: string;
  overlay?: string;
  click?: string;
}

interface ShotManifest {
  overlays: Record<string, FundedOverlay>;
  shots: Shot[];
}

const manifest: ShotManifest = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots.json'), 'utf8'));
const env = loadDemoCaptureEnv();
const SETTLE_MS = 1_500;

const seedManifest: { demoUser: { preferences: { darkMode: boolean } } } = JSON.parse(
  readFileSync(path.join(repoRoot, 'scripts/demo/manifest.json'), 'utf8'),
);

/** Theme is a per-user preference in Sanctuary, not prefers-color-scheme. */
async function setDarkMode(request: APIRequestContext, darkMode: boolean): Promise<void> {
  const response = await request.patch('/api/v1/auth/me/preferences', {
    data: { darkMode },
    headers: await csrfHeader(request),
  });
  if (!response.ok()) throw new Error(`preference update failed: ${response.status()} ${await response.text()}`);
}

let ownedWalletIds: Promise<Map<string, string>> | undefined;

/** Seeded wallet name → id, for wallets the demo login owns. Fetched once per worker. */
function walletIdsByName(request: APIRequestContext): Promise<Map<string, string>> {
  ownedWalletIds ??= (async () => {
    const response = await request.get('/api/v1/wallets');
    if (!response.ok()) throw new Error(`GET /wallets failed: ${response.status()}`);
    const wallets: Array<{ id: string; name: string; userRole: string }> = await response.json();
    return new Map(wallets.filter((w) => w.userRole === 'owner').map((w) => [w.name, w.id]));
  })();
  return ownedWalletIds;
}

async function resolveRoute(request: APIRequestContext, route: string): Promise<string> {
  const refs = [...route.matchAll(/\{wallet:([^}]+)\}/g)];
  if (refs.length === 0) return route;
  const ids = await walletIdsByName(request);
  return refs.reduce((resolved, [token, name]) => {
    const id = ids.get(name);
    if (!id) throw new Error(`wallet "${name}" not found; run npm run demo:seed`);
    return resolved.replace(token, id);
  }, route);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
}

for (const shot of manifest.shots) {
  test(shot.name, async ({ page }, testInfo) => {
    const dark = testInfo.project.name === 'dark';
    await setDarkMode(page.request, dark);
    if (shot.overlay) {
      const overlay = manifest.overlays[shot.overlay];
      if (!overlay) throw new Error(`unknown overlay "${shot.overlay}" in shot ${shot.name}`);
      await applyFundedOverlay(page, overlay);
    }

    await page.goto(`/#${await resolveRoute(page.request, shot.route)}`);
    await settle(page);
    if (shot.click) {
      await page.getByRole('tab', { name: shot.click }).or(page.getByRole('button', { name: shot.click })).first().click();
      await settle(page);
    }

    mkdirSync(env.outputDir, { recursive: true });
    // Dark is the default image; light is the <picture> alternate.
    const file = dark ? `${shot.name}.png` : `${shot.name}-light.png`;
    await page.screenshot({ path: path.join(env.outputDir, file), animations: 'disabled' });
  });
}

test.afterAll(async ({ request }) => {
  // Leave the demo account in its seeded theme for people exploring by hand.
  await setDarkMode(request, seedManifest.demoUser.preferences.darkMode);
});
