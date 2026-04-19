import { BackgroundsPanel } from '../panels/BackgroundsPanel';
import { ColorThemePanel } from '../panels/ColorThemePanel';
import { VisualSettingsPanel } from '../panels/VisualSettingsPanel';
import type { AppearanceTabController } from './types';

export function AppearanceTabView({ controller }: { controller: AppearanceTabController }) {
  return (
    <div className="space-y-6">
      <ColorThemePanel
        themes={controller.themes}
        currentTheme={controller.currentTheme}
        onSelect={controller.selectTheme}
      />

      <BackgroundsPanel
        currentBg={controller.currentBg}
        staticBackgrounds={controller.staticBackgrounds}
        animatedBackgrounds={controller.animatedBackgrounds}
        favoriteBackgrounds={controller.favoriteBackgrounds}
        userSeasonalBgs={controller.userSeasonalBgs}
        onSelectBackground={controller.selectBackground}
        onToggleFavorite={controller.toggleFavorite}
        onUpdateSeasonBackground={controller.updateSeasonBackground}
      />

      <VisualSettingsPanel
        isDark={controller.isDark}
        contrastLevel={controller.contrastLevel}
        patternOpacity={controller.patternOpacity}
        onToggleDarkMode={controller.toggleDarkMode}
        onContrastChange={controller.updateContrastLevel}
        onPatternOpacityChange={controller.updatePatternOpacity}
      />
    </div>
  );
}
