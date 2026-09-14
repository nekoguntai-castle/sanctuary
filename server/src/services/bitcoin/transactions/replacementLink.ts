/**
 * RBF Replacement Linkage
 *
 * `replacesTxid` is client-supplied and untrusted on its own: it is only
 * honored when it names an existing, unconfirmed transaction on the same
 * wallet that shares at least one spent input (outpoint) with the new
 * transaction. `memo` is display text only and has no bearing on this
 * decision. See iteration-18 plan Phase 5
 * (rbf-memo-prefix-spoofs-transaction-replacement).
 *
 * Two checks share this logic but differ in what a failure means:
 *   - `assertReplacementLink` runs BEFORE anything is broadcast to the
 *     network. A bad `replacesTxid` here means nothing happened yet, so it
 *     rejects outright (throws `InvalidInputError`, mapped to 400).
 *   - `resolveReplacementLinkAfterBroadcast` runs AFTER the transaction has
 *     already been accepted by the network (inside `persistTransaction`'s
 *     database transaction). Funds have already moved, so a `replacesTxid`
 *     that no longer verifies (e.g. the original confirmed in the race
 *     between the pre-broadcast check and persistence) must never fail
 *     persistence — it only skips linkage and logs a warning.
 */
import type { PrismaTxClient } from '../../../models/prisma';
import { InvalidInputError } from '../../../errors/ApiError';
import { createLogger } from '../../../utils/logger';
import {
  findByTxid,
  findInputOutpointsByTransactionId,
  findUnconfirmedTransactionForReplacement,
  linkReplacementIfUnreplaced,
} from '../../../repositories/transactions/core';
import type { TransactionInputMetadata } from './types';

const log = createLogger('BITCOIN:SVC_TX_RBF_LINK');

type Outpoint = { txid: string; vout: number };

export interface ReplacementLink {
  originalTransactionId: string;
  inheritedLabel?: string;
}

const outpointKey = (outpoint: Outpoint): string => `${outpoint.txid}:${outpoint.vout}`;

// BIP 125 rule 2: a valid replacement must spend at least one of the same
// inputs as the transaction it replaces. An original recorded with no
// TransactionInput rows (e.g. persisted before input metadata was captured)
// has nothing to share by definition, so it is correctly treated as
// unverifiable here rather than specially exempted.
const sharesAnyInput = (candidates: Outpoint[], originalOutpoints: Outpoint[]): boolean => {
  const originalKeys = new Set(originalOutpoints.map(outpointKey));
  return candidates.some(candidate => originalKeys.has(outpointKey(candidate)));
};

/** Prefer the fully-detailed input list when present; fall back to the bare UTXO outpoints. */
export const selectCandidateOutpoints = (
  inputs: TransactionInputMetadata[] | undefined,
  utxos: Outpoint[]
): Outpoint[] => (inputs && inputs.length > 0 ? inputs : utxos);

const findVerifiedReplacement = async (
  walletId: string,
  replacesTxid: string,
  candidateOutpoints: Outpoint[],
  client: PrismaTxClient | undefined
): Promise<{ id: string; label: string | null } | null> => {
  const original = await findUnconfirmedTransactionForReplacement(replacesTxid, walletId, client);
  if (!original) return null;

  const originalOutpoints = await findInputOutpointsByTransactionId(original.id, client);
  if (!sharesAnyInput(candidateOutpoints, originalOutpoints)) return null;

  return original;
};

/**
 * Pre-broadcast gate. Call before any network submission or lease claim.
 * Throws `InvalidInputError` (400) when `replacesTxid` does not name a
 * verifiable replacement target; nothing has been broadcast at this point.
 */
export async function assertReplacementLink(
  walletId: string,
  replacesTxid: string,
  candidateOutpoints: Outpoint[],
  client?: PrismaTxClient
): Promise<void> {
  const original = await findVerifiedReplacement(walletId, replacesTxid, candidateOutpoints, client);
  if (original) return;

  // `findVerifiedReplacement` excludes an already-replaced original along
  // with confirmed/unknown ones, so a null result alone cannot tell those
  // apart. Look the txid up directly (ignoring the unconfirmed/replacement
  // filters) to give a precise, actionable error rather than the generic
  // "no match" message when the original is specifically already replaced.
  const existing = await findByTxid(replacesTxid, walletId, {
    select: { rbfStatus: true, replacedByTxid: true },
  });
  if (existing && (existing.rbfStatus === 'replaced' || existing.replacedByTxid !== null)) {
    throw new InvalidInputError('transaction was already replaced', 'replacesTxid');
  }

  throw new InvalidInputError(
    'replacesTxid does not match an unconfirmed transaction sharing an input',
    'replacesTxid'
  );
}

/**
 * Post-broadcast resolution, run inside `persistTransaction`'s database
 * transaction. Never throws: the broadcast already happened, so a stale or
 * invalidated `replacesTxid` only skips linkage (logged at warn) rather
 * than failing persistence of an already-accepted transaction.
 */
export async function resolveReplacementLinkAfterBroadcast(
  walletId: string,
  newTxid: string,
  replacesTxid: string | undefined,
  candidateOutpoints: Outpoint[],
  client: PrismaTxClient
): Promise<ReplacementLink | undefined> {
  if (!replacesTxid) return undefined;

  const original = await findVerifiedReplacement(walletId, replacesTxid, candidateOutpoints, client);
  if (!original) {
    log.warn('Skipping RBF replacement link: replacesTxid no longer verifies against an unconfirmed transaction sharing an input', {
      txid: newTxid,
      replacesTxid,
    });
    return undefined;
  }

  // Compare-and-swap: `findVerifiedReplacement` read the original as not
  // yet replaced, but a concurrent broadcast could have linked a different
  // replacement to it in the window between that read and this write. The
  // conditional `updateMany` only commits the link when the original is
  // still unreplaced at write time; a zero-row result means another
  // broadcast won the race, so this transaction must persist unlinked
  // rather than clobber the other link.
  const linked = await linkReplacementIfUnreplaced(original.id, newTxid, client);
  if (!linked) {
    log.warn('Skipping RBF replacement link: original was already replaced by a concurrent broadcast', {
      txid: newTxid,
      replacesTxid,
      originalTransactionId: original.id,
    });
    return undefined;
  }

  return { originalTransactionId: original.id, inheritedLabel: original.label ?? undefined };
}
