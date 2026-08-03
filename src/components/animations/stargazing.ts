/**
 * Stargazing Animation
 *
 * Peaceful night sky scene with twinkling stars, constellations,
 * occasional shooting stars, and a silhouetted landscape.
 * Stars primarily on sides to keep center clear.
 * All random values pre-generated for smooth, flicker-free animation.
 */

import { useEffect, RefObject } from 'react';

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
  twinkleSpeed: number;
  twinklePhase: number;
  color: string;
}

interface ShootingStar {
  x: number;
  y: number;
  angle: number;
  speed: number;
  length: number;
  life: number;
  maxLife: number;
  isBig?: boolean; // Rare bigger shooting stars
}

interface Constellation {
  stars: { x: number; y: number }[];
  connections: [number, number][];
}

interface CloudPuff {
  offsetX: number;
  offsetY: number;
  size: number;
}

interface Cloud {
  x: number;
  y: number;
  baseSize: number;
  opacity: number;
  targetOpacity: number;
  speed: number;
  puffs: CloudPuff[];
}

interface Tree {
  x: number;
  height: number;
  width: number;
  type: 'pine' | 'deciduous';
}

interface Firefly {
  x: number;
  y: number;
  glowPhase: number;
  targetX: number;
  targetY: number;
  size: number;
}

interface StargazingScene {
  stars: Star[];
  shootingStars: ShootingStar[];
  constellations: Constellation[];
  clouds: Cloud[];
  trees: Tree[];
  fireflies: Firefly[];
}

const STAR_COLORS = ['#FFFFFF', '#FFFACD', '#ADD8E6', '#FFE4E1', '#E6E6FA'];

const createEmptyStargazingScene = (): StargazingScene => {
  return {
    stars: [],
    shootingStars: [],
    constellations: [],
    clouds: [],
    trees: [],
    fireflies: [],
  };
};

const isInSideZone = (x: number, width: number): boolean => {
  const centerStart = width * 0.3;
  const centerEnd = width * 0.7;
  return x < centerStart || x > centerEnd;
};

const getRandomSidePosition = (width: number): number => {
  if (Math.random() >= 0.7) return Math.random() * width;
  if (Math.random() < 0.5) return Math.random() * width * 0.3;
  return width * 0.7 + Math.random() * width * 0.3;
};

const generateCloudPuffs = (baseSize: number): CloudPuff[] => {
  const puffs: CloudPuff[] = [];
  for (let i = 0; i < 5; i++) {
    puffs.push({
      offsetX: (i - 2) * baseSize * 0.3,
      offsetY: Math.sin(i * 1.5) * 10,
      size: baseSize * (0.3 + Math.random() * 0.3),
    });
  }
  return puffs;
};

const createStars = (width: number, height: number): Star[] => {
  const stars: Star[] = [];
  const starCount = Math.floor((width * height) / 8000);

  for (let i = 0; i < starCount; i++) {
    const x = getRandomSidePosition(width);
    const y = Math.random() * height * 0.7;

    stars.push({
      x,
      y,
      size: isInSideZone(x, width)
        ? 0.5 + Math.random() * 2
        : 0.3 + Math.random() * 1,
      brightness: 0.5 + Math.random() * 0.5,
      twinkleSpeed: 0.015 + Math.random() * 0.02,
      twinklePhase: Math.random() * Math.PI * 2,
      color: STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)],
    });
  }

  return stars;
};

const createLeftConstellation = (
  width: number,
  height: number,
): Constellation => {
  return {
    stars: [
      { x: width * 0.1, y: height * 0.15 },
      { x: width * 0.08, y: height * 0.25 },
      { x: width * 0.12, y: height * 0.25 },
      { x: width * 0.1, y: height * 0.3 },
      { x: width * 0.07, y: height * 0.35 },
      { x: width * 0.13, y: height * 0.35 },
      { x: width * 0.1, y: height * 0.4 },
    ],
    connections: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
      [3, 4],
      [3, 5],
      [4, 6],
      [5, 6],
    ],
  };
};

