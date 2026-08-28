import type { NetworkState } from './types';

export interface BufferedAddressActivity {
  scriptHash: string;
  address?: string;
  status: string | null;
  sequence?: number;
}

interface BaselineBarrier {
  holders: number;
  buffered: BufferedAddressActivity | null;
  latestResponseSequence: number;
}

interface BaselineToken {
  state: NetworkState;
  addresses: string[];
  released: boolean;
  releaseOperation?: () => void;
}

const barriersByState = new WeakMap<NetworkState, Map<string, BaselineBarrier>>();
const tokensByStatuses = new WeakMap<Map<string, string | null>, BaselineToken>();

function stateBarriers(state: NetworkState): Map<string, BaselineBarrier> {
  const existing = barriersByState.get(state);
  if (existing) return existing;
  const created = new Map<string, BaselineBarrier>();
  barriersByState.set(state, created);
  return created;
}

export function beginSubscriptionBaseline(
  state: NetworkState,
  addresses: string[],
): BaselineToken {
  const uniqueAddresses = [...new Set(addresses)];
  const barriers = stateBarriers(state);
  for (const address of uniqueAddresses) {
    const barrier = barriers.get(address) ?? {
      holders: 0,
      buffered: null,
      latestResponseSequence: -1,
    };
    barrier.holders += 1;
    barriers.set(address, barrier);
  }
  return { state, addresses: uniqueAddresses, released: false };
}

export function markSubscriptionResponse(
  state: NetworkState,
  address: string,
  sequence: number,
): void {
  const barrier = barriersByState.get(state)?.get(address);
  if (!barrier) return;
  barrier.latestResponseSequence = Math.max(barrier.latestResponseSequence, sequence);
}

export function attachSubscriptionBaseline(
  statuses: Map<string, string | null>,
  token: BaselineToken,
): void {
  tokensByStatuses.set(statuses, token);
}

export function releaseSubscriptionOperationWithBaseline(
  statuses: Map<string, string | null>,
  releaseOperation: () => void,
): void {
  const token = tokensByStatuses.get(statuses);
  if (!token) {
    releaseOperation();
    return;
  }
  token.releaseOperation = releaseOperation;
}

export function bufferSubscriptionNotification(
  state: NetworkState,
  activity: BufferedAddressActivity,
): boolean {
  if (activity.address === undefined) return false;
  const barrier = barriersByState.get(state)?.get(activity.address);
  if (!barrier) return false;
  // A status supersedes the previous status for the same script hash. Keep the
  // barrier bounded while an authoritative baseline is committing.
  barrier.buffered = activity;
  return true;
}

export function releaseSubscriptionBaseline(
  statusesOrToken: Map<string, string | null> | BaselineToken,
): void {
  const token = statusesOrToken instanceof Map
    ? tokensByStatuses.get(statusesOrToken)
    : statusesOrToken;
  if (!token || token.released) return;
  token.released = true;
  if (statusesOrToken instanceof Map) tokensByStatuses.delete(statusesOrToken);

  const barriers = barriersByState.get(token.state)!;
  for (const address of token.addresses) {
    const barrier = barriers.get(address)!;
    barrier.holders -= 1;
    if (barrier.holders > 0) continue;
    barriers.delete(address);
    if (barrier.buffered && (
      barrier.buffered.sequence === undefined
      || barrier.buffered.sequence > barrier.latestResponseSequence
    )) {
      token.state.client.emit('addressActivity', barrier.buffered);
    }
  }
  if (barriers.size === 0) barriersByState.delete(token.state);
  token.releaseOperation?.();
}
