import type { TwoFactorDisableRequest, TwoFactorEnableResponse } from '../api/twoFactor';
import type { User } from '../types';
import type { UserPreferencesPatch } from '../types/user';
import type { PreferenceSaveResult } from './useUserPreferenceMutation';

export interface TwoFactorPending {
  tempToken: string;
}

export interface LoginResult {
  success: boolean;
  requires2FA?: boolean;
  tempToken?: string;
  /** Login was refused with 403 because the account's email is unverified. */
  emailVerificationRequired?: boolean;
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
  updatePreferences: (prefs: UserPreferencesPatch) => Promise<PreferenceSaveResult>;
  /** Returns null for duplicate, retired or unauthenticated calls; current-session errors reject. */
  enableTwoFactor: (code: string) => Promise<TwoFactorEnableResponse | null>;
  /** Returns null for duplicate, retired or unauthenticated calls; current-session errors reject. */
  disableTwoFactor: (data: TwoFactorDisableRequest) => Promise<{ success: boolean } | null>;
  clearError: () => void;
  clearNotice: () => void;
}