const createRightConstellation = (
  width: number,
  height: number,
): Constellation => {
  return {
    stars: [
      { x: width * 0.95, y: height * 0.08 },
      { x: width * 0.92, y: height * 0.11 },
      { x: width * 0.89, y: height * 0.13 },
      { x: width * 0.86, y: height * 0.15 },
      { x: width * 0.83, y: height * 0.18 },
      { x: width * 0.85, y: height * 0.22 },
      { x: width * 0.88, y: height * 0.19 },
    ],
    connections: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 3],
    ],
  };
};

const createConstellations = (
  width: number,
  height: number,
): Constellation[] => {
  if (width <= 600) return [];

  return [
    createLeftConstellation(width, height),
    createRightConstellation(width, height),
  ];
};

const createClouds = (width: number, height: number): Cloud[] => {
  const clouds: Cloud[] = [];

  for (let i = 0; i < 3; i++) {
    const baseSize = 100 + Math.random() * 150;
    const initialOpacity = 0.05 + Math.random() * 0.08;
    clouds.push({
      x: Math.random() * width,
      y: height * 0.1 + Math.random() * height * 0.3,
      baseSize,
      opacity: initialOpacity,
      targetOpacity: initialOpacity,
      speed: 0.02 + Math.random() * 0.03,
      puffs: generateCloudPuffs(baseSize),
    });
  }

  return clouds;
};

const createTrees = (width: number): Tree[] => {
  const trees: Tree[] = [];
  const treeCount = Math.floor(width / 60);

  for (let i = 0; i < treeCount; i++) {
    const treeX = (i / treeCount) * width;
    if (isInSideZone(treeX, width) || Math.random() < 0.3) {
      let type: Tree['type'] = 'deciduous';
      if (Math.random() < 0.6) type = 'pine';

      trees.push({
        x: treeX + Math.random() * 30 - 15,
        height: 40 + Math.random() * 80,
        width: 20 + Math.random() * 30,
        type,
      });
    }
  }

  return trees;
};

const createFireflies = (width: number, height: number): Firefly[] => {
  const fireflies: Firefly[] = [];
  const fireflyCount = Math.floor(width / 150);

  for (let i = 0; i < fireflyCount; i++) {
    const x = getRandomSidePosition(width);
    fireflies.push({
      x,
      y: height * 0.85 + Math.random() * height * 0.1,
      glowPhase: Math.random() * Math.PI * 2,
      targetX: getRandomSidePosition(width),
      targetY: height * 0.85 + Math.random() * height * 0.1,
      size: 0.8 + Math.random() * 0.7,
    });
  }

  return fireflies;
};

const createStargazingScene = (
  width: number,
  height: number,
): StargazingScene => {
  return {
    stars: createStars(width, height),
    shootingStars: [],
    constellations: createConstellations(width, height),
    clouds: createClouds(width, height),
    trees: createTrees(width),
    fireflies: createFireflies(width, height),
  };
};

const drawSky = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  darkMode: boolean,
) => {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, height);
  if (darkMode) {
    skyGradient.addColorStop(0, '#000510');
    skyGradient.addColorStop(0.4, '#0a1525');
    skyGradient.addColorStop(0.7, '#1a2535');
    skyGradient.addColorStop(1, '#2a3545');
  } else {
    skyGradient.addColorStop(0, '#1a1a3a');
    skyGradient.addColorStop(0.3, '#2a2a5a');
    skyGradient.addColorStop(0.6, '#3a3a7a');
    skyGradient.addColorStop(1, '#4a4a6a');
  }
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, width, height);

  const milkyWay = ctx.createLinearGradient(0, 0, width, height * 0.5);
  milkyWay.addColorStop(0, 'rgba(100, 100, 150, 0.1)');
  milkyWay.addColorStop(0.3, 'transparent');
  milkyWay.addColorStop(0.7, 'transparent');
  milkyWay.addColorStop(1, 'rgba(100, 100, 150, 0.1)');
  ctx.fillStyle = milkyWay;
  ctx.fillRect(0, 0, width, height * 0.6);
};

