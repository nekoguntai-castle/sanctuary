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

/** Cooldown after a first HTTP 429 that carries no usable Retry-After. */
const RATE_LIMIT_BASE_COOLDOWN_MS = 60_000;
/** Upper bound for any 429 cooldown, including a server-sent Retry-After. */
const RATE_LIMIT_MAX_COOLDOWN_MS = 15 * 60_000;

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into milliseconds.
 * Returns null when the header is missing or unparseable.
 */
function parseRetryAfterMs(value: unknown, now: number): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

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

  /** Requests are skipped until this epoch ms after an HTTP 429 */
  private rateLimitedUntil = 0;
  private consecutiveRateLimits = 0;

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
      // Check circuit breaker and rate-limit cooldown first
      if (!this.circuit.isAllowingRequests() || this.isRateLimited()) {
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

    // Fail fast outside the breaker: a skipped call is not a provider failure
    this.assertNotRateLimited();
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
    this.assertNotRateLimited();

    try {
      const response = await axios.get<T>(url, {
        params,
        timeout: this.timeoutMs,
      });
      this.consecutiveRateLimits = 0;
      return response.data;
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 429) {
          this.enterRateLimitCooldown(error.response.headers?.['retry-after']);
        }
        throw new Error(`HTTP request failed: ${error.message}`);
      }
      throw error;
    }
  }

  private isRateLimited(): boolean {
    return Date.now() < this.rateLimitedUntil;
  }

  /** Throw without a request while an HTTP 429 cooldown is active. */
  protected assertNotRateLimited(): void {
    if (this.isRateLimited()) {
      throw new Error(
        `${this.name} is rate limited; retrying after ${new Date(this.rateLimitedUntil).toISOString()}`
      );
    }
  }

  /**
   * Pause all requests to this provider after an HTTP 429. The pause is the
   * longer of Retry-After and an exponential backoff on consecutive rate
   * limits, capped at RATE_LIMIT_MAX_COOLDOWN_MS (a longer Retry-After is
   * clamped to the cap).
   */
  private enterRateLimitCooldown(retryAfter: unknown): void {
    const now = Date.now();
    const retryAfterMs = parseRetryAfterMs(retryAfter, now);
    // 429s from requests already in flight when the first one landed belong to
    // the same burst; they must not escalate the backoff, only extend the
    // pause when they ask for a longer one.
    if (now < this.rateLimitedUntil) {
      if (retryAfterMs !== null) {
        this.rateLimitedUntil = Math.max(
          this.rateLimitedUntil,
          now + Math.min(RATE_LIMIT_MAX_COOLDOWN_MS, retryAfterMs)
        );
      }
      return;
    }

    this.consecutiveRateLimits += 1;
    const backoffMs = RATE_LIMIT_BASE_COOLDOWN_MS * 2 ** (this.consecutiveRateLimits - 1);
    const cooldownMs = Math.min(
      RATE_LIMIT_MAX_COOLDOWN_MS,
      Math.max(retryAfterMs ?? 0, backoffMs)
    );
    this.rateLimitedUntil = now + cooldownMs;
    this.log.warn('Rate limited by provider (HTTP 429); pausing requests', {
      cooldownMs,
      consecutiveRateLimits: this.consecutiveRateLimits,
    });
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
