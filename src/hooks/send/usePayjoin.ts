/**
 * usePayjoin Hook
 *
 * Manages Payjoin negotiation state. The actual Payjoin attempt is performed
 * during transaction creation (in the orchestrator), but this hook owns
 * the status tracking and the guard ref that prevents duplicate attempts.
 */

import { useState, useRef, useCallback } from 'react';
import type { PayjoinAttemptStatus } from '../../contexts/send/types';

export interface UsePayjoinResult {
  payjoinStatus: PayjoinAttemptStatus;
  payjoinAttempted: React.RefObject<boolean>;
  setPayjoinStatus: (status: PayjoinAttemptStatus) => void;
  resetPayjoin: () => void;
}

export function usePayjoin(): UsePayjoinResult {
  const [payjoinStatus, setPayjoinStatus] = useState<PayjoinAttemptStatus>('idle');
  const payjoinAttempted = useRef(false);

  const resetPayjoin = useCallback(() => {
    setPayjoinStatus('idle');
    payjoinAttempted.current = false;
  }, []);

  return {
    payjoinStatus,
    payjoinAttempted,
    setPayjoinStatus,
    resetPayjoin,
  };
}
