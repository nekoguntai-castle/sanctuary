import type { BackendFetchResult } from "./utils";
import { fetchFromBackend } from "./utils";

export async function fetchTransactionContext(
  backendUrl: string,
  txId: string,
  authToken: string,
): Promise<BackendFetchResult<any>> {
  return fetchFromBackend(
    backendUrl,
    `/internal/ai/tx/${txId}`,
    authToken,
    "tx context",
  );
}

export async function fetchWalletLabels(
  backendUrl: string,
  walletId: string,
  authToken: string,
): Promise<BackendFetchResult<{ labels?: string[] }>> {
  return fetchFromBackend(
    backendUrl,
    `/internal/ai/wallet/${walletId}/labels`,
    authToken,
    "wallet labels",
  );
}

export async function fetchWalletContext(
  backendUrl: string,
  walletId: string,
  authToken: string,
): Promise<BackendFetchResult<any>> {
  return fetchFromBackend(
    backendUrl,
    `/internal/ai/wallet/${walletId}/context`,
    authToken,
    "wallet context",
  );
}
