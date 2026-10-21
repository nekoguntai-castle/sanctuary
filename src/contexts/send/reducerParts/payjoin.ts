import { canonicalSegwitAddressCase } from '@sanctuary/shared/utils/bitcoin';
import type { TransactionAction, TransactionState } from '../types';
import type { ReducerResult } from './types';

type PayjoinBindingState = Pick<TransactionState, 'transactionType' | 'outputs' | 'payjoinUrl' | 'payjoinAddress'>;

function sameAddress(a: string, b: string): boolean {
  return canonicalSegwitAddressCase(a) === canonicalSegwitAddressCase(b);
}

/**
 * The payjoin endpoint, only while it still belongs to the send: a standard
 * send whose single output pays the address the BIP21 URI carried it with.
 * Every consumer reads the endpoint through this, never `state.payjoinUrl`.
 */
export function getBoundPayjoinUrl(state: PayjoinBindingState): string | null {
  const { payjoinUrl, payjoinAddress, outputs } = state;
  if (!payjoinUrl || !payjoinAddress) return null;
  if (state.transactionType !== 'standard' || outputs.length !== 1) return null;
  return sameAddress(outputs[0].address, payjoinAddress) ? payjoinUrl : null;
}

function hasBoundOutput(outputs: TransactionState['outputs'], address: string): boolean {
  return outputs.some((output) => sameAddress(output.address, address));
}

/**
 * Drop the endpoint once an output edit removes its bound address: it was
 * present before and is absent after (by presence, not index, so duplicate
 * addresses and dispatch order do not matter).
 */
export function clearPayjoinIfUnbound(state: TransactionState, next: TransactionState): TransactionState {
  const address = state.payjoinAddress;
  if (!address || !hasBoundOutput(state.outputs, address) || hasBoundOutput(next.outputs, address)) {
    return next;
  }
  return { ...next, payjoinUrl: null, payjoinAddress: null };
}

export function reducePayjoin(
  state: TransactionState,
  action: TransactionAction
): ReducerResult {
  if (action.type === 'SET_PAYJOIN_URL') {
    return { ...state, payjoinUrl: action.url, payjoinAddress: action.address };
  }

  if (action.type === 'SET_PAYJOIN_STATUS') {
    return { ...state, payjoinStatus: action.status };
  }

  return undefined;
}
