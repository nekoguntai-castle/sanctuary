/**
 * Login Component Tests
 *
 * Tests user authentication, registration, and 2FA flows.
 */

import { act,render,screen,waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { getRegistrationStatus } from '../../src/api/auth';

// Mock the UserContext
const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockVerify2FA = vi.fn();
const mockCancel2FA = vi.fn();
const mockClearError = vi.fn();

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    login: mockLogin,
    register: mockRegister,
    verify2FA: mockVerify2FA,
    cancel2FA: mockCancel2FA,
    twoFactorPending: null,
    isLoading: false,
    error: null,
    clearError: mockClearError,
  }),
}));

// Mock auth API
vi.mock('../../src/api/auth', () => ({
  getRegistrationStatus: vi.fn().mockResolvedValue({ enabled: true }),
}));

// Mock lucide-react icons to avoid rendering issues
vi.mock('lucide-react', () => ({
  Lock: () => <span data-testid="lock-icon" />,
  User: () => <span data-testid="user-icon" />,
  Mail: () => <span data-testid="mail-icon" />,
  Shield: () => <span data-testid="shield-icon" />,
  ArrowLeft: () => <span data-testid="arrow-left-icon" />,
}));

// Mock custom icons
vi.mock('../../components/ui/CustomIcons', () => ({
  SanctuaryLogo: () => <span data-testid="sanctuary-logo" />,
  SanctuaryShieldLogo: ({ ready }: { ready?: boolean }) => <span data-testid="sanctuary-shield-logo" data-ready={ready} />,
}));

// Mock Button component
vi.mock('../../components/ui/Button', () => ({
  Button: ({ children, type, isLoading, disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { isLoading?: boolean }) => (
    <button type={type as 'button' | 'submit' | 'reset' | undefined} disabled={disabled || isLoading} {...props}>
      {isLoading ? 'Loading...' : children}
    </button>
  ),
}));

// Mock global fetch for API health check
const mockFetch = vi.fn();
global.fetch = mockFetch;

const renderLogin = async (Login: React.ComponentType) => {
  render(<Login />);
  await waitFor(() => {
    expect(mockFetch).toHaveBeenCalled();
  });
};

describe('Login Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    // Mock matchMedia for system theme detection
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('should render login form by default', async () => {
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    expect(screen.getByText('Sanctuary')).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('should display registration toggle when enabled', async () => {
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(screen.getByText(/don't have an account\? register/i)).toBeInTheDocument();
    });
  });

  it('should toggle to register mode when clicked', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    expect(screen.getByText(/create your digital sanctuary/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument();
  });

  it('should call login on form submit in login mode', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /sign in/i });

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'testpassword');
    await user.click(submitButton);

    expect(mockClearError).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith('testuser', 'testpassword');
  });

  it('should call register on form submit in register mode', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    // Toggle to register mode
    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const emailInput = screen.getByLabelText(/email/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });

    await user.type(usernameInput, 'newuser');
    await user.type(passwordInput, 'newpassword123');
    await user.type(emailInput, 'test@example.com');
    await user.click(submitButton);

    expect(mockClearError).toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledWith('newuser', 'newpassword123', 'test@example.com');
  });

  it('should check API health status on mount', async () => {
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/v1/health');
    });
  });

  it('should display API connected status', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
  });

  it('should treat 401 health response as connected', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401 });
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(screen.getByText(/connected/i)).toBeInTheDocument();
    });
  });

  it('should show API error for non-401 unsuccessful responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it('should disable registration when registration status lookup fails', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    vi.mocked(getRegistrationStatus).mockRejectedValueOnce(new Error('reg status failed'));
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(screen.queryByText(/don't have an account\? register/i)).not.toBeInTheDocument();
      expect(screen.getByText(/contact administrator for account access/i)).toBeInTheDocument();
    });
  });

  it('should display API error status on fetch failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    await waitFor(() => {
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });
  });

  it('should clear form fields when toggling modes', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    const usernameInput = screen.getByLabelText(/username/i) as HTMLInputElement;
    const passwordInput = screen.getByLabelText(/password/i) as HTMLInputElement;

    await user.type(usernameInput, 'testuser');
    await user.type(passwordInput, 'testpassword');

    // Toggle to register mode
    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    // Fields should be cleared
    expect(usernameInput.value).toBe('');
    expect(passwordInput.value).toBe('');
  });

  it('should register without email as undefined', async () => {
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    const toggleButton = await screen.findByText(/don't have an account\? register/i);
    await user.click(toggleButton);

    const usernameInput = screen.getByLabelText(/username/i);
    const passwordInput = screen.getByLabelText(/password/i);
    const submitButton = screen.getByRole('button', { name: /create account/i });

    await user.type(usernameInput, 'newuser');
    await user.type(passwordInput, 'newpassword123');
    await user.click(submitButton);

    expect(mockRegister).toHaveBeenCalledWith('newuser', 'newpassword123', undefined);
  });

  it('applies dark class when system prefers dark mode', async () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { Login } = await import('../../components/Login');
    await renderLogin(Login);

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('updates theme when system color-scheme change event fires', async () => {
    let changeHandler!: (e: MediaQueryListEvent) => void;

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn((event: string, handler: EventListenerOrEventListenerObject) => {
          if (event === 'change' && typeof handler === 'function') {
            changeHandler = handler as (e: MediaQueryListEvent) => void;
          }
        }),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    const { Login } = await import('../../components/Login');
    await renderLogin(Login);

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    await act(async () => {
      changeHandler({ matches: true } as MediaQueryListEvent);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await act(async () => {
      changeHandler({ matches: false } as MediaQueryListEvent);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

});

describe('Login Component - 2FA Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('should display 2FA verification screen when pending', async () => {
    // Override the mock for this test
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    // Need to reimport to get the mocked version
    vi.resetModules();
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
  });

  it('should call verify2FA on 2FA form submit', async () => {
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    vi.resetModules();
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    const codeInput = screen.getByLabelText(/verification code/i);
    await user.type(codeInput, '123456');

    const verifyButton = screen.getByRole('button', { name: /verify/i });
    await user.click(verifyButton);

    expect(mockClearError).toHaveBeenCalled();
    expect(mockVerify2FA).toHaveBeenCalledWith('123456');
  });

  it('should call cancel2FA when back button clicked', async () => {
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    vi.resetModules();
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();

    await renderLogin(Login);

    const backButton = screen.getByText(/back to login/i);
    await user.click(backButton);

    expect(mockCancel2FA).toHaveBeenCalled();
  });
});

describe('Login Component - Error Display', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  it('should display error message when error exists', async () => {
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: null,
        isLoading: false,
        error: 'Invalid credentials',
        clearError: mockClearError,
      }),
    }));

    vi.resetModules();
    const { Login } = await import('../../components/Login');

    await renderLogin(Login);

    expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
  });
});

