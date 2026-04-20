import React from 'react';
import { LoginBackground } from './LoginBackground';
import { LoginFormActions } from './LoginForm/LoginFormActions';
import { LoginFormFields } from './LoginForm/LoginFormFields';
import { LoginFormFooter } from './LoginForm/LoginFormFooter';
import { LoginFormHeader } from './LoginForm/LoginFormHeader';
import type { LoginFormProps } from './LoginForm/types';
import { useCardTilt } from './LoginForm/useCardTilt';

export const LoginForm: React.FC<LoginFormProps> = ({
  darkMode,
  isRegisterMode,
  username,
  password,
  email,
  apiStatus,
  registrationEnabled,
  isLoading,
  isBootLoading,
  error,
  onUsernameChange,
  onPasswordChange,
  onEmailChange,
  onSubmit,
  onToggleMode,
}) => {
  const { cardRef, handleMouseMove, handleMouseLeave } = useCardTilt();

  return (
    <LoginBackground darkMode={darkMode}>
      <LoginFormHeader isRegisterMode={isRegisterMode} />

      <form className="mt-8 space-y-6 login-reveal-3" onSubmit={onSubmit}>
        <LoginFormFields
          cardRef={cardRef}
          onCardMouseMove={handleMouseMove}
          onCardMouseLeave={handleMouseLeave}
          isRegisterMode={isRegisterMode}
          username={username}
          password={password}
          email={email}
          onUsernameChange={onUsernameChange}
          onPasswordChange={onPasswordChange}
          onEmailChange={onEmailChange}
        />
        <LoginFormActions
          isRegisterMode={isRegisterMode}
          registrationEnabled={registrationEnabled}
          isLoading={isLoading}
          isBootLoading={isBootLoading}
          error={error}
          onToggleMode={onToggleMode}
        />
      </form>

      <LoginFormFooter
        apiStatus={apiStatus}
        isRegisterMode={isRegisterMode}
        registrationEnabled={registrationEnabled}
      />
    </LoginBackground>
  );
};
