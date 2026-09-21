// Shared by Wallet Detail data and mutations for one wallet and user, across
// network route changes and hook remounts. Reads spanning a rename cannot
// commit an older HTTP name over the optimistic or confirmed name.
interface WalletRenameEpoch {
  generation: number;
  pendingWrites: number;
  activeReads: number;
  drainListeners: Set<() => void>;
}

const epochs = new Map<string, WalletRenameEpoch>();

function getEpoch(key: string): WalletRenameEpoch {
  let epoch = epochs.get(key);
  if (!epoch) {
    epoch = { generation: 0, pendingWrites: 0, activeReads: 0, drainListeners: new Set() };
    epochs.set(key, epoch);
  }
  return epoch;
}

function releaseIdleEpoch(key: string, epoch: WalletRenameEpoch): void {
  if (epoch.pendingWrites || epoch.activeReads || epoch.drainListeners.size) return;
  if (epochs.get(key) === epoch) epochs.delete(key);
}

export interface WalletNameRead {
  canCommit: () => boolean;
  release: () => void;
}

export function releaseWalletNameReads(reads: Set<WalletNameRead>): void {
  for (const read of reads) read.release();
  reads.clear();
}

/** Capture a GET lifetime; release it after commit or discard. */
export function captureWalletNameRead(key: string): WalletNameRead {
  const epoch = getEpoch(key);
  const generation = epoch.generation;
  epoch.activeReads += 1;
  let released = false;
  return {
    canCommit: () => epochs.get(key) === epoch
      && epoch.generation === generation
      && epoch.pendingWrites === 0,
    release: () => {
      if (released) return;
      released = true;
      epoch.activeReads -= 1;
      releaseIdleEpoch(key, epoch);
    },
  };
}

/** Register an accepted PATCH; always call the returned finish callback. */
export function beginWalletRenameWrite(key: string): () => void {
  const epoch = getEpoch(key);
  // Beginning a write invalidates reads already in flight. The final drain
  // advances again so reads started while writes were pending stay invalid.
  epoch.generation += 1;
  epoch.pendingWrites += 1;
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    epoch.pendingWrites -= 1;
    if (epoch.pendingWrites === 0) {
      epoch.generation += 1;
      for (const listener of epoch.drainListeners) listener();
    }
    releaseIdleEpoch(key, epoch);
  };
}

/** Notify a mounted owner once its last accepted write settles. */
export function subscribeWalletRenameDrain(key: string, listener: () => void): () => void {
  const epoch = getEpoch(key);
  epoch.drainListeners.add(listener);
  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    epoch.drainListeners.delete(listener);
    releaseIdleEpoch(key, epoch);
  };
}
