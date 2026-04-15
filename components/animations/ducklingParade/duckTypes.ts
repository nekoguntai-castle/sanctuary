export interface Duck {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  size: number;
  waddle: number;
  isMother: boolean;
  followIndex: number;
  bobPhase: number;
  blinkTimer: number;
  isBlinking: boolean;
  quackTimer: number;
  isQuacking: boolean;
  wingFlap: number;
}

type DuckKind = 'mother' | 'duckling';

export interface DuckPalette {
  bodyColor: string;
  bodyHighlight: string;
  bodyDark: string;
  wingDetail: string;
  headHighlight: string;
  headShadow: string;
}

export const LIGHT_DUCK_PALETTES: Record<DuckKind, DuckPalette> = {
  mother: {
    bodyColor: '#8B7355',
    bodyHighlight: '#A08060',
    bodyDark: '#6B5340',
    wingDetail: '#5B4B3B',
    headHighlight: '#4A6B4A',
    headShadow: '#2A4B2A',
  },
  duckling: {
    bodyColor: '#FFD700',
    bodyHighlight: '#FFEC8B',
    bodyDark: '#DAA520',
    wingDetail: '#C8B800',
    headHighlight: '#FFEC8B',
    headShadow: '#FFD700',
  },
};

export const DARK_DUCK_PALETTES: Record<DuckKind, DuckPalette> = {
  mother: {
    bodyColor: '#6B5B4B',
    bodyHighlight: '#8B7B6B',
    bodyDark: '#4B3B2B',
    wingDetail: '#5B4B3B',
    headHighlight: '#4B6B4B',
    headShadow: '#2B4B2B',
  },
  duckling: {
    bodyColor: '#B8A800',
    bodyHighlight: '#D8C820',
    bodyDark: '#988800',
    wingDetail: '#C8B800',
    headHighlight: '#D8C820',
    headShadow: '#B8A800',
  },
};

export interface DuckFamily {
  ducks: Duck[];
  direction: 1 | -1;
  pathY: number;
  leader: Duck;
}

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

export interface GrassBlade {
  heightMult: number;
  swayMult: number;
}

export interface Grass {
  x: number;
  y: number;
  height: number;
  blades: number;
  swayPhase: number;
  bladeData: GrassBlade[];
}

export interface Butterfly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  wingPhase: number;
  color: string;
  size: number;
  targetX: number;
  targetY: number;
  flutterPhase: number;
  flutterSpeed: number;
  turnTimer: number;
  turnInterval: number;
  hoverTimer: number;
  isHovering: boolean;
  baseSpeed: number;
}
