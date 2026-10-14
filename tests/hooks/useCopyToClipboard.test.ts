/**
 * useCopyToClipboard Hook Tests
 *
 * Tests for the clipboard hook that provides copy functionality with visual feedback.
 */

import { StrictMode } from 'react';
import { act,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useCopyToClipboard } from '../../src/hooks/useCopyToClipboard';

// Mock the clipboard utility
vi.mock('../../src/utils/clipboard', () => ({
  copyToClipboard: vi.fn(),
}));

import { copyToClipboard } from '../../src/utils/clipboard';

const mockCopyToClipboard = vi.mocked(copyToClipboard);

describe('useCopyToClipboard', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCopyToClipboard.mockReset();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should return copy function', () => {
      const { result } = renderHook(() => useCopyToClipboard());

      expect(typeof result.current.copy).toBe('function');
    });

    it('should return isCopied function', () => {
      const { result } = renderHook(() => useCopyToClipboard());

      expect(typeof result.current.isCopied).toBe('function');
    });

    it('should have null copiedText initially', () => {
      const { result } = renderHook(() => useCopyToClipboard());

      expect(result.current.copiedText).toBeNull();
    });

    it('should report isCopied as false initially', () => {
      const { result } = renderHook(() => useCopyToClipboard());

      expect(result.current.isCopied('any text')).toBe(false);
    });
  });

  describe('copy', () => {
    it('should call copyToClipboard with text', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('test text');
      });

      expect(mockCopyToClipboard).toHaveBeenCalledWith('test text');
    });

    it('should return true on successful copy', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      let success: boolean = false;
      await act(async () => {
        success = await result.current.copy('test text');
      });

      expect(success).toBe(true);
    });

    it('should return false on failed copy', async () => {
      mockCopyToClipboard.mockResolvedValue(false);
      const { result } = renderHook(() => useCopyToClipboard());

      let success: boolean = true;
      await act(async () => {
        success = await result.current.copy('test text');
      });

      expect(success).toBe(false);
    });

    it('should set copiedText on successful copy', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('test text');
      });

      expect(result.current.copiedText).toBe('test text');
    });

    it('should not set copiedText on failed copy', async () => {
      mockCopyToClipboard.mockResolvedValue(false);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('test text');
      });

      expect(result.current.copiedText).toBeNull();
    });
  });

  describe('isCopied', () => {
    it('should return true for copied text', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('copied text');
      });

      expect(result.current.isCopied('copied text')).toBe(true);
    });

    it('should return false for different text', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('copied text');
      });

      expect(result.current.isCopied('different text')).toBe(false);
    });
  });

  describe('reset delay', () => {
    it('should reset copiedText after default delay (2000ms)', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('test text');
      });

      expect(result.current.copiedText).toBe('test text');

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.copiedText).toBeNull();
    });

    it('should respect custom reset delay', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard(5000));

      await act(async () => {
        await result.current.copy('test text');
      });

      expect(result.current.copiedText).toBe('test text');

      // After 2000ms, should still be copied (custom delay is 5000ms)
      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(result.current.copiedText).toBe('test text');

      // After full 5000ms, should be reset
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.copiedText).toBeNull();
    });

    it('should update isCopied after reset', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard(1000));

      await act(async () => {
        await result.current.copy('test text');
      });

      expect(result.current.isCopied('test text')).toBe(true);

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.isCopied('test text')).toBe(false);
    });
  });

  describe('multiple copies', () => {
    it('should update copiedText for new copy', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('first text');
      });

      expect(result.current.copiedText).toBe('first text');

      await act(async () => {
        await result.current.copy('second text');
      });

      expect(result.current.copiedText).toBe('second text');
    });

    it('should correctly track isCopied for latest copy', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('first text');
      });

      await act(async () => {
        await result.current.copy('second text');
      });

      expect(result.current.isCopied('first text')).toBe(false);
      expect(result.current.isCopied('second text')).toBe(true);
    });
  });

  describe('reset timer lifecycle', () => {
    it('clears the pending reset timer on unmount', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result, unmount } = renderHook(() => useCopyToClipboard());

      await act(async () => {
        await result.current.copy('text');
      });
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('still shows copy feedback under StrictMode effect re-runs', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard(), { wrapper: StrictMode });

      await act(async () => {
        await result.current.copy('strict');
      });

      expect(result.current.copiedText).toBe('strict');
    });

    it('does not arm a reset timer when the copy settles after unmount', async () => {
      let settle: (value: boolean) => void = () => undefined;
      mockCopyToClipboard.mockReturnValue(new Promise<boolean>((resolve) => { settle = resolve; }));
      const { result, unmount } = renderHook(() => useCopyToClipboard());

      let pending: Promise<boolean> = Promise.resolve(false);
      act(() => {
        pending = result.current.copy('late');
      });
      unmount();
      settle(true);
      await expect(pending).resolves.toBe(true);

      expect(vi.getTimerCount()).toBe(0);
    });

    it('restarts the reset delay when a newer copy replaces the old one', async () => {
      mockCopyToClipboard.mockResolvedValue(true);
      const { result } = renderHook(() => useCopyToClipboard(2000));

      await act(async () => {
        await result.current.copy('first');
      });
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      await act(async () => {
        await result.current.copy('second');
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.copiedText).toBe('second');
      expect(vi.getTimerCount()).toBe(1);
    });
  });
});
