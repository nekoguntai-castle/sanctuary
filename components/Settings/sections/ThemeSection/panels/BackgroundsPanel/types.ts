import type { LucideIcon } from 'lucide-react';
import type { BackgroundOption, SeasonalBackgrounds } from '../../../../../../types';
import type { Season } from '../../../../../../themes';
import type { BackgroundCategory } from '../../../../../../themes/backgroundCategories';
import type { BackgroundIcon } from '../../iconMaps';

export interface BackgroundInfo {
  id: BackgroundOption;
  name: string;
  icon: BackgroundIcon;
  categories: readonly BackgroundCategory[];
}

export interface BackgroundsPanelProps {
  currentBg: string;
  staticBackgrounds: BackgroundInfo[];
  animatedBackgrounds: BackgroundInfo[];
  favoriteBackgrounds: BackgroundOption[];
  userSeasonalBgs: SeasonalBackgrounds | undefined;
  onSelectBackground: (background: BackgroundOption) => void;
  onToggleFavorite: (background: BackgroundOption) => void;
  onUpdateSeasonBackground: (season: Season, background: string) => void;
}

export interface CategoryTabModel {
  id: BackgroundCategory;
  label: string;
  icon: string;
  count: number;
  isActive: boolean;
}

export interface BackgroundTileModel extends BackgroundInfo {
  isAnimated: boolean;
  isCurrent: boolean;
  isFavorite: boolean;
}

export interface SeasonRowModel {
  season: Season;
  label: string;
  Icon: LucideIcon;
  isCurrentSeason: boolean;
  currentSeasonBg: string;
}
