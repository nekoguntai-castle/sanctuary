import { useCallback, useEffect, useMemo, useRef } from 'react';

export interface SendOperationLease {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

interface OperationSlot {
  controller: AbortController;
  id: number;
}

export interface SendOperationOwner {
  acceptTransaction: (lease: SendOperationLease) => boolean;
  beginBroadcast: () => SendOperationLease | null;
  beginCreation: () => SendOperationLease;
  beginDraftSave: () => SendOperationLease | null;
  beginSigning: () => SendOperationLease | null;
  hasCurrentTransaction: () => boolean;
  invalidate: () => void;
}

const abortSlot = (slot: React.RefObject<OperationSlot | null>): void => {
  slot.current?.controller.abort();
  slot.current = null;
};

export function useSendOperationOwner(hasInitialTransaction: boolean): SendOperationOwner {
  const formGeneration = useRef(0);
  const operationId = useRef(0);
  const transactionGeneration = useRef<number | null>(hasInitialTransaction ? 0 : null);
  const creation = useRef<OperationSlot | null>(null);
  const signing = useRef<OperationSlot | null>(null);
  // Broadcast owns a slot separate from `signing`: a signing click that arrives while a
  // broadcast is in flight must not abort the broadcast's lease after the server call has
  // already gone out (see useBroadcast.ts).
  const broadcasting = useRef<OperationSlot | null>(null);
  // Draft save owns its own slot too. Sharing `signing` let a signing click abort an
  // in-flight save: the save then never cleared its busy flag and the wizard wedged.
  const draftSaving = useRef<OperationSlot | null>(null);

  const invalidate = useCallback(() => {
    formGeneration.current += 1;
    transactionGeneration.current = null;
    abortSlot(creation);
    abortSlot(signing);
    abortSlot(broadcasting);
    abortSlot(draftSaving);
  }, []);

  const begin = useCallback((slot: React.RefObject<OperationSlot | null>): SendOperationLease => {
    abortSlot(slot);
    const controller = new AbortController();
    const id = ++operationId.current;
    const generation = formGeneration.current;
    slot.current = { controller, id };
    return {
      signal: controller.signal,
      isCurrent: () => (
        !controller.signal.aborted &&
        generation === formGeneration.current &&
        slot.current?.id === id
      ),
    };
  }, []);

  const beginCreation = useCallback(() => {
    transactionGeneration.current = null;
    abortSlot(signing);
    abortSlot(draftSaving);
    return begin(creation);
  }, [begin]);

  // Work on the current transaction: refused once the form moved on.
  const beginForTransaction = useCallback((slot: React.RefObject<OperationSlot | null>) => {
    if (transactionGeneration.current !== formGeneration.current) return null;
    return begin(slot);
  }, [begin]);

  const beginSigning = useCallback(() => beginForTransaction(signing), [beginForTransaction]);
  const beginDraftSave = useCallback(() => beginForTransaction(draftSaving), [beginForTransaction]);
  const beginBroadcast = useCallback(() => beginForTransaction(broadcasting), [beginForTransaction]);

  const acceptTransaction = useCallback((lease: SendOperationLease) => {
    if (!lease.isCurrent()) return false;
    transactionGeneration.current = formGeneration.current;
    return true;
  }, []);

  const hasCurrentTransaction = useCallback(
    () => transactionGeneration.current === formGeneration.current,
    [],
  );

  useEffect(() => {
    // React StrictMode replays effect cleanup during initial mount. Restore draft
    // ownership in the replayed setup while still invalidating real unmounts.
    if (hasInitialTransaction) transactionGeneration.current = formGeneration.current;
    return invalidate;
  }, [hasInitialTransaction, invalidate]);

  return useMemo(
    () => ({
      acceptTransaction,
      beginBroadcast,
      beginCreation,
      beginDraftSave,
      beginSigning,
      hasCurrentTransaction,
      invalidate,
    }),
    [acceptTransaction, beginBroadcast, beginCreation, beginDraftSave, beginSigning, hasCurrentTransaction, invalidate],
  );
}
