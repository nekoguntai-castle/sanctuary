import type { BackgroundOption, SeasonalBackgrounds, ThemeOption } from '../../../../../types';
import { themeRegistry, type Season } from '../../../../../themes';
import { getBackgroundPatternIcon } from '../iconMaps';
import type { BackgroundInfo } from '../panels/BackgroundsPanel/types';
import type { ThemeChoice } from './types';

export const getThemeChoices = (): ThemeChoice[] => {
  return themeRegistry.getAllMetadata().map((theme) => ({
    id: theme.id as ThemeOption,
    name: theme.name,
    color: theme.preview?.primaryColor || '#7d7870',
  }));
};

export const getBackgroundChoices = (currentTheme: ThemeOption) => {
  const allPatterns = themeRegistry.getAllPatterns(currentTheme);
  const staticBackgrounds = mapBackgroundChoices(allPatterns.filter((pattern) => !pattern.animated));
  const animatedBackgrounds = mapBackgroundChoices(allPatterns.filter((pattern) => pattern.animated));

  return { staticBackgrounds, animatedBackgrounds };
};

export const getNextFavoriteBackgrounds = (
  favoriteBackgrounds: BackgroundOption[],
  background: BackgroundOption
) => {
  if (favoriteBackgrounds.includes(background)) {
    return favoriteBackgrounds.filter((favorite) => favorite !== background);
  }

  return [...favoriteBackgrounds, background];
};

export const getNextSeasonalBackgrounds = (
  currentSeasonalBackgrounds: SeasonalBackgrounds | undefined,
  season: Season,
  background: string
): SeasonalBackgrounds => ({
  ...currentSeasonalBackgrounds,
  [season]: background as BackgroundOption,
});

const mapBackgroundChoices = (
  patterns: ReturnType<typeof themeRegistry.getAllPatterns>
): BackgroundInfo[] => {
  return patterns.map((pattern) => ({
    id: pattern.id as BackgroundOption,
    name: pattern.name,
    icon: getBackgroundPatternIcon(pattern),
    categories: pattern.categories ?? [],
  }));
};
