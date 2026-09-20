/**
 * Metrics Registry
 *
 * Prometheus metrics registry setup and default Node.js metrics collection.
 */

import {
  Registry,
  collectDefaultMetrics,
  register as defaultRegister,
} from '@prometheus-io/client';
import { createLogger } from '../../utils/logger';

const log = createLogger('INFRA:METRICS');

// Use the default registry for compatibility with the Prometheus client ecosystem.
export const registry = defaultRegister;

// Collect default Node.js metrics
collectDefaultMetrics({
  register: registry,
  prefix: 'sanctuary_',
  labels: { app: 'sanctuary' },
});

/**
 * Metrics Service
 */
class MetricsService {
  private initialized = false;

  /**
   * Initialize metrics service
   */
  initialize(): void {
    if (this.initialized) return;

    log.info('Metrics service initialized');
    this.initialized = true;
  }

  /**
   * Get all metrics in Prometheus text format
   */
  async getMetrics(): Promise<string> {
    return registry.metrics();
  }

  /**
   * Get metrics content type header
   */
  getContentType(): string {
    return registry.contentType;
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    registry.resetMetrics();
  }

  /**
   * Get registry for custom metric registration
   */
  getRegistry(): Registry {
    return registry;
  }
}

// Singleton instance
export const metricsService = new MetricsService();
