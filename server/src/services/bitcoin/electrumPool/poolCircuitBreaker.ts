import {
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitState,
} from '../../circuitBreaker';
import type { PooledConnectionHandle } from './types';

let poolBreakerSeq = 0;

/** Unique registry key per pool; the registry is keyed by name, so a shared name overwrites. */
export function nextElectrumPoolBreakerName(): string {
  poolBreakerSeq += 1;
  return `electrum-pool:${poolBreakerSeq}`;
}

export function createElectrumPoolCircuitBreaker(
  onStateChange: (newState: CircuitState, oldState: CircuitState) => void,
  name: string
): CircuitBreaker<PooledConnectionHandle> {
  return createCircuitBreaker<PooledConnectionHandle>({
    name,
    failureThreshold: 8,
    recoveryTimeout: 15000,
    successThreshold: 2,
    onStateChange,
  });
}
