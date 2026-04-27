/**
 * Authentication API
 *
 * API calls for user authentication and profile management
 */

import apiClient from './client';
import type { TelegramConfig, WalletTelegramSettings } from '../../types';
import { createLogger } from '../../utils/logger';

const log = createLogger('AuthApi');

export interface User {
  id: string;
  username: string;
  email?: string;
  isAdmin: boolean;
  preferences: {
    darkMode?: boolean;
    theme?: string;
    background?: string;
    contrastLevel?: number;
    patternOpacity?: number;
    flyoutOpacity?: number;
    unit?: string;
    fiatCurrency?: string;
    showFiat?: boolean;
    priceProvider?: string;
    telegram?: TelegramConfig;
  };
  createdAt: string;
  twoFactorEnabled?: boolean;
}

export type { TelegramConfig, WalletTelegramSettings };

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

/**
 * ADR 0001 / 0002 Phase 6: browser auth is cookie-only. The response
 * body no longer carries a `token` field — the access and refresh JWTs
 * are set via `Set-Cookie` (sanctuary_access / sanctuary_refresh) and
 * the `X-Access-Expires-At` header drives the refresh scheduler. The
 * caller only needs the user object for UserContext hydration.
 */
export interface AuthResponse {
  user: User;
}

export interface TwoFactorRequiredResponse {
  requires2FA: true;
  tempToken: string;
}

export type LoginResponse = AuthResponse | TwoFactorRequiredResponse;

/**
 * Check if a login response requires 2FA
 */
export function requires2FA(response: LoginResponse): response is TwoFactorRequiredResponse {
  return 'requires2FA' in response && response.requires2FA === true;
}

/**
 * Register a new user.
 *
 * ADR 0001 / 0002 Phase 4: the browser no longer stores or sends the
 * JSON access token. The backend sets the sanctuary_access / _refresh /
 * _csrf cookies on this response, and the ApiClient reads the
 * X-Access-Expires-At header to schedule the next refresh. The caller
 * receives the user object for context hydration only.
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  return apiClient.post<AuthResponse>('/auth/register', data);
}

/**
 * Login user
 * Returns either a full auth response or a 2FA required response.
 *
 * Phase 4 cookie path: no token persistence on the browser side.
 */
export async function login(data: LoginRequest): Promise<LoginResponse> {
  // Disable retries — auto-retrying failed logins worsens server-side rate limiting
  return apiClient.post<LoginResponse>('/auth/login', data, { retry: { enabled: false } });
}

/**
 * Logout user.
 *
 * Tells the backend to revoke the session and clear the browser cookies.
 * The UserContext calls this then invokes refresh.triggerLogout() to
 * clear local in-memory refresh state and broadcast the logout to other
 * tabs. Best-effort: even if the backend call fails (e.g. network
 * offline), the local cleanup still runs.
 */
export async function logout(): Promise<void> {
  try {
    await apiClient.post('/auth/logout', {}, { retry: { enabled: false } });
  } catch (error) {
    log.debug('Logout request failed before local cleanup', { error });
    // Swallow: local cleanup (UserContext + refresh.triggerLogout) runs
    // regardless so the user is always logged out client-side.
  }
}

/**
 * Get current user profile
 */
export async function getCurrentUser(): Promise<User> {
  return apiClient.get<User>('/auth/me');
}

/**
 * Update user preferences
 */
export async function updatePreferences(preferences: Partial<User['preferences']>): Promise<User> {
  return apiClient.patch<User>('/auth/me/preferences', preferences);
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Change user password
 */
export async function changePassword(data: ChangePasswordRequest): Promise<{ message: string }> {
  return apiClient.post<{ message: string }>('/auth/me/change-password', data);
}

export interface UserGroup {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
  memberIds: string[];
}

/**
 * Get groups the current user is a member of
 */
export async function getUserGroups(): Promise<UserGroup[]> {
  return apiClient.get<UserGroup[]>('/auth/me/groups');
}

export interface SearchUser {
  id: string;
  username: string;
}

/**
 * Search users by username
 */
export async function searchUsers(query: string): Promise<SearchUser[]> {
  return apiClient.get<SearchUser[]>('/auth/users/search', { q: query });
}

/**
 * Check if public registration is enabled
 */
export async function getRegistrationStatus(): Promise<{ enabled: boolean }> {
  return apiClient.get<{ enabled: boolean }>('/auth/registration-status');
}

/**
 * Fetch Telegram chat ID from bot's recent messages
 */
export async function fetchTelegramChatId(
  botToken: string
): Promise<{ success: boolean; chatId?: string; username?: string; error?: string }> {
  return apiClient.post<{ success: boolean; chatId?: string; username?: string; error?: string }>(
    '/auth/telegram/chat-id',
    { botToken }
  );
}

/**
 * Test Telegram configuration by sending a test message
 */
export async function testTelegramConfig(
  botToken: string,
  chatId: string
): Promise<{ success: boolean; error?: string }> {
  return apiClient.post<{ success: boolean; error?: string }>('/auth/telegram/test', {
    botToken,
    chatId,
  });
}
