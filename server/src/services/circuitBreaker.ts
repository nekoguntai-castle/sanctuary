/**
 * Circuit Breaker Pattern
 *
 * Prevents cascade failures by stopping requests to failing services.
 * Automatically recovers after a timeout period.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service failing, requests rejected immediately
 * - HALF_OPEN: Testing if service recovered
 */

import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('CIRCUIT_BREAKER:SVC');

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Name for logging/identification */
  name: string;
  /** Number of failures before opening circuit */
  failureThreshold: number;
  /** Milliseconds before attempting recovery */
  recoveryTimeout: number;
  /** Number of successes in half-open to close circuit */
  successThreshold?: number;
  /** Callback when state changes */
  onStateChange?: (state: CircuitState, previousState: CircuitState) => void;
}

export interface CircuitHealth {
  name: string;
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: string | null;
  lastSuccess: string | null;
  totalRequests: number;
  totalFailures: number;
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly serviceName: string,
    public readonly retryAfter: number
  ) {
    super(`Circuit open for ${serviceName}. Retry after ${retryAfter}ms`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker<T = unknown> {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private openedAt: Date | null = null;
  private totalRequests = 0;
  private totalFailures = 0;

  private readonly name: string;
  private readonly failureThreshold: number;
  private readonly recoveryTimeout: number;
  private readonly successThreshold: number;
  private readonly onStateChange?: (state: CircuitState, prev: CircuitState) => void;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold;
    this.recoveryTimeout = options.recoveryTimeout;
    this.successThreshold = options.successThreshold ?? 1;
    this.onStateChange = options.onStateChange;
  }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute(operation: () => Promise<T>): Promise<T> {
    this.totalRequests++;

    if (this.state === 'open') {
      if (this.shouldAttemptRecovery()) {
        this.transitionTo('half-open');
      } else {
        const retryAfter = this.getRetryAfter();
        throw new CircuitOpenError(this.name, retryAfter);
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Execute with fallback when circuit is open
   */
  async executeWithFallback(
    operation: () => Promise<T>,
    fallback: () => Promise<T>
  ): Promise<T> {
    try {
      return await this.execute(operation);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        log.warn(`[${this.name}] Circuit open, using fallback`);
        return fallback();
      }
      throw error;
    }
  }

  /**
   * Get current health status
   */
  getHealth(): CircuitHealth {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure?.toISOString() ?? null,
      lastSuccess: this.lastSuccess?.toISOString() ?? null,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures,
    };
  }

  /**
   * Check if circuit is allowing requests
   */
  isAllowingRequests(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'half-open') return true;
    return this.shouldAttemptRecovery();
  }

  /**
   * Manually reset the circuit to closed state
   */
  reset(): void {
    this.transitionTo('closed');
    this.failures = 0;
    this.successes = 0;
    log.info(`[${this.name}] Circuit manually reset`);
  }

  private onSuccess(): void {
    this.lastSuccess = new Date();
    this.successes++;

    if (this.state === 'half-open') {
      if (this.successes >= this.successThreshold) {
        this.transitionTo('closed');
        this.failures = 0;
        this.successes = 0;
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failures = 0;
    }
  }

  private onFailure(error: unknown): void {
    this.lastFailure = new Date();
    this.failures++;
    this.totalFailures++;

    const errorMessage = getErrorMessage(error);
    log.warn(`[${this.name}] Operation failed (${this.failures}/${this.failureThreshold})`, {
      error: errorMessage,
    });

    if (this.state === 'half-open') {
      // Any failure in half-open returns to open
      this.transitionTo('open');
      this.successes = 0;
    } else if (this.state === 'closed' && this.failures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state === newState) return;

    const previousState = this.state;
    this.state = newState;

    if (newState === 'open') {
      this.openedAt = new Date();
    }

    log.info(`[${this.name}] Circuit state: ${previousState} → ${newState}`);

    if (this.onStateChange) {
      try {
        this.onStateChange(newState, previousState);
      } catch (error) {
        log.error(`[${this.name}] onStateChange callback error`, { error: getErrorMessage(error) });
      }
    }
  }

  private shouldAttemptRecovery(): boolean {
    if (!this.openedAt) return false;
    const elapsed = Date.now() - this.openedAt.getTime();
    return elapsed >= this.recoveryTimeout;
  }

  private getRetryAfter(): number {
    if (!this.openedAt) return 0;
    const elapsed = Date.now() - this.openedAt.getTime();
    return Math.max(0, this.recoveryTimeout - elapsed);
  }
}

/**
 * Registry of circuit breakers for health monitoring
 */
class CircuitBreakerRegistry {
  private breakers = new Map<string, CircuitBreaker<unknown>>();

  register<T>(breaker: CircuitBreaker<T>): void {
    const health = breaker.getHealth();
    this.breakers.set(health.name, breaker as CircuitBreaker<unknown>);
  }

  unregister(name: string): void {
    this.breakers.delete(name);
  }

  get(name: string): CircuitBreaker<unknown> | undefined {
    return this.breakers.get(name);
  }

  getAllHealth(): CircuitHealth[] {
    return Array.from(this.breakers.values()).map(b => b.getHealth());
  }

  getOverallStatus(): 'healthy' | 'degraded' | 'unhealthy' {
    const healths = this.getAllHealth();
    if (healths.length === 0) return 'healthy';

    const openCount = healths.filter(h => h.state === 'open').length;
    if (openCount === healths.length) return 'unhealthy';
    if (openCount > 0) return 'degraded';
    return 'healthy';
  }

  /**
   * Reset all registered circuit breakers to closed state
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Clear all registered circuit breakers
   * Use with caution - mainly for testing
   */
  clear(): void {
    this.breakers.clear();
  }
}

export const circuitBreakerRegistry = new CircuitBreakerRegistry();

/**
 * Create and register a circuit breaker
 */
export function createCircuitBreaker<T>(options: CircuitBreakerOptions): CircuitBreaker<T> {
  const breaker = new CircuitBreaker<T>(options);
  circuitBreakerRegistry.register(breaker);
  return breaker;
}
