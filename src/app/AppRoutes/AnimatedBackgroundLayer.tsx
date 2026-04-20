import { lazy, Suspense } from 'react';
import type { AppPreferenceState } from './types';

const AnimatedBackground = lazy(async () => ({
  default: (await import('../../../components/AnimatedBackground')).AnimatedBackground,
}));

interface AnimatedBackgroundLayerProps {
  preferences: AppPreferenceState;
}

export function AnimatedBackgroundLayer({ preferences }: AnimatedBackgroundLayerProps) {
  if (!preferences.shouldRenderAnimatedBackground) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <AnimatedBackground
        pattern={preferences.backgroundPattern}
        darkMode={preferences.isDarkMode}
        opacity={preferences.patternOpacity}
      />
    </Suspense>
  );
}
