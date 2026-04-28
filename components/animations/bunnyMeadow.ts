/**
 * Bunny Meadow Animation
 *
 * Cute fluffy bunnies hopping around a meadow, eating grass,
 * and twitching their noses. Positioned on sides of screen.
 */

import { useEffect, RefObject } from 'react';
import {
  DARK_BUNNY_PALETTES,
  LIGHT_BUNNY_PALETTES,
} from './bunnyMeadow/bunnyTypes';
import type {
  Bunny,
  BunnyPalette,
  Butterfly,
  Cloud,
  Flower,
  Grass,
} from './bunnyMeadow/bunnyTypes';

interface BunnyMeadowScene {
  bunnies: Bunny[];
  flowers: Flower[];
  grassPatches: Grass[];
  butterflies: Butterfly[];
  clouds: Cloud[];
}

const BUNNY_COLORS: Bunny['color'][] = ['white', 'brown', 'gray', 'spotted'];
const FLOWER_COLORS = [
  '#FFB6C1',
  '#FF69B4',
  '#DDA0DD',
  '#FFD700',
  '#FFA500',
  '#87CEEB',
  '#FFFFFF',
];

const createEmptyBunnyMeadowScene = (): BunnyMeadowScene => ({
  bunnies: [],
  flowers: [],
  grassPatches: [],
  butterflies: [],
  clouds: [],
});

const getRandomSidePosition = (width: number): number => {
  if (Math.random() >= 0.75) return Math.random() * width;
  if (Math.random() < 0.5) return Math.random() * width * 0.25;
  return width * 0.75 + Math.random() * width * 0.25;
};

function createBunnies(width: number, height: number): Bunny[] {
  const bunnies: Bunny[] = [];
  const bunnyCount = Math.ceil(width / 350);

  for (let i = 0; i < bunnyCount; i++) {
    const x = getRandomSidePosition(width);
    const y = height * 0.55 + Math.random() * height * 0.35;
    const size = 30 + Math.random() * 15;
    const color = BUNNY_COLORS[Math.floor(Math.random() * BUNNY_COLORS.length)];
    const direction = Math.random() < 0.5 ? 1 : -1;

    bunnies.push({
      x,
      y,
      size,
      color,
      direction,
      state: 'sitting',
      stateTimer: 100 + Math.random() * 200,
      hopPhase: 0,
      hopHeight: 0,
      earPhase: Math.random() * Math.PI * 2,
      noseWiggle: Math.random() * Math.PI * 2,
      targetX: getRandomSidePosition(width),
      blinkTimer: Math.random() * 200,
      isBlinking: false,
      tailWiggle: 0,
    });
  }

  return bunnies;
}

const createFlowers = (width: number, height: number): Flower[] => {
  const flowers: Flower[] = [];
  const flowerCount = Math.floor(width / 80);

  for (let i = 0; i < flowerCount; i++) {
    flowers.push({
      x: getRandomSidePosition(width),
      y: height * 0.5 + Math.random() * height * 0.45,
      size: 8 + Math.random() * 12,
      color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)],
      petalCount: 5 + Math.floor(Math.random() * 3),
      swayPhase: Math.random() * Math.PI * 2,
    });
  }

  return flowers;
};

const createGrassPatches = (width: number, height: number): Grass[] => {
  const grassPatches: Grass[] = [];
  const grassCount = Math.floor(width / 60);

  for (let i = 0; i < grassCount; i++) {
    grassPatches.push({
      x: getRandomSidePosition(width),
      y: height * 0.5 + Math.random() * height * 0.45,
      height: 15 + Math.random() * 25,
      blades: 4 + Math.floor(Math.random() * 4),
      swayPhase: Math.random() * Math.PI * 2,
    });
  }

  return grassPatches;
};

const createButterflies = (width: number, height: number): Butterfly[] => {
  const butterflies: Butterfly[] = [];

  for (let i = 0; i < 4; i++) {
    butterflies.push({
      x: Math.random() * width,
      y: height * 0.2 + Math.random() * height * 0.4,
      targetX: Math.random() * width,
      targetY: height * 0.2 + Math.random() * height * 0.4,
      wingPhase: Math.random() * Math.PI * 2,
      color: FLOWER_COLORS[Math.floor(Math.random() * FLOWER_COLORS.length)],
      size: 6 + Math.random() * 6,
    });
  }

  return butterflies;
};

