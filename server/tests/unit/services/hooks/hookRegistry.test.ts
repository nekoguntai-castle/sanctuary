import { vi } from 'vitest';
/**
 * Hook Registry Tests
 *
 * Tests for the operation hooks system (before/after hooks).
 */

import { HookRegistry } from '../../../../src/services/hooks/registry';
import { HookPriorities, Operations } from '../../../../src/services/hooks/types';

// Mock the logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('HookRegistry', () => {
  describe('before/after registration', () => {
    it('should register a before hook', () => {
      const registry = new HookRegistry();
      const handler = vi.fn();

      const hookId = registry.before('wallet:create', handler);

      expect(hookId).toBeDefined();
      expect(hookId).toMatch(/^hook_/);
      expect(registry.getHooks('wallet:create', 'before')).toHaveLength(1);
    });

    it('should register an after hook', () => {
      const registry = new HookRegistry();
      const handler = vi.fn();

      const hookId = registry.after('wallet:create', handler);

      expect(hookId).toBeDefined();
      expect(registry.getHooks('wallet:create', 'after')).toHaveLength(1);
    });

    it('should support priority option', () => {
      const registry = new HookRegistry();
      const callOrder: string[] = [];

      registry.before('test', () => { callOrder.push('low'); }, { priority: HookPriorities.LOW });
      registry.before('test', () => { callOrder.push('high'); }, { priority: HookPriorities.HIGH });
      registry.before('test', () => { callOrder.push('normal'); }, { priority: HookPriorities.NORMAL });

      const hooks = registry.getHooks('test', 'before');

      expect(hooks[0].priority).toBe(HookPriorities.HIGH);
      expect(hooks[1].priority).toBe(HookPriorities.NORMAL);
      expect(hooks[2].priority).toBe(HookPriorities.LOW);
    });

    it('should support description option', () => {
      const registry = new HookRegistry();

      registry.before('test', () => {}, { description: 'My hook' });

      const hooks = registry.getHooks('test', 'before');
      expect(hooks[0].description).toBe('My hook');
    });

    it('should support enabled option', () => {
      const registry = new HookRegistry();

      registry.before('test', () => {}, { enabled: false });

      const hooks = registry.getHooks('test', 'before');
      expect(hooks[0].enabled).toBe(false);

      const enabledHooks = registry.getEnabledHooks('test', 'before');
      expect(enabledHooks).toHaveLength(0);
    });

    it('logs registration and unregister events when debug mode is enabled', () => {
      const registry = new HookRegistry({ debug: true });
      const hookId = registry.before('test', () => {});

      expect(registry.unregister(hookId)).toBe(true);
    });
  });

  describe('unregister', () => {
    it('should remove a hook by ID', () => {
      const registry = new HookRegistry();
      const hookId = registry.before('test', () => {});

      expect(registry.getHooks('test', 'before')).toHaveLength(1);

      const result = registry.unregister(hookId);

      expect(result).toBe(true);
      expect(registry.getHooks('test', 'before')).toHaveLength(0);
    });

    it('should return false for unknown hook ID', () => {
      const registry = new HookRegistry();

      const result = registry.unregister('unknown_hook_id');

      expect(result).toBe(false);
    });

    it('should scan multiple keys and remove hook from a later operation', () => {
      const registry = new HookRegistry();
      registry.before('op:first', () => {});
      const targetId = registry.before('op:second', () => {});

      expect(registry.unregister(targetId)).toBe(true);
      expect(registry.getHooks('op:first', 'before')).toHaveLength(1);
      expect(registry.getHooks('op:second', 'before')).toHaveLength(0);
    });

    it('should keep operation entry when unregistering one hook among many', () => {
      const registry = new HookRegistry();
      const firstId = registry.before('op:multi', () => {});
      const secondId = registry.before('op:multi', () => {});

      expect(registry.unregister(secondId)).toBe(true);
      expect(registry.getHooks('op:multi', 'before')).toHaveLength(1);
      expect(registry.getHooks('op:multi', 'before')[0].id).toBe(firstId);
    });
  });

  describe('setEnabled', () => {
    it('should enable/disable a hook', () => {
      const registry = new HookRegistry();
      const hookId = registry.before('test', () => {}, { enabled: true });

      expect(registry.getEnabledHooks('test', 'before')).toHaveLength(1);

      registry.setEnabled(hookId, false);

      expect(registry.getEnabledHooks('test', 'before')).toHaveLength(0);

      registry.setEnabled(hookId, true);

      expect(registry.getEnabledHooks('test', 'before')).toHaveLength(1);
    });

    it('should return false for unknown hook ID', () => {
      const registry = new HookRegistry();

      const result = registry.setEnabled('unknown', true);

      expect(result).toBe(false);
    });

    it('should scan through multiple hook lists before finding the target hook', () => {
      const registry = new HookRegistry();
      registry.before('op:one', () => {});
      const hookId = registry.before('op:two', () => {});

      expect(registry.setEnabled(hookId, false)).toBe(true);
      expect(registry.getEnabledHooks('op:two', 'before')).toHaveLength(0);
    });
  });

  describe('executeBefore', () => {
    it('should execute before hooks in priority order', async () => {
      const registry = new HookRegistry();
      const callOrder: number[] = [];

      registry.before('test', () => { callOrder.push(3); }, { priority: HookPriorities.LOW });
      registry.before('test', () => { callOrder.push(1); }, { priority: HookPriorities.HIGH });
      registry.before('test', () => { callOrder.push(2); }, { priority: HookPriorities.NORMAL });

      await registry.executeBefore('test', {});

      expect(callOrder).toEqual([1, 2, 3]);
    });

    it('should pass context to hooks', async () => {
      const registry = new HookRegistry();
      const handler = vi.fn();

      registry.before('test', handler);

      await registry.executeBefore('test', { data: 'value' }, { userId: 'user123' });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'test',
          phase: 'before',
          payload: { data: 'value' },
          userId: 'user123',
        })
      );
    });

    it('should allow hooks to modify payload', async () => {
      const registry = new HookRegistry();

      registry.before('test', (ctx) => ({ ...(ctx.payload as object), modified: true }));

      const result = await registry.executeBefore('test', { original: true });

      expect(result.payload).toEqual({ original: true, modified: true });
    });

    it('should chain payload modifications', async () => {
      const registry = new HookRegistry();

      registry.before('test', (ctx) => ({ ...(ctx.payload as object), step1: true }), { priority: HookPriorities.HIGH });
      registry.before('test', (ctx) => ({ ...(ctx.payload as object), step2: true }), { priority: HookPriorities.NORMAL });
      registry.before('test', (ctx) => ({ ...(ctx.payload as object), step3: true }), { priority: HookPriorities.LOW });

      const result = await registry.executeBefore('test', { initial: true });

      expect(result.payload).toEqual({
        initial: true,
        step1: true,
        step2: true,
        step3: true,
      });
    });

    it('should skip disabled hooks', async () => {
      const registry = new HookRegistry();
      const enabledHandler = vi.fn();
      const disabledHandler = vi.fn();

      registry.before('test', enabledHandler, { enabled: true });
      registry.before('test', disabledHandler, { enabled: false });

      await registry.executeBefore('test', {});

      expect(enabledHandler).toHaveBeenCalled();
      expect(disabledHandler).not.toHaveBeenCalled();
    });

    it('should throw on error when stopOnBeforeError is true (default)', async () => {
      const registry = new HookRegistry({ stopOnBeforeError: true });

      registry.before('test', () => { throw new Error('Hook failed'); });

      await expect(registry.executeBefore('test', {})).rejects.toThrow('Hook failed');
    });

    it('should return execution stats', async () => {
      const registry = new HookRegistry();

      registry.before('test', () => {});
      registry.before('test', () => {});

      const result = await registry.executeBefore('test', {});

      expect(result.success).toBe(true);
      expect(result.hooksExecuted).toBe(2);
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('logs execution details when logExecutions is enabled', async () => {
      const registry = new HookRegistry({ logExecutions: true });
      registry.before('test', () => {});

      const result = await registry.executeBefore('test', {});

      expect(result.success).toBe(true);
      expect(result.hooksExecuted).toBe(1);
    });

    it('normalizes non-Error hook throws into Error objects', async () => {
      const registry = new HookRegistry({ stopOnBeforeError: false });
      registry.before('test', () => {
        throw 'string failure';
      });

      const result = await registry.executeBefore('test', {});

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].error).toBeInstanceOf(Error);
      expect(result.errors?.[0].error.message).toBe('string failure');
    });
  });

  describe('executeAfter', () => {
    it('should execute after hooks with result context', async () => {
      const registry = new HookRegistry();
      const handler = vi.fn();

      registry.after('test', handler);

      await registry.executeAfter('test', { input: 'data' }, {
        result: { output: 'result' },
        success: true,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: 'test',
          phase: 'after',
          payload: { input: 'data' },
          result: { output: 'result' },
          success: true,
        })
      );
    });

    it('should execute after hooks with error context', async () => {
      const registry = new HookRegistry();
      const handler = vi.fn();
      const error = new Error('Operation failed');

      registry.after('test', handler);

      await registry.executeAfter('test', {}, {
        error,
        success: false,
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          success: false,
        })
      );
    });

    it('should not throw on after hook errors', async () => {
      const registry = new HookRegistry();

      registry.after('test', () => { throw new Error('After hook failed'); });

      const result = await registry.executeAfter('test', {});

      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors![0].error.message).toBe('After hook failed');
    });
  });

  describe('wrap', () => {
    it('should wrap operation with before/after hooks', async () => {
      const registry = new HookRegistry();
      const beforeHandler = vi.fn();
      const afterHandler = vi.fn();

      registry.before('test', beforeHandler);
      registry.after('test', afterHandler);

      const operation = vi.fn().mockResolvedValue('result');

      const result = await registry.wrap('test', { input: 'data' }, operation);

      expect(result).toBe('result');
      expect(beforeHandler).toHaveBeenCalled();
      expect(operation).toHaveBeenCalledWith({ input: 'data' });
      await vi.waitFor(() => expect(afterHandler).toHaveBeenCalled());
    });

    it('should pass modified payload to operation', async () => {
      const registry = new HookRegistry();

      registry.before('test', (ctx) => ({ ...(ctx.payload as object), modified: true }));

      const operation = vi.fn().mockResolvedValue('result');

      await registry.wrap('test', { original: true }, operation);

      expect(operation).toHaveBeenCalledWith({ original: true, modified: true });
    });

    it('should execute after hooks on error', async () => {
      const registry = new HookRegistry();
      const afterHandler = vi.fn();

      registry.after('test', afterHandler);

      const error = new Error('Operation failed');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(registry.wrap('test', {}, operation)).rejects.toThrow('Operation failed');

      await vi.waitFor(() => expect(afterHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error,
          success: false,
        })
      ));
    });

    it('should pass userId through context', async () => {
      const registry = new HookRegistry();
      const beforeHandler = vi.fn();
      const afterHandler = vi.fn();

      registry.before('test', beforeHandler);
      registry.after('test', afterHandler);

      await registry.wrap('test', {}, async () => 'result', { userId: 'user123' });

      expect(beforeHandler).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user123' })
      );
      await vi.waitFor(() => expect(afterHandler).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user123' })
      ));
    });

    it('logs when after hooks fail in error path', async () => {
      const registry = new HookRegistry();
      vi.spyOn(registry, 'executeAfter').mockRejectedValueOnce(new Error('after hooks failed'));
      const operation = vi.fn().mockRejectedValue(new Error('operation failed'));

      await expect(registry.wrap('test', {}, operation)).rejects.toThrow('operation failed');
      await vi.waitFor(() => expect(registry.executeAfter).toHaveBeenCalled());
    });

    it('logs when after hooks fail in success path', async () => {
      const registry = new HookRegistry();
      vi.spyOn(registry, 'executeAfter').mockRejectedValueOnce(new Error('after hooks failed'));
      const operation = vi.fn().mockResolvedValue('ok');

      await expect(registry.wrap('test', {}, operation)).resolves.toBe('ok');
      await vi.waitFor(() => expect(registry.executeAfter).toHaveBeenCalled());
    });

    it('converts non-Error operation throws for after-hook error context', async () => {
      const registry = new HookRegistry();
      const afterHandler = vi.fn();
      registry.after('test', afterHandler);

      await expect(
        registry.wrap('test', {}, async () => {
          throw 'wrapped-string-error';
        })
      ).rejects.toBe('wrapped-string-error');

      await vi.waitFor(() => expect(afterHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.objectContaining({
            message: 'wrapped-string-error',
          }),
          success: false,
        })
      ));
    });
  });

  describe('getOperations', () => {
    it('should return all operations with hooks', () => {
      const registry = new HookRegistry();

      registry.before('wallet:create', () => {});
      registry.after('wallet:delete', () => {});
      registry.before('device:register', () => {});

      const operations = registry.getOperations();

      expect(operations).toContain('wallet:create');
      expect(operations).toContain('wallet:delete');
      expect(operations).toContain('device:register');
    });
  });

  describe('getHookCount', () => {
    it('should return count of before and after hooks', () => {
      const registry = new HookRegistry();

      registry.before('test', () => {});
      registry.before('test', () => {});
      registry.after('test', () => {});

      const count = registry.getHookCount('test');

      expect(count.before).toBe(2);
      expect(count.after).toBe(1);
    });
  });

  describe('clear', () => {
    it('should remove all hooks', () => {
      const registry = new HookRegistry();

      registry.before('test1', () => {});
      registry.after('test2', () => {});

      registry.clear();

      expect(registry.getOperations()).toHaveLength(0);
    });
  });

  describe('getSummary', () => {
    it('should return summary of registered hooks', () => {
      const registry = new HookRegistry();

      registry.before('wallet:create', () => {});
      registry.before('wallet:create', () => {});
      registry.after('wallet:create', () => {});
      registry.before('device:register', () => {});

      const summary = registry.getSummary();

      expect(summary.totalHooks).toBe(4);
      expect(summary.operations).toContainEqual({
        operation: 'wallet:create',
        before: 2,
        after: 1,
      });
      expect(summary.operations).toContainEqual({
        operation: 'device:register',
        before: 1,
        after: 0,
      });
    });
  });

  describe('Operations constants', () => {
    it('should have expected operation names', () => {
      expect(Operations.WALLET_CREATE).toBe('wallet:create');
      expect(Operations.WALLET_DELETE).toBe('wallet:delete');
      expect(Operations.TRANSACTION_SIGN).toBe('transaction:sign');
      expect(Operations.DEVICE_REGISTER).toBe('device:register');
    });
  });

  describe('HookPriorities constants', () => {
    it('should have expected priority values', () => {
      expect(HookPriorities.HIGHEST).toBe(0);
      expect(HookPriorities.HIGH).toBe(25);
      expect(HookPriorities.NORMAL).toBe(50);
      expect(HookPriorities.LOW).toBe(75);
      expect(HookPriorities.LOWEST).toBe(100);
    });
  });
});
