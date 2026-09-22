import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as authApi from '../../../api/auth';
import { createLogger } from '../../../utils/logger';
import type { PasswordFormProps } from '../types';
import {
  getPasswordChangeErrorMessage,
  getPasswordValidationError,
} from './passwordHelpers';

const log = createLogger('Account');

export const usePasswordChangeController = (): PasswordFormProps => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const mounted = useRef(false);
  const successResetTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (successResetTimeout.current) clearTimeout(successResetTimeout.current);
    };
  }, []);

  const handlePasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(null);

    const validationError = getPasswordValidationError(newPassword, confirmPassword);
    if (validationError) {
      setPasswordError(validationError);
      return;
    }

    setIsChangingPassword(true);

    try {
      await authApi.changePassword({ currentPassword, newPassword });
      if (!mounted.current) return;

      setPasswordSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      successResetTimeout.current = setTimeout(() => {
        if (!mounted.current) return;
        successResetTimeout.current = null;
        setPasswordSuccess(false);
      }, 3000);
    } catch (error) {
      if (!mounted.current) return;
      log.error('Password change error', { error });
      setPasswordError(getPasswordChangeErrorMessage(error));
    } finally {
      if (mounted.current) setIsChangingPassword(false);
    }
  };

  return {
    currentPassword,
    newPassword,
    confirmPassword,
    showCurrentPassword,
    showNewPassword,
    showConfirmPassword,
    isChangingPassword,
    passwordSuccess,
    passwordError,
    onCurrentPasswordChange: setCurrentPassword,
    onNewPasswordChange: setNewPassword,
    onConfirmPasswordChange: setConfirmPassword,
    onToggleShowCurrentPassword: () => setShowCurrentPassword((show) => !show),
    onToggleShowNewPassword: () => setShowNewPassword((show) => !show),
    onToggleShowConfirmPassword: () => setShowConfirmPassword((show) => !show),
    onSubmit: handlePasswordChange,
  };
};
