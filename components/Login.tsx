import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { Button } from './ui/Button';
import { Lock, User, Mail, Shield, ArrowLeft } from 'lucide-react';
import { SanctuaryLogo } from './ui/CustomIcons';
import { useUser } from '../contexts/UserContext';
import { getRegistrationStatus } from '../src/api/auth';

const AnimatedBackground = lazy(() => import('./AnimatedBackground'));

// #6: Floating dust motes configuration
const DUST_MOTES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  size: 2 + Math.random() * 3,
  left: Math.random() * 100,
  top: Math.random() * 100,
  dx: (Math.random() - 0.5) * 200,
  dy: -50 - Math.random() * 150,
  duration: 20 + Math.random() * 20,
  delay: Math.random() * 15,
}));

// #7: Card tilt hook for glassmorphism enhancement
// Visual-only mouse tracking — requires real DOM mouse physics untestable in jsdom
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

// Shared login page background with vignette, glow, dust motes, and canvas animation
const LoginBackground: React.FC<{ darkMode: boolean; children: React.ReactNode }> = ({ darkMode, children }) => (
  <div className="min-h-screen flex items-center justify-center bg-atmospheric p-4 transition-colors duration-500 relative overflow-hidden">
    {/* #3: Canvas background animation */}
    <Suspense fallback={null}>
      <AnimatedBackground
        pattern={darkMode ? 'fireflies' : 'zen-sand-garden'}
        darkMode={darkMode}
        opacity={darkMode ? 18 : 12}
      />
    </Suspense>
    {/* Vignette overlay */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(250,250,250,0.15)_100%)] dark:bg-[radial-gradient(ellipse_at_center,_transparent_30%,_rgba(0,0,0,0.4)_100%)] pointer-events-none z-[1]" />
    {/* Ambient glow behind card */}
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-success-50/30 dark:bg-success-700/[0.07] blur-[120px] pointer-events-none z-[1]" />
    {/* #6: Floating dust motes */}
    {DUST_MOTES.map((mote) => (
      <div
        key={mote.id}
        className="dust-mote bg-warning-500/40 dark:bg-warning-600/30"
        style={{
          width: mote.size,
          height: mote.size,
          left: `${mote.left}%`,
          top: `${mote.top}%`,
          '--dust-dx': `${mote.dx}px`,
          '--dust-dy': `${mote.dy}px`,
          '--dust-duration': `${mote.duration}s`,
          '--dust-delay': `${mote.delay}s`,
        } as React.CSSProperties}
      />
    ))}
    <div className="relative z-10 max-w-md w-full space-y-8">
      {children}
    </div>
  </div>
);

