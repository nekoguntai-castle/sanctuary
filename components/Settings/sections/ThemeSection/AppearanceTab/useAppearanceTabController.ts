import { useMemo } from 'react';
import { useUser } from '../../../../../contexts/UserContext';
import type { BackgroundOption, ThemeOption } from '../../../../../types';
import type { Season } from '../../../../../themes';
import {
  getBackgroundChoices,
  getNextFavoriteBackgrounds,
  getNextSeasonalBackgrounds,
  getThemeChoices,
} from './appearanceTabHelpers';
import type { AppearanceTabController } from './types';

export const useAppearanceTabController = (): AppearanceTabController => {
  const { user, updatePreferences } = useUser();
  const preferences = user?.preferences;

  const currentTheme = (preferences?.theme || 'sanctuary') as ThemeOption;
  const currentBg = (preferences?.background || 'zen') as BackgroundOption;
  const isDark = preferences?.darkMode || false;
  const userSeasonalBgs = preferences?.seasonalBackgrounds;
  const favoriteBackgrounds = preferences?.favoriteBackgrounds || [];

  const themes = useMemo(() => getThemeChoices(), []);
  const { staticBackgrounds, animatedBackgrounds } = useMemo(
    () => getBackgroundChoices(currentTheme),
    [currentTheme]
  );

  return {
    themes,
    currentTheme,
    currentBg,
    isDark,
    contrastLevel: preferences?.contrastLevel ?? 0,
    patternOpacity: preferences?.patternOpacity ?? 50,
    flyoutOpacity: preferences?.flyoutOpacity ?? 92,
    userSeasonalBgs,
    favoriteBackgrounds,
    staticBackgrounds,
    animatedBackgrounds,
    selectTheme: (theme) => updatePreferences({ theme }),
    selectBackground: (background) => updatePreferences({ background }),
    toggleFavorite: (background) => {
      updatePreferences({
        favoriteBackgrounds: getNextFavoriteBackgrounds(favoriteBackgrounds, background),
      });
    },
    updateSeasonBackground: (season: Season, background: string) => {
      updatePreferences({
        seasonalBackgrounds: getNextSeasonalBackgrounds(userSeasonalBgs, season, background),
      });
    },
    toggleDarkMode: () => updatePreferences({ darkMode: !isDark }),
    updateContrastLevel: (level) => updatePreferences({ contrastLevel: level }),
    updatePatternOpacity: (opacity) => updatePreferences({ patternOpacity: opacity }),
    updateFlyoutOpacity: (opacity) => updatePreferences({ flyoutOpacity: opacity }),
  };
};
