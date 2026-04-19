import { ApiError } from '../../../src/api/client';

export const getPasswordValidationError = (newPassword: string, confirmPassword: string) => {
  if (newPassword !== confirmPassword) return 'New passwords do not match';
  if (newPassword.length < 6) return 'Password must be at least 6 characters';
  return null;
};

export const getPasswordChangeErrorMessage = (error: unknown) => {
  return error instanceof ApiError ? error.message : 'Failed to change password';
};
