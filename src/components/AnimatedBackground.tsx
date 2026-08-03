/**
 * Animated Background Component
 *
 * Renders canvas-based animated backgrounds for special patterns.
 * Loads only the active animation module to avoid eagerly bundling every hook.
 */

import React, { useRef } from 'react';
import {
  ANIMATED_PATTERNS,
  isAnimatedBackgroundPattern,
  type GlobalAnimatedPatternId,
} from '../themes/patterns';
import {
  type AnimationHook,
  type AnimationModuleMap,
} from './AnimatedBackground/animationLoader';
import { useLoadedAnimationHook } from './AnimatedBackground/useLoadedAnimationHook';

export { ANIMATED_PATTERNS, isAnimatedBackgroundPattern };
export { isAnimatedBackgroundPattern as isAnimatedPattern };
export type AnimatedPatternId = GlobalAnimatedPatternId;

interface AnimatedBackgroundProps {
  pattern: string;
  darkMode: boolean;
  opacity?: number; // 0-100, default 50
}

interface AnimationRunnerProps {
  useAnimation: AnimationHook;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  darkMode: boolean;
  opacity: number;
}

/* v8 ignore start */
const animationModules: AnimationModuleMap =
  import.meta.glob('./animations/*.ts');
/* v8 ignore stop */

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
  const animatedPattern = isAnimatedBackgroundPattern(pattern) ? pattern : null;
  const activeHook = useLoadedAnimationHook(animatedPattern, animationModules);

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
