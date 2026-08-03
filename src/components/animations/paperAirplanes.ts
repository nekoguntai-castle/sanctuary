/**
 * Paper Airplanes Animation
 *
 * Delicate paper airplanes gliding through a soft sky,
 * catching air currents with graceful turns and sweeping arcs.
 */

import { useEffect, useRef } from 'react';

interface PaperAirplane {
  x: number;
  y: number;
  z: number; // Depth: 0 = far away, 1 = close to camera
  zVelocity: number; // Moving toward or away from camera
  size: number;
  baseSize: number;
  color: string;
  heading: number; // Direction plane is facing (radians, 0 = right)
  turnRate: number; // Current turning speed (radians per frame)
  targetTurnRate: number; // Target turn rate we're easing toward
  baseSpeed: number;
  speed: number;
  bankAngle: number; // Visual tilt during turns
  energyReserve: number;
  glidePhase: number;
  turnTimer: number; // Time until next turn decision
  flightStyle: 'wanderer' | 'circler' | 'swooper';
  trail: { x: number; y: number; opacity: number }[];
}

interface Cloud {
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  opacity: number;
}

interface Bird {
  x: number;
  y: number;
  size: number;
  wingPhase: number;
  wingSpeed: number;
  speed: number;
  heading: number;
}

type CreatePaperAirplane = (w: number, h: number, colors: string[]) => PaperAirplane;
type DrawPaperAirplane = (ctx: CanvasRenderingContext2D, plane: PaperAirplane) => void;

const FULL_CIRCLE = Math.PI * 2;

function randomSignedDirection() {
  return Math.random() < 0.5 ? 1 : -1;
}

function drawAirplaneDartPath(ctx: CanvasRenderingContext2D, s: number, yOffset = 0) {
  ctx.beginPath();
  ctx.moveTo(s * 0.7, yOffset);
  ctx.lineTo(-s * 0.35, s * 0.22 + yOffset);
  ctx.lineTo(-s * 0.15, yOffset);
  ctx.lineTo(-s * 0.35, -s * 0.22 + yOffset);
  ctx.closePath();
}

function drawAirplaneShadow(ctx: CanvasRenderingContext2D, s: number, isClose: boolean) {
  const shadowOffset = isClose ? 4 : 2;
  const shadowOpacity = isClose ? 0.12 : 0.08;

  drawAirplaneDartPath(ctx, s, shadowOffset);
  ctx.fillStyle = `rgba(0, 0, 0, ${shadowOpacity})`;
  ctx.fill();
}

function addAirplaneGradientStops(
  grad: CanvasGradient,
  paperColor: string,
  darkMode: boolean,
  isClose: boolean
) {
  if (isClose) {
    grad.addColorStop(0, paperColor);
    grad.addColorStop(0.3, darkMode ? '#f0e8e0' : '#ffffff');
    grad.addColorStop(0.5, darkMode ? '#f5ede5' : '#fffefa');
    grad.addColorStop(0.7, darkMode ? '#f0e8e0' : '#ffffff');
    grad.addColorStop(1, paperColor);
    return;
  }

  grad.addColorStop(0, paperColor);
  grad.addColorStop(0.5, darkMode ? '#f5ede5' : '#ffffff');
  grad.addColorStop(1, paperColor);
}

function drawAirplaneBody(
  ctx: CanvasRenderingContext2D,
  plane: PaperAirplane,
  darkMode: boolean,
  isClose: boolean,
  isMedium: boolean
) {
  const s = plane.size;
  const grad = ctx.createLinearGradient(-s * 0.3, -s * 0.25, s * 0.3, s * 0.25);

  drawAirplaneDartPath(ctx, s);
  addAirplaneGradientStops(grad, plane.color, darkMode, isClose);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = darkMode ? 'rgba(100, 90, 80, 0.3)' : 'rgba(180, 170, 160, 0.35)';
  ctx.lineWidth = isClose ? 1.2 : (isMedium ? 0.9 : 0.6);
  ctx.stroke();
}

