/**
 * LoginLogoContainer - Shared wrapper for login/2FA logo with animated glow ring
 */

import React from 'react';

interface LoginLogoContainerProps {
  children: React.ReactNode;
}

export const LoginLogoContainer: React.FC<LoginLogoContainerProps> = ({ children }) => (
  <div className="relative mx-auto h-20 w-20 mb-6">
    <div className="logo-glow-ring" />
    <div className="h-full w-full bg-sanctuary-200/80 dark:bg-sanctuary-800/80 rounded-xl flex items-center justify-center shadow-inner backdrop-blur-sm login-logo-enter">
      {children}
    </div>
  </div>
);