const drawStar = (ctx: CanvasRenderingContext2D, star: Star, time: number) => {
  const twinkle =
    Math.sin(time * star.twinkleSpeed + star.twinklePhase) * 0.3 + 0.7;
  const actualBrightness = star.brightness * twinkle;

  const glowGradient = ctx.createRadialGradient(
    star.x,
    star.y,
    0,
    star.x,
    star.y,
    star.size * 3,
  );
  glowGradient.addColorStop(0, `rgba(255, 255, 255, ${actualBrightness})`);
  glowGradient.addColorStop(
    0.3,
    `rgba(255, 255, 255, ${actualBrightness * 0.3})`,
  );
  glowGradient.addColorStop(1, 'transparent');

  ctx.fillStyle = glowGradient;
  ctx.beginPath();
  ctx.arc(star.x, star.y, star.size * 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = star.color;
  ctx.globalAlpha = actualBrightness;
  ctx.beginPath();
  ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
  ctx.fill();

  if (star.size > 1.2) {
    ctx.strokeStyle = star.color;
    ctx.lineWidth = 0.5;
    ctx.globalAlpha = actualBrightness * 0.5;

    ctx.beginPath();
    ctx.moveTo(star.x - star.size * 2, star.y);
    ctx.lineTo(star.x + star.size * 2, star.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(star.x, star.y - star.size * 2);
    ctx.lineTo(star.x, star.y + star.size * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
};

const drawConstellation = (
  ctx: CanvasRenderingContext2D,
  constellation: Constellation,
  time: number,
) => {
  ctx.strokeStyle = 'rgba(150, 180, 220, 0.3)';
  ctx.lineWidth = 1;

  constellation.connections.forEach(([from, to]) => {
    const fromStar = constellation.stars[from];
    const toStar = constellation.stars[to];

    ctx.beginPath();
    ctx.moveTo(fromStar.x, fromStar.y);
    ctx.lineTo(toStar.x, toStar.y);
    ctx.stroke();
  });

  constellation.stars.forEach((star) => {
    const twinkle = Math.sin(time * 0.015 + star.x) * 0.2 + 0.8;
    const glowGradient = ctx.createRadialGradient(
      star.x,
      star.y,
      0,
      star.x,
      star.y,
      8,
    );
    glowGradient.addColorStop(0, `rgba(200, 220, 255, ${twinkle})`);
    glowGradient.addColorStop(0.5, `rgba(200, 220, 255, ${twinkle * 0.3})`);
    glowGradient.addColorStop(1, 'transparent');

    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(star.x, star.y, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(star.x, star.y, 2, 0, Math.PI * 2);
    ctx.fill();
  });
};

const drawShootingStar = (
  ctx: CanvasRenderingContext2D,
  shootingStar: ShootingStar,
) => {
  const lifeRatio = shootingStar.life / shootingStar.maxLife;
  const lineWidth = shootingStar.isBig ? 4 : 2;
  const headRadius = shootingStar.isBig ? 12 : 5;

  ctx.save();
  ctx.translate(shootingStar.x, shootingStar.y);
  ctx.rotate(shootingStar.angle);

  const trailGradient = ctx.createLinearGradient(-shootingStar.length, 0, 0, 0);
  trailGradient.addColorStop(0, 'transparent');
  trailGradient.addColorStop(0.3, `rgba(255, 255, 255, ${lifeRatio * 0.3})`);
  trailGradient.addColorStop(1, `rgba(255, 255, 255, ${lifeRatio})`);

  ctx.strokeStyle = trailGradient;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(-shootingStar.length, 0);
  ctx.lineTo(0, 0);
  ctx.stroke();

  if (shootingStar.isBig) {
    const outerTrail = ctx.createLinearGradient(
      -shootingStar.length * 0.7,
      0,
      0,
      0,
    );
    outerTrail.addColorStop(0, 'transparent');
    outerTrail.addColorStop(0.5, `rgba(200, 220, 255, ${lifeRatio * 0.15})`);
    outerTrail.addColorStop(1, `rgba(200, 220, 255, ${lifeRatio * 0.25})`);
    ctx.strokeStyle = outerTrail;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.moveTo(-shootingStar.length * 0.7, 0);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }

  const headGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, headRadius);
  headGlow.addColorStop(0, `rgba(255, 255, 255, ${lifeRatio})`);
  headGlow.addColorStop(0.4, `rgba(220, 240, 255, ${lifeRatio * 0.7})`);
  headGlow.addColorStop(1, 'transparent');
  ctx.fillStyle = headGlow;
  ctx.beginPath();
  ctx.arc(0, 0, headRadius, 0, Math.PI * 2);
  ctx.fill();

  if (shootingStar.isBig) {
    const halo = ctx.createRadialGradient(
      0,
      0,
      headRadius * 0.5,
      0,
      0,
      headRadius * 2.5,
    );
    halo.addColorStop(0, `rgba(200, 220, 255, ${lifeRatio * 0.3})`);
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, headRadius * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
};

const drawCloud = (ctx: CanvasRenderingContext2D, cloud: Cloud) => {
  ctx.fillStyle = `rgba(100, 120, 150, ${cloud.opacity})`;

  cloud.puffs.forEach((puff) => {
    const puffX = cloud.x + puff.offsetX;
    const puffY = cloud.y + puff.offsetY;

    ctx.beginPath();
    ctx.arc(puffX, puffY, puff.size, 0, Math.PI * 2);
    ctx.fill();
  });
};

const drawPineTree = (
  ctx: CanvasRenderingContext2D,
  tree: Tree,
  baseY: number,
) => {
  ctx.beginPath();
  ctx.moveTo(tree.x, baseY);
  ctx.lineTo(tree.x - tree.width * 0.1, baseY);
  ctx.lineTo(tree.x - tree.width * 0.1, baseY - tree.height * 0.2);

  for (let layer = 0; layer < 4; layer++) {
    const layerY = baseY - tree.height * 0.2 - layer * tree.height * 0.2;
    const layerWidth = tree.width * (0.5 - layer * 0.1);
    ctx.lineTo(tree.x - layerWidth, layerY);
    ctx.lineTo(tree.x, layerY - tree.height * 0.15);
    ctx.lineTo(tree.x + layerWidth, layerY);
  }

  ctx.lineTo(tree.x + tree.width * 0.1, baseY - tree.height * 0.2);
  ctx.lineTo(tree.x + tree.width * 0.1, baseY);
  ctx.closePath();
  ctx.fill();
};

const drawDeciduousTree = (
  ctx: CanvasRenderingContext2D,
  tree: Tree,
  baseY: number,
) => {
  ctx.beginPath();
  ctx.moveTo(tree.x - tree.width * 0.1, baseY);
  ctx.lineTo(tree.x - tree.width * 0.1, baseY - tree.height * 0.4);
  ctx.arc(tree.x, baseY - tree.height * 0.7, tree.width * 0.5, Math.PI, 0);
  ctx.lineTo(tree.x + tree.width * 0.1, baseY - tree.height * 0.4);
  ctx.lineTo(tree.x + tree.width * 0.1, baseY);
  ctx.closePath();
  ctx.fill();
};

const drawTree = (
  ctx: CanvasRenderingContext2D,
  tree: Tree,
  height: number,
) => {
  const baseY = height;

  ctx.fillStyle = '#0a0a0a';

  if (tree.type === 'pine') {
    drawPineTree(ctx, tree, baseY);
    return;
  }

  drawDeciduousTree(ctx, tree, baseY);
};

const drawFirefly = (
  ctx: CanvasRenderingContext2D,
  firefly: Firefly,
  time: number,
) => {
  const glow = Math.sin(time * 0.03 + firefly.glowPhase) * 0.5 + 0.5;

  if (glow <= 0.4) return;

  const glowGradient = ctx.createRadialGradient(
    firefly.x,
    firefly.y,
    0,
    firefly.x,
    firefly.y,
    firefly.size * 4,
  );
  glowGradient.addColorStop(0, `rgba(255, 255, 150, ${glow * 0.35})`);
  glowGradient.addColorStop(0.4, `rgba(255, 255, 100, ${glow * 0.15})`);
  glowGradient.addColorStop(1, 'transparent');

  ctx.fillStyle = glowGradient;
  ctx.beginPath();
  ctx.arc(firefly.x, firefly.y, firefly.size * 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(255, 255, 200, ${glow * 0.5})`;
  ctx.beginPath();
  ctx.arc(firefly.x, firefly.y, firefly.size, 0, Math.PI * 2);
  ctx.fill();
};

const drawGround = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) => {
  ctx.fillStyle = '#0a0a0a';
  ctx.beginPath();
  ctx.moveTo(0, height);

  for (let x = 0; x <= width; x += 20) {
    const hillY =
      height - 30 - Math.sin(x * 0.008) * 20 - Math.sin(x * 0.02) * 10;
    ctx.lineTo(x, hillY);
  }

  ctx.lineTo(width, height);
  ctx.closePath();
  ctx.fill();
};

const updateCloud = (cloud: Cloud, width: number) => {
  cloud.x += cloud.speed;
  if (cloud.x > width + cloud.baseSize) {
    cloud.x = -cloud.baseSize;
    cloud.targetOpacity = 0.05 + Math.random() * 0.08;
  }
  cloud.opacity += (cloud.targetOpacity - cloud.opacity) * 0.005;
};

const updateFirefly = (
  firefly: Firefly,
  width: number,
  height: number,
  time: number,
) => {
  const dx = firefly.targetX - firefly.x;
  const dy = firefly.targetY - firefly.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 10) {
    firefly.targetX = getRandomSidePosition(width);
    firefly.targetY = height * 0.85 + Math.random() * height * 0.1;
  } else {
    firefly.x += (dx / dist) * 0.15;
    firefly.y +=
      (dy / dist) * 0.15 + Math.sin(time * 0.015 + firefly.glowPhase) * 0.08;
  }
};

const createSmallShootingStar = (
  width: number,
  height: number,
): ShootingStar => {
  return {
    x: Math.random() * width,
    y: Math.random() * height * 0.4,
    angle: Math.PI * 0.15 + Math.random() * Math.PI * 0.2,
    speed: 6 + Math.random() * 6,
    length: 50 + Math.random() * 100,
    life: 60,
    maxLife: 60,
  };
};

const createBigShootingStar = (width: number, height: number): ShootingStar => {
  return {
    x: Math.random() * width,
    y: Math.random() * height * 0.3,
    angle: Math.PI * 0.15 + Math.random() * Math.PI * 0.15,
    speed: 8 + Math.random() * 6,
    length: 150 + Math.random() * 100,
    life: 70,
    maxLife: 70,
    isBig: true,
  };
};

const spawnShootingStars = (
  shootingStars: ShootingStar[],
  width: number,
  height: number,
) => {
  if (Math.random() < 0.001) {
    shootingStars.push(createSmallShootingStar(width, height));
  }

  if (Math.random() < 0.0001) {
    shootingStars.push(createBigShootingStar(width, height));
  }
};

const updateAndDrawShootingStars = (
  ctx: CanvasRenderingContext2D,
  shootingStars: ShootingStar[],
): ShootingStar[] => {
  return shootingStars.filter((shootingStar) => {
    shootingStar.x += Math.cos(shootingStar.angle) * shootingStar.speed;
    shootingStar.y += Math.sin(shootingStar.angle) * shootingStar.speed;
    shootingStar.life--;
    drawShootingStar(ctx, shootingStar);
    return shootingStar.life > 0;
  });
};

const drawStargazingFrame = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: StargazingScene,
  time: number,
  darkMode: boolean,
) => {
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);
  drawSky(ctx, width, height, darkMode);

  scene.clouds.forEach((cloud) => {
    updateCloud(cloud, width);
    drawCloud(ctx, cloud);
  });

  scene.stars.forEach((star) => drawStar(ctx, star, time));
  scene.constellations.forEach((constellation) =>
    drawConstellation(ctx, constellation, time),
  );

  spawnShootingStars(scene.shootingStars, width, height);
  scene.shootingStars = updateAndDrawShootingStars(ctx, scene.shootingStars);

  drawGround(ctx, width, height);
  scene.trees.forEach((tree) => drawTree(ctx, tree, height));
  scene.fireflies.forEach((firefly) => {
    updateFirefly(firefly, width, height, time);
    drawFirefly(ctx, firefly, time);
  });
};

export function useStargazing(
  canvasRef: RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number | undefined;
    let scene = createEmptyStargazingScene();
    let timeRef = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      scene = createStargazingScene(canvas.width, canvas.height);
    };

    const animate = () => {
      timeRef++;
      drawStargazingFrame(ctx, canvas, scene, timeRef, darkMode);
      animationId = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      if (animationId !== undefined) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [canvasRef, darkMode, opacity, active]);
}