function drawAirplaneCenterFold(
  ctx: CanvasRenderingContext2D,
  s: number,
  darkMode: boolean,
  isClose: boolean
) {
  ctx.beginPath();
  ctx.moveTo(s * 0.7, 0);
  ctx.lineTo(-s * 0.15, 0);
  ctx.strokeStyle = darkMode ? 'rgba(100, 90, 80, 0.35)' : 'rgba(180, 170, 160, 0.4)';
  ctx.lineWidth = isClose ? 1.0 : 0.7;
  ctx.stroke();
}

function drawAirplaneWingCreases(
  ctx: CanvasRenderingContext2D,
  s: number,
  darkMode: boolean,
  isClose: boolean
) {
  ctx.beginPath();
  ctx.moveTo(s * 0.3, 0);
  ctx.lineTo(-s * 0.25, s * 0.15);
  ctx.moveTo(s * 0.3, 0);
  ctx.lineTo(-s * 0.25, -s * 0.15);
  ctx.strokeStyle = darkMode ? 'rgba(100, 90, 80, 0.25)' : 'rgba(180, 170, 160, 0.3)';
  ctx.lineWidth = isClose ? 0.8 : 0.5;
  ctx.stroke();
}

function drawCloseAirplaneDetails(ctx: CanvasRenderingContext2D, s: number, darkMode: boolean) {
  ctx.beginPath();
  ctx.moveTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.28, s * 0.18);
  ctx.moveTo(s * 0.5, 0);
  ctx.lineTo(-s * 0.28, -s * 0.18);
  ctx.strokeStyle = darkMode ? 'rgba(100, 90, 80, 0.15)' : 'rgba(180, 170, 160, 0.2)';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(s * 0.68, -0.5);
  ctx.lineTo(-s * 0.33, -s * 0.21);
  ctx.strokeStyle = darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawPaperAirplaneShape(
  ctx: CanvasRenderingContext2D,
  plane: PaperAirplane,
  darkMode: boolean
) {
  ctx.save();
  ctx.translate(plane.x, plane.y);
  ctx.rotate(plane.heading);
  ctx.scale(1, 0.5 + Math.cos(plane.bankAngle) * 0.5);

  const s = plane.size;
  const isClose = plane.z > 0.7;
  const isMedium = plane.z > 0.4;

  drawAirplaneShadow(ctx, s, isClose);
  drawAirplaneBody(ctx, plane, darkMode, isClose, isMedium);
  drawAirplaneCenterFold(ctx, s, darkMode, isClose);
  drawAirplaneWingCreases(ctx, s, darkMode, isClose);

  if (isClose) {
    drawCloseAirplaneDetails(ctx, s, darkMode);
  }

  ctx.restore();
}

function setLoopTurn(plane: PaperAirplane) {
  plane.targetTurnRate = randomSignedDirection() * (0.04 + Math.random() * 0.02);
  plane.turnTimer = 80 + Math.random() * 40;
}

function setSwooperTurn(plane: PaperAirplane) {
  plane.targetTurnRate = randomSignedDirection() * (0.012 + Math.random() * 0.015);
  plane.turnTimer = 50 + Math.random() * 100;
}

function setCirclerTurn(plane: PaperAirplane) {
  if (Math.random() < 0.2) {
    plane.targetTurnRate = randomSignedDirection() * (0.006 + Math.random() * 0.01);
  } else {
    plane.targetTurnRate = plane.targetTurnRate * 0.9 + (Math.random() - 0.5) * 0.005;
  }

  plane.turnTimer = 80 + Math.random() * 120;
}

function setWandererTurn(plane: PaperAirplane) {
  plane.targetTurnRate = (Math.random() - 0.5) * 0.025;
  plane.turnTimer = 30 + Math.random() * 60;
}

function chooseAirplaneTurn(plane: PaperAirplane) {
  if (Math.random() < 0.003 && plane.energyReserve > 0.8) {
    setLoopTurn(plane);
    return;
  }

  if (plane.flightStyle === 'swooper') {
    setSwooperTurn(plane);
    return;
  }

  if (plane.flightStyle === 'circler') {
    setCirclerTurn(plane);
    return;
  }

  setWandererTurn(plane);
}

