/**
 * Bamboo Sway Animation (Enhanced Forest Version)
 * Dense bamboo forest with many stalks, branches, and leaves swaying in the breeze
 */

import { useRef, useEffect } from 'react';

interface BambooLeaf {
  segment: number;
  side: number;
  size: number;
  angle: number;
  offsetY: number;
  curvature: number;
  colorVariant: number;
}

interface BambooBranch {
  segment: number;
  side: number;
  length: number;
  angle: number;
  leaves: BambooLeaf[];
}

interface BambooStalk {
  x: number;
  baseY: number;
  segments: number;
  segmentHeight: number;
  thickness: number;
  swayPhase: number;
  swaySpeed: number;
  leaves: BambooLeaf[];
  branches: BambooBranch[];
  opacity: number;
  colorScheme: number;
  layer: number; // 0 = back, 1 = mid, 2 = front for depth
}

interface BambooColorScheme {
  stalk: number[];
  leaf: number[];
  accent: number[];
}

interface BambooLayerConfig {
  layer: number;
  countDivisor: number;
  countOffset: number;
  segmentBase: number;
  segmentRange: number;
  startSegment: number;
  jitter: number;
  baseYOffset: number;
  segmentHeightBase: number;
  segmentHeightRange: number;
  thicknessBase: number;
  thicknessRange: number;
  swaySpeedBase: number;
  swaySpeedRange: number;
  opacityBase: number;
  opacityRange: number;
  leafChance: number;
  extraLeafChance: number;
  extraLeafUsesSameSide: boolean;
  branchChance: number;
  extraBranchChance: number;
}

const DARK_BAMBOO_COLOR_SCHEMES: BambooColorScheme[] = [
  { stalk: [60, 80, 55], leaf: [75, 100, 65], accent: [90, 115, 75] },
  { stalk: [50, 70, 45], leaf: [70, 95, 60], accent: [85, 110, 70] },
  { stalk: [55, 75, 50], leaf: [65, 90, 55], accent: [80, 105, 65] },
  { stalk: [45, 65, 40], leaf: [60, 85, 50], accent: [75, 100, 60] },
];

const LIGHT_BAMBOO_COLOR_SCHEMES: BambooColorScheme[] = [
  { stalk: [145, 170, 135], leaf: [160, 190, 150], accent: [175, 205, 165] },
  { stalk: [135, 160, 125], leaf: [155, 185, 145], accent: [170, 200, 160] },
  { stalk: [140, 165, 130], leaf: [150, 180, 140], accent: [165, 195, 155] },
  { stalk: [130, 155, 120], leaf: [145, 175, 135], accent: [160, 190, 150] },
];

const BAMBOO_LAYER_CONFIGS: BambooLayerConfig[] = [
  {
    layer: 0,
    countDivisor: 60,
    countOffset: 5,
    segmentBase: 4,
    segmentRange: 3,
    startSegment: 1,
    jitter: 50,
    baseYOffset: 30,
    segmentHeightBase: 40,
    segmentHeightRange: 25,
    thicknessBase: 5,
    thicknessRange: 3,
    swaySpeedBase: 0.15,
    swaySpeedRange: 0.2,
    opacityBase: 0.06,
    opacityRange: 0.04,
    leafChance: 0.7,
    extraLeafChance: 0.5,
    extraLeafUsesSameSide: true,
    branchChance: 0.8,
    extraBranchChance: 0.4,
  },
  {
    layer: 1,
    countDivisor: 100,
    countOffset: 4,
    segmentBase: 5,
    segmentRange: 4,
    startSegment: 2,
    jitter: 80,
    baseYOffset: 25,
    segmentHeightBase: 50,
    segmentHeightRange: 35,
    thicknessBase: 7,
    thicknessRange: 4,
    swaySpeedBase: 0.2,
    swaySpeedRange: 0.25,
    opacityBase: 0.09,
    opacityRange: 0.05,
    leafChance: 0.6,
    extraLeafChance: 0.4,
    extraLeafUsesSameSide: false,
    branchChance: 0.75,
    extraBranchChance: 0.5,
  },
  {
    layer: 2,
    countDivisor: 150,
    countOffset: 3,
    segmentBase: 6,
    segmentRange: 4,
    startSegment: 2,
    jitter: 100,
    baseYOffset: 20,
    segmentHeightBase: 55,
    segmentHeightRange: 40,
    thicknessBase: 9,
    thicknessRange: 5,
    swaySpeedBase: 0.25,
    swaySpeedRange: 0.35,
    opacityBase: 0.12,
    opacityRange: 0.06,
    leafChance: 0.5,
    extraLeafChance: 0.35,
    extraLeafUsesSameSide: true,
    branchChance: 0.7,
    extraBranchChance: 0.45,
  },
];

