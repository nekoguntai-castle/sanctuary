/**
 * Circuit Breakers Collector
 *
 * Collects health status of all registered circuit breakers.
 */

import { circuitBreakerRegistry } from '../../circuitBreaker';
import { registerCollector } from './registry';

registerCollector('circuitBreakers', async () => {
  return {
    breakers: circuitBreakerRegistry.getAllHealth(),
    overallStatus: circuitBreakerRegistry.getOverallStatus(),
  };
});