const createCloudPuffs = (puffCount: number): Cloud['puffs'] => {
  const puffs: Cloud['puffs'] = [];

  for (let puff = 0; puff < puffCount; puff++) {
    puffs.push({
      x: (puff - puffCount / 2) * 25,
      y: (Math.random() - 0.5) * 15,
      size: 20 + Math.random() * 20,
    });
  }

  return puffs;
};

const createClouds = (width: number, height: number): Cloud[] => {
  const clouds: Cloud[] = [];
  const cloudCount = 4;

  for (let i = 0; i < cloudCount; i++) {
    const puffCount = 3 + Math.floor(Math.random() * 3);
    clouds.push({
      x: (i / cloudCount) * width + Math.random() * 100,
      y: height * 0.05 + Math.random() * height * 0.15,
      size: 1,
      speed: 0.1 + Math.random() * 0.15,
      puffs: createCloudPuffs(puffCount),
    });
  }

  return clouds;
};

const createBunnyMeadowScene = (
  width: number,
  height: number,
): BunnyMeadowScene => {
  const bunnies = createBunnies(width, height);
  const flowers = createFlowers(width, height);
  const grassPatches = createGrassPatches(width, height);
  const butterflies = createButterflies(width, height);
  const clouds = createClouds(width, height);

  return { bunnies, flowers, grassPatches, butterflies, clouds };
};

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  darkMode: boolean,
) => {
  const skyGradient = ctx.createLinearGradient(0, 0, 0, height * 0.5);
  if (darkMode) {
    skyGradient.addColorStop(0, '#0a1a2a');
    skyGradient.addColorStop(1, '#1a3a4a');
  } else {
    skyGradient.addColorStop(0, '#87CEEB');
    skyGradient.addColorStop(1, '#E0F6FF');
  }
  ctx.fillStyle = skyGradient;
  ctx.fillRect(0, 0, width, height);

  const meadowGradient = ctx.createLinearGradient(0, height * 0.4, 0, height);
  if (darkMode) {
    meadowGradient.addColorStop(0, '#1a3a2a');
    meadowGradient.addColorStop(0.5, '#2a4a3a');
    meadowGradient.addColorStop(1, '#1a3020');
  } else {
    meadowGradient.addColorStop(0, '#90EE90');
    meadowGradient.addColorStop(0.3, '#7CCD7C');
    meadowGradient.addColorStop(1, '#228B22');
  }
  ctx.fillStyle = meadowGradient;
  ctx.fillRect(0, height * 0.4, width, height * 0.6);

  ctx.fillStyle = darkMode ? '#2a4a3a' : '#8FBC8F';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(0, height * 0.5 + i * 30);
    for (let x = 0; x <= width; x += 50) {
      const hillY = height * 0.5 + i * 30 + Math.sin(x * 0.005 + i) * 20;
      ctx.lineTo(x, hillY);
    }
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
  }
};