const getBambooColorSchemes = (darkMode: boolean) =>
  darkMode ? DARK_BAMBOO_COLOR_SCHEMES : LIGHT_BAMBOO_COLOR_SCHEMES;

const randomSide = () => (Math.random() < 0.5 ? -1 : 1);

const createLeaf = (segment: number, side: number): BambooLeaf => ({
  segment,
  side,
  size: 12 + Math.random() * 22,
  angle: (Math.random() - 0.5) * 0.7,
  offsetY: Math.random() * 0.5,
  curvature: 0.08 + Math.random() * 0.18,
  colorVariant: Math.floor(Math.random() * 4),
});

const createBranch = (segment: number, side: number): BambooBranch => {
  const leafCount = 3 + Math.floor(Math.random() * 5); // More leaves per branch
  const leaves: BambooLeaf[] = [];
  for (let i = 0; i < leafCount; i++) {
    leaves.push({
      segment,
      side,
      size: 10 + Math.random() * 18,
      angle: (Math.random() - 0.5) * 0.9 + (i * 0.15 - 0.3),
      offsetY: 0.2 + (i / leafCount) * 0.7,
      curvature: 0.08 + Math.random() * 0.12,
      colorVariant: Math.floor(Math.random() * 4),
    });
  }
  return {
    segment,
    side,
    length: 25 + Math.random() * 50,
    angle: side * (0.25 + Math.random() * 0.5),
    leaves,
  };
};

const addLayerLeaves = (
  leaves: BambooLeaf[],
  segment: number,
  config: BambooLayerConfig,
) => {
  if (Math.random() >= config.leafChance) return;

  const side = randomSide();
  leaves.push(createLeaf(segment, side));
  if (Math.random() < config.extraLeafChance) {
    leaves.push(
      createLeaf(segment, config.extraLeafUsesSameSide ? side : -side),
    );
  }
};

const addLayerBranches = (
  branches: BambooBranch[],
  segment: number,
  config: BambooLayerConfig,
) => {
  if (Math.random() >= config.branchChance) return;

  const side = randomSide();
  branches.push(createBranch(segment, side));
  if (Math.random() < config.extraBranchChance) {
    branches.push(createBranch(segment, -side));
  }
};

const createStalkFeatures = (
  segments: number,
  config: BambooLayerConfig,
): Pick<BambooStalk, 'leaves' | 'branches'> => {
  const leaves: BambooLeaf[] = [];
  const branches: BambooBranch[] = [];

  for (let segment = config.startSegment; segment < segments; segment++) {
    addLayerLeaves(leaves, segment, config);
    addLayerBranches(branches, segment, config);
  }

  return { leaves, branches };
};

const createLayerStalk = (
  index: number,
  count: number,
  width: number,
  height: number,
  config: BambooLayerConfig,
): BambooStalk => {
  const segments =
    config.segmentBase + Math.floor(Math.random() * config.segmentRange);
  const { leaves, branches } = createStalkFeatures(segments, config);

  return {
    x:
      (width / count) * index +
      Math.random() * config.jitter -
      config.jitter / 2,
    baseY: height + config.baseYOffset,
    segments,
    segmentHeight:
      config.segmentHeightBase + Math.random() * config.segmentHeightRange,
    thickness: config.thicknessBase + Math.random() * config.thicknessRange,
    swayPhase: Math.random() * Math.PI * 2,
    swaySpeed: config.swaySpeedBase + Math.random() * config.swaySpeedRange,
    leaves,
    branches,
    opacity: config.opacityBase + Math.random() * config.opacityRange,
    colorScheme: Math.floor(Math.random() * 4),
    layer: config.layer,
  };
};

