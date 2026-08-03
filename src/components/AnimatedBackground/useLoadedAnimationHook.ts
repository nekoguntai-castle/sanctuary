import { useEffect, useState } from 'react';
import {
  loadAnimationHook,
  type AnimationHook,
  type AnimationModuleMap,
} from './animationLoader';

export function useLoadedAnimationHook(
  pattern: string | null,
  animationModules: AnimationModuleMap
) {
  const [activeHook, setActiveHook] = useState<AnimationHook | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Clear the active hook immediately to prevent rendering AnimationRunner
    // with a stale hook while the new one loads. Different animation hooks have
    // different numbers of React hooks internally, so rendering with a mismatched
    // hook causes React hook reconciliation failures.
    setActiveHook(null);

    if (!pattern) {
      return;
    }

    loadAnimationHook(pattern, animationModules)
      .then((hookCandidate) => {
        if (cancelled) {
          return;
        }

        if (hookCandidate) {
          setActiveHook(() => hookCandidate);
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
  }, [pattern, animationModules]);

  return activeHook;
}
