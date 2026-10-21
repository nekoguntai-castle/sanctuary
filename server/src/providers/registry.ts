/**
 * Generic Provider Registry
 *
 * A flexible registry for managing pluggable providers with health checking,
 * priority-based selection, and automatic failover.
 *
 * @module providers/registry
 */

import { createLogger } from '../utils/logger';
import { singleFlight } from '../utils/async';
import type {
  IProvider,
  IProviderLifecycle,
  IProviderRegistry,
  InvokeOptions,
  ProviderHealthStatus,
  RegistryHealthSummary,
} from './types';

/**
 * Configuration options for the registry
 */
export interface RegistryOptions {
  /**
   * Name of the registry (for logging)
   */
  name: string;

  /**
   * Health check interval in milliseconds
   * @default 60000 (1 minute)
   */
  healthCheckIntervalMs?: number;

  /**
   * Cache health results for this duration
   * @default 30000 (30 seconds)
   */
  healthCacheTtlMs?: number;

  /**
   * Default timeout for provider invocations
   * @default 30000 (30 seconds)
   */
  defaultTimeoutMs?: number;

  /**
   * Default max retries for provider invocations
   * @default 2
   */
  defaultMaxRetries?: number;
}

/**
 * Generic provider registry implementation
 */
export class ProviderRegistry<T extends IProvider> implements IProviderRegistry<T> {
  private providers = new Map<string, T>();
  private healthCache = new Map<string, { healthy: boolean; timestamp: number }>();
  /** One in-flight health probe per provider name, shared by concurrent callers */
  private healthInFlight = new Map<string, Promise<boolean>>();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly log;
  private readonly options: Required<RegistryOptions>;

  constructor(options: RegistryOptions) {
    this.log = createLogger(`PROVIDER:${options.name}`);
    this.options = {
      name: options.name,
      healthCheckIntervalMs: options.healthCheckIntervalMs ?? 60000,
      healthCacheTtlMs: options.healthCacheTtlMs ?? 30000,
      defaultTimeoutMs: options.defaultTimeoutMs ?? 30000,
      defaultMaxRetries: options.defaultMaxRetries ?? 2,
    };
  }

  /**
   * Start periodic health checking
   */
  startHealthChecks(): void {
    if (this.healthCheckInterval) return;

    this.healthCheckInterval = setInterval(async () => {
      await this.checkAllHealth();
    }, this.options.healthCheckIntervalMs);

    // Don't keep process alive just for health checks
    this.healthCheckInterval.unref();

    this.log.debug('Started periodic health checks', {
      intervalMs: this.options.healthCheckIntervalMs,
    });
  }

  /**
   * Stop periodic health checking
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      this.log.debug('Stopped periodic health checks');
    }
  }

  /**
   * Register a provider
   */
  async register(provider: T): Promise<void> {
    if (this.providers.has(provider.name)) {
      this.log.warn('Provider already registered, replacing', { name: provider.name });
      await this.unregister(provider.name);
    }

    // Call lifecycle hook if available
    const lifecycleProvider = provider as unknown as IProviderLifecycle;
    if (lifecycleProvider.onRegister) {
      try {
        await lifecycleProvider.onRegister();
      } catch (err) {
        this.log.error('Provider onRegister failed', {
          name: provider.name,
          error: (err as Error).message,
        });
        throw err;
      }
    }

    this.providers.set(provider.name, provider);
    this.log.info('Provider registered', {
      name: provider.name,
      priority: provider.priority,
    });

    // Initial health check
    await this.checkProviderHealth(provider);
  }

  /**
   * Unregister a provider by name
   */
  async unregister(name: string): Promise<void> {
    const provider = this.providers.get(name);
    if (!provider) {
      this.log.warn('Provider not found for unregister', { name });
      return;
    }

    // Call lifecycle hook if available
    const lifecycleProvider = provider as unknown as IProviderLifecycle;
    if (lifecycleProvider.onUnregister) {
      try {
        await lifecycleProvider.onUnregister();
      } catch (err) {
        this.log.error('Provider onUnregister failed', {
          name,
          error: (err as Error).message,
        });
      }
    }

    this.providers.delete(name);
    this.healthCache.delete(name);
    this.healthInFlight.delete(name);
    this.log.info('Provider unregistered', { name });
  }

