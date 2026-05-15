import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockVerify2FA = vi.fn();
const mockCancel2FA = vi.fn();
const mockClearError = vi.fn();
const mockClearNotice = vi.fn();
// Mutable state object so individual tests can flip the UserContext
// boot-loading flag without re-mocking the module.
const mockUserContextState = {
  isLoading: false,
};

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({
    login: mockLogin,
    register: mockRegister,
    verify2FA: mockVerify2FA,
    cancel2FA: mockCancel2FA,
    twoFactorPending: false,
    isLoading: mockUserContextState.isLoading,
    error: null,
    notice: null,
    clearError: mockClearError,
    clearNotice: mockClearNotice,
  }),
}));

vi.mock('../../../src/api/auth', () => ({
  getRegistrationStatus: vi.fn().mockResolvedValue({ enabled: true }),
}));

// Must import after mocks are defined
import { useLoginFlow } from '../../../components/Login/useLoginFlow';
import { getRegistrationStatus } from '../../../src/api/auth';

describe('useLoginFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mutable UserContext state before every test.
    mockUserContextState.isLoading = false;
    vi.mocked(getRegistrationStatus).mockResolvedValue({ enabled: true });
    // Mock fetch for health check
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const waitForInitialChecks = async (result: ReturnType<typeof renderHook<ReturnType<typeof useLoginFlow>, unknown>>['result']) => {
    await waitFor(() => expect(result.current.apiStatus).toBe('connected'));
    await waitFor(() => expect(result.current.registrationEnabled).toBe(true));
  };

  it('returns initial state', async () => {
    const { result } = renderHook(() => useLoginFlow());

    expect(result.current.isRegisterMode).toBe(false);
    expect(result.current.username).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.email).toBe('');
    expect(result.current.twoFactorCode).toBe('');
    expect(result.current.notice).toBeNull();
    await waitForInitialChecks(result);
  });

  it('marks API status as error and skips registration lookup when health is not connected', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const { result } = renderHook(() => useLoginFlow());

    await waitFor(() => expect(result.current.apiStatus).toBe('error'));
    expect(getRegistrationStatus).not.toHaveBeenCalled();
    expect(result.current.registrationEnabled).toBe(false);
  });

  it('marks API status as error and skips registration lookup when health rejects', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useLoginFlow());

    await waitFor(() => expect(result.current.apiStatus).toBe('error'));
    expect(getRegistrationStatus).not.toHaveBeenCalled();
    expect(result.current.registrationEnabled).toBe(false);
  });

  it('falls back to registration disabled when registration status lookup fails', async () => {
    vi.mocked(getRegistrationStatus).mockRejectedValueOnce(new Error('registration unavailable'));

    const { result } = renderHook(() => useLoginFlow());

    await waitFor(() => expect(result.current.apiStatus).toBe('connected'));
    await waitFor(() => expect(getRegistrationStatus).toHaveBeenCalled());
    expect(result.current.registrationEnabled).toBe(false);
  });

  it('does not update registration state after unmounting during an in-flight health check', async () => {
    let resolveHealth: ((value: Pick<Response, 'ok' | 'status'>) => void) | undefined;
    const healthPromise = new Promise<Pick<Response, 'ok' | 'status'>>((resolve) => {
      resolveHealth = resolve;
    });
    global.fetch = vi.fn().mockReturnValue(healthPromise);

    const { unmount } = renderHook(() => useLoginFlow());
    const fetchOptions = vi.mocked(global.fetch).mock.calls[0][1] as RequestInit;

    unmount();
    resolveHealth!({ ok: true, status: 200 });

    await act(async () => {
      await healthPromise;
      await Promise.resolve();
    });

    expect((fetchOptions.signal as AbortSignal).aborted).toBe(true);
    expect(getRegistrationStatus).not.toHaveBeenCalled();
  });

  it('does not update API status after unmounting during a failed health check', async () => {
    let rejectHealth: ((reason: Error) => void) | undefined;
    const healthPromise = new Promise<Pick<Response, 'ok' | 'status'>>((_resolve, reject) => {
      rejectHealth = reject;
    });
    global.fetch = vi.fn().mockReturnValue(healthPromise);

    const { result, unmount } = renderHook(() => useLoginFlow());

    unmount();
    rejectHealth!(new Error('network down'));

    await act(async () => {
      await healthPromise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(result.current.apiStatus).toBe('checking');
    expect(getRegistrationStatus).not.toHaveBeenCalled();
  });

  it('does not update registration state after unmounting during registration lookup', async () => {
    let resolveRegistration: ((value: { enabled: boolean }) => void) | undefined;
    const registrationPromise = new Promise<{ enabled: boolean }>((resolve) => {
      resolveRegistration = resolve;
    });
    vi.mocked(getRegistrationStatus).mockReturnValueOnce(registrationPromise);

    const { result, unmount } = renderHook(() => useLoginFlow());

    await waitFor(() => expect(result.current.apiStatus).toBe('connected'));
    expect(getRegistrationStatus).toHaveBeenCalled();

    unmount();
    resolveRegistration!({ enabled: true });

    await act(async () => {
      await registrationPromise;
      await Promise.resolve();
    });

    expect(result.current.registrationEnabled).toBe(false);
  });

  it('does not update registration state after unmounting during failed registration lookup', async () => {
    let rejectRegistration: ((reason: Error) => void) | undefined;
    const registrationPromise = new Promise<{ enabled: boolean }>((_resolve, reject) => {
      rejectRegistration = reject;
    });
    vi.mocked(getRegistrationStatus).mockReturnValueOnce(registrationPromise);

    const { result, unmount } = renderHook(() => useLoginFlow());

    await waitFor(() => expect(result.current.apiStatus).toBe('connected'));
    expect(getRegistrationStatus).toHaveBeenCalled();

    unmount();
    rejectRegistration!(new Error('registration unavailable'));

    await act(async () => {
      await registrationPromise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(result.current.registrationEnabled).toBe(false);
  });

  it('toggleMode switches mode and clears fields', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setUsername('alice'));
    act(() => result.current.setPassword('pass'));
    act(() => result.current.setEmail('a@b.com'));

    act(() => result.current.toggleMode());

    expect(result.current.isRegisterMode).toBe(true);
    expect(result.current.username).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.email).toBe('');
    expect(mockClearError).toHaveBeenCalled();
    expect(mockClearNotice).toHaveBeenCalled();
  });

  it('handleSubmit calls login in login mode', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setUsername('alice'));
    act(() => result.current.setPassword('password123'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handleSubmit(mockEvent));

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockClearError).toHaveBeenCalled();
    expect(mockClearNotice).toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledWith('alice', 'password123');
  });

  it('handleSubmit calls register in register mode', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.toggleMode());
    act(() => result.current.setUsername('bob'));
    act(() => result.current.setPassword('password123'));
    act(() => result.current.setEmail('bob@test.com'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handleSubmit(mockEvent));

    expect(mockRegister).toHaveBeenCalledWith('bob', 'password123', 'bob@test.com');
  });

  it('handleSubmit passes the required registration email', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.toggleMode());
    act(() => result.current.setUsername('bob'));
    act(() => result.current.setPassword('password123'));
    act(() => result.current.setEmail('bob@example.com'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handleSubmit(mockEvent));

    expect(mockRegister).toHaveBeenCalledWith('bob', 'password123', 'bob@example.com');
  });

  it('handle2FASubmit calls verify2FA', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setTwoFactorCode('123456'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handle2FASubmit(mockEvent));

    expect(mockVerify2FA).toHaveBeenCalledWith('123456');
    expect(mockClearError).toHaveBeenCalled();
  });

  it('handleCancel2FA clears code and calls cancel2FA', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setTwoFactorCode('123456'));
    act(() => result.current.handleCancel2FA());

    expect(result.current.twoFactorCode).toBe('');
    expect(mockCancel2FA).toHaveBeenCalled();
  });

  it('setters update state correctly', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setUsername('alice'));
    expect(result.current.username).toBe('alice');

    act(() => result.current.setPassword('pass'));
    expect(result.current.password).toBe('pass');

    act(() => result.current.setEmail('a@b.com'));
    expect(result.current.email).toBe('a@b.com');

    act(() => result.current.setTwoFactorCode('ABC'));
    expect(result.current.twoFactorCode).toBe('ABC');
  });

  // Phase 6 regression: the submit handlers must refuse to fire while
  // UserContext is running the boot `/auth/me` check. Otherwise the
  // user can race their login against the boot authentication probe.
  it('handleSubmit returns early when UserContext is still boot-loading', async () => {
    mockUserContextState.isLoading = true;
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setUsername('alice'));
    act(() => result.current.setPassword('password123'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handleSubmit(mockEvent));

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    // Boot-loading guard must prevent login/register from firing and
    // must not touch the error state either — nothing happens.
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockClearError).not.toHaveBeenCalled();
  });

  it('handle2FASubmit returns early when UserContext is still boot-loading', async () => {
    mockUserContextState.isLoading = true;
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.setTwoFactorCode('123456'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handle2FASubmit(mockEvent));

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockVerify2FA).not.toHaveBeenCalled();
    expect(mockClearError).not.toHaveBeenCalled();
  });
});
