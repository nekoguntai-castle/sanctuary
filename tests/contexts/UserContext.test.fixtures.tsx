import { useUser } from '../../contexts/UserContext';

export const mockUser = {
  id: 'user-1',
  username: 'testuser',
  email: 'test@example.com',
  isAdmin: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  preferences: {
    darkMode: true,
    unit: 'sats' as const,
    fiatCurrency: 'USD' as const,
    showFiat: false,
    theme: 'sanctuary' as const,
    background: 'minimal' as const,
  },
};

export const mockTwoFactorResponse = {
  requires2FA: true as const,
  tempToken: 'temp-token-123',
};

export function TestConsumer() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    twoFactorPending,
    login,
    verify2FA,
    cancel2FA,
    register,
    logout,
    updatePreferences,
    clearError,
  } = useUser();

  return (
    <div>
      <span data-testid="user">{user?.username ?? 'null'}</span>
      <span data-testid="authenticated">{isAuthenticated.toString()}</span>
      <span data-testid="loading">{isLoading.toString()}</span>
      <span data-testid="error">{error ?? 'null'}</span>
      <span data-testid="2fa-pending">{twoFactorPending ? 'yes' : 'no'}</span>
      <button data-testid="login" onClick={() => login('testuser', 'password')}>Login</button>
      <button data-testid="register" onClick={() => register('newuser', 'password', 'new@example.com')}>Register</button>
      <button data-testid="logout" onClick={logout}>Logout</button>
      <button data-testid="verify-2fa" onClick={() => verify2FA('123456')}>Verify 2FA</button>
      <button data-testid="cancel-2fa" onClick={cancel2FA}>Cancel 2FA</button>
      <button data-testid="update-prefs" onClick={() => updatePreferences({ darkMode: false })}>Update Prefs</button>
      <button data-testid="clear-error" onClick={clearError}>Clear Error</button>
    </div>
  );
}
