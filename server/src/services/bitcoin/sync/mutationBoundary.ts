import type { PrismaTxClient } from '../../../models/prisma';
import {
  withWalletSyncMutationLock,
  withWalletSyncMutationFence,
} from '../../../repositories/syncIntentRepository';
import type { SyncContext } from './types';

export type WalletSyncMutationUnit =
  | 'rbf_cleanup'
  | 'repair_attempt_cursors'
  | 'transaction_batch'
  | 'transaction_labels'
  | 'transaction_io_repair'
  | 'balance_recalculation'
  | 'utxo_reconciliation'
  | 'utxo_insert'
  | 'address_usage'
  | 'gap_limit_expansion'
  | 'ownership_repair'
  | 'consolidation_repair'
  | 'missing_field_chunk';

type PostCommitEffect = () => void | Promise<void>;
type DeferPostCommit = (effect: PostCommitEffect) => void;

/**
 * Run one bounded wallet-sync mutation and release its row lock before any
 * caller resumes Electrum work. Canonical generation-bound work validates the
 * exact immutable fence and a real explicit transaction client. Compatibility
 * callers retain their pre-fence repository behavior with no lease authority
 * or stale-owner protection. They therefore cannot participate in expired-
 * lease reclaim and must disappear at the later producer cutover.
 */
export async function runWalletSyncMutation<T>(
  ctx: Pick<SyncContext, 'walletId' | 'mutationFence' | 'attemptRuntime'>,
  unit: WalletSyncMutationUnit,
  callback: (
    tx: PrismaTxClient | undefined,
    deferPostCommit: DeferPostCommit,
  ) => Promise<T>,
  assertAuthority: () => void = () => undefined,
  serializeUnfenced = false,
): Promise<T> {
  if (ctx.mutationFence && ctx.mutationFence.walletId !== ctx.walletId) {
    throw new Error(`Wallet sync ${unit} fence does not match the mutation target wallet`);
  }
  const effects: PostCommitEffect[] = [];
  const deferPostCommit: DeferPostCommit = effect => {
    effects.push(effect);
  };
  const assertActive = (): void => {
    ctx.attemptRuntime?.signal.throwIfAborted();
    assertAuthority();
  };
  const execute = (tx: PrismaTxClient): Promise<T> => {
    assertActive();
    return callback(tx, deferPostCommit);
  };
  const executeUnfenced = (): Promise<T> => {
    assertActive();
    return callback(undefined, deferPostCommit);
  };
  const result = ctx.mutationFence
    ? await withWalletSyncMutationFence(ctx.mutationFence, execute)
    : serializeUnfenced && ctx.walletId
      ? await withWalletSyncMutationLock(
          ctx.walletId,
          assertActive,
          tx => callback(tx, deferPostCommit),
        )
      : await executeUnfenced();

  for (const effect of effects) {
    ctx.attemptRuntime?.signal.throwIfAborted();
    await effect();
  }
  return result;
}
