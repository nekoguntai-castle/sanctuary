/**
 * Appearance Tab
 *
 * Main orchestrator for the theme/appearance settings page.
 * Coordinates state and delegates rendering to panel sub-components.
 */

import React from 'react';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { useUser } from '../../../../contexts/UserContext';
import type { ThemeOption, BackgroundOption, SeasonalBackgrounds } from '../../../../types';
import { Season, themeRegistry } from '../../../../themes';
import { bgIconMap } from './iconMaps';
import { ColorThemePanel } from './panels/ColorThemePanel';
import { BackgroundsPanel } from './panels/BackgroundsPanel';
import { VisualSettingsPanel } from './panels/VisualSettingsPanel';

const AppearanceTab: React.FC = () => {
  const { user, updatePreferences } = useUser();

  const currentTheme = user?.preferences?.theme || 'sanctuary';
  const currentBg = user?.preferences?.background || 'zen';
  const isDark = user?.preferences?.darkMode || false;
  const userSeasonalBgs = user?.preferences?.seasonalBackgrounds;
  const favoriteBackgrounds = user?.preferences?.favoriteBackgrounds || [];

  const themes = themeRegistry.getAllMetadata().map(theme => ({
    id: theme.id as ThemeOption,
    name: theme.name,
    color: theme.preview?.primaryColor || '#7d7870'
  }));

  const allPatterns = themeRegistry.getAllPatterns(currentTheme);

  const staticBackgrounds = allPatterns
    .filter(pattern => !pattern.animated)
    .map(pattern => ({
      id: pattern.id as BackgroundOption,
      name: pattern.name,
      icon: bgIconMap[pattern.id] || ImageIcon
    }));

  const animatedBackgrounds = allPatterns
    .filter(pattern => pattern.animated)
    .map(pattern => ({
      id: pattern.id as BackgroundOption,
      name: pattern.name,
      icon: bgIconMap[pattern.id] || Sparkles
    }));

  // Toggle a background as favorite
  const toggleFavorite = (bgId: BackgroundOption) => {
    const newFavorites = favoriteBackgrounds.includes(bgId)
      ? favoriteBackgrounds.filter(id => id !== bgId)
      : [...favoriteBackgrounds, bgId];
    updatePreferences({ favoriteBackgrounds: newFavorites });
  };

  // Update a specific season's background
  const updateSeasonBackground = (season: Season, background: string) => {
    const newSeasonalBgs: SeasonalBackgrounds = {
      ...userSeasonalBgs,
      [season]: background as BackgroundOption,
    };
    updatePreferences({ seasonalBackgrounds: newSeasonalBgs });
  };

  return (
    <div className="space-y-6">
      <ColorThemePanel
        themes={themes}
        currentTheme={currentTheme}
        onSelect={(theme) => updatePreferences({ theme })}
      />

      <BackgroundsPanel
        currentBg={currentBg}
        staticBackgrounds={staticBackgrounds}
        animatedBackgrounds={animatedBackgrounds}
        favoriteBackgrounds={favoriteBackgrounds}
        userSeasonalBgs={userSeasonalBgs}
        onSelectBackground={(bg) => updatePreferences({ background: bg })}
        onToggleFavorite={toggleFavorite}
        onUpdateSeasonBackground={updateSeasonBackground}
      />

      <VisualSettingsPanel
        isDark={isDark}
        contrastLevel={user?.preferences?.contrastLevel ?? 0}
        patternOpacity={user?.preferences?.patternOpacity ?? 50}
        onToggleDarkMode={() => updatePreferences({ darkMode: !isDark })}
        onContrastChange={(level) => updatePreferences({ contrastLevel: level })}
        onPatternOpacityChange={(opacity) => updatePreferences({ patternOpacity: opacity })}
      />
    </div>
  );
};

export { AppearanceTab };
