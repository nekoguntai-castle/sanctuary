/**
 * Mycelium Network growth model
 *
 * Pure growth step for the mycelium animation, split out of the hook so the
 * growth bounds can be tested without a canvas.
 */

export interface MyceliumNode {
  x: number;
  y: number;
  connections: number[];
  pulsePhase: number;
  size: number;
  bloomPhase: number;
  isBloomNode: boolean;
}

export interface MyceliumPulse {
  position: number; // 0-1 along branch
  speed: number;
  size: number;
  opacity: number;
}

export interface MyceliumBranch {
  startNode: number;
  endNode: number;
  progress: number;
  growthSpeed: number;
  thickness: number;
  pulses: MyceliumPulse[];
}

export interface MyceliumTip {
  x: number;
  y: number;
  angle: number;
  parentNode: number;
  age: number;
  thickness: number;
}

export interface MyceliumState {
  nodes: MyceliumNode[];
  branches: MyceliumBranch[];
  tips: MyceliumTip[];
}

export type Random = () => number;

/** Hard caps so a long-lived background cannot grow without bound. */
export const MYCELIUM_MAX_NODES = 150;
export const MYCELIUM_MAX_TIPS = 20;

export function addNode(
  state: MyceliumState,
  x: number,
  y: number,
  parentIndex: number,
  random: Random
): number {
  const node: MyceliumNode = {
    x,
    y,
    connections: [parentIndex],
    pulsePhase: random() * Math.PI * 2,
    size: 2 + random() * 3,
    bloomPhase: 0,
    isBloomNode: random() < 0.15,
  };
  const newIndex = state.nodes.length;
  state.nodes.push(node);
  state.nodes[parentIndex].connections.push(newIndex);

  state.branches.push({
    startNode: parentIndex,
    endNode: newIndex,
    progress: 0,
    growthSpeed: 0.02 + random() * 0.02,
    thickness: 1 + random() * 2,
    pulses: [],
  });

  return newIndex;
}

function advanceTip(
  state: MyceliumState,
  tip: MyceliumTip,
  size: { width: number; height: number },
  random: Random
): boolean {
  const { width, height } = size;
  tip.age += 1;

  // Grow
  const speed = 0.5 + random() * 0.3;
  tip.angle += (random() - 0.5) * 0.1; // Slight wandering
  tip.x += Math.cos(tip.angle) * speed;
  tip.y += Math.sin(tip.angle) * speed;

  // Create node and branch occasionally
  if (tip.age > 30 && random() < 0.02) {
    // At the node cap the tip retires instead of growing the network further.
    if (state.nodes.length >= MYCELIUM_MAX_NODES) return false;
    const newNodeIndex = addNode(state, tip.x, tip.y, tip.parentNode, random);
    tip.parentNode = newNodeIndex;
    tip.age = 0;

    // Maybe branch
    if (random() < 0.3 && state.tips.length < MYCELIUM_MAX_TIPS) {
      state.tips.push({
        x: tip.x,
        y: tip.y,
        angle: tip.angle + (random() < 0.5 ? 0.5 : -0.5) + (random() - 0.5) * 0.3,
        parentNode: newNodeIndex,
        age: 0,
        thickness: tip.thickness * 0.8,
      });
    }
  }

  // Stop growing if out of bounds or too many nodes
  if (tip.x < 0 || tip.x > width || tip.y < 0 || tip.y > height) {
    return false;
  }
  if (state.nodes.length > 100) {
    return random() > 0.01; // Slow down growth
  }

  return tip.age < 200;
}

/** Advance every growing tip one frame, then occasionally respawn growth. */
export function advanceMyceliumGrowth(
  state: MyceliumState,
  size: { width: number; height: number },
  random: Random
): void {
  // Pre-existing behaviour kept as-is: branch tips pushed during this filter are
  // dropped when its result replaces the array.
  state.tips = state.tips.filter((tip) => advanceTip(state, tip, size, random));

  // Occasionally start new growth from existing nodes
  if (
    state.tips.length < 5
    && state.nodes.length > 0
    && state.nodes.length < MYCELIUM_MAX_NODES
    && random() < 0.005
  ) {
    const nodeIndex = Math.floor(random() * state.nodes.length);
    const node = state.nodes[nodeIndex];
    state.tips.push({
      x: node.x,
      y: node.y,
      angle: random() * Math.PI * 2,
      parentNode: nodeIndex,
      age: 0,
      thickness: 1.5 + random() * 1.5,
    });
  }
}
