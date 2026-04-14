/**
 * Paper Boats Animation
 *
 * Tiny paper boats floating on a gentle stream
 * with organic riverbanks and realistic flowing water.
 */

import { useEffect, useRef } from 'react';

interface PaperBoat {
  x: number;
  y: number;
  size: number;
  color: string;
  bobPhase: number;
  bobSpeed: number;
  speedX: number;
  rotation: number;
  rotationSpeed: number;
}

interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  opacity: number;
}

interface WaterLayer {
  yOffset: number;
  phase: number;
  speed: number;
  amplitude: number;
  frequency: number;
  opacity: number;
}

interface Caustic {
  x: number;
  y: number;
  size: number;
  phase: number;
  speed: number;
  opacity: number;
}

export function usePaperBoats(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  enabled: boolean
) {
  const boatsRef = useRef<PaperBoat[]>([]);
  const ripplesRef = useRef<Ripple[]>([]);
  const waterLayersRef = useRef<WaterLayer[]>([]);
  const causticsRef = useRef<Caustic[]>([]);
  const animationRef = useRef<number | undefined>(undefined);
  const timeRef = useRef(0);
  // Store bank curves for consistent rendering
  const bankCurvesRef = useRef<{ top: number[]; bottom: number[] }>({ top: [], bottom: [] });

  useEffect(() => {
    if (!enabled) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      // Regenerate bank curves on resize
      generateBankCurves(canvas.width, canvas.height);
    };

    const generateBankCurves = (w: number, h: number) => {
      const topBank: number[] = [];
      const bottomBank: number[] = [];
      const segments = Math.ceil(w / 20) + 1;

      // Generate organic curves using layered sine waves
      for (let i = 0; i < segments; i++) {
        const x = (i / (segments - 1)) * w;

        // Multiple frequencies for natural look
        const topOffset =
          Math.sin(x * 0.003) * 40 +
          Math.sin(x * 0.008 + 1.5) * 20 +
          Math.sin(x * 0.015 + 3) * 10 +
          Math.sin(x * 0.025) * 5;

        const bottomOffset =
          Math.sin(x * 0.004 + 2) * 35 +
          Math.sin(x * 0.009 + 0.8) * 18 +
          Math.sin(x * 0.018 + 1.2) * 8 +
          Math.sin(x * 0.022 + 4) * 4;

        topBank.push(h * 0.22 + topOffset);
        bottomBank.push(h * 0.82 + bottomOffset);
      }

      bankCurvesRef.current = { top: topBank, bottom: bottomBank };
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const width = canvas.width;
    const height = canvas.height;

    // Boat colors (cream/white paper tones)
    const boatColors = darkMode
      ? ['#e8e0d8', '#ddd5cc', '#e0d8d0', '#d8d0c8', '#f0e8e0']
      : ['#ffffff', '#fff8f0', '#fffaf5', '#f8f8ff', '#fff5f0'];

    // Initialize multiple water layers for depth
    waterLayersRef.current = [];
    for (let i = 0; i < 6; i++) {
      waterLayersRef.current.push({
        yOffset: i * 0.15,
        phase: Math.random() * Math.PI * 2,
        speed: 0.008 + i * 0.003,
        amplitude: 2 + i * 0.8,
        frequency: 0.015 - i * 0.002,
        opacity: 0.15 - i * 0.02,
      });
    }

    // Initialize caustic light patterns
    causticsRef.current = [];
    for (let i = 0; i < 12; i++) {
      causticsRef.current.push({
        x: Math.random() * width,
        y: height * 0.25 + Math.random() * height * 0.5,
        size: 30 + Math.random() * 60,
        phase: Math.random() * Math.PI * 2,
        speed: 0.02 + Math.random() * 0.02,
        opacity: 0.03 + Math.random() * 0.04,
      });
    }

    // Initialize boats
    boatsRef.current = [];
    for (let i = 0; i < 4; i++) {
      boatsRef.current.push({
        x: Math.random() * width,
        y: height * 0.35 + Math.random() * height * 0.35,
        size: 20 + Math.random() * 12,
        color: boatColors[Math.floor(Math.random() * boatColors.length)],
        bobPhase: Math.random() * Math.PI * 2,
        bobSpeed: 0.018 + Math.random() * 0.012,
        speedX: 0.2 + Math.random() * 0.2,
        rotation: (Math.random() - 0.5) * 0.1,
        rotationSpeed: (Math.random() - 0.5) * 0.003,
      });
    }

    ripplesRef.current = [];

    const drawPaperBoat = (ctx: CanvasRenderingContext2D, boat: PaperBoat) => {
      const bob = Math.sin(boat.bobPhase) * 2.5;
      const tilt = Math.sin(boat.bobPhase * 0.7) * 0.03;

      ctx.save();
      ctx.translate(boat.x, boat.y + bob);
      ctx.rotate(boat.rotation + tilt);

      const s = boat.size;

      // Simple water reflection
      ctx.globalAlpha = 0.15;
      ctx.save();
      ctx.scale(1, -0.25);
      ctx.translate(0, -s * 3.5);
      drawBoatShape(ctx, s, boat.color);
      ctx.restore();
      ctx.globalAlpha = 1;

      // The boat
      drawBoatShape(ctx, s, boat.color);

      ctx.restore();
    };

    const drawBoatShape = (
      ctx: CanvasRenderingContext2D,
      s: number,
      color: string
    ) => {
      // Hull - simple curved bottom
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, 0);
      ctx.quadraticCurveTo(-s * 0.4, s * 0.28, 0, s * 0.32);
      ctx.quadraticCurveTo(s * 0.4, s * 0.28, s * 0.5, 0);
      ctx.lineTo(s * 0.35, -s * 0.08);
      ctx.lineTo(-s * 0.35, -s * 0.08);
      ctx.closePath();

      // Gradient for paper texture
      const hullGrad = ctx.createLinearGradient(-s * 0.5, 0, s * 0.5, s * 0.3);
      hullGrad.addColorStop(0, color);
      hullGrad.addColorStop(0.5, darkMode ? '#f0e8e0' : '#ffffff');
      hullGrad.addColorStop(1, color);
      ctx.fillStyle = hullGrad;
      ctx.fill();

      ctx.strokeStyle = darkMode ? 'rgba(120, 100, 80, 0.4)' : 'rgba(200, 180, 160, 0.5)';
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Sail
      ctx.beginPath();
      ctx.moveTo(0, s * 0.1);
      ctx.lineTo(0, -s * 0.55);
      ctx.lineTo(s * 0.28, s * 0.02);
      ctx.closePath();

      const sailGrad = ctx.createLinearGradient(0, -s * 0.5, s * 0.25, 0);
      sailGrad.addColorStop(0, darkMode ? '#f5f0e8' : '#ffffff');
      sailGrad.addColorStop(1, color);
      ctx.fillStyle = sailGrad;
      ctx.fill();
      ctx.stroke();

      // Mast
      ctx.beginPath();
      ctx.moveTo(0, s * 0.15);
      ctx.lineTo(0, -s * 0.55);
      ctx.strokeStyle = darkMode ? 'rgba(100, 80, 60, 0.6)' : 'rgba(160, 140, 120, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Fold line on hull
      ctx.beginPath();
      ctx.moveTo(-s * 0.3, s * 0.05);
      ctx.quadraticCurveTo(0, s * 0.2, s * 0.3, s * 0.05);
      ctx.strokeStyle = darkMode ? 'rgba(100, 80, 60, 0.25)' : 'rgba(180, 160, 140, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    };

    const getBankY = (x: number, bank: number[], w: number): number => {
      const segments = bank.length - 1;
      const segmentWidth = w / segments;
      const segmentIndex = Math.min(Math.floor(x / segmentWidth), segments - 1);
      const t = (x - segmentIndex * segmentWidth) / segmentWidth;

      // Smooth interpolation
      const y0 = bank[Math.max(0, segmentIndex)];
      const y1 = bank[Math.min(segments, segmentIndex + 1)];
      return y0 + (y1 - y0) * t;
    };

    const addSkyGradientStops = (skyGradient: CanvasGradient) => {
      if (darkMode) {
        skyGradient.addColorStop(0, '#1a1f2a');
        skyGradient.addColorStop(0.5, '#1e2535');
        skyGradient.addColorStop(1, '#1a2030');
        return;
      }

      skyGradient.addColorStop(0, '#e0eef8');
      skyGradient.addColorStop(0.5, '#d0e5f5');
      skyGradient.addColorStop(1, '#c5ddf0');
    };

    const addWaterGradientStops = (waterGrad: CanvasGradient) => {
      if (darkMode) {
        waterGrad.addColorStop(0, '#1e3040');
        waterGrad.addColorStop(0.3, '#253848');
        waterGrad.addColorStop(0.7, '#2a4050');
        waterGrad.addColorStop(1, '#203545');
        return;
      }

      waterGrad.addColorStop(0, '#88b8d0');
      waterGrad.addColorStop(0.3, '#7ab0c8');
      waterGrad.addColorStop(0.7, '#70a8c0');
      waterGrad.addColorStop(1, '#80b0c8');
    };

    const traceBankCurve = (bank: number[], currentWidth: number) => {
      ctx.moveTo(0, bank[0]);
      for (let i = 1; i < bank.length; i++) {
        const x = (i / (bank.length - 1)) * currentWidth;
        ctx.lineTo(x, bank[i]);
      }
    };

    const drawSky = (currentWidth: number, currentHeight: number) => {
      const skyGradient = ctx.createLinearGradient(0, 0, 0, currentHeight);
      addSkyGradientStops(skyGradient);
      ctx.fillStyle = skyGradient;
      ctx.fillRect(0, 0, currentWidth, currentHeight);
    };

    const drawTopBank = (topBank: number[], currentWidth: number) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 0; i < topBank.length; i++) {
        const x = (i / (topBank.length - 1)) * currentWidth;
        ctx.lineTo(x, topBank[i]);
      }
      ctx.lineTo(currentWidth, 0);
      ctx.closePath();
      ctx.fillStyle = darkMode ? '#1a2818' : '#7aa870';
      ctx.fill();
    };

    const drawBottomBank = (
      bottomBank: number[],
      currentWidth: number,
      currentHeight: number
    ) => {
      ctx.beginPath();
      ctx.moveTo(0, currentHeight);
      for (let i = 0; i < bottomBank.length; i++) {
        const x = (i / (bottomBank.length - 1)) * currentWidth;
        ctx.lineTo(x, bottomBank[i]);
      }
      ctx.lineTo(currentWidth, currentHeight);
      ctx.closePath();
      ctx.fillStyle = darkMode ? '#1a2818' : '#7aa870';
      ctx.fill();
    };

    const drawBankEdge = (bank: number[], currentWidth: number, offset: number) => {
      ctx.beginPath();
      traceBankCurve(bank, currentWidth);
      ctx.lineTo(currentWidth, bank[bank.length - 1] + offset);
      for (let i = bank.length - 1; i >= 0; i--) {
        const x = (i / (bank.length - 1)) * currentWidth;
        ctx.lineTo(x, bank[i] + offset);
      }
      ctx.closePath();
      ctx.fillStyle = darkMode ? '#121a10' : '#5a8850';
      ctx.fill();
    };

    const drawWaterBase = (
      topBank: number[],
      bottomBank: number[],
      currentWidth: number,
      currentHeight: number
    ) => {
      ctx.beginPath();
      traceBankCurve(topBank, currentWidth);
      for (let i = bottomBank.length - 1; i >= 0; i--) {
        const x = (i / (bottomBank.length - 1)) * currentWidth;
        ctx.lineTo(x, bottomBank[i]);
      }
      ctx.closePath();

      const waterGrad = ctx.createLinearGradient(0, currentHeight * 0.2, 0, currentHeight * 0.8);
      addWaterGradientStops(waterGrad);
      ctx.fillStyle = waterGrad;
      ctx.fill();
    };

    const addCausticGradientStops = (
      gradient: CanvasGradient,
      caustic: Caustic,
      pulse: number
    ) => {
      if (darkMode) {
        gradient.addColorStop(0, `rgba(100, 140, 180, ${caustic.opacity * pulse})`);
        gradient.addColorStop(0.5, `rgba(80, 120, 160, ${caustic.opacity * 0.5 * pulse})`);
        gradient.addColorStop(1, 'rgba(60, 100, 140, 0)');
        return;
      }

      gradient.addColorStop(0, `rgba(255, 255, 240, ${caustic.opacity * pulse})`);
      gradient.addColorStop(0.5, `rgba(240, 250, 255, ${caustic.opacity * 0.5 * pulse})`);
      gradient.addColorStop(1, 'rgba(220, 240, 255, 0)');
    };

    const drawCausticGlow = (caustic: Caustic, pulse: number) => {
      const gradient = ctx.createRadialGradient(
        caustic.x,
        caustic.y,
        0,
        caustic.x,
        caustic.y,
        caustic.size * pulse
      );
      addCausticGradientStops(gradient, caustic, pulse);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(caustic.x, caustic.y, caustic.size * pulse, 0, Math.PI * 2);
      ctx.fill();
    };

    const updateAndDrawCaustics = (
      topBank: number[],
      bottomBank: number[],
      currentWidth: number,
      currentHeight: number
    ) => {
      causticsRef.current.forEach((caustic) => {
        caustic.phase += caustic.speed;
        const pulse = 0.7 + Math.sin(caustic.phase) * 0.3;
        const topY = getBankY(caustic.x, topBank, currentWidth);
        const bottomY = getBankY(caustic.x, bottomBank, currentWidth);

        if (caustic.y > topY && caustic.y < bottomY) {
          drawCausticGlow(caustic, pulse);
        }

        caustic.x += 0.15;
        if (caustic.x > currentWidth + caustic.size) {
          caustic.x = -caustic.size;
          caustic.y = currentHeight * 0.25 + Math.random() * currentHeight * 0.5;
        }
      });
    };

    const drawWaterFlowLayers = (
      topBank: number[],
      bottomBank: number[],
      currentWidth: number
    ) => {
      waterLayersRef.current.forEach((layer) => {
        layer.phase += layer.speed;

        ctx.beginPath();
        for (let x = 0; x <= currentWidth; x += 8) {
          const topY = getBankY(x, topBank, currentWidth);
          const bottomY = getBankY(x, bottomBank, currentWidth);
          const waterHeight = bottomY - topY;
          const y =
            topY +
            waterHeight * (0.2 + layer.yOffset * 0.6) +
            Math.sin(x * layer.frequency + layer.phase) * layer.amplitude +
            Math.sin(x * layer.frequency * 2.3 + layer.phase * 1.5) * layer.amplitude * 0.4;

          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.strokeStyle = darkMode
          ? `rgba(100, 150, 180, ${layer.opacity})`
          : `rgba(255, 255, 255, ${layer.opacity * 1.5})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    };

    const drawWaterShimmer = (topBank: number[], currentWidth: number) => {
      for (let i = 0; i < 8; i++) {
        const shimmerX = ((timeRef.current * 30 + i * 200) % (currentWidth + 100)) - 50;
        const topY = getBankY(shimmerX, topBank, currentWidth);
        const shimmerY = topY + 20 + Math.sin(shimmerX * 0.02 + timeRef.current) * 5;

        ctx.beginPath();
        ctx.moveTo(shimmerX, shimmerY);
        ctx.lineTo(shimmerX + 15 + Math.random() * 10, shimmerY);
        ctx.strokeStyle = darkMode
          ? 'rgba(120, 160, 200, 0.15)'
          : 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };

    const updateAndDrawRipple = (ripple: Ripple) => {
      ripple.radius += 0.5;
      ripple.opacity -= 0.008;

      if (ripple.opacity <= 0) return false;

      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
      ctx.strokeStyle = darkMode
        ? `rgba(140, 180, 200, ${ripple.opacity})`
        : `rgba(255, 255, 255, ${ripple.opacity})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();

      if (ripple.radius > 8) {
        ctx.beginPath();
        ctx.arc(ripple.x, ripple.y, ripple.radius * 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = darkMode
          ? `rgba(140, 180, 200, ${ripple.opacity * 0.5})`
          : `rgba(255, 255, 255, ${ripple.opacity * 0.6})`;
        ctx.stroke();
      }

      return true;
    };

    const updateAndDrawRipples = () => {
      ripplesRef.current = ripplesRef.current.filter(updateAndDrawRipple);
    };

    const wrapBoatIfNeeded = (
      boat: PaperBoat,
      topBank: number[],
      bottomBank: number[],
      currentWidth: number
    ) => {
      if (boat.x <= currentWidth + 60) return;

      boat.x = -50;
      const newTopY = getBankY(0, topBank, currentWidth);
      const newBottomY = getBankY(0, bottomBank, currentWidth);
      boat.y = newTopY + 50 + Math.random() * (newBottomY - newTopY - 100);
    };

    const maybeAddBoatRipple = (boat: PaperBoat) => {
      if (Math.random() >= 0.012) return;

      ripplesRef.current.push({
        x: boat.x - boat.size * 0.2,
        y: boat.y + boat.size * 0.35,
        radius: 2,
        maxRadius: 20,
        opacity: 0.3,
      });
    };

    const updateBoat = (
      boat: PaperBoat,
      topBank: number[],
      bottomBank: number[],
      currentWidth: number
    ) => {
      boat.bobPhase += boat.bobSpeed;
      boat.x += boat.speedX;
      boat.rotation += boat.rotationSpeed;

      if (Math.abs(boat.rotation) > 0.1) {
        boat.rotationSpeed *= -0.8;
      }

      const topY = getBankY(boat.x, topBank, currentWidth);
      const bottomY = getBankY(boat.x, bottomBank, currentWidth);
      const waterMid = (topY + bottomY) / 2;

      if (boat.y < topY + 40) boat.y = topY + 40;
      if (boat.y > bottomY - 30) boat.y = bottomY - 30;

      boat.y += (waterMid - boat.y) * 0.001;
      wrapBoatIfNeeded(boat, topBank, bottomBank, currentWidth);
      maybeAddBoatRipple(boat);
    };

    const updateAndDrawBoats = (
      topBank: number[],
      bottomBank: number[],
      currentWidth: number
    ) => {
      boatsRef.current.forEach((boat) => {
        updateBoat(boat, topBank, bottomBank, currentWidth);
        drawPaperBoat(ctx, boat);
      });
    };

    const trimRipples = () => {
      if (ripplesRef.current.length > 25) {
        ripplesRef.current = ripplesRef.current.slice(-20);
      }
    };

    const drawGrassBlade = (
      x: number,
      bankY: number,
      offsetX: number,
      height: number,
      sway: number,
      isTop: boolean
    ) => {
      ctx.beginPath();
      ctx.moveTo(x + offsetX, bankY);

      if (isTop) {
        ctx.quadraticCurveTo(
          x + offsetX + sway,
          bankY + height * 0.5,
          x + offsetX + sway * 0.7,
          bankY + height
        );
      } else {
        ctx.quadraticCurveTo(
          x + offsetX + sway,
          bankY - height * 0.5,
          x + offsetX + sway * 0.7,
          bankY - height
        );
      }
      ctx.stroke();
    };

    const drawGrassTufts = (
      bankCurve: number[],
      currentWidth: number,
      isTop: boolean
    ) => {
      ctx.strokeStyle = darkMode ? '#2a3820' : '#6a9a60';
      ctx.lineWidth = 1;

      for (let x = 0; x < currentWidth; x += 18 + Math.sin(x) * 5) {
        const bankY = getBankY(x, bankCurve, currentWidth);
        const tufts = 2 + Math.floor(Math.random() * 2);

        for (let t = 0; t < tufts; t++) {
          const offsetX = (t - tufts / 2) * 4;
          const height = 6 + Math.random() * 8;
          const sway = Math.sin(timeRef.current * 1.2 + x * 0.05 + t) * 2;
          drawGrassBlade(x, bankY, offsetX, height, sway, isTop);
        }
      }
    };

    const drawFrame = (currentWidth: number, currentHeight: number) => {
      const { top: topBank, bottom: bottomBank } = bankCurvesRef.current;

      drawSky(currentWidth, currentHeight);
      drawTopBank(topBank, currentWidth);
      drawBankEdge(topBank, currentWidth, 15);
      drawBottomBank(bottomBank, currentWidth, currentHeight);
      drawBankEdge(bottomBank, currentWidth, -12);
      drawWaterBase(topBank, bottomBank, currentWidth, currentHeight);
      updateAndDrawCaustics(topBank, bottomBank, currentWidth, currentHeight);
      drawWaterFlowLayers(topBank, bottomBank, currentWidth);
      drawWaterShimmer(topBank, currentWidth);
      updateAndDrawRipples();
      updateAndDrawBoats(topBank, bottomBank, currentWidth);
      trimRipples();
      drawGrassTufts(topBank, currentWidth, true);
      drawGrassTufts(bottomBank, currentWidth, false);
    };

    const animate = () => {
      const currentWidth = canvas.width;
      const currentHeight = canvas.height;
      ctx.clearRect(0, 0, currentWidth, currentHeight);
      timeRef.current += 0.016;

      drawFrame(currentWidth, currentHeight);
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
