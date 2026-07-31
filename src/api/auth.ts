/**
 * Authentication API
 *
 * API calls for user authentication and profile management
 */

import apiClient from './client';
import type {
  AuthResponse,
  AuthUser,
  LoginRequest,
  LoginResponse,
  PendingEmailVerificationResponse,
  RegisterRequest,
  RegisterResponse,
  TwoFactorRequiredResponse,
} from '@sanctuary/shared/types/api';
import type { TelegramConfig, WalletTelegramSettings } from '../../types';
import { createLogger } from '../../utils/logger';

const log = createLogger('AuthApi');

export type User = AuthUser;
export type AuthUserPreferences = NonNullable<AuthUser['preferences']>;

export type {
  AuthResponse,
  LoginRequest,
  LoginResponse,
  PendingEmailVerificationResponse,
  RegisterRequest,
  RegisterResponse,
  TelegramConfig,
  TwoFactorRequiredResponse,
  WalletTelegramSettings,
};

/**
 * Check if a login response requires 2FA
 */
export function requires2FA(response: LoginResponse): response is TwoFactorRequiredResponse {
  return 'requires2FA' in response && response.requires2FA === true;
}

/**
 * Registration returns this shape when email verification is required. The
 * backend has created the account but deliberately did not issue auth cookies.
 */
export function isPendingEmailVerification(
  response: RegisterResponse,
): response is PendingEmailVerificationResponse {
  return 'emailVerificationRequired' in response && response.emailVerificationRequired === true;
}

/**
 * Register a new user.
 *
 * ADR 0001 / 0002: the browser no longer stores or sends a JSON access
 * token. The backend sets the sanctuary_access / _refresh /
 * _csrf cookies on this response, and the ApiClient reads the
 * X-Access-Expires-At header to schedule the next refresh. The caller
 * receives the user object for context hydration only.
 */
export async function register(data: RegisterRequest): Promise<RegisterResponse> {
  return apiClient.post<RegisterResponse>('/auth/register', data);
}

/**
 * Login user
 * Returns either a full auth response or a 2FA required response.
 *
 * Cookie-auth path: no token persistence on the browser side.
 */
export async function login(data: LoginRequest): Promise<LoginResponse> {
  // Mutations are transport-single-shot; this also avoids amplifying login
  // attempts against the server-side rate limiter.
  return apiClient.post<LoginResponse>('/auth/login', data);
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
    await apiClient.post('/auth/logout', {});
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
export async function updatePreferences(preferences: Partial<AuthUserPreferences>): Promise<User> {
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
