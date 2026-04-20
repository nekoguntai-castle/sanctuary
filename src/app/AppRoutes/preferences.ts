import type { User } from '../../../types';
import { isAnimatedBackgroundPattern } from '../../../themes/patterns';
import type { AppPreferenceState } from './types';

export function getAppPreferenceState(user: User | null): AppPreferenceState {
  const backgroundPattern = user?.preferences?.background || 'minimal';

  return {
    isDarkMode: user?.preferences?.darkMode || false,
    backgroundPattern,
    patternOpacity: user?.preferences?.patternOpacity ?? 50,
    shouldRenderAnimatedBackground: isAnimatedBackgroundPattern(backgroundPattern),
  };
}
