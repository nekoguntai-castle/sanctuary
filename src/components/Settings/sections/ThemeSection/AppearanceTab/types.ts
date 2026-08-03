import type { BackgroundOption, SeasonalBackgrounds, ThemeOption } from '../../../../../types';
import type { Season } from '../../../../../themes';
import type { BackgroundInfo } from '../panels/BackgroundsPanel/types';

export interface ThemeChoice {
  id: ThemeOption;
  name: string;
  color: string;
}

export interface AppearanceTabController {
  themes: ThemeChoice[];
  currentTheme: ThemeOption;
  currentBg: BackgroundOption;
  isDark: boolean;
  contrastLevel: number;
  patternOpacity: number;
  flyoutOpacity: number;
  userSeasonalBgs: SeasonalBackgrounds | undefined;
  favoriteBackgrounds: BackgroundOption[];
  staticBackgrounds: BackgroundInfo[];
  animatedBackgrounds: BackgroundInfo[];
  selectTheme: (theme: ThemeOption) => void;
  selectBackground: (background: BackgroundOption) => void;
  toggleFavorite: (background: BackgroundOption) => void;
  updateSeasonBackground: (season: Season, background: string) => void;
  toggleDarkMode: () => void;
  updateContrastLevel: (level: number) => void;
  updatePatternOpacity: (opacity: number) => void;
  updateFlyoutOpacity: (opacity: number) => void;
}