function updateAirplaneTurn(plane: PaperAirplane) {
  plane.turnTimer -= 1;

  if (plane.turnTimer <= 0) {
    chooseAirplaneTurn(plane);
  }

  plane.turnRate += (plane.targetTurnRate - plane.turnRate) * 0.03;
  plane.heading += plane.turnRate;

  const targetBank = plane.turnRate * 25;
  plane.bankAngle += (targetBank - plane.bankAngle) * 0.08;
}

function updateAirplaneEnergy(plane: PaperAirplane) {
  const verticalComponent = Math.sin(plane.heading);

  if (verticalComponent > 0.05) {
    const descentFactor = verticalComponent * 0.015;
    plane.speed = Math.min(plane.baseSpeed * 2.0, plane.speed + descentFactor);
    plane.energyReserve = Math.min(1.0, plane.energyReserve + descentFactor * 0.2);
    return;
  }

  if (verticalComponent < -0.05) {
    const climbFactor = Math.abs(verticalComponent) * 0.04;
    plane.speed = Math.max(plane.baseSpeed * 0.3, plane.speed - climbFactor);
    plane.energyReserve = Math.max(0, plane.energyReserve - climbFactor * 1.5);
    return;
  }

  plane.speed += (plane.baseSpeed * 0.9 - plane.speed) * 0.015;
  plane.energyReserve = Math.max(0, plane.energyReserve - 0.001);
}

function applyGravityToHeading(plane: PaperAirplane) {
  const gravityStrength = 0.002;

  if (plane.heading >= 0 && plane.heading < Math.PI) {
    plane.heading += plane.heading < Math.PI / 2 ? gravityStrength : -gravityStrength * 0.5;
    return;
  }

  plane.heading += plane.heading > Math.PI * 1.5 ? gravityStrength * 1.5 : -gravityStrength * 1.5;
}

function applyStallPull(plane: PaperAirplane) {
  if (plane.energyReserve >= 0.2 && plane.speed >= plane.baseSpeed * 0.5) {
    return;
  }

  plane.heading += plane.heading < Math.PI ? 0.006 : -0.006;
}

function updateAirplaneDepth(plane: PaperAirplane) {
  if (Math.random() < 0.005) {
    plane.zVelocity = (Math.random() - 0.5) * 0.006;
  }

  plane.z += plane.zVelocity;

  if (plane.z < 0.08) {
    plane.z = 0.08;
    plane.zVelocity = Math.abs(plane.zVelocity) * 0.8;
  }

  if (plane.z > 1.0) {
    plane.z = 1.0;
    plane.zVelocity = -Math.abs(plane.zVelocity) * 0.8;
  }

  plane.size = plane.baseSize * (0.3 + plane.z * 1.5);
}

function moveAirplane(plane: PaperAirplane) {
  plane.glidePhase += 0.008;

  const glideY = Math.sin(plane.glidePhase) * 0.3;
  const depthSpeedFactor = 0.6 + plane.z * 0.6;

  plane.x += Math.cos(plane.heading) * plane.speed * depthSpeedFactor;
  plane.y += Math.sin(plane.heading) * plane.speed * depthSpeedFactor + glideY;
}

function normalizeAirplaneHeading(plane: PaperAirplane) {
  while (plane.heading < 0) {
    plane.heading += FULL_CIRCLE;
  }

  while (plane.heading > FULL_CIRCLE) {
    plane.heading -= FULL_CIRCLE;
  }
}

function turnAwayFromHorizontalBoundary(
  plane: PaperAirplane,
  currentWidth: number,
  margin: number,
  turnStrength: number
) {
  if (plane.x < margin) {
    plane.heading += plane.heading > Math.PI * 0.5 && plane.heading < Math.PI * 1.5
      ? -turnStrength
      : turnStrength;
  }

  if (plane.x > currentWidth - margin) {
    plane.heading += plane.heading < Math.PI * 0.5 || plane.heading > Math.PI * 1.5
      ? turnStrength
      : -turnStrength;
  }
}

function turnAwayFromVerticalBoundary(
  plane: PaperAirplane,
  currentHeight: number,
  margin: number,
  turnStrength: number
) {
  if (plane.y < margin) {
    plane.heading += plane.heading > Math.PI ? -turnStrength : turnStrength;
  }

  if (plane.y > currentHeight - margin) {
    plane.heading += plane.heading < Math.PI ? -turnStrength * 0.7 : turnStrength * 0.7;
    plane.energyReserve = Math.min(0.4, plane.energyReserve + 0.003);
  }
}

