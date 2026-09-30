import type { Page, Route } from '@playwright/test';

export interface FundedOverlay {
  balances: Record<string, number>;
}

interface BalancePoint {
  name: string;
  value: number;
  timestamp?: string;
}

interface WalletSummary {
  name: string;
  balance?: number;
}

const WALLET_LIST = /\/api\/v1\/wallets(?:\?.*)?$/;
const WALLET_DETAIL = /\/api\/v1\/wallets\/[0-9a-f-]{36}(?:\?.*)?$/;
const BALANCE_HISTORY = /\/api\/v1\/transactions\/balance-history(?:\?.*)?$/;
const FUNDED_POINTS = 12;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * A rising, slightly uneven curve ending at `total`, spread across the same
 * window the server reported. Every point carries a timestamp because the
 * chart places points on a real time axis (src/utils/balanceHistorySeries.ts).
 * The curve's shape is fixed, so dark and light captures of a shot match up to the
 * server's moving "now".
 */
export function fundedHistory(realPoints: readonly BalancePoint[], total: number): BalancePoint[] {
  const stamps = realPoints.map((p) => Date.parse(p.timestamp ?? '')).filter(Number.isFinite);
  const end = stamps.length > 0 ? Math.max(...stamps) : Date.now();
  const start = stamps.length > 1 ? Math.min(...stamps) : end - WEEK_MS;
  const last = FUNDED_POINTS - 1;
  return Array.from({ length: FUNDED_POINTS }, (_, i) => {
    const progress = i / last;
    const wiggle = i === last ? 0 : Math.sin(i * 1.7) * 0.03;
    return {
      name: i === 0 ? 'Start' : i === last ? 'Now' : `Step ${i}`,
      value: Math.round(total * (0.62 + 0.38 * progress * progress + wiggle)),
      timestamp: new Date(start + ((end - start) * i) / last).toISOString(),
    };
  });
}

function withBalance<T extends WalletSummary>(wallet: T, overlay: FundedOverlay): T {
  const balance = overlay.balances[wallet.name];
  return balance === undefined ? wallet : { ...wallet, balance };
}

/** Rewrites a GET's JSON body; anything unexpected passes through untouched. */
async function rewriteJson(
  route: Route,
  accepts: (body: unknown) => boolean,
  transform: (body: never) => unknown,
): Promise<void> {
  if (route.request().method() !== 'GET') return route.fallback();
  const response = await route.fetch();
  if (!response.ok()) return route.fulfill({ response });
  const body: unknown = await response.json();
  return route.fulfill({ response, json: accepts(body) ? transform(body as never) : body });
}

const isObject = (body: unknown): boolean => typeof body === 'object' && body !== null && !Array.isArray(body);

/**
 * Presents the demo wallets as funded without faking anything else: the
 * test-vector wallets are swept to ~0 by bots, which makes a poor hero shot.
 */
export async function applyFundedOverlay(page: Page, overlay: FundedOverlay): Promise<void> {
  const total = Object.values(overlay.balances).reduce((sum, sats) => sum + sats, 0);
  await page.route(WALLET_LIST, (route) =>
    rewriteJson(route, Array.isArray, (wallets: WalletSummary[]) => wallets.map((w) => withBalance(w, overlay))));
  await page.route(WALLET_DETAIL, (route) =>
    rewriteJson(route, isObject, (wallet: WalletSummary) => withBalance(wallet, overlay)));
  await page.route(BALANCE_HISTORY, (route) =>
    rewriteJson(route, Array.isArray, (points: BalancePoint[]) => fundedHistory(points, total)));
}
