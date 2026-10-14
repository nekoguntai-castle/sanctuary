import type { FormEvent } from 'react';
import type { ResendFeedback } from '../../VerifyEmail/useVerifyEmail';

export type LoginApiStatus = 'checking' | 'connected' | 'error';

export interface LoginFormProps {
  darkMode: boolean;
  isRegisterMode: boolean;
  username: string;
  password: string;
  email: string;
  apiStatus: LoginApiStatus;
  registrationEnabled: boolean;
  isLoading: boolean;
  /** True while UserContext is running the boot `/auth/me` check. The
   *  submit button is disabled but the label stays "Sign In". */
  isBootLoading: boolean;
  error: string | null;
  notice: string | null;
  /** The last sign-in was refused because the email is unverified. */
  showResendVerification: boolean;
  isResendingVerification: boolean;
  resendFeedback: ResendFeedback | null;
  onResendVerification: () => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onToggleMode: () => void;
}