function guideAirplaneAwayFromEdges(
  plane: PaperAirplane,
  currentWidth: number,
  currentHeight: number
) {
  const margin = 80;
  const turnStrength = 0.008;

  turnAwayFromHorizontalBoundary(plane, currentWidth, margin, turnStrength);
  turnAwayFromVerticalBoundary(plane, currentHeight, margin, turnStrength);
}

function drawAirplaneTrail(ctx: CanvasRenderingContext2D, plane: PaperAirplane, darkMode: boolean) {
  if (plane.trail.length <= 3) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(plane.trail[0].x, plane.trail[0].y);

  for (let i = 1; i < plane.trail.length; i++) {
    ctx.lineTo(plane.trail[i].x, plane.trail[i].y);
  }

  const trailOpacity = Math.min(0.15, (plane.speed / plane.baseSpeed - 1.3) * 0.1);
  ctx.strokeStyle = darkMode
    ? `rgba(150, 160, 170, ${trailOpacity * 0.5})`
    : `rgba(255, 255, 255, ${trailOpacity})`;
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function updateAirplaneTrail(ctx: CanvasRenderingContext2D, plane: PaperAirplane, darkMode: boolean) {
  if (plane.speed <= plane.baseSpeed * 1.3) {
    if (plane.trail.length > 0) {
      plane.trail.shift();
    }

    return;
  }

  plane.trail.push({ x: plane.x, y: plane.y, opacity: 0.1 });

  if (plane.trail.length > 12) {
    plane.trail.shift();
  }

  drawAirplaneTrail(ctx, plane, darkMode);
}

function drawAirplaneAtDepth(
  ctx: CanvasRenderingContext2D,
  plane: PaperAirplane,
  drawPaperAirplane: DrawPaperAirplane
) {
  ctx.globalAlpha = Math.min(1.0, 0.4 + plane.z * 0.6);
  drawPaperAirplane(ctx, plane);
  ctx.globalAlpha = 1;
}

function shouldResetAirplane(plane: PaperAirplane, currentWidth: number, currentHeight: number) {
  return (
    plane.x < -150 ||
    plane.x > currentWidth + 150 ||
    plane.y < -150 ||
    plane.y > currentHeight + 150
  );
}

function updateAndDrawPaperAirplane(
  ctx: CanvasRenderingContext2D,
  plane: PaperAirplane,
  index: number,
  currentWidth: number,
  currentHeight: number,
  darkMode: boolean,
  paperColors: string[],
  airplanes: PaperAirplane[],
  createAirplane: CreatePaperAirplane,
  drawPaperAirplane: DrawPaperAirplane
) {
  updateAirplaneTurn(plane);
  updateAirplaneEnergy(plane);
  applyGravityToHeading(plane);
  applyStallPull(plane);
  updateAirplaneDepth(plane);
  moveAirplane(plane);
  normalizeAirplaneHeading(plane);
  guideAirplaneAwayFromEdges(plane, currentWidth, currentHeight);
  updateAirplaneTrail(ctx, plane, darkMode);
  drawAirplaneAtDepth(ctx, plane, drawPaperAirplane);

  if (shouldResetAirplane(plane, currentWidth, currentHeight)) {
    airplanes[index] = createAirplane(currentWidth, currentHeight, paperColors);
  }
}

export function usePaperAirplanes(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  enabled: boolean
) {
  const airplanesRef = useRef<PaperAirplane[]>([]);
  const cloudsRef = useRef<Cloud[]>([]);
  const birdsRef = useRef<Bird[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const width = canvas.width;
    const height = canvas.height;

    // Paper colors
    const paperColors = darkMode
      ? ['#e0d8d0', '#d8d0c8', '#e8e0d8', '#d0c8c0', '#ddd5cd']
      : ['#ffffff', '#fff8f0', '#f8f8ff', '#fffaf5', '#f5f5ff'];

    // Initialize clouds
    cloudsRef.current = [];
    for (let i = 0; i < 6; i++) {
      cloudsRef.current.push({
        x: Math.random() * width * 1.5 - width * 0.25,
        y: Math.random() * height * 0.5,
        width: 100 + Math.random() * 150,
        height: 40 + Math.random() * 40,
        speed: 0.1 + Math.random() * 0.15,
        opacity: 0.3 + Math.random() * 0.3,
      });
    }

    // Initialize birds
    birdsRef.current = [];
    for (let i = 0; i < 3; i++) {
      birdsRef.current.push({
        x: Math.random() * width,
        y: height * 0.1 + Math.random() * height * 0.3,
        size: 3 + Math.random() * 2,
        wingPhase: Math.random() * Math.PI * 2,
        wingSpeed: 0.15 + Math.random() * 0.1,
        speed: 0.6 + Math.random() * 0.3,
        heading: Math.random() * Math.PI * 2,
      });
    }

    function createAirplane(w: number, h: number, colors: string[]): PaperAirplane {
      // Random starting position around the edges or in the sky
      const edge = Math.random();
      let x: number, y: number, heading: number;

      if (edge < 0.25) {
        // Left edge - slight downward bias
        x = -40;
        y = h * 0.1 + Math.random() * h * 0.5;
        heading = 0.1 + Math.random() * 0.4; // Rightward with slight descent
      } else if (edge < 0.5) {
        // Right edge - slight downward bias
        x = w + 40;
        y = h * 0.1 + Math.random() * h * 0.5;
        heading = Math.PI - 0.1 - Math.random() * 0.4; // Leftward with slight descent
      } else if (edge < 0.8) {
        // Top (more common spawn) - descending
        x = Math.random() * w;
        y = -30;
        heading = Math.PI * 0.3 + Math.random() * Math.PI * 0.4; // Downward
      } else {
        // Random in middle (for initial spawn) - favor horizontal/slight descent
        x = w * 0.2 + Math.random() * w * 0.6;
        y = h * 0.1 + Math.random() * h * 0.35;
        // Favor horizontal with slight downward tendency
        const baseHeading = Math.random() < 0.5 ? 0 : Math.PI; // Left or right
        heading = baseHeading + (Math.random() * 0.5 - 0.1); // Slight variation, biased down
      }

      // Flight styles determine behavior
      const styles: ('wanderer' | 'circler' | 'swooper')[] = ['wanderer', 'circler', 'swooper'];
      const flightStyle = styles[Math.floor(Math.random() * styles.length)];

      const baseSpeed = 1.0 + Math.random() * 0.8;
      const baseSize = 18 + Math.random() * 8;
      // More varied depth - some planes very close, some far
      // Weight toward middle-far, but allow some close planes
      const depthRoll = Math.random();
      let z: number;
      if (depthRoll < 0.15) {
        z = 0.85 + Math.random() * 0.15; // Very close (15% chance)
      } else if (depthRoll < 0.35) {
        z = 0.6 + Math.random() * 0.25; // Medium-close (20% chance)
      } else if (depthRoll < 0.65) {
        z = 0.35 + Math.random() * 0.25; // Medium (30% chance)
      } else {
        z = 0.1 + Math.random() * 0.25; // Far (35% chance)
      }

      return {
        x,
        y,
        z,
        zVelocity: (Math.random() - 0.5) * 0.004, // Initial z movement
        size: baseSize * (0.3 + z * 1.5), // Size based on depth - close planes are much larger
        baseSize,
        color: colors[Math.floor(Math.random() * colors.length)],
        heading,
        turnRate: 0,
        targetTurnRate: 0,
        baseSpeed,
        speed: baseSpeed,
        bankAngle: 0,
        energyReserve: 0.2 + Math.random() * 0.3, // Low initial energy - climbing is hard
        glidePhase: Math.random() * Math.PI * 2,
        turnTimer: 30 + Math.random() * 60,
        flightStyle,
        trail: [],
      };
    }

    // Initialize airplanes
    airplanesRef.current = [];
    for (let i = 0; i < 5; i++) {
      airplanesRef.current.push(createAirplane(width, height, paperColors));
    }

    const drawPaperAirplane = (ctx: CanvasRenderingContext2D, plane: PaperAirplane) => {
      drawPaperAirplaneShape(ctx, plane, darkMode);
    };

    const drawCloud = (ctx: CanvasRenderingContext2D, cloud: Cloud) => {
      const { x, y, width: cw, height: ch, opacity: op } = cloud;

      ctx.fillStyle = darkMode
        ? `rgba(60, 70, 90, ${op})`
        : `rgba(255, 255, 255, ${op})`;

      ctx.beginPath();
      ctx.ellipse(x, y, cw * 0.4, ch, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(x - cw * 0.25, y + ch * 0.2, cw * 0.3, ch * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(x + cw * 0.25, y + ch * 0.1, cw * 0.35, ch * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(x + cw * 0.1, y - ch * 0.3, cw * 0.25, ch * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawBird = (ctx: CanvasRenderingContext2D, bird: Bird) => {
      ctx.save();
      ctx.translate(bird.x, bird.y);
      ctx.rotate(bird.heading);

      const wingY = Math.sin(bird.wingPhase) * bird.size * 0.4;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-bird.size, wingY - bird.size * 0.3, -bird.size * 1.5, wingY);
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(bird.size, wingY - bird.size * 0.3, bird.size * 1.5, wingY);

      ctx.strokeStyle = darkMode ? 'rgba(40, 50, 60, 0.5)' : 'rgba(80, 90, 100, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();
    };

    const animate = () => {
      const currentWidth = canvas.width;
      const currentHeight = canvas.height;
      ctx.clearRect(0, 0, currentWidth, currentHeight);
      timeRef.current += 0.016;

      // Sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, currentHeight);
      if (darkMode) {
        skyGrad.addColorStop(0, '#1a2030');
        skyGrad.addColorStop(0.4, '#252a3a');
        skyGrad.addColorStop(1, '#202535');
      } else {
        skyGrad.addColorStop(0, '#87ceeb');
        skyGrad.addColorStop(0.4, '#98d8f0');
        skyGrad.addColorStop(1, '#c8e8ff');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, currentWidth, currentHeight);

      // Sun glow
      const sunX = currentWidth * 0.8;
      const sunY = currentHeight * 0.15;
      const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, currentHeight * 0.35);
      if (darkMode) {
        sunGlow.addColorStop(0, 'rgba(60, 70, 90, 0.15)');
        sunGlow.addColorStop(1, 'rgba(40, 50, 70, 0)');
      } else {
        sunGlow.addColorStop(0, 'rgba(255, 250, 220, 0.35)');
        sunGlow.addColorStop(0.4, 'rgba(255, 245, 200, 0.15)');
        sunGlow.addColorStop(1, 'rgba(255, 240, 180, 0)');
      }
      ctx.fillStyle = sunGlow;
      ctx.fillRect(0, 0, currentWidth, currentHeight);

      // Draw clouds
      cloudsRef.current.forEach((cloud) => {
        cloud.x += cloud.speed;
        if (cloud.x > currentWidth + cloud.width) {
          cloud.x = -cloud.width;
          cloud.y = Math.random() * currentHeight * 0.5;
        }
        drawCloud(ctx, cloud);
      });

      // Draw birds
      birdsRef.current.forEach((bird) => {
        bird.wingPhase += bird.wingSpeed;
        bird.x += Math.cos(bird.heading) * bird.speed;
        bird.y += Math.sin(bird.heading) * bird.speed;
        bird.heading += (Math.random() - 0.5) * 0.02; // Slight wandering

        // Wrap around
        if (bird.x > currentWidth + 30) bird.x = -30;
        if (bird.x < -30) bird.x = currentWidth + 30;
        if (bird.y > currentHeight * 0.5) bird.y = currentHeight * 0.1;
        if (bird.y < 0) bird.y = currentHeight * 0.4;

        drawBird(ctx, bird);
      });

      // Update and draw airplanes
      airplanesRef.current.forEach((plane, index) => {
        updateAndDrawPaperAirplane(
          ctx,
          plane,
          index,
          currentWidth,
          currentHeight,
          darkMode,
          paperColors,
          airplanesRef.current,
          createAirplane,
          drawPaperAirplane
        );
      });

      // Occasionally spawn new airplane
      if (Math.random() < 0.001 && airplanesRef.current.length < 7) {
        airplanesRef.current.push(createAirplane(currentWidth, currentHeight, paperColors));
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [canvasRef, darkMode, opacity, enabled]);
}
