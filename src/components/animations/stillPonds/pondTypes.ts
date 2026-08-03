export interface LilyPad {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  hasFlower: boolean;
  flowerColor: string;
  flowerPhase: number;
  bobPhase: number;
  bobSpeed: number;
}

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
  speed: number;
}

export interface Spot {
  x: number;
  y: number;
  size: number;
}

export interface KoiFish {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  size: number;
  speed: number;
  baseSpeed: number;
  angle: number;
  targetAngle: number;
  angularVelocity: number;
  tailPhase: number;
  tailAmplitude: number;
  bodyPhase: number;
  maxTurnRate: number;
  color: 'orange' | 'white' | 'gold' | 'red';
  pattern: 'solid' | 'spotted' | 'calico';
  spots: Spot[];
  depth: number;
}

export interface Dragonfly {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  wingPhase: number;
  size: number;
  color: string;
  hoverTime: number;
  state: 'flying' | 'hovering';
}
