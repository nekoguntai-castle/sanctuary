import { vi } from 'vitest';
/**
 * Circuit Breaker Tests
 *
 * Tests the circuit breaker pattern implementation for handling
 * cascading failures in external service calls.
 */

import {
  CircuitBreaker,
  CircuitOpenError,
  circuitBreakerRegistry,
  createCircuitBreaker,
  type CircuitState,
  type CircuitHealth,
} from '../../../src/services/circuitBreaker';

describe('CircuitBreaker', () => {
  let circuit: CircuitBreaker<string>;

  beforeEach(() => {
    // Clear and reset registry between tests
    circuitBreakerRegistry.clear();
    vi.useFakeTimers();

    circuit = new CircuitBreaker({
      name: 'test-circuit',
      failureThreshold: 3,
      recoveryTimeout: 1000, // 1 second for faster tests
      successThreshold: 2,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    circuitBreakerRegistry.resetAll();
  });

  describe('closed state', () => {
    it('should start in closed state', () => {
      expect(circuit.getHealth().state).toBe('closed');
    });

    it('should report allowing requests while closed', () => {
      expect(circuit.isAllowingRequests()).toBe(true);
    });

    it('should allow successful calls through', async () => {
      const result = await circuit.execute(async () => 'success');
      expect(result).toBe('success');
      expect(circuit.getHealth().state).toBe('closed');
    });

    it('should count failures but stay closed below threshold', async () => {
      // Fail twice (threshold is 3)
      for (let i = 0; i < 2; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      expect(circuit.getHealth().state).toBe('closed');
    });

    it('should transition to open after reaching failure threshold', async () => {
      // Fail 3 times (threshold is 3)
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      expect(circuit.getHealth().state).toBe('open');
    });

    it('should reset failure count on success', async () => {
      // Fail twice
      for (let i = 0; i < 2; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      // Succeed once - should reset counter
      await circuit.execute(async () => 'success');

      // Fail twice more - should still be closed
      for (let i = 0; i < 2; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      expect(circuit.getHealth().state).toBe('closed');
    });
  });

  describe('open state', () => {
    beforeEach(async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }
      expect(circuit.getHealth().state).toBe('open');
    });

    it('should reject calls immediately when open', async () => {
      await expect(
        circuit.execute(async () => 'should not run')
      ).rejects.toThrow(CircuitOpenError);

      await expect(
        circuit.execute(async () => 'should not run')
      ).rejects.toThrow('Circuit open for test-circuit');
    });

    it('should transition to half-open after recovery timeout', async () => {
      // Advance past recovery timeout
      vi.advanceTimersByTime(1100);

      // Next call should be allowed (circuit transitions to half-open)
      const result = await circuit.execute(async () => 'success');
      expect(result).toBe('success');
      // The recovery probe opens half-open; successThreshold (2) counts probes from here
      expect(circuit.getHealth().state).toBe('half-open');
    });

    it('should report as not allowing requests when open', () => {
      expect(circuit.isAllowingRequests()).toBe(false);
    });

    it('should report as allowing requests after recovery timeout', async () => {
      vi.advanceTimersByTime(1100);
      expect(circuit.isAllowingRequests()).toBe(true);
    });
  });

  describe('half-open state', () => {
    beforeEach(async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }

      // Advance past recovery timeout
      vi.advanceTimersByTime(1100);

      // Trigger transition to half-open with first success
      await circuit.execute(async () => 'success');
    });

    it('should transition to closed after success threshold', async () => {
      // Already had 1 success, need 1 more (threshold is 2)
      await circuit.execute(async () => 'success');
      expect(circuit.getHealth().state).toBe('closed');
    });

    it('should report allowing requests while half-open', () => {
      expect(circuit.getHealth().state).toBe('half-open');
      expect(circuit.isAllowingRequests()).toBe(true);
    });

    it('should transition back to open on any failure', async () => {
      // Create a new circuit with higher success threshold
      const testCircuit = new CircuitBreaker<string>({
        name: 'half-open-test',
        failureThreshold: 1,
        recoveryTimeout: 100,
        successThreshold: 3, // Need 3 successes
      });

      // Trip it
      await expect(
        testCircuit.execute(async () => { throw new Error('fail'); })
      ).rejects.toThrow();

      // Advance past recovery timeout
      vi.advanceTimersByTime(150);

      // One success - now in half-open
      await testCircuit.execute(async () => 'success');
      expect(testCircuit.getHealth().state).toBe('half-open');

      // One failure - back to open
      await expect(
        testCircuit.execute(async () => { throw new Error('fail'); })
      ).rejects.toThrow('fail');

      expect(testCircuit.getHealth().state).toBe('open');
    });
  });

  describe('success threshold', () => {
    it('counts only half-open probe successes toward closing', async () => {
      for (let i = 0; i < 5; i++) {
        await circuit.execute(async () => 'ok');
      }
      for (let i = 0; i < 3; i++) {
        await expect(circuit.execute(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
      }
      expect(circuit.getHealth().state).toBe('open');

      vi.advanceTimersByTime(1100);
      await circuit.execute(async () => 'probe');
      expect(circuit.getHealth().state).toBe('half-open');

      await circuit.execute(async () => 'probe');
      expect(circuit.getHealth().state).toBe('closed');
    });
  });

  describe('health statistics', () => {
    it('should track request statistics', async () => {
      // 2 successes
      await circuit.execute(async () => 'success');
      await circuit.execute(async () => 'success');

      // 1 failure
      await expect(
        circuit.execute(async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow();

      const health = circuit.getHealth();
      expect(health.totalRequests).toBe(3);
      expect(health.successes).toBe(2);
      expect(health.failures).toBe(1);
      expect(health.totalFailures).toBe(1);
      expect(health.name).toBe('test-circuit');
      expect(health.state).toBe('closed');
    });

    it('should track last success/failure times', async () => {
      const beforeSuccess = new Date().toISOString();
      await circuit.execute(async () => 'success');
      const afterSuccess = new Date().toISOString();

      const health = circuit.getHealth();
      expect(health.lastSuccess).not.toBeNull();
      expect(health.lastSuccess).toBeDefined();
      expect(new Date(health.lastSuccess!).getTime()).toBeGreaterThanOrEqual(new Date(beforeSuccess).getTime());
      expect(new Date(health.lastSuccess!).getTime()).toBeLessThanOrEqual(new Date(afterSuccess).getTime());
    });
  });

  describe('manual reset', () => {
    it('should reset circuit to closed state', async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow('fail');
      }
      expect(circuit.getHealth().state).toBe('open');

      // Manual reset
      circuit.reset();
      expect(circuit.getHealth().state).toBe('closed');

      // Should allow calls again
      const result = await circuit.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should no-op reset when already closed', () => {
      expect(circuit.getHealth().state).toBe('closed');
      circuit.reset();
      expect(circuit.getHealth().state).toBe('closed');
    });

    it('does not run closed-state success reset when internal state is open', () => {
      const internal = circuit as any;
      internal.state = 'open';
      internal.failures = 2;

      internal.onSuccess();

      expect(circuit.getHealth().failures).toBe(2);
    });
  });

  describe('state change callback', () => {
    it('should call onStateChange when state transitions', async () => {
      const stateChanges: Array<{ from: CircuitState; to: CircuitState }> = [];

      const circuitWithCallback = new CircuitBreaker<string>({
        name: 'callback-circuit',
        failureThreshold: 2,
        recoveryTimeout: 100,
        onStateChange: (to, from) => {
          stateChanges.push({ from, to });
        },
      });

      // Trip the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          circuitWithCallback.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }

      expect(stateChanges).toContainEqual({
        from: 'closed',
        to: 'open',
      });
    });

    it('should swallow onStateChange callback errors', async () => {
      const circuitWithThrowingCallback = new CircuitBreaker<string>({
        name: 'callback-throw-circuit',
        failureThreshold: 1,
        recoveryTimeout: 100,
        onStateChange: () => {
          throw new Error('callback failed');
        },
      });

      await expect(
        circuitWithThrowingCallback.execute(async () => {
          throw new Error('primary failure');
        })
      ).rejects.toThrow('primary failure');
      expect(circuitWithThrowingCallback.getHealth().state).toBe('open');
    });
  });

  describe('executeWithFallback', () => {
    it('should use fallback when circuit is open', async () => {
      // Trip the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuit.execute(async () => {
            throw new Error('fail');
          })
        ).rejects.toThrow();
      }

      const result = await circuit.executeWithFallback(
        async () => 'primary',
        async () => 'fallback'
      );

      expect(result).toBe('fallback');
    });

    it('should use primary when circuit is closed', async () => {
      const result = await circuit.executeWithFallback(
        async () => 'primary',
        async () => 'fallback'
      );

      expect(result).toBe('primary');
    });

    it('should rethrow non-circuit errors', async () => {
      await expect(
        circuit.executeWithFallback(
          async () => { throw new Error('not a circuit error'); },
          async () => 'fallback'
        )
      ).rejects.toThrow('not a circuit error');
    });

    it('handles defensive open state without openedAt timestamp', async () => {
      const internal = circuit as any;
      internal.state = 'open';
      internal.openedAt = null;

      await expect(
        circuit.execute(async () => 'primary')
      ).rejects.toEqual(expect.objectContaining({
        serviceName: 'test-circuit',
        retryAfter: 0,
      }));
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  beforeEach(() => {
    circuitBreakerRegistry.clear();
  });

  it('should report healthy when registry is empty', () => {
    expect(circuitBreakerRegistry.getOverallStatus()).toBe('healthy');
  });

  it('should create and retrieve circuit breakers', () => {
    const circuit = createCircuitBreaker<string>({
      name: 'registry-test',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });

    const retrieved = circuitBreakerRegistry.get('registry-test');
    expect(retrieved).toBe(circuit);
  });

  it('should return undefined for unknown circuit', () => {
    const circuit = circuitBreakerRegistry.get('unknown-circuit');
    expect(circuit).toBeUndefined();
  });

  it('should get health for all circuits', async () => {
    const circuit1 = createCircuitBreaker<string>({
      name: 'circuit-1',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });
    const circuit2 = createCircuitBreaker<string>({
      name: 'circuit-2',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });

    await circuit1.execute(async () => 'success');
    await circuit2.execute(async () => 'success');
    await circuit2.execute(async () => 'success');

    const allHealth = circuitBreakerRegistry.getAllHealth();

    const health1 = allHealth.find((h) => h.name === 'circuit-1');
    const health2 = allHealth.find((h) => h.name === 'circuit-2');

    expect(health1).toBeDefined();
    expect(health2).toBeDefined();
    expect(health1?.totalRequests).toBe(1);
    expect(health2?.totalRequests).toBe(2);
  });

  it('should reset all circuits', async () => {
    const circuit1 = createCircuitBreaker<void>({
      name: 'reset-1',
      failureThreshold: 1,
      recoveryTimeout: 30000,
    });
    const circuit2 = createCircuitBreaker<void>({
      name: 'reset-2',
      failureThreshold: 1,
      recoveryTimeout: 30000,
    });

    // Trip both circuits
    await expect(circuit1.execute(async () => { throw new Error(); })).rejects.toThrow();
    await expect(circuit2.execute(async () => { throw new Error(); })).rejects.toThrow();

    expect(circuit1.getHealth().state).toBe('open');
    expect(circuit2.getHealth().state).toBe('open');

    // Reset all
    circuitBreakerRegistry.resetAll();

    expect(circuit1.getHealth().state).toBe('closed');
    expect(circuit2.getHealth().state).toBe('closed');
  });

  it('should report overall status as healthy when all circuits are closed', () => {
    createCircuitBreaker<string>({
      name: 'healthy-1',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });
    createCircuitBreaker<string>({
      name: 'healthy-2',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });

    expect(circuitBreakerRegistry.getOverallStatus()).toBe('healthy');
  });

  it('should report overall status as degraded when some circuits are open', async () => {
    const circuit1 = createCircuitBreaker<void>({
      name: 'degraded-1',
      failureThreshold: 1,
      recoveryTimeout: 30000,
    });
    createCircuitBreaker<string>({
      name: 'degraded-2',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });

    // Trip one circuit
    await expect(circuit1.execute(async () => { throw new Error(); })).rejects.toThrow();

    expect(circuitBreakerRegistry.getOverallStatus()).toBe('degraded');
  });

  it('should report overall status as unhealthy when all circuits are open', async () => {
    const circuit1 = createCircuitBreaker<void>({
      name: 'unhealthy-1',
      failureThreshold: 1,
      recoveryTimeout: 30000,
    });
    const circuit2 = createCircuitBreaker<void>({
      name: 'unhealthy-2',
      failureThreshold: 1,
      recoveryTimeout: 30000,
    });

    // Trip both circuits
    await expect(circuit1.execute(async () => { throw new Error(); })).rejects.toThrow();
    await expect(circuit2.execute(async () => { throw new Error(); })).rejects.toThrow();

    expect(circuitBreakerRegistry.getOverallStatus()).toBe('unhealthy');
  });

  it('should unregister circuits', () => {
    createCircuitBreaker<string>({
      name: 'to-unregister',
      failureThreshold: 5,
      recoveryTimeout: 30000,
    });

    expect(circuitBreakerRegistry.get('to-unregister')).toBeDefined();

    circuitBreakerRegistry.unregister('to-unregister');

    expect(circuitBreakerRegistry.get('to-unregister')).toBeUndefined();
  });
});

describe('CircuitOpenError', () => {
  it('should include service name and retry after', () => {
    const error = new CircuitOpenError('my-circuit', 5000);

    expect(error.message).toBe('Circuit open for my-circuit. Retry after 5000ms');
    expect(error.serviceName).toBe('my-circuit');
    expect(error.retryAfter).toBe(5000);
    expect(error.name).toBe('CircuitOpenError');
  });
});
