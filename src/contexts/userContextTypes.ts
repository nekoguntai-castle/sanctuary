import type { User, UserPreferences } from '../types';

export interface TwoFactorPending {
  tempToken: string;
}

export interface LoginResult {
  success: boolean;
  requires2FA?: boolean;
  tempToken?: string;
}

/**
 * Result of submitting the registration form. When `pendingVerification` is
 * true, the account was created but no authenticated session was started.
 */
export interface RegistrationResult {
  success: boolean;
  pendingVerification?: boolean;
  message?: string;
}

export interface UserContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  notice: string | null;
  twoFactorPending: TwoFactorPending | null;
  login: (username: string, password: string) => Promise<LoginResult>;
  verify2FA: (code: string) => Promise<boolean>;
  cancel2FA: () => void;
  register: (username: string, password: string, email: string) => Promise<RegistrationResult>;
  logout: () => void;
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  clearError: () => void;
  clearNotice: () => void;
}
