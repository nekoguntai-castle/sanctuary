import { useEffect, type RefObject } from "react";
import { drawBunnyMeadowFrame } from "./bunnyMeadow/frame";
import {
  createBunnyMeadowScene,
  createEmptyBunnyMeadowScene,
} from "./bunnyMeadow/scene";

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

    const ctx = canvas.getContext("2d");
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
    window.addEventListener("resize", resize);
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      if (animationId !== undefined) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [canvasRef, darkMode, opacity, active]);
}
