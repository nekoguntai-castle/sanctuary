/**
 * Drafts Collector
 *
 * Draft transaction and UTXO-lock state. The oldest lock age is
 * especially useful — long-lived locks are the fingerprint of a stuck
 * draft that's preventing UTXO reuse.
 */

import { draftRepository, draftLockRepository } from '../../../repositories';
import { getErrorMessage } from '../../../utils/errors';
import { registerCollector } from './registry';

registerCollector('drafts', async () => {
  try {
    const now = new Date();
    const [drafts, locks] = await Promise.all([
      draftRepository.getSupportStats(now),
      draftLockRepository.getSupportStats(now),
    ]);
    return { drafts, locks };
  } catch (error) {
    return { error: getErrorMessage(error) };
  }
});
