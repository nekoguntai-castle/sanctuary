/**
 * Auth API Tests
 *
 * Tests for authentication API: login, register, logout,
 * 2FA handling, token management, and user profile functions.
 */

import { beforeEach,describe,expect,it,vi } from 'vitest';

// Mock the API client. ADR 0001 / 0002 Phase 4: no more setToken/
// isAuthenticated — auth state lives in the backend cookies, and the
// frontend just calls the endpoints and lets credentials:'include' do
// the attaching automatically.
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

import type { AuthResponse,TwoFactorRequiredResponse } from '../../src/api/auth';
import {
changePassword,
fetchTelegramChatId,
getCurrentUser,
getRegistrationStatus,
getUserGroups,
login,
logout,
register,
requires2FA,
searchUsers,
testTelegramConfig,
updatePreferences,
} from '../../src/api/auth';

describe('Auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================
  // requires2FA type guard
  // ========================================
  describe('requires2FA', () => {
    it('should return true for 2FA required response', () => {
      const response: TwoFactorRequiredResponse = {
        requires2FA: true,
        tempToken: 'temp-123',
      };
      expect(requires2FA(response)).toBe(true);
    });

    it('should return false for normal auth response', () => {
      const response: AuthResponse = {
        user: {
          id: '1',
          username: 'test',
          isAdmin: false,
          preferences: {},
          createdAt: '2024-01-01',
        },
      };
      expect(requires2FA(response)).toBe(false);
    });
  });

  // ========================================
  // register
  // ========================================
  describe('register', () => {
    it('should POST registration data and return the auth response', async () => {
      // Phase 6: the backend sets the browser auth cookies on this
      // response; the response body carries only the user object for
      // UserContext hydration. Tokens are delivered via Set-Cookie.
      const mockResponse: AuthResponse = {
        user: {
          id: 'user-1',
          username: 'newuser',
          isAdmin: false,
          preferences: {},
          createdAt: '2024-01-01',
        },
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await register({ username: 'newuser', password: 'securepass' });

      expect(mockPost).toHaveBeenCalledWith('/auth/register', {
        username: 'newuser',
        password: 'securepass',
      });
      expect(result.user.username).toBe('newuser');
    });

    it('should include email when provided', async () => {
      mockPost.mockResolvedValue({ user: { id: '1' } });

      await register({ username: 'user', password: 'pass', email: 'user@example.com' });

      expect(mockPost).toHaveBeenCalledWith('/auth/register', {
        username: 'user',
        password: 'pass',
        email: 'user@example.com',
      });
    });
  });

  // ========================================
  // login
  // ========================================
  describe('login', () => {
    it('should POST login and return the auth response on success', async () => {
      const mockResponse: AuthResponse = {
        user: {
          id: 'user-1',
          username: 'testuser',
          isAdmin: false,
          preferences: {},
          createdAt: '2024-01-01',
        },
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await login({ username: 'testuser', password: 'pass' });

      expect(mockPost).toHaveBeenCalledWith('/auth/login', {
        username: 'testuser',
        password: 'pass',
      }, { retry: { enabled: false } });
      expect(requires2FA(result)).toBe(false);
    });

    it('should return the 2FA pending shape when the backend requires 2FA', async () => {
      const mockResponse: TwoFactorRequiredResponse = {
        requires2FA: true,
        tempToken: 'temp-token',
      };
      mockPost.mockResolvedValue(mockResponse);

      const result = await login({ username: 'secureuser', password: 'pass' });

      expect(requires2FA(result)).toBe(true);
      expect((result as TwoFactorRequiredResponse).tempToken).toBe('temp-token');
    });
  });

  // ========================================
  // logout
  // ========================================
  describe('logout', () => {
    it('should POST /auth/logout with retries disabled', async () => {
      mockPost.mockResolvedValue({ success: true });
      await logout();
      expect(mockPost).toHaveBeenCalledWith('/auth/logout', {}, { retry: { enabled: false } });
    });

    it('should swallow backend errors so local cleanup still runs', async () => {
      // Phase 4 logout is best-effort on the backend call — the local
      // refresh-module cleanup and React state reset in UserContext
      // always run, even if the backend request fails (e.g. network
      // offline). The authApi.logout() helper wraps the call in a
      // try/catch to guarantee this.
      mockPost.mockRejectedValue(new Error('network down'));
      await expect(logout()).resolves.toBeUndefined();
    });
  });

  // ========================================
  // getCurrentUser
  // ========================================
  describe('getCurrentUser', () => {
    it('should GET current user profile', async () => {
      const mockUser = {
        id: 'user-1',
        username: 'test',
        isAdmin: false,
        preferences: { darkMode: true },
        createdAt: '2024-01-01',
      };
      mockGet.mockResolvedValue(mockUser);

      const result = await getCurrentUser();

      expect(mockGet).toHaveBeenCalledWith('/auth/me');
      expect(result.username).toBe('test');
    });
  });

  // ========================================
  // updatePreferences
  // ========================================
  describe('updatePreferences', () => {
    it('should PATCH preferences', async () => {
      const prefs = { darkMode: true, unit: 'sats' };
      mockPatch.mockResolvedValue({ id: '1', preferences: prefs });

      await updatePreferences(prefs);

      expect(mockPatch).toHaveBeenCalledWith('/auth/me/preferences', prefs);
    });
  });

  // The legacy `isAuthenticated()` helper was removed in Phase 4 — auth
  // state lives in the backend cookies, and the frontend determines
  // "am I authenticated?" by calling /auth/me and interpreting the
  // response status. See tests/contexts/UserContext.test.tsx for the
  // /auth/me hydration test.

  // ========================================
  // changePassword
  // ========================================
  describe('changePassword', () => {
    it('should POST password change request', async () => {
      mockPost.mockResolvedValue({ message: 'Password changed' });

      const result = await changePassword({
        currentPassword: 'old',
        newPassword: 'new',
      });

      expect(mockPost).toHaveBeenCalledWith('/auth/me/change-password', {
        currentPassword: 'old',
        newPassword: 'new',
      });
      expect(result.message).toBe('Password changed');
    });
  });

  // ========================================
  // getUserGroups
  // ========================================
  describe('getUserGroups', () => {
    it('should GET user groups', async () => {
      const groups = [{ id: 'g1', name: 'Group 1', memberCount: 3, memberIds: ['1', '2', '3'] }];
      mockGet.mockResolvedValue(groups);

      const result = await getUserGroups();

      expect(mockGet).toHaveBeenCalledWith('/auth/me/groups');
      expect(result).toHaveLength(1);
    });
  });

  // ========================================
  // searchUsers
  // ========================================
  describe('searchUsers', () => {
    it('should GET search results with query param', async () => {
      mockGet.mockResolvedValue([{ id: '1', username: 'alice' }]);

      const result = await searchUsers('ali');

      expect(mockGet).toHaveBeenCalledWith('/auth/users/search', { q: 'ali' });
      expect(result[0].username).toBe('alice');
    });
  });

  // ========================================
  // getRegistrationStatus
  // ========================================
  describe('getRegistrationStatus', () => {
    it('should GET registration status', async () => {
      mockGet.mockResolvedValue({ enabled: true });

      const result = await getRegistrationStatus();

      expect(mockGet).toHaveBeenCalledWith('/auth/registration-status');
      expect(result.enabled).toBe(true);
    });
  });

  // ========================================
  // Telegram functions
  // ========================================
  describe('fetchTelegramChatId', () => {
    it('should POST bot token to fetch chat ID', async () => {
      mockPost.mockResolvedValue({ success: true, chatId: '12345', username: 'bot' });

      const result = await fetchTelegramChatId('bot-token-123');

      expect(mockPost).toHaveBeenCalledWith('/auth/telegram/chat-id', { botToken: 'bot-token-123' });
      expect(result.chatId).toBe('12345');
    });
  });

  describe('testTelegramConfig', () => {
    it('should POST test config', async () => {
      mockPost.mockResolvedValue({ success: true });

      const result = await testTelegramConfig('bot-token', 'chat-123');

      expect(mockPost).toHaveBeenCalledWith('/auth/telegram/test', {
        botToken: 'bot-token',
        chatId: 'chat-123',
      });
      expect(result.success).toBe(true);
    });
  });
});
