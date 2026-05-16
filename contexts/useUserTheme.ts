import { useEffect } from 'react';
import type { User } from '../types';
import { themeRegistry } from '../themes';
import {
  DEFAULT_AUTHENTICATED_PREFERENCES,
  getUserPreferenceRecord,
} from './userModel';

function applyBodyTransition(): void {
  document.body.style.transition = 'background-color 0.5s ease, color 0.5s ease';
}

function applyFallbackTheme(): void {
  document.documentElement.classList.add('dark');
  themeRegistry.applyTheme('sanctuary', 'dark', 0);
  themeRegistry.applyPattern('sanctuary-hero', 'sanctuary');
  themeRegistry.applyPatternOpacity(50);
  themeRegistry.applyFlyoutOpacity(92);
  applyBodyTransition();
}

function applyAuthenticatedTheme(user: User): void {
  const preferences = {
    ...DEFAULT_AUTHENTICATED_PREFERENCES,
    ...getUserPreferenceRecord(user),
  };
  const { darkMode, theme, background, contrastLevel, patternOpacity, flyoutOpacity } = preferences;

  if (darkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }

  const mode = darkMode ? 'dark' : 'light';
  themeRegistry.applyTheme(theme, mode, contrastLevel ?? 0);
  themeRegistry.applyPattern(background, theme);
  themeRegistry.applyPatternOpacity(patternOpacity ?? 50);
  themeRegistry.applyFlyoutOpacity(flyoutOpacity ?? 92);
  applyBodyTransition();
}

export function useUserTheme(user: User | null): void {
  useEffect(() => {
    if (user) {
      applyAuthenticatedTheme(user);
      return;
    }

    applyFallbackTheme();
  }, [user]);
}
