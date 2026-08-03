import React from 'react';
import { SanctuaryLogo } from '../../ui/CustomIcons';
import { LoginLogoContainer } from '../LoginLogoContainer';

const MODE_SUBTITLES = {
  login: 'Sign in to access your digital sanctuary',
  register: 'Create your digital sanctuary',
} as const;

interface LoginFormHeaderProps {
  isRegisterMode: boolean;
}

export const LoginFormHeader: React.FC<LoginFormHeaderProps> = ({ isRegisterMode }) => {
  const subtitle = MODE_SUBTITLES[isRegisterMode ? 'register' : 'login'];

  return (
    <>
      <div className="text-center login-reveal-1">
        <LoginLogoContainer>
          <SanctuaryLogo className="h-10 w-10 text-primary-600 dark:text-primary-400 logo-assemble" />
        </LoginLogoContainer>
      </div>

      <div className="text-center login-reveal-2">
        <h2 className="text-3xl font-medium tracking-tight bg-gradient-to-r from-sanctuary-900 via-primary-700 to-sanctuary-900 dark:from-sanctuary-100 dark:via-primary-400 dark:to-sanctuary-100 bg-clip-text text-transparent">
          Sanctuary
        </h2>
        <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400 transition-opacity duration-300">
          {subtitle}
        </p>
      </div>
    </>
  );
};
