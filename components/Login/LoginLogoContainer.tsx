/**
 * LoginLogoContainer - Shared wrapper for login/2FA logo
 */

import React from 'react';

interface LoginLogoContainerProps {
  children: React.ReactNode;
}

export const LoginLogoContainer: React.FC<LoginLogoContainerProps> = ({ children }) => (
  <div className="mx-auto h-20 w-20 bg-sanctuary-200/80 dark:bg-sanctuary-800/80 rounded-xl flex items-center justify-center mb-6 shadow-inner backdrop-blur-sm login-logo-enter">
    {children}
  </div>
);
