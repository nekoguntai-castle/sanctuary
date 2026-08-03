import type { Bunny, Butterfly, Cloud, Flower, Grass } from "./bunnyTypes";

export interface BunnyMeadowScene {
  bunnies: Bunny[];
  flowers: Flower[];
  grassPatches: Grass[];
  butterflies: Butterfly[];
  clouds: Cloud[];
}

const BUNNY_COLORS: Bunny["color"][] = ["white", "brown", "gray", "spotted"];
export const FLOWER_COLORS = [
  "#FFB6C1",
  "#FF69B4",
  "#DDA0DD",
  "#FFD700",
  "#FFA500",
  "#87CEEB",
  "#FFFFFF",
];

export const createEmptyBunnyMeadowScene = (): BunnyMeadowScene => ({
  bunnies: [],
  flowers: [],
  grassPatches: [],
  butterflies: [],
  clouds: [],
});

export const getRandomSidePosition = (width: number): number => {
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
      state: "sitting",
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

const createCloudPuffs = (puffCount: number): Cloud["puffs"] => {
  const puffs: Cloud["puffs"] = [];

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

export const createBunnyMeadowScene = (
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
