import {
  createCircuitBreaker,
  type CircuitBreaker,
  type CircuitState,
} from '../../circuitBreaker';
import type { PooledConnectionHandle } from './types';

export function createElectrumPoolCircuitBreaker(
  onStateChange: (newState: CircuitState, oldState: CircuitState) => void
): CircuitBreaker<PooledConnectionHandle> {
  return createCircuitBreaker<PooledConnectionHandle>({
    name: 'electrum-pool',
    failureThreshold: 8,
    recoveryTimeout: 15000,
    successThreshold: 2,
    onStateChange,
  });
}
