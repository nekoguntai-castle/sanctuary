/**
 * Base Price Provider
 *
 * Abstract base class for price providers with common functionality.
 */

import axios, { AxiosError } from 'axios';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { createCircuitBreaker, CircuitBreaker } from '../../circuitBreaker';
import type { IPriceProvider, PriceData } from '../types';

/**
 * Configuration for a price provider
 */
export interface PriceProviderRuntimeOptions {
  registerCircuitBreaker?: boolean;
}

export interface PriceProviderConfig extends PriceProviderRuntimeOptions {
  name: string;
  priority: number;
  supportedCurrencies: string[];
  timeoutMs?: number;
  circuitBreaker?: {
    failureThreshold?: number;
    recoveryTimeout?: number;
  };
}

/**
 * Base price provider with circuit breaker protection
 */
export abstract class BasePriceProvider implements IPriceProvider {
  readonly name: string;
  readonly priority: number;
  readonly supportedCurrencies: string[];

  protected readonly log;
  protected readonly circuit: CircuitBreaker<PriceData>;
  protected readonly timeoutMs: number;

  constructor(config: PriceProviderConfig) {
    this.name = config.name;
    this.priority = config.priority;
    this.supportedCurrencies = config.supportedCurrencies.map(c => c.toUpperCase());
    this.timeoutMs = config.timeoutMs ?? 2000; // Fast fail for better UX
    this.log = createLogger(`PRICE:SVC_${config.name}`);

    const circuitConfig = {
      name: `price-${config.name}`,
      failureThreshold: config.circuitBreaker?.failureThreshold ?? 3,
      recoveryTimeout: config.circuitBreaker?.recoveryTimeout ?? 30000, // Faster recovery
    };

    this.circuit = config.registerCircuitBreaker === false
      ? new CircuitBreaker<PriceData>(circuitConfig)
      : createCircuitBreaker<PriceData>(circuitConfig);
  }

  /**
   * Check if provider supports a currency
   */
  supportsCurrency(currency: string): boolean {
    return this.supportedCurrencies.includes(currency.toUpperCase());
  }

  /**
   * Health check - verify provider is responding
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Check circuit breaker state first
      if (!this.circuit.isAllowingRequests()) {
        return false;
      }

      // Try to fetch USD price as health check
      await this.getPrice('USD');
      return true;
    } catch (error) {
      this.log.debug('Health check failed', { error: getErrorMessage(error) });
      return false;
    }
  }

  /**
   * Get price with circuit breaker protection
   */
  async getPrice(currency: string): Promise<PriceData> {
    const normalizedCurrency = currency.toUpperCase();

    if (!this.supportsCurrency(normalizedCurrency)) {
      throw new Error(`Currency ${normalizedCurrency} not supported by ${this.name}`);
    }

    return this.circuit.execute(async () => {
      return this.fetchPrice(normalizedCurrency);
    });
  }

  /**
   * Fetch price without registering health/circuit-breaker side effects.
   * Used by operator diagnostics.
   */
  async testPrice(currency: string): Promise<PriceData> {
    const normalizedCurrency = currency.toUpperCase();

    if (!this.supportsCurrency(normalizedCurrency)) {
      throw new Error(`Currency ${normalizedCurrency} not supported by ${this.name}`);
    }

    return this.fetchPrice(normalizedCurrency);
  }

  /**
   * Abstract method for actual price fetching
   * Subclasses must implement this
   */
  protected abstract fetchPrice(currency: string): Promise<PriceData>;

  /**
   * Helper method for making HTTP requests
   */
  protected async httpGet<T>(url: string, params?: Record<string, any>): Promise<T> {
    try {
      const response = await axios.get<T>(url, {
        params,
        timeout: this.timeoutMs,
      });
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        throw new Error(`HTTP request failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Lifecycle hook - called when registered
   */
  async onRegister(): Promise<void> {
    this.log.debug('Provider registered');
  }

  /**
   * Lifecycle hook - called when unregistered
   */
  async onUnregister(): Promise<void> {
    this.log.debug('Provider unregistered');
  }

  /**
   * Lifecycle hook - called when health status changes
   */
  onHealthChange(healthy: boolean): void {
    this.log.info('Health status changed', { healthy });
  }
}
