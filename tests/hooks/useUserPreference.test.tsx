/**
 * useUserPreference Hook Tests
 *
 * Tests for the preference abstraction hook that reads/writes to server-side
 * user preferences when logged in, and falls back to localStorage when not.
 * Supports dot-notation keys for nested preference paths.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUserPreference } from '../../hooks/useUserPreference';

const mockUpdatePreferences = vi.fn();
let mockUser: any = null;
let mockPreferences: any = null;

vi.mock('../../contexts/UserContext', () => ({
  useCurrentUser: () => mockUser,
  useUserPreferences: () => ({
    preferences: mockPreferences,
    updatePreferences: mockUpdatePreferences,
  }),
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// localStorage is mocked globally in tests/setup.ts as vi.fn() stubs.
// We configure getItem return values and assert setItem calls here.
const mockGetItem = localStorage.getItem as ReturnType<typeof vi.fn>;
const mockSetItem = localStorage.setItem as ReturnType<typeof vi.fn>;

describe('useUserPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = null;
    mockPreferences = null;
  });

  describe('Not logged in (localStorage fallback)', () => {
    it('should return default value when no localStorage value exists', () => {
      mockGetItem.mockReturnValue(null);

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      expect(result.current[0]).toBe('light');
    });

    it('should read value from localStorage', () => {
      mockGetItem.mockReturnValue(JSON.stringify('dark'));

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      expect(result.current[0]).toBe('dark');
    });

    it('should write to localStorage via setValue', () => {
      mockGetItem.mockReturnValue(null);

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      act(() => {
        result.current[1]('dark');
      });

      expect(result.current[0]).toBe('dark');
      expect(mockSetItem).toHaveBeenCalledWith(
        'sanctuary_pref_theme',
        JSON.stringify('dark')
      );
    });

    it('should handle localStorage read errors gracefully and return default', () => {
      mockGetItem.mockImplementation(() => {
        throw new Error('localStorage is disabled');
      });

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      expect(result.current[0]).toBe('light');
    });

    it('should handle localStorage write errors gracefully', () => {
      mockGetItem.mockReturnValue(null);
      mockSetItem.mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      // Should not throw when setting a value triggers a localStorage write error
      act(() => {
        result.current[1]('dark');
      });

      // The in-memory state should still update even if localStorage fails
      expect(result.current[0]).toBe('dark');
    });
  });

  describe('Logged in (server preferences)', () => {
    beforeEach(() => {
      mockUser = { id: 1, name: 'Test User' };
      mockPreferences = {};
    });

    it('should return server preference value when logged in', () => {
      mockPreferences = { theme: 'dark' };

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      expect(result.current[0]).toBe('dark');
    });

    it('should return default value when logged in but preference is undefined', () => {
      mockPreferences = {};

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      expect(result.current[0]).toBe('light');
    });

    it('should write to server via updatePreferences when logged in', () => {
      mockPreferences = { theme: 'light' };

      const { result } = renderHook(() =>
        useUserPreference('theme', 'light')
      );

      act(() => {
        result.current[1]('dark');
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({ theme: 'dark' });
    });
  });

  describe('Dot-notation keys (nested preferences)', () => {
    it('should read nested server preferences using dot-notation', () => {
      mockUser = { id: 1, name: 'Test User' };
      mockPreferences = {
        viewSettings: {
          wallets: {
            layout: 'grid',
          },
        },
      };

      const { result } = renderHook(() =>
        useUserPreference('viewSettings.wallets.layout', 'list')
      );

      expect(result.current[0]).toBe('grid');
    });

    it('should write nested server preferences using dot-notation via buildNestedUpdate', () => {
      mockUser = { id: 1, name: 'Test User' };
      mockPreferences = {
        viewSettings: {
          wallets: {
            layout: 'grid',
            sortBy: 'name',
          },
        },
      };

      const { result } = renderHook(() =>
        useUserPreference('viewSettings.wallets.layout', 'list')
      );

      act(() => {
        result.current[1]('list');
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        viewSettings: {
          wallets: {
            layout: 'list',
            sortBy: 'name',
          },
        },
      });
    });

    it('should create nested structure when parent keys do not exist in server preferences', () => {
      mockUser = { id: 1, name: 'Test User' };
      mockPreferences = {};

      const { result } = renderHook(() =>
        useUserPreference('viewSettings.wallets.layout', 'list')
      );

      act(() => {
        result.current[1]('grid');
      });

      expect(mockUpdatePreferences).toHaveBeenCalledWith({
        viewSettings: {
          wallets: {
            layout: 'grid',
          },
        },
      });
    });

    it('should return default when nested path does not exist in server preferences', () => {
      mockUser = { id: 1, name: 'Test User' };
      mockPreferences = { viewSettings: {} };

      const { result } = renderHook(() =>
        useUserPreference('viewSettings.wallets.layout', 'list')
      );

      expect(result.current[0]).toBe('list');
    });
  });
});
