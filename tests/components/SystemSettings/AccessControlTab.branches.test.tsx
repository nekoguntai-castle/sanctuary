import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccessControlTab } from '../../../components/SystemSettings/AccessControlTab';
import * as adminApi from '../../../src/api/admin';

vi.mock('../../../src/api/admin', () => ({
  getSystemSettings: vi.fn(),
  updateSystemSettings: vi.fn(),
}));

const getToggleButton = (): HTMLButtonElement => {
  const container = screen
    .getByText('Public Registration')
    .closest('div')
    ?.parentElement
    ?.parentElement as HTMLElement;

  const button = container.querySelector('button[class*="rounded-full"]') as HTMLButtonElement | null;
  if (!button) {
    throw new Error('toggle button not found');
  }
  return button;
};

describe('AccessControlTab branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('covers successful toggles, saving state class, timeout replacement, and cleanup', async () => {
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

    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({ registrationEnabled: false } as never);

    let resolveFirstSave: (() => void) | null = null;
    vi.mocked(adminApi.updateSystemSettings)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSave = resolve;
          }) as never,
      )
      .mockResolvedValueOnce(undefined as never);

    const { unmount } = render(<AccessControlTab />);

    await waitFor(() => {
      expect(screen.getByText('Public Registration')).toBeInTheDocument();
    });

    const toggleButton = getToggleButton();
    fireEvent.click(toggleButton);

    await waitFor(() => {
      expect(toggleButton).toBeDisabled();
      expect(toggleButton.className).toContain('opacity-50');
    });

    resolveFirstSave?.();

    await waitFor(() => {
      expect(adminApi.updateSystemSettings).toHaveBeenNthCalledWith(1, { registrationEnabled: true });
      expect(screen.getByText('Settings saved successfully')).toBeInTheDocument();
      expect(screen.getByText(/Public registration is enabled/)).toBeInTheDocument();
    });
    expect(timeoutCallbacks.length).toBeGreaterThan(0);

    act(() => {
      timeoutCallbacks.forEach((callback) => callback());
    });
    expect(screen.queryByText('Settings saved successfully')).not.toBeInTheDocument();

    fireEvent.click(getToggleButton());

    await waitFor(() => {
      expect(adminApi.updateSystemSettings).toHaveBeenNthCalledWith(2, { registrationEnabled: false });
      expect(clearTimeoutSpy).toHaveBeenCalled();
      expect(screen.getByText(/Public registration is disabled/)).toBeInTheDocument();
    });

    unmount();

    // cleanup path clears active success timeout on unmount
    expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(1);
    setTimeoutSpy.mockRestore();
  });

  it('covers runSave null path and save error rendering', async () => {
    vi.mocked(adminApi.getSystemSettings).mockResolvedValue({ registrationEnabled: true } as never);
    vi.mocked(adminApi.updateSystemSettings).mockRejectedValueOnce(new Error('Permission denied') as never);

    render(<AccessControlTab />);

    await waitFor(() => {
      expect(screen.getByText('Public Registration')).toBeInTheDocument();
      expect(screen.getByText(/Public registration is enabled/)).toBeInTheDocument();
    });

    fireEvent.click(getToggleButton());

    await waitFor(() => {
      expect(adminApi.updateSystemSettings).toHaveBeenCalledWith({ registrationEnabled: false });
      expect(screen.getByText('Permission denied')).toBeInTheDocument();
    });

    // registration state should remain unchanged when runSave returns null
    expect(screen.getByText(/Public registration is enabled/)).toBeInTheDocument();
    expect(screen.queryByText('Settings saved successfully')).not.toBeInTheDocument();
  });
});