  /**
   * Get a provider by name
   */
  get(name: string): T | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all registered providers
   */
  getAll(): T[] {
    return Array.from(this.providers.values());
  }

  /**
   * Get all healthy providers sorted by priority (highest first)
   */
  async getHealthy(): Promise<T[]> {
    const providers = this.getAll();
    const healthyProviders: T[] = [];

    for (const provider of providers) {
      const isHealthy = await this.isProviderHealthy(provider);
      if (isHealthy) {
        healthyProviders.push(provider);
      }
    }

    // Sort by priority (highest first)
    return healthyProviders.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get the best (highest priority) healthy provider
   */
  async getBest(): Promise<T | undefined> {
    const healthy = await this.getHealthy();
    return healthy[0];
  }

  /**
   * Invoke a method on the best available provider with failover
   */
  async invoke<R>(
    method: (provider: T) => Promise<R>,
    options?: InvokeOptions
  ): Promise<R> {
    const opts = {
      timeoutMs: options?.timeoutMs ?? this.options.defaultTimeoutMs,
      maxRetries: options?.maxRetries ?? this.options.defaultMaxRetries,
      throwOnFailure: options?.throwOnFailure ?? true,
    };

    // If specific provider requested
    if (options?.provider) {
      const provider = this.providers.get(options.provider);
      if (!provider) {
        throw new Error(`Provider not found: ${options.provider}`);
      }
      return this.invokeWithTimeout(provider, method, opts.timeoutMs);
    }

    // Get healthy providers sorted by priority
    const providers = await this.getHealthy();

    if (providers.length === 0) {
      if (opts.throwOnFailure) {
        throw new Error(`No healthy providers available in ${this.options.name}`);
      }
      return undefined as R;
    }

    let lastError: Error | undefined;
    let attempts = 0;

    for (const provider of providers) {
      if (attempts >= opts.maxRetries + 1) break;

      try {
        const result = await this.invokeWithTimeout(provider, method, opts.timeoutMs);
        return result;
      } catch (err) {
        lastError = err as Error;
        attempts++;
        this.log.warn('Provider invocation failed, trying next', {
          provider: provider.name,
          attempt: attempts,
          error: lastError.message,
        });

        // Mark as unhealthy
        this.healthCache.set(provider.name, { healthy: false, timestamp: Date.now() });

        // Notify health change
        const lifecycleProvider = provider as unknown as IProviderLifecycle;
        if (lifecycleProvider.onHealthChange) {
          lifecycleProvider.onHealthChange(false);
        }
      }
    }

    if (opts.throwOnFailure && lastError) {
      throw new Error(
        `All providers failed in ${this.options.name}: ${lastError.message}`
      );
    }

    return undefined as R;
  }

  /**
   * Invoke a method on all healthy providers
   */
  async invokeAll<R>(
    method: (provider: T) => Promise<R>,
    options?: InvokeOptions
  ): Promise<R[]> {
    const opts = {
      timeoutMs: options?.timeoutMs ?? this.options.defaultTimeoutMs,
    };

    const providers = await this.getHealthy();
    const results: R[] = [];

    await Promise.allSettled(
      providers.map(async (provider) => {
        try {
          const result = await this.invokeWithTimeout(provider, method, opts.timeoutMs);
          results.push(result);
        } catch (err) {
          this.log.warn('Provider invocation failed in invokeAll', {
            provider: provider.name,
            error: (err as Error).message,
          });
        }
      })
    );

    return results;
  }

  /**
   * Get health status of all providers
   */
  async getHealth(): Promise<RegistryHealthSummary> {
    const providers = this.getAll();
    const statuses: ProviderHealthStatus[] = [];

    for (const provider of providers) {
      const start = Date.now();
      let healthy = false;
      let error: string | undefined;

      try {
        healthy = await provider.healthCheck();
      } catch (err) {
        error = (err as Error).message;
      }

      const latencyMs = Date.now() - start;

      statuses.push({
        name: provider.name,
        healthy,
        lastCheck: new Date(),
        latencyMs,
        error,
      });

      // Update cache
      this.healthCache.set(provider.name, { healthy, timestamp: Date.now() });
    }

    return summarizeHealth(statuses);
  }

  /**
   * Get health status of all providers from the TTL health cache.
   *
   * Stale or missing entries are refreshed through the single-flight probe, so
   * any number of callers cause at most one provider call per cache TTL.
   */
  async getCachedHealth(): Promise<RegistryHealthSummary> {
    const statuses = await Promise.all(
      this.getAll().map((provider) => this.getCachedProviderStatus(provider))
    );
    return summarizeHealth(statuses);
  }

  /**
   * Check if any healthy providers are available
   */
  async hasHealthy(): Promise<boolean> {
    const healthy = await this.getHealthy();
    return healthy.length > 0;
  }

  /**
   * Shutdown the registry and cleanup
   */
  async shutdown(): Promise<void> {
    this.stopHealthChecks();

    // Unregister all providers
    const names = Array.from(this.providers.keys());
    for (const name of names) {
      await this.unregister(name);
    }

    this.log.info('Provider registry shut down');
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  /**
   * Resolve one provider's status through the health cache
   */
  private async getCachedProviderStatus(provider: T): Promise<ProviderHealthStatus> {
    const healthy = await this.isProviderHealthy(provider);
    const cached = this.healthCache.get(provider.name);
    return {
      name: provider.name,
      healthy,
      lastCheck: new Date(cached?.timestamp ?? Date.now()),
    };
  }

  /**
   * Check health of a single provider, sharing an in-flight probe with concurrent callers
   */
  private checkProviderHealth(provider: T): Promise<boolean> {
    return singleFlight(this.healthInFlight, provider.name, () => this.probeProviderHealth(provider));
  }

  /**
   * Probe a single provider and record the result in the health cache.
   * The probe is bounded so a hung provider cannot pin the shared in-flight
   * entry (and every caller waiting on it) indefinitely.
   */
  private async probeProviderHealth(provider: T): Promise<boolean> {
    try {
      const healthy = await this.invokeWithTimeout(
        provider,
        (p) => p.healthCheck(),
        this.options.defaultTimeoutMs
      );
      if (!this.isCurrentProvider(provider)) return healthy;

      // Check if status changed
      const cached = this.healthCache.get(provider.name);
      if (cached && cached.healthy !== healthy) {
        const lifecycleProvider = provider as unknown as IProviderLifecycle;
        if (lifecycleProvider.onHealthChange) {
          lifecycleProvider.onHealthChange(healthy);
        }
      }

      this.healthCache.set(provider.name, { healthy, timestamp: Date.now() });
      return healthy;
    } catch (err) {
      this.log.error('Health check failed', {
        provider: provider.name,
        error: (err as Error).message,
      });
      if (this.isCurrentProvider(provider)) {
        this.healthCache.set(provider.name, { healthy: false, timestamp: Date.now() });
      }
      return false;
    }
  }

  /**
   * Check health of all providers
   */
  private async checkAllHealth(): Promise<void> {
    const providers = this.getAll();
    await Promise.allSettled(
      providers.map((p) => this.checkProviderHealth(p))
    );
  }

  /**
   * Check if a provider is healthy (using cache)
   */
  private async isProviderHealthy(provider: T): Promise<boolean> {
    const cached = this.healthCache.get(provider.name);

    // Use cache if fresh
    if (cached && Date.now() - cached.timestamp < this.options.healthCacheTtlMs) {
      return cached.healthy;
    }

    // Otherwise do a fresh check
    return this.checkProviderHealth(provider);
  }

  /**
   * A probe that settles after its provider was unregistered (or replaced under
   * the same name) must not write the cache entry the current provider owns.
   */
  private isCurrentProvider(provider: T): boolean {
    return this.providers.get(provider.name) === provider;
  }

  /**
   * Invoke with timeout
   */
  private async invokeWithTimeout<R>(
    provider: T,
    method: (provider: T) => Promise<R>,
    timeoutMs: number
  ): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Provider ${provider.name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      method(provider)
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }
}

/**
 * Build a registry health summary from per-provider statuses
 */
function summarizeHealth(statuses: ProviderHealthStatus[]): RegistryHealthSummary {
  const healthyProviders = statuses.filter((s) => s.healthy).length;
  return {
    totalProviders: statuses.length,
    healthyProviders,
    unhealthyProviders: statuses.length - healthyProviders,
    providers: statuses,
  };
}

/**
 * Create a new provider registry
 */
export function createProviderRegistry<T extends IProvider>(
  options: RegistryOptions
): ProviderRegistry<T> {
  return new ProviderRegistry<T>(options);
}
