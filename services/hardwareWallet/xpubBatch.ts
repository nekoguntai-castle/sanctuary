import type { StandardXpubResult, XpubBatchResult } from "./service";

type ProgressCallback = (current: number, total: number, name: string) => void;

export interface StandardXpubBatchService {
  getAllXpubs(onProgress?: ProgressCallback): Promise<StandardXpubResult[]>;
  getAllXpubsWithFailures?(
    onProgress?: ProgressCallback,
  ): Promise<XpubBatchResult>;
}

/**
 * Fetch standard xpubs while preserving partial failures when the adapter can
 * report them. Older adapters still return an all-success batch.
 */
export async function fetchStandardXpubBatch(
  service: StandardXpubBatchService,
  onProgress?: ProgressCallback,
): Promise<XpubBatchResult> {
  if (service.getAllXpubsWithFailures) {
    return service.getAllXpubsWithFailures(onProgress);
  }

  const results = await service.getAllXpubs(onProgress);
  return { results, failures: [], totalPaths: results.length };
}