export const Login: React.FC = () => {
  const { login, register, verify2FA, cancel2FA, twoFactorPending, isLoading, error, clearError } = useUser();
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [apiStatus, setApiStatus] = useState<'checking' | 'connected' | 'error'>('checking');
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const twoFactorInputRef = useRef<HTMLInputElement>(null);
  const [darkMode, setDarkMode] = useState(false);

  // #7: Card tilt for glassmorphism
  const { cardRef, handleMouseMove, handleMouseLeave } = useCardTilt();

  // Apply system color scheme preference on login screen
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const applySystemTheme = (isDark: boolean) => {
      setDarkMode(isDark);
      if (isDark) {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    // Apply initial preference
    applySystemTheme(mediaQuery.matches);

    // Listen for changes
    const handler = (e: MediaQueryListEvent) => applySystemTheme(e.matches);
    mediaQuery.addEventListener('change', handler);

    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  // Check API status and registration status on mount
  React.useEffect(() => {
    const checkApi = async () => {
      try {
        // Use relative URL to go through nginx proxy
        const response = await fetch('/api/v1/health');
        if (response.ok || response.status === 401) {
          // 401 is fine - it means the API is responding but requires auth
          setApiStatus('connected');

          // Check if registration is enabled
          try {
            const regStatus = await getRegistrationStatus();
            setRegistrationEnabled(regStatus.enabled);
          } catch {
            setRegistrationEnabled(false);
          }
        } else {
          setApiStatus('error');
        }
      } catch (err) {
        setApiStatus('error');
      }
    };
    checkApi();
  }, []);

  // Focus 2FA input when it appears
  useEffect(() => {
    if (twoFactorPending && twoFactorInputRef.current) {
      twoFactorInputRef.current.focus();
    }
  }, [twoFactorPending]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (isRegisterMode) {
      await register(username, password, email || undefined);
    } else {
      await login(username, password);
    }
    // Context will handle success/error states and 2FA pending
  };

  const handle2FASubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await verify2FA(twoFactorCode);
  };

  const handleCancel2FA = () => {
    setTwoFactorCode('');
    cancel2FA();
  };

  // #8: Smooth mode toggle with content cross-fade
  const toggleMode = () => {
    setIsRegisterMode(!isRegisterMode);
    clearError();
    setUsername('');
    setPassword('');
    setEmail('');
  };

  // 2FA Verification Screen
  if (twoFactorPending) {
    return (
      <LoginBackground darkMode={darkMode}>
        {/* #1: Staggered entrance */}
        <div className="text-center login-reveal-1">
          <div className="mx-auto h-20 w-20 bg-sanctuary-200/80 dark:bg-sanctuary-800/80 rounded-2xl flex items-center justify-center mb-6 shadow-inner backdrop-blur-sm login-logo-enter">
            <Shield className="h-10 w-10 text-primary-600 dark:text-primary-400" />
          </div>
          <h2 className="mt-6 text-3xl font-light text-sanctuary-900 dark:text-sanctuary-100 tracking-tight">
            Two-Factor Authentication
          </h2>
          <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400">
            Enter the 6-digit code from your authenticator app
          </p>
        </div>

        <form className="mt-8 space-y-6 login-reveal-2" onSubmit={handle2FASubmit}>
          <div className="rounded-xl surface-elevated shadow-sm border border-sanctuary-200 dark:border-sanctuary-800 p-6 space-y-4">
            {/* #4: Input ripple effect */}
            <div className="input-ripple">
              <label htmlFor="twoFactorCode" className="block text-xs font-medium text-sanctuary-500 uppercase mb-1">
                Verification Code
              </label>
              <input
                ref={twoFactorInputRef}
                id="twoFactorCode"
                name="twoFactorCode"
                type="text"
                autoComplete="one-time-code"
                required
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
                className="appearance-none rounded-lg block w-full px-4 py-3 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 text-center text-2xl tracking-[0.3em] font-mono transition-colors"
                placeholder="000000"
                maxLength={8}
              />
            </div>
            <p className="text-xs text-sanctuary-400 text-center">
              You can also enter a backup code if you don't have access to your authenticator app
            </p>
          </div>

          {error && (
            <div className="text-center text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 p-2 rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-3 login-reveal-3">
            <Button
              type="submit"
              className="w-full justify-center py-3"
              isLoading={isLoading}
              disabled={twoFactorCode.length < 6}
            >
              {isLoading ? 'Verifying...' : 'Verify'}
            </Button>

            <button
              type="button"
              onClick={handleCancel2FA}
              className="w-full flex items-center justify-center gap-2 text-sm text-sanctuary-500 dark:text-sanctuary-400 hover:text-sanctuary-700 dark:hover:text-sanctuary-200 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to login
            </button>
          </div>
        </form>
      </LoginBackground>
    );
  }

  // Regular Login/Register Screen
  return (
    <LoginBackground darkMode={darkMode}>
      {/* #1: Staggered entrance - Logo */}
      <div className="text-center login-reveal-1">
        <div className="mx-auto h-20 w-20 bg-sanctuary-200/80 dark:bg-sanctuary-800/80 rounded-2xl flex items-center justify-center mb-6 shadow-inner backdrop-blur-sm login-logo-enter">
          {/* #2: Breathing logo */}
          <SanctuaryLogo className="h-10 w-10 text-primary-600 dark:text-primary-400 logo-breathe" />
        </div>
      </div>

      {/* #1: Staggered entrance - Title */}
      <div className="text-center login-reveal-2">
        <h2 className="text-3xl font-light tracking-tight bg-gradient-to-r from-sanctuary-900 via-primary-700 to-sanctuary-900 dark:from-sanctuary-100 dark:via-primary-400 dark:to-sanctuary-100 bg-clip-text text-transparent">
          Sanctuary
        </h2>
        <p className="mt-2 text-sm text-sanctuary-500 dark:text-sanctuary-400 transition-opacity duration-300">
          {isRegisterMode ? 'Create your digital sanctuary' : 'Sign in to access your digital sanctuary'}
        </p>
      </div>

      {/* #1: Staggered entrance - Form card */}
      {/* #7: Card tilt on hover */}
      {/* #8: Smooth height transition for login/register toggle */}
      <form className="mt-8 space-y-6 login-reveal-3" onSubmit={handleSubmit}>
        <div
          ref={cardRef}
          data-testid="login-card"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="rounded-xl surface-glass shadow-sm p-6 space-y-4 transition-[transform] duration-200 ease-out will-change-transform"
        >
          {/* #4: Input ripple on username */}
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
                onChange={(e) => setUsername(e.target.value)}
                className="appearance-none rounded-lg block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                placeholder="Enter username"
              />
            </div>
          </div>

          {/* #8: Smooth expand for email field */}
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
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none rounded-lg block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                    placeholder="your@email.com"
                    tabIndex={isRegisterMode ? 0 : -1}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* #4: Input ripple on password */}
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
                onChange={(e) => setPassword(e.target.value)}
                className="appearance-none rounded-lg block w-full pl-10 pr-3 py-2 border border-sanctuary-300 dark:border-sanctuary-700 placeholder-sanctuary-400 text-sanctuary-900 dark:text-sanctuary-100 surface-muted focus:outline-none focus:ring-2 focus:ring-sanctuary-500 focus:border-sanctuary-500 sm:text-sm transition-colors"
                placeholder="••••••••"
                minLength={8}
              />
            </div>
            {/* #8: Smooth reveal for password hint */}
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

        {error && (
          <div className="text-center text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 p-2 rounded-lg">
            {error}
          </div>
        )}

        {/* #1: Staggered entrance - Buttons */}
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
              onClick={toggleMode}
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

      {/* #1: Staggered entrance - Footer */}
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
