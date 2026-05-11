import { describe, expect, it, vi } from 'vitest';

import { PrioritizedRegistry, type RegistryDetectionResult } from '@sanctuary/shared/utils/priorityRegistry';

interface TestEntry {
  id: string;
  priority: number;
  label: string;
}

function entry(id: string, priority: number): TestEntry {
  return { id, priority, label: `${id}-label` };
}

describe('PrioritizedRegistry', () => {
  it('registers entries by descending priority and returns snapshots', () => {
    const registry = new PrioritizedRegistry<TestEntry>('Test entry');

    registry.register(entry('low', 10));
    registry.register(entry('high', 90));
    registry.register(entry('middle', 50));

    expect(registry.count).toBe(3);
    expect(registry.getAll().map((item) => item.id)).toEqual(['high', 'middle', 'low']);

    const snapshot = registry.getAll();
    snapshot.pop();

    expect(registry.count).toBe(3);
  });

  it('rejects duplicate IDs and supports get and unregister', () => {
    const registry = new PrioritizedRegistry<TestEntry>('Test entry');
    const first = entry('dup', 10);

    registry.register(first);

    expect(() => registry.register(entry('dup', 20))).toThrow("Test entry 'dup' is already registered");
    expect(registry.get('dup')).toBe(first);
    expect(registry.unregister('dup')).toBe(true);
    expect(registry.unregister('dup')).toBe(false);
    expect(registry.get('dup')).toBeUndefined();
  });

  it('detects the first matching entry and reports detection errors', () => {
    const registry = new PrioritizedRegistry<TestEntry>('Test entry');
    const onDetected = vi.fn();
    const onError = vi.fn();

    registry.register(entry('match', 10));
    registry.register(entry('throwing', 90));

    const result = registry.detectFirst<RegistryDetectionResult>(
      (item) => {
        if (item.id === 'throwing') {
          throw new Error('bad detector');
        }
        return { detected: item.id === 'match', confidence: 80 };
      },
      { onDetected, onError }
    );

    expect(result?.id).toBe('match');
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ id: 'throwing' }), expect.any(Error));
    expect(onDetected).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'match' }),
      { detected: true, confidence: 80 }
    );
  });

  it('returns null when no entry detects the input', () => {
    const registry = new PrioritizedRegistry<TestEntry>('Test entry');
    registry.register(entry('miss', 10));

    expect(registry.detectFirst(() => ({ detected: false, confidence: 0 }))).toBeNull();
  });

  it('detects all entries with fallback values sorted by confidence', () => {
    const registry = new PrioritizedRegistry<TestEntry>('Test entry');

    registry.register(entry('low-confidence', 90));
    registry.register(entry('throwing', 50));
    registry.register(entry('high-confidence', 10));

    const results = registry.detectAll<RegistryDetectionResult>(
      (item) => {
        if (item.id === 'throwing') {
          throw new Error('bad detector');
        }
        return {
          detected: true,
          confidence: item.id === 'high-confidence' ? 90 : 10,
        };
      },
      () => ({ detected: false, confidence: 0 })
    );

    expect(results.map(({ entry: item }) => item.id)).toEqual([
      'high-confidence',
      'low-confidence',
      'throwing',
    ]);
    expect(results[2].result).toEqual({ detected: false, confidence: 0 });
  });
});
