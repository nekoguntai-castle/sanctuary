/**
 * Mycelium Network Animation
 *
 * Organic branching lines that grow, connect, and pulse with traveling energy
 * like underground fungal networks or neural pathways.
 */

import { useEffect, useRef } from 'react';
import { advanceMyceliumGrowth, type MyceliumNode, type MyceliumState } from './myceliumNetwork/model';

export function useMyceliumNetwork(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
): void {
  const stateRef = useRef<MyceliumState>({ nodes: [], branches: [], tips: [] });
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initializeNetwork();
    };

    const initializeNetwork = () => {
      const { width, height } = canvas;
      const state = stateRef.current;
      state.nodes = [];
      state.branches = [];
      state.tips = [];

      // Create initial seed nodes
      const seedCount = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < seedCount; i++) {
        const node: MyceliumNode = {
          x: width * 0.2 + Math.random() * width * 0.6,
          y: height * 0.2 + Math.random() * height * 0.6,
          connections: [],
          pulsePhase: Math.random() * Math.PI * 2,
          size: 4 + Math.random() * 4,
          bloomPhase: 0,
          isBloomNode: Math.random() < 0.3,
        };
        state.nodes.push(node);

        // Create initial growing tips from seed
        const tipCount = 2 + Math.floor(Math.random() * 3);
        for (let t = 0; t < tipCount; t++) {
          state.tips.push({
            x: node.x,
            y: node.y,
            angle: (t / tipCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.5,
            parentNode: state.nodes.length - 1,
            age: 0,
            thickness: 2 + Math.random() * 2,
          });
        }
      }
    };

    const drawNetwork = () => {
      const opacityMult = opacity / 50;

      // Draw branches
      stateRef.current.branches.forEach((branch) => {
        const startNode = stateRef.current.nodes[branch.startNode];
        const endNode = stateRef.current.nodes[branch.endNode];

        const progress = Math.min(1, branch.progress);
        const endX = startNode.x + (endNode.x - startNode.x) * progress;
        const endY = startNode.y + (endNode.y - startNode.y) * progress;

        // Main branch line
        const gradient = ctx.createLinearGradient(startNode.x, startNode.y, endX, endY);
        if (darkMode) {
          gradient.addColorStop(0, `rgba(140, 160, 140, ${0.4 * opacityMult})`);
          gradient.addColorStop(1, `rgba(100, 130, 100, ${0.3 * opacityMult})`);
        } else {
          gradient.addColorStop(0, `rgba(80, 120, 80, ${0.35 * opacityMult})`);
          gradient.addColorStop(1, `rgba(60, 100, 60, ${0.25 * opacityMult})`);
        }

        ctx.strokeStyle = gradient;
        ctx.lineWidth = branch.thickness;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startNode.x, startNode.y);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        // Draw pulses along branch
        branch.pulses.forEach((pulse) => {
          const px = startNode.x + (endNode.x - startNode.x) * pulse.position;
          const py = startNode.y + (endNode.y - startNode.y) * pulse.position;

          const pulseGradient = ctx.createRadialGradient(px, py, 0, px, py, pulse.size);
          if (darkMode) {
            pulseGradient.addColorStop(0, `rgba(180, 220, 180, ${pulse.opacity * opacityMult})`);
            pulseGradient.addColorStop(1, 'rgba(140, 180, 140, 0)');
          } else {
            pulseGradient.addColorStop(0, `rgba(100, 180, 100, ${pulse.opacity * opacityMult})`);
            pulseGradient.addColorStop(1, 'rgba(80, 140, 80, 0)');
          }

          ctx.fillStyle = pulseGradient;
          ctx.beginPath();
          ctx.arc(px, py, pulse.size, 0, Math.PI * 2);
          ctx.fill();
        });
      });

      // Draw nodes
      stateRef.current.nodes.forEach((node) => {
        const pulse = Math.sin(node.pulsePhase) * 0.3 + 0.7;
        const size = node.size * pulse;

        // Node glow
        const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, size * 2);
        if (darkMode) {
          gradient.addColorStop(0, `rgba(160, 200, 160, ${0.5 * opacityMult})`);
          gradient.addColorStop(0.5, `rgba(120, 160, 120, ${0.2 * opacityMult})`);
          gradient.addColorStop(1, 'rgba(100, 140, 100, 0)');
        } else {
          gradient.addColorStop(0, `rgba(80, 160, 80, ${0.4 * opacityMult})`);
          gradient.addColorStop(0.5, `rgba(60, 120, 60, ${0.15 * opacityMult})`);
          gradient.addColorStop(1, 'rgba(60, 100, 60, 0)');
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(node.x, node.y, size * 2, 0, Math.PI * 2);
        ctx.fill();

        // Bloom effect for special nodes
        if (node.isBloomNode && node.bloomPhase > 0) {
          const bloomSize = size * 3 * Math.sin(node.bloomPhase);
          const bloomGradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, bloomSize);
          const bloomAlpha = Math.sin(node.bloomPhase) * 0.3 * opacityMult;
          if (darkMode) {
            bloomGradient.addColorStop(0, `rgba(200, 240, 200, ${bloomAlpha})`);
            bloomGradient.addColorStop(1, 'rgba(160, 200, 160, 0)');
          } else {
            bloomGradient.addColorStop(0, `rgba(120, 200, 120, ${bloomAlpha})`);
            bloomGradient.addColorStop(1, 'rgba(80, 160, 80, 0)');
          }
          ctx.fillStyle = bloomGradient;
          ctx.beginPath();
          ctx.arc(node.x, node.y, bloomSize, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Draw growing tips
      stateRef.current.tips.forEach((tip) => {
        const tipGradient = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, 5);
        if (darkMode) {
          tipGradient.addColorStop(0, `rgba(180, 220, 180, ${0.6 * opacityMult})`);
          tipGradient.addColorStop(1, 'rgba(140, 180, 140, 0)');
        } else {
          tipGradient.addColorStop(0, `rgba(100, 180, 100, ${0.5 * opacityMult})`);
          tipGradient.addColorStop(1, 'rgba(60, 140, 60, 0)');
        }
        ctx.fillStyle = tipGradient;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const animate = () => {
      const { width, height } = canvas;
      timeRef.current += 16;

      // Clear
      ctx.fillStyle = darkMode ? 'rgba(15, 18, 15, 1)' : 'rgba(250, 252, 250, 1)';
      ctx.fillRect(0, 0, width, height);

      // Update nodes
      stateRef.current.nodes.forEach((node) => {
        node.pulsePhase += 0.02;
        if (node.isBloomNode) {
          if (node.bloomPhase > 0) {
            node.bloomPhase += 0.015;
            if (node.bloomPhase > Math.PI) {
              node.bloomPhase = 0;
            }
          } else if (Math.random() < 0.0003) {
            node.bloomPhase = 0.01;
          }
        }
      });

      // Update branches - grow and add pulses
      stateRef.current.branches.forEach((branch) => {
        if (branch.progress < 1) {
          branch.progress += branch.growthSpeed;
        }

        // Random pulse generation
        if (Math.random() < 0.003 && branch.progress >= 1) {
          branch.pulses.push({
            position: 0,
            speed: 0.008 + Math.random() * 0.008,
            size: 3 + Math.random() * 4,
            opacity: 0.5 + Math.random() * 0.3,
          });
        }

        // Update pulses
        branch.pulses = branch.pulses.filter((pulse) => {
          pulse.position += pulse.speed;
          pulse.opacity *= 0.995;
          return pulse.position < 1 && pulse.opacity > 0.05;
        });
      });

      // Grow tips and occasionally start new growth, within the model's caps
      advanceMyceliumGrowth(stateRef.current, { width, height }, Math.random);

      drawNetwork();

      animationRef.current = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener('resize', resize);
    animate();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationRef.current);
    };
  }, [canvasRef, darkMode, opacity, active]);
}