const createLayerStalks = (
  width: number,
  height: number,
  config: BambooLayerConfig,
): BambooStalk[] => {
  const count = Math.floor(width / config.countDivisor) + config.countOffset;
  const stalks: BambooStalk[] = [];

  for (let i = 0; i < count; i++) {
    stalks.push(createLayerStalk(i, count, width, height, config));
  }

  return stalks;
};

const createBambooStalks = (width: number, height: number): BambooStalk[] =>
  BAMBOO_LAYER_CONFIGS.flatMap((config) =>
    createLayerStalks(width, height, config),
  ).sort((a, b) => a.layer - b.layer);

const drawLeaf = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  leaf: BambooLeaf,
  sway: number,
  colors: BambooColorScheme,
  baseOpacity: number,
  opacityMult: number,
) => {
  const leafSway = sway * 0.3;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(leaf.side * (0.65 + leafSway) + leaf.angle);

  const colorBase = leaf.colorVariant < 2 ? colors.leaf : colors.accent;
  const leafOpacity =
    baseOpacity * opacityMult * (0.55 + leaf.colorVariant * 0.08);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(
    leaf.size * 0.22,
    -leaf.size * (0.07 + leaf.curvature),
    leaf.size * 0.58,
    -leaf.size * 0.1,
    leaf.size,
    0,
  );
  ctx.bezierCurveTo(
    leaf.size * 0.58,
    leaf.size * 0.08,
    leaf.size * 0.22,
    leaf.size * (0.05 + leaf.curvature * 0.5),
    0,
    0,
  );

  ctx.fillStyle = `rgba(${colorBase[0]}, ${colorBase[1]}, ${colorBase[2]}, ${leafOpacity})`;
  ctx.fill();

  // Subtle vein
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.quadraticCurveTo(
    leaf.size * 0.5,
    -leaf.size * 0.015,
    leaf.size * 0.85,
    0,
  );
  ctx.strokeStyle = `rgba(${colorBase[0] - 15}, ${colorBase[1] - 8}, ${
    colorBase[2] - 15
  }, ${leafOpacity * 0.35})`;
  ctx.lineWidth = 0.4;
  ctx.stroke();

  ctx.restore();
};

const drawBambooBranch = (
  ctx: CanvasRenderingContext2D,
  branch: BambooBranch,
  branchSway: number,
  colors: BambooColorScheme,
  baseOpacity: number,
  opacityMultiplier: number,
) => {
  ctx.save();
  ctx.rotate(branch.angle + branchSway * 0.35);

  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(
    branch.length * 0.5,
    -branch.length * 0.08,
    branch.length,
    0,
  );
  ctx.strokeStyle = `rgba(${colors.stalk[0]}, ${colors.stalk[1]}, ${colors.stalk[2]}, ${
    baseOpacity * opacityMultiplier * 0.65
  })`;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  branch.leaves.forEach((leaf) => {
    const leafX = branch.length * leaf.offsetY;
    const leafY = -branch.length * 0.08 * leaf.offsetY * (1 - leaf.offsetY) * 4;
    drawLeaf(
      ctx,
      leafX,
      leafY,
      leaf,
      branchSway,
      colors,
      baseOpacity,
      opacityMultiplier,
    );
  });

  ctx.restore();
};

