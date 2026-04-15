import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockVerify2FA = vi.fn();
const mockCancel2FA = vi.fn();
const mockClearError = vi.fn();
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
    clearError: mockClearError,
  }),
}));

vi.mock('../../../src/api/auth', () => ({
  getRegistrationStatus: vi.fn().mockResolvedValue({ enabled: true }),
}));

// Must import after mocks are defined
import { useLoginFlow } from '../../../components/Login/useLoginFlow';

describe('useLoginFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mutable UserContext state before every test.
    mockUserContextState.isLoading = false;
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
    await waitForInitialChecks(result);
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

  it('handleSubmit calls register with undefined email when empty', async () => {
    const { result } = renderHook(() => useLoginFlow());
    await waitForInitialChecks(result);

    act(() => result.current.toggleMode());
    act(() => result.current.setUsername('bob'));
    act(() => result.current.setPassword('password123'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handleSubmit(mockEvent));

    expect(mockRegister).toHaveBeenCalledWith('bob', 'password123', undefined);
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
