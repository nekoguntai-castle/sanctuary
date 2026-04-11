/**
 * LoginForm - Main login/register form with card tilt effect
 */

import React, { useRef, useCallback } from 'react';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { Lock, User, Mail } from 'lucide-react';
import { SanctuaryLogo } from '../ui/CustomIcons';
import { LoginBackground } from './LoginBackground';
import { LoginLogoContainer } from './LoginLogoContainer';

// Visual-only mouse tracking -- requires real DOM mouse physics untestable in jsdom
/* v8 ignore start */
function useCardTilt() {
  const cardRef = useRef<HTMLDivElement>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.transform = `perspective(800px) rotateY(${x * 3}deg) rotateX(${-y * 3}deg)`;
  }, []);

  const handleMouseLeave = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.transform = 'perspective(800px) rotateY(0deg) rotateX(0deg)';
  }, []);

  return { cardRef, handleMouseMove, handleMouseLeave };
}
/* v8 ignore stop */

interface LoginFormProps {
  darkMode: boolean;
  isRegisterMode: boolean;
  username: string;
  password: string;
  email: string;
  apiStatus: 'checking' | 'connected' | 'error';
  registrationEnabled: boolean;
  isLoading: boolean;
  error: string | null;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onToggleMode: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({
  darkMode,
  isRegisterMode,
  username,
  password,
  email,
  apiStatus,
  registrationEnabled,
  isLoading,
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
      {/* Staggered entrance - Logo with glow ring */}
      <div className="text-center login-reveal-1">
        <LoginLogoContainer>
          <SanctuaryLogo className="h-10 w-10 text-primary-600 dark:text-primary-400 logo-assemble" />
        </LoginLogoContainer>
      </div>

      {/* Staggered entrance - Title */}
      <div className="text-center login-reveal-2">
        <h2 className="text-3xl font-medium tracking-tight bg-gradient-to-r from-sanctuary-900 via-primary-700 to-sanctuary-900 dark:from-sanctuary-100 dark:via-primary-400 dark:to-sanctuary-100 bg-clip-text text-transparent">
          Sanctuary
        </h2>
        <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400 transition-opacity duration-300">
          {isRegisterMode ? 'Create your digital sanctuary' : 'Sign in to access your digital sanctuary'}
        </p>
      </div>

      <form className="mt-8 space-y-6 login-reveal-3" onSubmit={onSubmit}>
        <div
          ref={cardRef}
          data-testid="login-card"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="rounded-xl surface-glass shadow-sm p-6 space-y-4 transition-[transform] duration-200 ease-out will-change-transform"
        >
          {/* Input ripple on username */}
          <div className="input-ripple">
            <label htmlFor="username" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Username</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <User className="h-4 w-4 text-sanctuary-400" />
              </div>
              <input
                id="username"
                name="username"
                type="text"
                required
                value={username}
                onChange={(e) => onUsernameChange(e.target.value)}
                className="appearance-none rounded-md block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                placeholder="Enter username"
              />
            </div>
          </div>

          {/* Smooth expand for email field */}
          <div
            className="grid transition-all duration-400 ease-in-out"
            style={{
              gridTemplateRows: isRegisterMode ? '1fr' : '0fr',
              opacity: isRegisterMode ? 1 : 0,
            }}
          >
            <div className="overflow-hidden">
              <div className="input-ripple">
                <label htmlFor="email" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Email (Optional)</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Mail className="h-4 w-4 text-sanctuary-400" />
                  </div>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => onEmailChange(e.target.value)}
                    className="appearance-none rounded-md block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                    placeholder="your@email.com"
                    tabIndex={isRegisterMode ? 0 : -1}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Input ripple on password */}
          <div className="input-ripple">
            <label htmlFor="password" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">Password</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Lock className="h-4 w-4 text-sanctuary-400" />
              </div>
              <input
                id="password"
                name="password"
                type="password"
                required
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                className="appearance-none rounded-md block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                placeholder="••••••••"
                minLength={8}
              />
            </div>
            {/* Smooth reveal for password hint */}
            <div
              className="grid transition-all duration-300 ease-in-out"
              style={{
                gridTemplateRows: isRegisterMode ? '1fr' : '0fr',
                opacity: isRegisterMode ? 1 : 0,
              }}
            >
              <div className="overflow-hidden">
                <p className="mt-1 text-xs text-sanctuary-400 dark:text-sanctuary-600">
                  Minimum 8 characters
                </p>
              </div>
            </div>
          </div>
        </div>

        <ErrorAlert message={error} className="text-center" />

        {/* Staggered entrance - Buttons */}
        <div className="space-y-3 login-reveal-4">
          <Button
            type="submit"
            className="w-full justify-center py-3"
            isLoading={isLoading}
          >
            {isLoading
              ? (isRegisterMode ? 'Creating account...' : 'Signing in...')
              : (isRegisterMode ? 'Create Account' : 'Sign In')
            }
          </Button>

          {(registrationEnabled || isRegisterMode) && (
            <button
              type="button"
              onClick={onToggleMode}
              className="w-full text-sm text-sanctuary-500 dark:text-sanctuary-400 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors"
            >
              {isRegisterMode
                ? 'Already have an account? Sign in'
                : "Don't have an account? Register"
              }
            </button>
          )}
        </div>
      </form>

      {/* Staggered entrance - Footer */}
      <div className="text-center space-y-2 login-reveal-5">
        <p className="text-xs text-sanctuary-400 dark:text-sanctuary-600">
          Backend API: {' '}
          {apiStatus === 'checking' && <span className="text-amber-600 dark:text-amber-400">● Connecting...</span>}
          {apiStatus === 'connected' && <span className="text-green-600 dark:text-green-400">● Connected</span>}
          {apiStatus === 'error' && <span className="text-red-600 dark:text-red-400">● Error</span>}
        </p>
        <p className="text-[10px] text-sanctuary-300 dark:text-sanctuary-600">
          {isRegisterMode
            ? 'Create a new account to get started'
            : registrationEnabled
              ? 'Use existing credentials to sign in'
              : 'Contact administrator for account access'}
        </p>
      </div>
    </LoginBackground>
  );
};
