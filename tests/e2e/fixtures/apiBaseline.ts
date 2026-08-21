import type { ApiResponseMap, MockApiResponse } from '../apiSimulator';
import { emptyBalanceHistory } from './balanceHistory';

export const BASELINE_API_KEYS = {
  registrationStatus: 'GET /auth/registration-status',
  devices: 'GET /devices',
  health: 'GET /health',
  price: 'GET /price',
  priceProviders: 'GET /price/providers',
  priceProviderStatus: 'GET /price/providers/status',
  bitcoinStatus: 'GET /bitcoin/status',
  bitcoinFees: 'GET /bitcoin/fees',
  bitcoinMempool: 'GET /bitcoin/mempool',
  adminVersion: 'GET /admin/version',
  recentTransactions: 'GET /transactions/recent',
  activitySummary: 'GET /transactions/activity-summary',
  balanceHistory: 'GET /transactions/balance-history',
  aiStatus: 'GET /ai/status',
  intelligenceStatus: 'GET /intelligence/status',
} as const;

export type BaselineApiKey = typeof BASELINE_API_KEYS[keyof typeof BASELINE_API_KEYS];

const PRICE_PROVIDER_INFOS = [
  {
    name: 'mempool', priority: 100,
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
    enabled: true,
  },
  {
    name: 'coingecko', priority: 90,
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'CNY', 'KRW', 'INR'],
    enabled: true,
  },
  {
    name: 'kraken', priority: 80,
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
    enabled: true,
  },
  {
    name: 'coinbase', priority: 70,
    supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD'],
    enabled: true,
  },
  {
    name: 'binance', priority: 60,
    supportedCurrencies: ['USD', 'EUR', 'GBP'],
    enabled: false,
  },
] as const;

const enabledPriceProviders = PRICE_PROVIDER_INFOS
  .filter(provider => provider.enabled)
  .map(provider => provider.name);

const response = (body: unknown, status?: number): MockApiResponse => ({ body, status });

const DEFAULT_BASELINE_RESPONSES: Readonly<Record<BaselineApiKey, MockApiResponse>> = {
  [BASELINE_API_KEYS.registrationStatus]: response({ enabled: false }),
  [BASELINE_API_KEYS.devices]: response([]),
  [BASELINE_API_KEYS.health]: response({ status: 'ok' }),
  [BASELINE_API_KEYS.price]: response({
    price: 0, currency: 'USD', sources: [], median: 0, average: 0,
    timestamp: '2026-08-20T00:00:00.000Z', cached: true, change24h: 0,
  }),
  [BASELINE_API_KEYS.priceProviders]: response({
    providers: enabledPriceProviders,
    count: enabledPriceProviders.length,
  }),
  [BASELINE_API_KEYS.priceProviderStatus]: response({
    providers: PRICE_PROVIDER_INFOS,
    count: PRICE_PROVIDER_INFOS.length,
  }),
  [BASELINE_API_KEYS.bitcoinStatus]: response({
    connected: false,
    blockHeight: 0,
    explorerUrl: 'https://mempool.space',
    confirmationThreshold: 1,
    deepConfirmationThreshold: 6,
    pool: { enabled: false },
  }),
  [BASELINE_API_KEYS.bitcoinFees]: response({ fastest: 18, halfHour: 12, hour: 8, economy: 3 }),
  [BASELINE_API_KEYS.bitcoinMempool]: response({
    mempool: [], blocks: [],
    mempoolInfo: { count: 0, size: 0, totalFees: 0 },
    queuedBlocksSummary: null,
  }),
  [BASELINE_API_KEYS.adminVersion]: response({
    updateAvailable: false,
    currentVersion: '0.8.14',
  }),
  [BASELINE_API_KEYS.recentTransactions]: response([]),
  [BASELINE_API_KEYS.activitySummary]: response({
    count: 0, receivedSats: 0, sentSats: 0, latestAt: null,
  }),
  [BASELINE_API_KEYS.balanceHistory]: response(emptyBalanceHistory()),
  [BASELINE_API_KEYS.aiStatus]: response({
    enabled: false, available: false, proxyAvailable: false,
  }),
  [BASELINE_API_KEYS.intelligenceStatus]: response({
    available: false, ollamaConfigured: false,
  }),
};

export interface AuthenticatedApiBaselineOptions {
  include: readonly BaselineApiKey[];
  overrides?: Partial<Record<BaselineApiKey, MockApiResponse>>;
}

/** Select only endpoints the scenario intentionally permits. */
export function createAuthenticatedApiBaseline(
  options: AuthenticatedApiBaselineOptions,
): ApiResponseMap {
  return Object.fromEntries(options.include.map((requestKey) => [
    requestKey,
    options.overrides?.[requestKey] ?? DEFAULT_BASELINE_RESPONSES[requestKey],
  ]));
}

/** Compatibility response used by legacy harnesses before strict migration. */
export function getSharedApiResponse(
  method: string,
  path: string,
): MockApiResponse | null {
  const requestKey = `${method} ${path}` as BaselineApiKey;
  if (
    requestKey !== BASELINE_API_KEYS.priceProviders
    && requestKey !== BASELINE_API_KEYS.priceProviderStatus
  ) return null;
  return DEFAULT_BASELINE_RESPONSES[requestKey];
}
