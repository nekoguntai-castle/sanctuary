/**
 * Transactions API - UTXO Operations
 *
 * UTXO listing, freezing, selection, and strategy comparison
 */

import apiClient from '../client';
import type {
  GetUTXOsResponse,
  GetUTXOsParams,
  FreezeUTXOResponse,
  SelectUtxosRequest,
  SelectionResult,
  RecommendedStrategyResponse,
  SelectionStrategy,
} from './types';
import { GetUtxosResponseSchema } from '@sanctuary/shared/schemas/walletResponses';

// ========================================
// UTXO LISTING & MANAGEMENT
// ========================================

/**
 * Get UTXOs for a wallet
 */
export async function getUTXOs(
  walletId: string,
  params?: GetUTXOsParams
): Promise<GetUTXOsResponse> {
  return apiClient.get<GetUTXOsResponse>(
    `/wallets/${walletId}/utxos`,
    params as Record<string, string | number | boolean | string[] | undefined | null> | undefined,
    undefined,
    // `.utxos` is spread straight into `.map` by walletDataLoaders and the send
    // page, and `Number(amount)` turns a null into 0 — a UTXO dropped from coin
    // selection with nothing said.
    { schema: GetUtxosResponseSchema },
  );
}

// The server caps a UTXO page at 1000 rows (validatePagination).
const UTXO_PAGE_SIZE = 1000;
// Safety stop at 100,000 UTXOs; real wallets are far below this.
const MAX_UTXO_PAGES = 100;

/**
 * Get every UTXO for a wallet by paging.
 *
 * An unpaged request is capped at one server page, which would hide UTXOs from
 * coin selection and balance stats. The reported `count` is not a stop
 * condition because it can lag the rows. `count` and `totalBalance` come from
 * the first page. Any failed page, or reaching the safety cap, rejects the
 * whole call so callers never get a partial set.
 */
export async function getAllUTXOs(walletId: string): Promise<GetUTXOsResponse> {
  const first = await getUTXOs(walletId, { limit: UTXO_PAGE_SIZE, offset: 0 });
  const seen = new Set<string>();
  const utxos: GetUTXOsResponse['utxos'] = [];
  const collect = (page: GetUTXOsResponse): number => {
    const before = utxos.length;
    for (const utxo of page.utxos) {
      const key = utxo.id ?? `${utxo.txid}:${utxo.vout}`;
      if (!seen.has(key)) {
        seen.add(key);
        utxos.push(utxo);
      }
    }
    return utxos.length - before;
  };

  collect(first);
  let page = first;
  for (let pageIndex = 1; page.utxos.length >= UTXO_PAGE_SIZE; pageIndex++) {
    if (pageIndex >= MAX_UTXO_PAGES) {
      throw new Error(`Wallet has at least ${MAX_UTXO_PAGES * UTXO_PAGE_SIZE} UTXOs; loading more is not supported`);
    }
    page = await getUTXOs(walletId, { limit: UTXO_PAGE_SIZE, offset: pageIndex * UTXO_PAGE_SIZE });
    // A full page with nothing new means the server ignored the offset.
    if (collect(page) === 0) break;
  }

  return { utxos, count: first.count, totalBalance: first.totalBalance };
}

/**
 * Toggle UTXO frozen status
 */
export async function freezeUTXO(utxoId: string, frozen: boolean): Promise<FreezeUTXOResponse> {
  return apiClient.patch<FreezeUTXOResponse>(`/utxos/${utxoId}/freeze`, { frozen });
}

// ========================================
// UTXO SELECTION
// ========================================

/**
 * Select UTXOs for a transaction using specified strategy
 */
export async function selectUtxos(
  walletId: string,
  request: SelectUtxosRequest
): Promise<SelectionResult> {
  return apiClient.post<SelectionResult>(`/wallets/${walletId}/utxos/select`, request);
}

/**
 * Compare different UTXO selection strategies for a given amount
 */
export async function compareStrategies(
  walletId: string,
  amount: number,
  feeRate: number,
  scriptType?: string
): Promise<Record<SelectionStrategy, SelectionResult>> {
  return apiClient.post<Record<SelectionStrategy, SelectionResult>>(
    `/wallets/${walletId}/utxos/compare-strategies`,
    { amount, feeRate, scriptType }
  );
}

/**
 * Get recommended UTXO selection strategy based on context
 */
export async function getRecommendedStrategy(
  walletId: string,
  feeRate: number,
  prioritizePrivacy?: boolean
): Promise<RecommendedStrategyResponse> {
  const params: Record<string, string> = { feeRate: String(feeRate) };
  if (prioritizePrivacy) {
    params.prioritizePrivacy = 'true';
  }
  return apiClient.get<RecommendedStrategyResponse>(
    `/wallets/${walletId}/utxos/recommended-strategy`,
    params
  );
}
