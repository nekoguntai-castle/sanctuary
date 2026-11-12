/**
 * Circuit Breakers Collector
 *
 * Collects health status of the circuit breakers registered in this (API)
 * process. The worker's breakers are reported by the `notificationWorker`
 * collector, which asks the worker for them (`value.circuitBreakers`).
 */

import { API_PROCESS_BREAKER_SCOPE, circuitBreakerRegistry } from '../../circuitBreaker';
import { registerCollector } from './registry';

registerCollector('circuitBreakers', async () => {
  return {
    scope: API_PROCESS_BREAKER_SCOPE,
    breakers: circuitBreakerRegistry.getAllHealth(),
    overallStatus: circuitBreakerRegistry.getOverallStatus(),
  };
});
