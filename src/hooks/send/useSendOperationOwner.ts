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

  const invalidate = useCallback(() => {
    formGeneration.current += 1;
    transactionGeneration.current = null;
    abortSlot(creation);
    abortSlot(signing);
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
    return begin(creation);
  }, [begin]);

  const beginSigning = useCallback(() => {
    if (transactionGeneration.current !== formGeneration.current) return null;
    return begin(signing);
  }, [begin]);

  const beginDraftSave = beginSigning;

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
    () => ({ acceptTransaction, beginCreation, beginDraftSave, beginSigning, hasCurrentTransaction, invalidate }),
    [acceptTransaction, beginCreation, beginDraftSave, beginSigning, hasCurrentTransaction, invalidate],
  );
}
