import type { StandardXpubResult, XpubBatchResult } from "./service";
import { validateXpubBatch } from "./identity";

type ProgressCallback = (current: number, total: number, name: string) => void;

export interface StandardXpubBatchService {
  getAllXpubs(onProgress?: ProgressCallback): Promise<StandardXpubResult[]>;
  getAllXpubsWithFailures?(
    onProgress?: ProgressCallback,
  ): Promise<XpubBatchResult>;
}

export interface XpubBatchIdentityEvidence {
  connectedFingerprint: unknown;
  storedFingerprint?: unknown;
}

/**
 * Fetch standard xpubs while preserving partial failures when the adapter can
 * report them. Older adapters still return an all-success batch.
 */
export async function fetchStandardXpubBatch(
  service: StandardXpubBatchService,
  onProgress: ProgressCallback | undefined,
  identity: XpubBatchIdentityEvidence,
): Promise<XpubBatchResult> {
  let batch: XpubBatchResult;
  if (service.getAllXpubsWithFailures) {
    batch = await service.getAllXpubsWithFailures(onProgress);
  } else {
    const results = await service.getAllXpubs(onProgress);
    batch = { results, failures: [], totalPaths: results.length };
  }

  const validated = validateXpubBatch(
    batch.results,
    identity.connectedFingerprint,
    identity.storedFingerprint,
  );
  return { ...batch, results: validated.results };
}