const drawStalkSegment = (
  ctx: CanvasRenderingContext2D,
  stalk: BambooStalk,
  colors: BambooColorScheme,
  opacityMultiplier: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  segmentWidth: number,
) => {
  const stalkColor = `rgba(${colors.stalk[0]}, ${colors.stalk[1]}, ${colors.stalk[2]}, ${
    stalk.opacity * opacityMultiplier
  })`;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = stalkColor;
  ctx.lineWidth = segmentWidth;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Highlight
  ctx.beginPath();
  ctx.moveTo(from.x + segmentWidth * 0.2, from.y);
  ctx.lineTo(to.x + segmentWidth * 0.2, to.y);
  ctx.strokeStyle = `rgba(${colors.accent[0]}, ${colors.accent[1]}, ${colors.accent[2]}, ${
    stalk.opacity * opacityMultiplier * 0.25
  })`;
  ctx.lineWidth = segmentWidth * 0.25;
  ctx.stroke();

  // Node
  ctx.beginPath();
  ctx.ellipse(to.x, to.y, stalk.thickness * 0.85, 3.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${colors.stalk[0] - 12}, ${colors.stalk[1] - 8}, ${
    colors.stalk[2] - 12
  }, ${stalk.opacity * opacityMultiplier * 1.15})`;
  ctx.fill();
};

const drawSegmentBranches = (
  ctx: CanvasRenderingContext2D,
  stalk: BambooStalk,
  segment: number,
  position: { x: number; y: number },
  sway: number,
  secondarySway: number,
  colors: BambooColorScheme,
  opacityMultiplier: number,
) => {
  stalk.branches.forEach((branch) => {
    if (branch.segment !== segment) return;

    const branchSway = sway * 0.45 + secondarySway * 0.25;
    ctx.save();
    ctx.translate(position.x, position.y);
    drawBambooBranch(
      ctx,
      branch,
      branchSway,
      colors,
      stalk.opacity,
      opacityMultiplier,
    );
    ctx.restore();
  });
};

const drawSegmentLeaves = (
  ctx: CanvasRenderingContext2D,
  stalk: BambooStalk,
  segment: number,
  position: { x: number; y: number },
  sway: number,
  colors: BambooColorScheme,
  opacityMultiplier: number,
) => {
  stalk.leaves.forEach((leaf) => {
    if (leaf.segment === segment) {
      drawLeaf(
        ctx,
        position.x,
        position.y,
        leaf,
        sway,
        colors,
        stalk.opacity,
        opacityMultiplier,
      );
    }
  });
};

const drawBamboo = (
  ctx: CanvasRenderingContext2D,
  stalk: BambooStalk,
  time: number,
  opacity: number,
  colorSchemes: BambooColorScheme[],
) => {
  const opacityMultiplier = opacity / 50;
  const colors = colorSchemes[stalk.colorScheme];
  const sway = Math.sin(time * stalk.swaySpeed + stalk.swayPhase) * 1.8;
  const secondarySway =
    Math.sin(time * stalk.swaySpeed * 1.4 + stalk.swayPhase + 1) * 1.5;

  let previous = { x: stalk.x, y: stalk.baseY };

  for (let i = 0; i < stalk.segments; i++) {
    const swayOffset = sway * (i + 1) * 2.5;
    const position = {
      x: stalk.x + swayOffset,
      y: stalk.baseY - (i + 1) * stalk.segmentHeight,
    };
    const segmentWidth = stalk.thickness * (1 - i * 0.06);

    drawStalkSegment(
      ctx,
      stalk,
      colors,
      opacityMultiplier,
      previous,
      position,
      segmentWidth,
    );
    drawSegmentBranches(
      ctx,
      stalk,
      i,
      position,
      sway,
      secondarySway,
      colors,
      opacityMultiplier,
    );
    drawSegmentLeaves(ctx, stalk, i, position, sway, colors, opacityMultiplier);

    previous = position;
  }
};

export function useBambooSway(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean,
) {
  const stalksRef = useRef<BambooStalk[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const colorSchemes = getBambooColorSchemes(darkMode);

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      stalksRef.current = createBambooStalks(canvas.width, canvas.height);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      stalksRef.current.forEach((stalk) => {
        drawBamboo(ctx, stalk, timeRef.current, opacity, colorSchemes);
      });

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, active]);
}
