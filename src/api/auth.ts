/**
 * Authentication API
 *
 * API calls for user authentication and profile management
 */

import apiClient from './client';
import type { TelegramConfig, WalletTelegramSettings } from '../../types';

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

export interface AuthResponse {
  token: string;
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
 * Register a new user
 */
export async function register(data: RegisterRequest): Promise<AuthResponse> {
  const response = await apiClient.post<AuthResponse>('/auth/register', data);

  // Set token in client
  apiClient.setToken(response.token);

  return response;
}

/**
 * Login user
 * Returns either a full auth response or a 2FA required response
 */
export async function login(data: LoginRequest): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', data, { retry: { enabled: false } });

  // Only set token if full auth (not 2FA pending)
  if (!requires2FA(response)) {
    apiClient.setToken(response.token);
  }

  return response;
}

/**
 * Logout user
 */
export function logout(): void {
  apiClient.setToken(null);
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

/**
 * Check if user is authenticated
 */
export function isAuthenticated(): boolean {
  return apiClient.isAuthenticated();
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
