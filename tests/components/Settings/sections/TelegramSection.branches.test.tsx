import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TelegramSettings } from '../../../../components/Settings/sections/TelegramSection';
import * as authApi from '../../../../src/api/auth';

const mockState = vi.hoisted(() => ({
  user: {
    id: 'user-1',
    preferences: {
      telegram: {
        enabled: false,
        botToken: '',
        chatId: '',
        wallets: {},
      },
    },
  },
  updatePreferences: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../../contexts/UserContext', () => ({
  useUser: () => ({
    user: mockState.user,
    updatePreferences: mockState.updatePreferences,
  }),
}));

vi.mock('../../../../src/api/auth', () => ({
  testTelegramConfig: vi.fn(),
  fetchTelegramChatId: vi.fn(),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: (...args: unknown[]) => mockState.logError(...args),
}));

vi.mock('../../../../components/ui/Button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button onClick={onClick} data-disabled={disabled ? 'true' : 'false'} {...props}>{children}</button>
  ),
}));

describe('TelegramSettings branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockState.user = {
      id: 'user-1',
      preferences: {
        telegram: {
          enabled: false,
          botToken: '',
          chatId: '',
          wallets: {},
        },
      },
    };

    mockState.updatePreferences.mockResolvedValue({});
    mockState.logError.mockReturnValue('Handled error');
    vi.mocked(authApi.testTelegramConfig).mockResolvedValue({ success: true } as any);
    vi.mocked(authApi.fetchTelegramChatId).mockResolvedValue({ success: true, chatId: '123' } as any);
  });

  it('covers empty field guards and bot-token visibility toggle states', async () => {
    const user = userEvent.setup();
    render(<TelegramSettings />);

    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(screen.getByText('Please enter both bot token and chat ID')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(screen.getByText('Please enter your bot token first')).toBeInTheDocument();

    const tokenInput = screen.getByPlaceholderText('123456789:ABCdefGHIjklMNOpqrsTUVwxyz') as HTMLInputElement;
    expect(tokenInput.type).toBe('password');

    const eyeButton = tokenInput.parentElement?.querySelector('button');
    expect(eyeButton).toBeTruthy();
    await user.click(eyeButton as HTMLButtonElement);
    expect(tokenInput.type).toBe('text');
    await user.click(eyeButton as HTMLButtonElement);
    expect(tokenInput.type).toBe('password');
  });

  it('covers test and fetch failure branches with explicit and fallback messages', async () => {
    const user = userEvent.setup();
    render(<TelegramSettings />);

    const tokenInput = screen.getByPlaceholderText('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    const chatInput = screen.getByPlaceholderText('123456789');
    await user.type(tokenInput, 'bot-token');
    await user.type(chatInput, 'chat-id');

    vi.mocked(authApi.testTelegramConfig)
      .mockResolvedValueOnce({ success: false } as any)
      .mockResolvedValueOnce({ success: false, error: 'Access denied' } as any);

    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Failed to send test message')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();

    vi.mocked(authApi.fetchTelegramChatId)
      .mockResolvedValueOnce({ success: false } as any)
      .mockResolvedValueOnce({ success: false, error: 'Bad token' } as any)
      .mockRejectedValueOnce(new Error('network down'));

    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(await screen.findByText('Failed to fetch chat ID')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(await screen.findByText('Bad token')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(await screen.findByText('Handled error')).toBeInTheDocument();
  });

  it('covers chat-id fetch success with and without username', async () => {
    const user = userEvent.setup();
    render(<TelegramSettings />);

    const tokenInput = screen.getByPlaceholderText('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    await user.type(tokenInput, 'bot-token');

    vi.mocked(authApi.fetchTelegramChatId)
      .mockResolvedValueOnce({ success: true, chatId: '123' } as any)
      .mockResolvedValueOnce({ success: true, chatId: '456', username: 'satoshi' } as any);

    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(await screen.findByText('Chat ID found!')).toBeInTheDocument();
    expect(screen.getByDisplayValue('123')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fetch' }));
    expect(await screen.findByText('Chat ID found (@satoshi)!')).toBeInTheDocument();
    expect(screen.getByDisplayValue('456')).toBeInTheDocument();
  });

  it('covers save timeout replacement/cleanup and save/toggle error branches', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const timeoutCallbacks: Array<() => void> = [];
    const realSetTimeout = globalThis.setTimeout;
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        if (typeof cb === 'function' && ms === 3000) {
          timeoutCallbacks.push(cb as () => void);
          return 1 as unknown as ReturnType<typeof setTimeout>;
        }
        return realSetTimeout(cb, ms);
      }) as typeof setTimeout);
    const user = userEvent.setup();
    const { unmount } = render(<TelegramSettings />);

    const tokenInput = screen.getByPlaceholderText('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    const chatInput = screen.getByPlaceholderText('123456789');
    await user.type(tokenInput, 'bot-token');
    await user.type(chatInput, 'chat-id');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Settings saved successfully')).toBeInTheDocument();
    expect(timeoutCallbacks.length).toBeGreaterThan(0);

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });
    expect(screen.queryByText('Settings saved successfully')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(clearTimeoutSpy).toHaveBeenCalled();

    mockState.logError.mockReturnValueOnce('Failed to save settings');
    mockState.updatePreferences.mockRejectedValueOnce(new Error('save failed'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Failed to save settings')).toBeInTheDocument();

    mockState.logError.mockReturnValueOnce('Failed to update settings');
    mockState.updatePreferences.mockRejectedValueOnce(new Error('toggle failed'));
    const disabledLabel = screen.getByText('Disabled');
    const toggleButton = disabledLabel.parentElement?.querySelector('button');
    expect(toggleButton).toBeTruthy();
    await user.click(toggleButton as HTMLButtonElement);
    expect(await screen.findByText('Failed to update settings')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();

    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
    clearTimeoutSpy.mockRestore();
  });

  it('falls back telegram wallets to empty object when user preferences omit wallets', async () => {
    const user = userEvent.setup();
    mockState.user = {
      id: 'user-1',
      preferences: {
        telegram: {
          enabled: false,
          botToken: '',
          chatId: '',
        },
      },
    } as any;

    render(<TelegramSettings />);

    const tokenInput = screen.getByPlaceholderText('123456789:ABCdefGHIjklMNOpqrsTUVwxyz');
    const chatInput = screen.getByPlaceholderText('123456789');
    await user.type(tokenInput, 'bot-token');
    await user.type(chatInput, 'chat-id');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(mockState.updatePreferences).toHaveBeenCalledWith(expect.objectContaining({
        telegram: expect.objectContaining({
          wallets: {},
        }),
      }));
    });

    const disabledLabel = screen.getByText('Disabled');
    const toggleButton = disabledLabel.parentElement?.querySelector('button');
    expect(toggleButton).toBeTruthy();
    await user.click(toggleButton as HTMLButtonElement);

    expect(mockState.updatePreferences).toHaveBeenLastCalledWith(expect.objectContaining({
      telegram: expect.objectContaining({
        wallets: {},
      }),
    }));
  });
});
