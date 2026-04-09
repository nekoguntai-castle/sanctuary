import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockLogin = vi.fn();
const mockRegister = vi.fn();
const mockVerify2FA = vi.fn();
const mockCancel2FA = vi.fn();
const mockClearError = vi.fn();

vi.mock('../../../contexts/UserContext', () => ({
  useUser: () => ({
    login: mockLogin,
    register: mockRegister,
    verify2FA: mockVerify2FA,
    cancel2FA: mockCancel2FA,
    twoFactorPending: false,
    isLoading: false,
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
    // Mock fetch for health check
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns initial state', () => {
    const { result } = renderHook(() => useLoginFlow());

    expect(result.current.isRegisterMode).toBe(false);
    expect(result.current.username).toBe('');
    expect(result.current.password).toBe('');
    expect(result.current.email).toBe('');
    expect(result.current.twoFactorCode).toBe('');
  });

  it('toggleMode switches mode and clears fields', () => {
    const { result } = renderHook(() => useLoginFlow());

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

    act(() => result.current.toggleMode());
    act(() => result.current.setUsername('bob'));
    act(() => result.current.setPassword('password123'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handleSubmit(mockEvent));

    expect(mockRegister).toHaveBeenCalledWith('bob', 'password123', undefined);
  });

  it('handle2FASubmit calls verify2FA', async () => {
    const { result } = renderHook(() => useLoginFlow());

    act(() => result.current.setTwoFactorCode('123456'));

    const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;
    await act(() => result.current.handle2FASubmit(mockEvent));

    expect(mockVerify2FA).toHaveBeenCalledWith('123456');
    expect(mockClearError).toHaveBeenCalled();
  });

  it('handleCancel2FA clears code and calls cancel2FA', () => {
    const { result } = renderHook(() => useLoginFlow());

    act(() => result.current.setTwoFactorCode('123456'));
    act(() => result.current.handleCancel2FA());

    expect(result.current.twoFactorCode).toBe('');
    expect(mockCancel2FA).toHaveBeenCalled();
  });

  it('setters update state correctly', () => {
    const { result } = renderHook(() => useLoginFlow());

    act(() => result.current.setUsername('alice'));
    expect(result.current.username).toBe('alice');

    act(() => result.current.setPassword('pass'));
    expect(result.current.password).toBe('pass');

    act(() => result.current.setEmail('a@b.com'));
    expect(result.current.email).toBe('a@b.com');

    act(() => result.current.setTwoFactorCode('ABC'));
    expect(result.current.twoFactorCode).toBe('ABC');
  });
});
