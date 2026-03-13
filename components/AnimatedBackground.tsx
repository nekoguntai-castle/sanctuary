/**
 * Animated Background Component
 *
 * Renders canvas-based animated backgrounds for special patterns.
 * Loads only the active animation module to avoid eagerly bundling every hook.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  ANIMATED_PATTERNS,
  isAnimatedPattern,
  type AnimatedPatternId,
} from './animatedPatterns';

export { ANIMATED_PATTERNS, isAnimatedPattern };
export type { AnimatedPatternId };

interface AnimatedBackgroundProps {
  pattern: string;
  darkMode: boolean;
  opacity?: number; // 0-100, default 50
}

type AnimationHook = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  darkMode: boolean,
  opacity: number,
  active: boolean
) => void;

interface AnimationRunnerProps {
  useAnimation: AnimationHook;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  darkMode: boolean;
  opacity: number;
}

const animationModules = import.meta.glob('./animations/*.ts');

const toPascalCase = (pattern: string): string => {
  return pattern
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
};

const toCamelCase = (pattern: string): string => {
  const pascal = toPascalCase(pattern);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

const getAnimationModulePath = (pattern: AnimatedPatternId): string => {
  return `./animations/${toCamelCase(pattern)}.ts`;
};

const getAnimationHookExport = (pattern: AnimatedPatternId): string => {
  return `use${toPascalCase(pattern)}`;
};

const AnimationRunner: React.FC<AnimationRunnerProps> = ({
  useAnimation,
  canvasRef,
  darkMode,
  opacity,
}) => {
  useAnimation(canvasRef, darkMode, opacity, true);
  return null;
};

export const AnimatedBackground: React.FC<AnimatedBackgroundProps> = ({
  pattern,
  darkMode,
  opacity = 50,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationCanvasRef = canvasRef as React.RefObject<HTMLCanvasElement>;
  const [activeHook, setActiveHook] = useState<AnimationHook | null>(null);

  const animatedPattern = isAnimatedPattern(pattern) ? pattern : null;

  useEffect(() => {
    let cancelled = false;

    if (!animatedPattern) {
      setActiveHook(null);
      return;
    }

    const modulePath = getAnimationModulePath(animatedPattern);
    const hookName = getAnimationHookExport(animatedPattern);
    const importer = animationModules[modulePath];

    if (!importer) {
      setActiveHook(null);
      return;
    }

    importer()
      .then((module) => {
        if (cancelled) {
          return;
        }

        const hookCandidate = (module as Record<string, unknown>)[hookName];
        if (typeof hookCandidate === 'function') {
          setActiveHook(() => hookCandidate as AnimationHook);
        } else {
          setActiveHook(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setActiveHook(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [animatedPattern]);

  if (!animatedPattern) {
    return null;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: -1,
          opacity: opacity / 100,
        }}
        aria-hidden="true"
      />
      {activeHook && (
        <AnimationRunner
          key={animatedPattern}
          useAnimation={activeHook}
          canvasRef={animationCanvasRef}
          darkMode={darkMode}
          opacity={opacity}
        />
      )}
    </>
  );
};

export default AnimatedBackground;
