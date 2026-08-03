/**
 * Sanctuary Logo Animation
 * Scattered floating Sanctuary logos with ambient particles
 * and sumi ink wash textured background
 */

import { useRef, useEffect, useCallback } from 'react';

interface ScatteredLogo {
  x: number;
  y: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  opacity: number;
  pulsePhase: number;
  driftX: number;
  driftY: number;
  driftPhaseX: number;
  driftPhaseY: number;
}

function drawTiledSanctuaryBackground(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  _time: number,
  darkMode: boolean,
  _opacityMultiplier: number
) {
  // Background color based on dark mode
  ctx.fillStyle = darkMode ? '#000000' : '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Logo color - subtly blends into background
  // Dark mode: very dark gray on black
  // Light mode: very light gray on white
  const logoColor = darkMode ? '#080808' : '#f5f5f5';

  // Match CSS tile size: 40x40 with viewBox 0 0 24 24
  const tileSize = 40;
  const scale = tileSize / 24;

  // Calculate grid to cover canvas
  const cols = Math.ceil(canvasWidth / tileSize) + 1;
  const rows = Math.ceil(canvasHeight / tileSize) + 1;

  ctx.strokeStyle = logoColor;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * tileSize;
      const cy = row * tileSize;

      ctx.save();
      ctx.translate(cx, cy);

      // Draw sanctuary logo matching SVG paths from index.html
      // Path: M12 2L2 7l10 5 10-5-10-5z (top diamond)
      ctx.beginPath();
      ctx.moveTo(12 * scale, 2 * scale);
      ctx.lineTo(2 * scale, 7 * scale);
      ctx.lineTo(12 * scale, 12 * scale);
      ctx.lineTo(22 * scale, 7 * scale);
      ctx.closePath();
      ctx.stroke();

      // Path: M2 17l10 5 10-5 (bottom layer)
      ctx.beginPath();
      ctx.moveTo(2 * scale, 17 * scale);
      ctx.lineTo(12 * scale, 22 * scale);
      ctx.lineTo(22 * scale, 17 * scale);
      ctx.stroke();

      // Path: M2 12l10 5 10-5 (middle layer)
      ctx.beginPath();
      ctx.moveTo(2 * scale, 12 * scale);
      ctx.lineTo(12 * scale, 17 * scale);
      ctx.lineTo(22 * scale, 12 * scale);
      ctx.stroke();

      // Circle at bottom of top diamond (cy=12)
      ctx.beginPath();
      ctx.arc(12 * scale, 12 * scale, 1 * scale, 0, Math.PI * 2);
      ctx.fillStyle = logoColor;
      ctx.fill();

      ctx.restore();
    }
  }
}

function drawSanctuaryLogoShape(
  ctx: CanvasRenderingContext2D,
  size: number,
  alpha: number
) {
  const goldColor = { r: 212, g: 160, b: 23 };
  const strokeColor = `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha})`;
  const fillColor = `rgba(${goldColor.r}, ${goldColor.g}, ${goldColor.b}, ${alpha * 0.4})`;

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = size * 0.075;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Scale factor: SVG viewBox is 24x24, logo spans y=2 to y=22
  // We center at (12,12) in SVG = (0,0) in canvas
  // So y=2 becomes -10, y=22 becomes +10
  const scale = size / 20;

  // Top diamond: SVG path "M12 2L2 7l10 5 10-5-10-5z"
  // Points: (12,2) → (2,7) → (12,12) → (22,7) → close
  // Centered: (0,-10) → (-10,-5) → (0,0) → (10,-5) → close
  ctx.beginPath();
  ctx.moveTo(0, -10 * scale);           // (12,2) - top point
  ctx.lineTo(-10 * scale, -5 * scale);  // (2,7) - left point
  ctx.lineTo(0, 0);                      // (12,12) - bottom point
  ctx.lineTo(10 * scale, -5 * scale);   // (22,7) - right point
  ctx.closePath();
  ctx.stroke();

  // Middle layer: SVG "M2 12l10 5 10-5"
  // Points: (2,12) → (12,17) → (22,12)
  // Centered: (-10,0) → (0,5) → (10,0)
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 0);
  ctx.lineTo(0, 5 * scale);
  ctx.lineTo(10 * scale, 0);
  ctx.stroke();

  // Bottom layer: SVG "M2 17l10 5 10-5"
  // Points: (2,17) → (12,22) → (22,17)
  // Centered: (-10,5) → (0,10) → (10,5)
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 5 * scale);
  ctx.lineTo(0, 10 * scale);
  ctx.lineTo(10 * scale, 5 * scale);
  ctx.stroke();

  // Circle at bottom of top diamond - where it meets the V layers below
  // SVG cy=12 (bottom vertex of top diamond)
  // Centered: (0, 12-12) = (0, 0)
  ctx.beginPath();
  ctx.arc(0, 0, 1 * scale, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
}

export function useSanctuaryLogo(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) {
  const logosRef = useRef<ScatteredLogo[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef<number>(0);

  const createLogo = useCallback((canvas: HTMLCanvasElement): ScatteredLogo => {
    const size = 20 + Math.random() * 40;

    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.003,
      opacity: 0.15 + Math.random() * 0.25,
      pulsePhase: Math.random() * Math.PI * 2,
      driftX: 15 + Math.random() * 25,
      driftY: 10 + Math.random() * 20,
      driftPhaseX: Math.random() * Math.PI * 2,
      driftPhaseY: Math.random() * Math.PI * 2,
    };
  }, []);

  useEffect(() => {
    if (!active) return;

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

    const logoCount = Math.floor((canvas.width * canvas.height) / 80000);
    logosRef.current = Array.from({ length: Math.max(8, logoCount) }, () =>
      createLogo(canvas)
    );

    const animate = () => {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      timeRef.current += 0.016;

      const opacityMultiplier = opacity / 50;

      // Draw tiled sanctuary logo pattern first (behind logos)
      drawTiledSanctuaryBackground(ctx, canvas.width, canvas.height, timeRef.current, darkMode, opacityMultiplier);

      logosRef.current.forEach((logo) => {
        const currentX = logo.x + Math.sin(timeRef.current * 0.2 + logo.driftPhaseX) * logo.driftX;
        const currentY = logo.y + Math.cos(timeRef.current * 0.15 + logo.driftPhaseY) * logo.driftY;

        logo.rotation += logo.rotationSpeed;

        const pulseOpacity = logo.opacity + Math.sin(timeRef.current * 0.5 + logo.pulsePhase) * 0.08;
        const pulseScale = 1 + Math.sin(timeRef.current * 0.3 + logo.pulsePhase) * 0.05;

        ctx.save();
        ctx.translate(currentX, currentY);
        ctx.rotate(logo.rotation);
        ctx.scale(pulseScale, pulseScale);

        // Draw logo
        drawSanctuaryLogoShape(ctx, logo.size, pulseOpacity * opacityMultiplier);

        ctx.restore();
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
  }, [canvasRef, darkMode, opacity, createLogo, active]);
}
