/**
 * Auth API Contract Types
 *
 * Types for authentication, registration, and user responses.
 */

/**
 * POST /auth/login request
 */
export interface LoginRequest {
  username: string;
  password: string;
}

/**
 * POST /auth/login response
 */
export interface LoginResponse {
  token: string;
  refreshToken: string;
  user: UserResponse;
  requires2FA?: boolean;
}

/**
 * POST /auth/register request
 */
export interface RegisterRequest {
  username: string;
  password: string;
}

/**
 * POST /auth/register response
 */
export interface RegisterResponse {
  token: string;
  refreshToken: string;
  user: UserResponse;
}

/**
 * User response (embedded in auth responses)
 */
export interface UserResponse {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string; // ISO date string
  preferences: Record<string, unknown> | null;
  has2FA: boolean;
}
