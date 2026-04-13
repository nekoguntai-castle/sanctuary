/**
 * Login - Entry point that orchestrates login, registration, and 2FA flows
 *
 * Delegates rendering to LoginForm, TwoFactorScreen, and state to useLoginFlow.
 */

import React from 'react';
import { LoginForm } from './LoginForm';
import { TwoFactorScreen } from './TwoFactorScreen';
import { useLoginFlow } from './useLoginFlow';

export const Login: React.FC = () => {
  const {
    isRegisterMode,
    username,
    password,
    email,
    apiStatus,
    registrationEnabled,
    twoFactorCode,
    twoFactorInputRef,
    darkMode,
    twoFactorPending,
    isLoading,
    isBootLoading,
    error,
    setUsername,
    setPassword,
    setEmail,
    setTwoFactorCode,
    handleSubmit,
    handle2FASubmit,
    handleCancel2FA,
    toggleMode,
  } = useLoginFlow();

  if (twoFactorPending) {
    return (
      <TwoFactorScreen
        darkMode={darkMode}
        twoFactorCode={twoFactorCode}
        onTwoFactorCodeChange={setTwoFactorCode}
        twoFactorInputRef={twoFactorInputRef}
        isLoading={isLoading}
        isBootLoading={isBootLoading}
        error={error}
        onSubmit={handle2FASubmit}
        onCancel={handleCancel2FA}
      />
    );
  }

  return (
    <LoginForm
      darkMode={darkMode}
      isRegisterMode={isRegisterMode}
      username={username}
      password={password}
      email={email}
      apiStatus={apiStatus}
      registrationEnabled={registrationEnabled}
      isLoading={isLoading}
      isBootLoading={isBootLoading}
      error={error}
      onUsernameChange={setUsername}
      onPasswordChange={setPassword}
      onEmailChange={setEmail}
      onSubmit={handleSubmit}
      onToggleMode={toggleMode}
    />
  );
};
