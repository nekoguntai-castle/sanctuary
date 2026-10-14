import { describe, expect, it } from 'vitest';
import {
  advanceMyceliumGrowth,
  MYCELIUM_MAX_NODES,
  MYCELIUM_MAX_TIPS,
  type MyceliumState,
} from '../../../../src/components/animations/myceliumNetwork/model';

function createLcg(seed: number) {
  let value = seed;
  return function next(): number {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function seedState(random: () => number): MyceliumState {
  const state: MyceliumState = { nodes: [], branches: [], tips: [] };
  for (let i = 0; i < 4; i++) {
    state.nodes.push({
      x: 600 + i * 200,
      y: 1000,
      connections: [],
      pulsePhase: 0,
      size: 5,
      bloomPhase: 0,
      isBloomNode: false,
    });
    for (let t = 0; t < 3; t++) {
      state.tips.push({
        x: 600 + i * 200,
        y: 1000,
        angle: (t / 3) * Math.PI * 2 + random(),
        parentNode: i,
        age: 0,
        thickness: 2,
      });
    }
  }
  return state;
}

describe('advanceMyceliumGrowth', () => {
  it.each([1, 2, 3])('keeps nodes, branches and tips bounded over a long session (seed %i)', (seed) => {
    const random = createLcg(seed);
    const state = seedState(random);

    for (let frame = 0; frame < 50_000; frame++) {
      advanceMyceliumGrowth(state, { width: 2000, height: 2000 }, random);
    }

    expect(state.nodes.length).toBeLessThanOrEqual(MYCELIUM_MAX_NODES);
    expect(state.branches.length).toBeLessThanOrEqual(MYCELIUM_MAX_NODES);
    expect(state.tips.length).toBeLessThanOrEqual(MYCELIUM_MAX_TIPS);
  });
});