const drawCloud = (
  ctx: CanvasRenderingContext2D,
  cloud: Cloud,
  darkMode: boolean,
) => {
  ctx.save();
  ctx.translate(cloud.x, cloud.y);

  ctx.fillStyle = darkMode
    ? 'rgba(60, 80, 100, 0.5)'
    : 'rgba(255, 255, 255, 0.9)';
  cloud.puffs.forEach((puff) => {
    ctx.beginPath();
    ctx.arc(puff.x, puff.y, puff.size, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.restore();
};

const drawGrass = (
  ctx: CanvasRenderingContext2D,
  grass: Grass,
  time: number,
  darkMode: boolean,
) => {
  const sway = Math.sin(time * 0.002 + grass.swayPhase) * 3;

  ctx.save();
  ctx.translate(grass.x, grass.y);

  for (let i = 0; i < grass.blades; i++) {
    const bladeX = (i - grass.blades / 2) * 4;
    const bladeHeight = grass.height * (0.7 + Math.random() * 0.3);
    const bladeSway = sway * (0.8 + i * 0.1);

    ctx.strokeStyle = darkMode ? '#3a5a3a' : '#228B22';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(bladeX, 0);
    ctx.quadraticCurveTo(
      bladeX + bladeSway * 0.5,
      -bladeHeight * 0.5,
      bladeX + bladeSway,
      -bladeHeight,
    );
    ctx.stroke();
  }

  ctx.restore();
};

const drawFlower = (
  ctx: CanvasRenderingContext2D,
  flower: Flower,
  time: number,
  darkMode: boolean,
) => {
  const sway = Math.sin(time * 0.002 + flower.swayPhase) * 2;

  ctx.save();
  ctx.translate(flower.x + sway, flower.y);

  ctx.strokeStyle = darkMode ? '#2a4a2a' : '#228B22';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(sway * 0.5, -flower.size, sway, -flower.size * 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(sway, -flower.size * 2);

  for (let i = 0; i < flower.petalCount; i++) {
    const angle = (i / flower.petalCount) * Math.PI * 2;
    ctx.save();
    ctx.rotate(angle);

    const petalGradient = ctx.createRadialGradient(
      flower.size * 0.4,
      0,
      0,
      flower.size * 0.4,
      0,
      flower.size * 0.5,
    );
    petalGradient.addColorStop(0, '#FFFFFF');
    petalGradient.addColorStop(0.5, flower.color);
    petalGradient.addColorStop(1, flower.color);

    ctx.fillStyle = petalGradient;
    ctx.beginPath();
    ctx.ellipse(
      flower.size * 0.4,
      0,
      flower.size * 0.4,
      flower.size * 0.2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = '#FFD700';
  ctx.beginPath();
  ctx.arc(0, 0, flower.size * 0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
  ctx.restore();
};

const drawButterfly = (
  ctx: CanvasRenderingContext2D,
  butterfly: Butterfly,
  time: number,
) => {
  const wingAngle = Math.sin(time * 0.1 + butterfly.wingPhase) * 0.5;

  ctx.save();
  ctx.translate(butterfly.x, butterfly.y);

  const dx = butterfly.targetX - butterfly.x;
  ctx.scale(dx > 0 ? 1 : -1, 1);

  ctx.fillStyle = butterfly.color;
  ctx.globalAlpha = 0.7;

  ctx.save();
  ctx.rotate(wingAngle);
  ctx.beginPath();
  ctx.ellipse(
    -butterfly.size * 0.3,
    -butterfly.size * 0.5,
    butterfly.size * 0.4,
    butterfly.size * 0.5,
    -0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.rotate(-wingAngle);
  ctx.beginPath();
  ctx.ellipse(
    -butterfly.size * 0.3,
    butterfly.size * 0.5,
    butterfly.size * 0.4,
    butterfly.size * 0.5,
    0.3,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();

  ctx.globalAlpha = 1;

  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    butterfly.size * 0.08,
    butterfly.size * 0.25,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();

  ctx.restore();
};

const fillEllipse = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation = 0,
) => {
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
  ctx.fill();
};

const fillCircle = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
) => {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
};

const getBunnyPalette = (
  color: Bunny['color'],
  darkMode: boolean,
): BunnyPalette => {
  const palettes = darkMode ? DARK_BUNNY_PALETTES : LIGHT_BUNNY_PALETTES;
  return palettes[color];
};

const drawBunnyShadow = (
  ctx: CanvasRenderingContext2D,
  size: number,
  hopOffset: number,
) => {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
  fillEllipse(ctx, 0, hopOffset + size * 0.5, size * 0.5, size * 0.15);
};

const drawBunnyBackLeg = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  shadowColor: string,
) => {
  if (bunny.state !== 'hopping') return;

  ctx.fillStyle = shadowColor;
  fillEllipse(ctx, -size * 0.15, size * 0.35, size * 0.2, size * 0.12, -0.5);
};

const drawBunnyTail = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  palette: BunnyPalette,
) => {
  const tailWiggle = Math.sin(bunny.tailWiggle) * 3;

  ctx.fillStyle = palette.highlightColor;
  fillCircle(ctx, -size * 0.35 + tailWiggle, size * 0.1, size * 0.15);

  ctx.fillStyle = palette.mainColor;
  fillCircle(ctx, -size * 0.32 + tailWiggle, size * 0.08, size * 0.1);
};

const drawBunnyBody = (
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: BunnyPalette,
) => {
  const bodyGradient = ctx.createRadialGradient(
    size * 0.1,
    -size * 0.1,
    0,
    0,
    0,
    size * 0.5,
  );
  bodyGradient.addColorStop(0, palette.highlightColor);
  bodyGradient.addColorStop(0.7, palette.mainColor);
  bodyGradient.addColorStop(1, palette.shadowColor);

  ctx.fillStyle = bodyGradient;
  fillEllipse(ctx, 0, size * 0.1, size * 0.4, size * 0.35);
};

const drawBunnySpots = (
  ctx: CanvasRenderingContext2D,
  size: number,
  darkMode: boolean,
) => {
  ctx.fillStyle = darkMode ? '#4a3a2a' : '#8B6914';
  fillEllipse(ctx, -size * 0.15, size * 0.05, size * 0.1, size * 0.08, 0.3);
  fillEllipse(ctx, size * 0.1, size * 0.2, size * 0.08, size * 0.06, -0.2);
};

const drawBunnyPawsUp = (ctx: CanvasRenderingContext2D, size: number) => {
  fillEllipse(ctx, size * 0.25, -size * 0.15, size * 0.08, size * 0.12, 0.3);
  fillEllipse(ctx, size * 0.35, -size * 0.1, size * 0.08, size * 0.12, 0.5);
};

const drawBunnyFrontPaws = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  mainColor: string,
) => {
  ctx.fillStyle = mainColor;

  if (bunny.state === 'eating') {
    drawBunnyPawsUp(ctx, size);
    return;
  }

  fillEllipse(ctx, size * 0.2, size * 0.35, size * 0.1, size * 0.06);
};

const drawBunnyHead = (
  ctx: CanvasRenderingContext2D,
  size: number,
  palette: BunnyPalette,
) => {
  const headGradient = ctx.createRadialGradient(
    size * 0.35,
    -size * 0.35,
    0,
    size * 0.3,
    -size * 0.25,
    size * 0.35,
  );
  headGradient.addColorStop(0, palette.highlightColor);
  headGradient.addColorStop(0.6, palette.mainColor);
  headGradient.addColorStop(1, palette.shadowColor);

  ctx.fillStyle = headGradient;
  fillCircle(ctx, size * 0.3, -size * 0.2, size * 0.28);

  ctx.fillStyle = 'rgba(255, 182, 193, 0.3)';
  fillEllipse(ctx, size * 0.45, -size * 0.1, size * 0.1, size * 0.08);
};

const drawBunnyEar = (
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  rotation: number,
  mainColor: string,
  darkMode: boolean,
) => {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  ctx.fillStyle = mainColor;
  fillEllipse(ctx, 0, -size * 0.35, size * 0.12, size * 0.35);

  ctx.fillStyle = darkMode ? '#8a6a5a' : '#FFB6C1';
  fillEllipse(ctx, 0, -size * 0.3, size * 0.06, size * 0.25);

  ctx.restore();
};

const drawBunnyEars = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  earWave: number,
  mainColor: string,
  darkMode: boolean,
) => {
  const earAngle = bunny.state === 'alert' ? -0.2 : 0.1;

  drawBunnyEar(
    ctx,
    size,
    size * 0.2,
    -size * 0.4,
    earAngle + earWave * 0.02,
    mainColor,
    darkMode,
  );
  drawBunnyEar(
    ctx,
    size,
    size * 0.35,
    -size * 0.42,
    earAngle - 0.15 - earWave * 0.01,
    mainColor,
    darkMode,
  );
};

const drawBunnySnout = (
  ctx: CanvasRenderingContext2D,
  size: number,
  highlightColor: string,
  noseWiggle: number,
  darkMode: boolean,
) => {
  ctx.fillStyle = highlightColor;
  fillEllipse(ctx, size * 0.48, -size * 0.12, size * 0.12, size * 0.1);

  ctx.fillStyle = darkMode ? '#8a5a4a' : '#FFB6C1';
  fillEllipse(
    ctx,
    size * 0.55 + noseWiggle * 0.3,
    -size * 0.18,
    size * 0.05,
    size * 0.04,
  );
};

const drawBunnyMouth = (
  ctx: CanvasRenderingContext2D,
  size: number,
  darkMode: boolean,
) => {
  ctx.strokeStyle = darkMode ? '#5a4a4a' : '#8B6969';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(size * 0.55, -size * 0.14);
  ctx.lineTo(size * 0.55, -size * 0.08);
  ctx.moveTo(size * 0.52, -size * 0.05);
  ctx.lineTo(size * 0.55, -size * 0.08);
  ctx.lineTo(size * 0.58, -size * 0.05);
  ctx.stroke();
};

const drawBunnyOpenEye = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.fillStyle = '#FFFFFF';
  fillEllipse(ctx, size * 0.38, -size * 0.28, size * 0.08, size * 0.1);

  ctx.fillStyle = '#000000';
  fillCircle(ctx, size * 0.4, -size * 0.27, size * 0.045);

  ctx.fillStyle = '#FFFFFF';
  fillCircle(ctx, size * 0.42, -size * 0.29, size * 0.015);
};

const drawBunnyClosedEye = (ctx: CanvasRenderingContext2D, size: number) => {
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(size * 0.38, -size * 0.27, size * 0.05, 0.3, Math.PI - 0.3);
  ctx.stroke();
};

const drawBunnyEyes = (
  ctx: CanvasRenderingContext2D,
  size: number,
  isBlinking: boolean,
) => {
  if (isBlinking) {
    drawBunnyClosedEye(ctx, size);
    return;
  }

  drawBunnyOpenEye(ctx, size);
};

const drawBunnyFace = (
  ctx: CanvasRenderingContext2D,
  size: number,
  bunny: Bunny,
  palette: BunnyPalette,
  noseWiggle: number,
  darkMode: boolean,
) => {
  drawBunnySnout(ctx, size, palette.highlightColor, noseWiggle, darkMode);
  drawBunnyMouth(ctx, size, darkMode);
  drawBunnyEyes(ctx, size, bunny.isBlinking);
};

const drawBunny = (
  ctx: CanvasRenderingContext2D,
  bunny: Bunny,
  time: number,
  darkMode: boolean,
) => {
  const size = bunny.size;
  const palette = getBunnyPalette(bunny.color, darkMode);
  const earWave = Math.sin(time * 0.02 + bunny.earPhase) * 3;
  const noseWiggle = Math.sin(time * 0.15 + bunny.noseWiggle) * 2;

  ctx.save();
  ctx.translate(bunny.x, bunny.y - bunny.hopHeight);
  ctx.scale(bunny.direction, 1);

  drawBunnyShadow(ctx, size, bunny.hopHeight);
  drawBunnyBackLeg(ctx, size, bunny, palette.shadowColor);
  drawBunnyTail(ctx, size, bunny, palette);
  drawBunnyBody(ctx, size, palette);
  if (bunny.color === 'spotted') drawBunnySpots(ctx, size, darkMode);
  drawBunnyFrontPaws(ctx, size, bunny, palette.mainColor);
  drawBunnyHead(ctx, size, palette);
  drawBunnyEars(ctx, size, bunny, earWave, palette.mainColor, darkMode);
  drawBunnyFace(ctx, size, bunny, palette, noseWiggle, darkMode);

  ctx.restore();
};

const startBunnyHop = (bunny: Bunny, width: number) => {
  bunny.targetX = getRandomSidePosition(width);
  bunny.direction = bunny.targetX > bunny.x ? 1 : -1;
};

const returnBunnyToSitting = (
  bunny: Bunny,
  timerStart: number,
  timerRange: number,
) => {
  bunny.state = 'sitting';
  bunny.stateTimer = timerStart + Math.random() * timerRange;
  bunny.hopHeight = 0;
};

const updateBunnyBlink = (bunny: Bunny) => {
  bunny.blinkTimer--;
  if (bunny.blinkTimer > 0) return;

  bunny.isBlinking = !bunny.isBlinking;
  bunny.blinkTimer = bunny.isBlinking ? 10 : 120 + Math.random() * 180;
};

const chooseNextSittingState = (bunny: Bunny, width: number) => {
  const states: Bunny['state'][] = ['hopping', 'eating', 'alert', 'sitting'];
  bunny.state = states[Math.floor(Math.random() * states.length)];
  bunny.stateTimer = 80 + Math.random() * 150;

  if (bunny.state === 'hopping') startBunnyHop(bunny, width);
};

const updateSittingBunny = (bunny: Bunny, width: number) => {
  bunny.hopHeight = 0;
  if (bunny.stateTimer > 0) return;

  chooseNextSittingState(bunny, width);
};

const updateHoppingBunny = (bunny: Bunny) => {
  bunny.hopPhase += 0.15;
  bunny.hopHeight = Math.abs(Math.sin(bunny.hopPhase)) * 30;

  if (Math.sin(bunny.hopPhase) > 0.5) {
    bunny.x += bunny.direction * 2;
    bunny.tailWiggle += 0.3;
  }

  if (Math.abs(bunny.x - bunny.targetX) < 20 || bunny.stateTimer <= 0) {
    returnBunnyToSitting(bunny, 100, 200);
  }
};

const updateEatingBunny = (bunny: Bunny) => {
  bunny.noseWiggle += 0.1;
  if (bunny.stateTimer > 0) return;

  returnBunnyToSitting(bunny, 80, 150);
};

const chooseNextAlertState = (bunny: Bunny, width: number) => {
  bunny.state = 'sitting';
  if (Math.random() < 0.5) bunny.state = 'hopping';

  bunny.stateTimer = 100 + Math.random() * 150;
  if (bunny.state === 'hopping') startBunnyHop(bunny, width);
};

const updateAlertBunny = (bunny: Bunny, width: number) => {
  bunny.earPhase += 0.05;
  if (bunny.stateTimer > 0) return;

  chooseNextAlertState(bunny, width);
};

const updateBunnyState = (bunny: Bunny, width: number) => {
  switch (bunny.state) {
    case 'sitting':
      updateSittingBunny(bunny, width);
      break;
    case 'hopping':
      updateHoppingBunny(bunny);
      break;
    case 'eating':
      updateEatingBunny(bunny);
      break;
    case 'alert':
      updateAlertBunny(bunny, width);
      break;
  }
};

const updateBunny = (bunny: Bunny, width: number) => {
  bunny.stateTimer--;
  bunny.noseWiggle += 0.1;
  updateBunnyBlink(bunny);
  updateBunnyState(bunny, width);
};

const updateButterfly = (
  butterfly: Butterfly,
  width: number,
  height: number,
  time: number,
) => {
  const dx = butterfly.targetX - butterfly.x;
  const dy = butterfly.targetY - butterfly.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 15) {
    butterfly.targetX = Math.random() * width;
    butterfly.targetY = height * 0.2 + Math.random() * height * 0.4;
  } else {
    butterfly.x += (dx / dist) * 1.2;
    butterfly.y += (dy / dist) * 1.2 + Math.sin(time * 0.05) * 0.5;
  }
};

const updateCloud = (cloud: Cloud, width: number) => {
  cloud.x += cloud.speed;
  if (cloud.x > width + 100) {
    cloud.x = -100;
  }
};

const drawBunnyMeadowFrame = (
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  scene: BunnyMeadowScene,
  time: number,
  darkMode: boolean,
) => {
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height, darkMode);

  scene.clouds.forEach((cloud) => {
    updateCloud(cloud, width);
    drawCloud(ctx, cloud, darkMode);
  });

  scene.grassPatches.forEach((grass) => drawGrass(ctx, grass, time, darkMode));
  scene.flowers.forEach((flower) => drawFlower(ctx, flower, time, darkMode));
  scene.butterflies.forEach((butterfly) => {
    updateButterfly(butterfly, width, height, time);
    drawButterfly(ctx, butterfly, time);
  });
  scene.bunnies.forEach((bunny) => {
    updateBunny(bunny, width);
    drawBunny(ctx, bunny, time, darkMode);
  });
};

export function useBunnyMeadow(
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
    let scene = createEmptyBunnyMeadowScene();
    let timeRef = 0;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      scene = createBunnyMeadowScene(canvas.width, canvas.height);
    };

    const animate = () => {
      timeRef++;
      drawBunnyMeadowFrame(ctx, canvas, scene, timeRef, darkMode);
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