describe('Login Component - Loading branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  // Phase 6 regression fix: the submit button's loading state is now
  // tracked locally in useLoginFlow (isSubmitting), not read from
  // UserContext.isLoading. This avoids showing "Signing in..." during
  // the boot `/auth/me` check (see useLoginFlow.ts for the reasoning).
  // Exercising the loading branch now requires triggering an actual
  // submit whose async action does not resolve until we assert.

  it('covers loading branch on login submit button', async () => {
    // Block login() forever so isSubmitting stays true.
    let resolveLogin: (() => void) | undefined;
    mockLogin.mockImplementation(
      () => new Promise<void>((res) => { resolveLogin = () => res(); })
    );

    vi.resetModules();
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();
    await renderLogin(Login);

    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret1234');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    });

    await act(async () => {
      resolveLogin?.();
    });
  });

  it('covers loading and error branches on 2FA screen', async () => {
    // 2FA pending comes from UserContext; error surfaces through
    // UserContext as well. Override the mock on this test to put the
    // form into the 2FA state and return an error, then trigger the
    // 2FA verify to exercise the local loading branch.
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: { tempToken: 'test-token' },
        isLoading: false,
        error: 'Invalid code',
        clearError: mockClearError,
      }),
    }));

    let resolveVerify: (() => void) | undefined;
    mockVerify2FA.mockImplementation(
      () => new Promise<void>((res) => { resolveVerify = () => res(); })
    );

    vi.resetModules();
    const { Login: LoginWith2FA } = await import('../../components/Login');
    const user = userEvent.setup();
    await renderLogin(LoginWith2FA);

    expect(screen.getByText('Invalid code')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/verification code/i), '123456');
    await user.click(screen.getByRole('button', { name: /verify/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    });

    await act(async () => {
      resolveVerify?.();
    });
  });

  it('covers loading branch while register mode is active', async () => {
    // Reset the UserContext mock to the default (no 2FA pending). The
    // previous test vi.doMock'd it into a 2FA-pending state and those
    // doMocks persist across tests until explicitly overridden.
    vi.doMock('../../contexts/UserContext', () => ({
      useUser: () => ({
        login: mockLogin,
        register: mockRegister,
        verify2FA: mockVerify2FA,
        cancel2FA: mockCancel2FA,
        twoFactorPending: null,
        isLoading: false,
        error: null,
        clearError: mockClearError,
      }),
    }));

    let resolveRegister: (() => void) | undefined;
    mockRegister.mockImplementation(
      () => new Promise<void>((res) => { resolveRegister = () => res(); })
    );

    vi.resetModules();
    const { Login } = await import('../../components/Login');
    const user = userEvent.setup();
    await renderLogin(Login);

    await user.click(screen.getByText(/don't have an account\? register/i));
    expect(screen.getByText(/create your digital sanctuary/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/username/i), 'alice');
    await user.type(screen.getByLabelText(/password/i), 'secret1234');
    await user.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();
    });

    await act(async () => {
      resolveRegister?.();
    });
  });
});
