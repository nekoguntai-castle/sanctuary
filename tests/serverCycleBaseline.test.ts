import { describe, expect, it } from 'vitest';
import {
  canonicalCycleKeys,
  canonicalCircularEdges,
  compareCycleInventory,
} from '../scripts/check-server-cycle-baseline.mjs';

describe('server cycle baseline', () => {
  it('canonicalizes rotated cycle reports into one stable member set', () => {
    const modules = [
      { source: 'b.ts', dependencies: [{ circular: true, cycle: [{ name: 'a.ts' }, { name: 'b.ts' }] }] },
      { source: 'a.ts', dependencies: [{ circular: true, cycle: [{ name: 'b.ts' }, { name: 'a.ts' }] }] },
    ];
    expect(canonicalCycleKeys(modules)).toEqual(['a.ts -> b.ts']);
  });

  it('reports added and removed cycle sets', () => {
    expect(compareCycleInventory(['a', 'b'], ['b', 'c'])).toEqual({
      added: ['c'],
      removed: ['a'],
    });
  });

  it('retains circular edge topology within a known member set', () => {
    const modules = [
      { source: 'a.ts', dependencies: [{ resolved: 'b.ts', circular: true }] },
      { source: 'b.ts', dependencies: [{ resolved: 'a.ts', circular: true }] },
    ];
    expect(canonicalCircularEdges(modules)).toEqual(['a.ts -> b.ts', 'b.ts -> a.ts']);
  });
});
