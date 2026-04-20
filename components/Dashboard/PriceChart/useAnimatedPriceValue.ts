import { useEffect, useRef, useState } from 'react';
import { getPriceDirection } from './animatedPriceModel';
import type { PriceDirection } from './types';

interface AnimatedPriceState {
  displayValue: number | null;
  direction: PriceDirection;
  isAnimating: boolean;
}

const ANIMATION_DURATION_MS = 800;

function easeOutCubic(progress: number) {
  return 1 - Math.pow(1 - progress, 3);
}

export function useAnimatedPriceValue(value: number | null): AnimatedPriceState {
  const [displayValue, setDisplayValue] = useState<number | null>(value);
  const [isAnimating, setIsAnimating] = useState(false);
  const previousValueRef = useRef<number | null>(value);
  const animationRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (value !== null && previousValueRef.current === null) {
      setDisplayValue(value);
      previousValueRef.current = value;
      return;
    }

    if (value === null || previousValueRef.current === null || previousValueRef.current === value) {
      return;
    }

    setIsAnimating(true);
    const startValue = previousValueRef.current;
    const endValue = value;
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const currentValue = startValue + (endValue - startValue) * easeOutCubic(progress);

      setDisplayValue(currentValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      setIsAnimating(false);
      previousValueRef.current = value;
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [value]);

  return {
    displayValue,
    direction: getPriceDirection(value, previousValueRef.current),
    isAnimating,
  };
}
