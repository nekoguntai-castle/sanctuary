import { fireEvent,render,screen } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { AppearanceTab } from '../../../../../components/Settings/sections/ThemeSection/AppearanceTab';

const mockUpdatePreferences = vi.fn();
let mockUser: any = null;

vi.mock('../../../../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockUser,
    updatePreferences: mockUpdatePreferences,
  }),
}));

vi.mock('../../../../../themes', () => ({
  Season: ['spring', 'summer', 'fall', 'winter'],
  themeRegistry: {
    getAllMetadata: () => [
      { id: 'sanctuary', name: 'Sanctuary', preview: { primaryColor: '#7d7870' } },
      { id: 'forest', name: 'Forest', preview: { primaryColor: '#365314' } },
    ],
    getAllPatterns: () => [
      { id: 'unknown-static-id', name: 'Unknown Static', animated: false },
      { id: 'unknown-animated-id', name: 'Unknown Animated', animated: true },
    ],
  },
}));

vi.mock('../../../../../components/Settings/sections/ThemeSection/panels/ColorThemePanel', () => ({
  ColorThemePanel: ({ currentTheme, onSelect }: any) => (
    <div>
      <span data-testid="current-theme">{currentTheme}</span>
      <button type="button" onClick={() => onSelect('forest')}>
        select-theme
      </button>
    </div>
  ),
}));

vi.mock('../../../../../components/Settings/sections/ThemeSection/panels/BackgroundsPanel', () => ({
  BackgroundsPanel: ({
    currentBg,
    staticBackgrounds,
    animatedBackgrounds,
    onSelectBackground,
    onToggleFavorite,
    onUpdateSeasonBackground,
  }: any) => (
    <div>
      <span data-testid="current-bg">{currentBg}</span>
      <span data-testid="bg-counts">
        {staticBackgrounds.length}:{animatedBackgrounds.length}
      </span>
      <button type="button" onClick={() => onSelectBackground('unknown-static-id')}>
        select-bg
      </button>
      <button type="button" onClick={() => onToggleFavorite('unknown-static-id')}>
        toggle-favorite
      </button>
      <button type="button" onClick={() => onUpdateSeasonBackground('summer', 'unknown-animated-id')}>
        update-season
      </button>
    </div>
  ),
}));

vi.mock('../../../../../components/Settings/sections/ThemeSection/panels/VisualSettingsPanel', () => ({
  VisualSettingsPanel: ({
    isDark,
    flyoutOpacity,
    onToggleDarkMode,
    onContrastChange,
    onPatternOpacityChange,
    onFlyoutOpacityChange,
  }: any) => (
    <div>
      <span data-testid="is-dark">{String(isDark)}</span>
      <span data-testid="flyout-opacity">{String(flyoutOpacity)}</span>
      <button type="button" onClick={onToggleDarkMode}>
        toggle-dark
      </button>
      <button type="button" onClick={() => onContrastChange(2)}>
        set-contrast
      </button>
      <button type="button" onClick={() => onPatternOpacityChange(65)}>
        set-opacity
      </button>
      <button type="button" onClick={() => onFlyoutOpacityChange(85)}>
        set-flyout-opacity
      </button>
    </div>
  ),
}));

describe('AppearanceTab branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('covers preference fallbacks and add-favorite path', () => {
    mockUser = { preferences: {} };
    render(<AppearanceTab />);

    expect(screen.getByTestId('current-theme')).toHaveTextContent('sanctuary');
    expect(screen.getByTestId('current-bg')).toHaveTextContent('zen');
    expect(screen.getByTestId('bg-counts')).toHaveTextContent('1:1');
    expect(screen.getByTestId('is-dark')).toHaveTextContent('false');
    expect(screen.getByTestId('flyout-opacity')).toHaveTextContent('92');

    fireEvent.click(screen.getByRole('button', { name: 'select-theme' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ theme: 'forest' });

    fireEvent.click(screen.getByRole('button', { name: 'select-bg' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ background: 'unknown-static-id' });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-favorite' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ favoriteBackgrounds: ['unknown-static-id'] });

    fireEvent.click(screen.getByRole('button', { name: 'update-season' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      seasonalBackgrounds: { summer: 'unknown-animated-id' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-dark' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ darkMode: true });

    fireEvent.click(screen.getByRole('button', { name: 'set-contrast' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ contrastLevel: 2 });

    fireEvent.click(screen.getByRole('button', { name: 'set-opacity' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ patternOpacity: 65 });

    fireEvent.click(screen.getByRole('button', { name: 'set-flyout-opacity' }));
    expect(mockUpdatePreferences).toHaveBeenCalledWith({ flyoutOpacity: 85 });
  });

  it('covers remove-favorite path when background is already favorited', () => {
    mockUser = {
      preferences: {
        theme: 'forest',
        background: 'unknown-static-id',
        darkMode: true,
        favoriteBackgrounds: ['unknown-static-id', 'other'],
        seasonalBackgrounds: { spring: 'unknown-static-id' },
      },
    };

    render(<AppearanceTab />);
    fireEvent.click(screen.getByRole('button', { name: 'toggle-favorite' }));

    expect(mockUpdatePreferences).toHaveBeenCalledWith({
      favoriteBackgrounds: ['other'],
    });
  });
});
