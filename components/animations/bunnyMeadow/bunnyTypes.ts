export interface Bunny {
  x: number;
  y: number;
  size: number;
  color: 'white' | 'brown' | 'gray' | 'spotted';
  direction: 1 | -1;
  state: 'sitting' | 'hopping' | 'eating' | 'alert';
  stateTimer: number;
  hopPhase: number;
  hopHeight: number;
  earPhase: number;
  noseWiggle: number;
  targetX: number;
  blinkTimer: number;
  isBlinking: boolean;
  tailWiggle: number;
}

export interface BunnyPalette {
  mainColor: string;
  shadowColor: string;
  highlightColor: string;
}

export const LIGHT_BUNNY_PALETTES: Record<Bunny['color'], BunnyPalette> = {
  white: {
    mainColor: '#FFFAFA',
    shadowColor: '#E0E0E0',
    highlightColor: '#FFFFFF',
  },
  brown: {
    mainColor: '#8B6914',
    shadowColor: '#6B4904',
    highlightColor: '#9B7924',
  },
  gray: {
    mainColor: '#808080',
    shadowColor: '#606060',
    highlightColor: '#A0A0A0',
  },
  spotted: {
    mainColor: '#FFFAFA',
    shadowColor: '#D0D0D0',
    highlightColor: '#FFFFFF',
  },
};

export const DARK_BUNNY_PALETTES: Record<Bunny['color'], BunnyPalette> = {
  white: {
    mainColor: '#D0D0D0',
    shadowColor: '#A0A0A0',
    highlightColor: '#E8E8E8',
  },
  brown: {
    mainColor: '#6B4423',
    shadowColor: '#4B2413',
    highlightColor: '#8B5433',
  },
  gray: {
    mainColor: '#606060',
    shadowColor: '#404040',
    highlightColor: '#808080',
  },
  spotted: {
    mainColor: '#C8C8C8',
    shadowColor: '#888888',
    highlightColor: '#E0E0E0',
  },
};

export interface Flower {
  x: number;
  y: number;
  size: number;
  color: string;
  petalCount: number;
  swayPhase: number;
}

export interface Grass {
  x: number;
  y: number;
  height: number;
  blades: number;
  swayPhase: number;
}

export interface Butterfly {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  wingPhase: number;
  color: string;
  size: number;
}

export interface Cloud {
  x: number;
  y: number;
  size: number;
  speed: number;
  puffs: { x: number; y: number; size: number }[];
}
