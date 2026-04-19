import { ApiError } from '../../../src/api/client';

export const getTwoFactorErrorMessage = (error: unknown, fallback: string) => {
  return error instanceof ApiError ? error.message : fallback;
};

export const canVerifySetupCode = (setupVerifyCode: string) => {
  return setupVerifyCode.length >= 6;
};

export const canDisableTwoFactor = (disablePassword: string, disableToken: string) => {
  return Boolean(disablePassword && disableToken);
};

export const canRegenerateBackupCodes = (disablePassword: string, regenerateToken: string) => {
  return Boolean(disablePassword && regenerateToken);
};
