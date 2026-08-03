/**
 * Clipboard Utility Tests
 *
 * Tests for the clipboard copy functionality.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { copyToClipboard } from '../../src/utils/clipboard';

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('clipboard', () => {
  let originalClipboard: typeof navigator.clipboard;
  let originalExecCommand: typeof document.execCommand;

  beforeEach(() => {
    originalClipboard = navigator.clipboard;
    originalExecCommand = document.execCommand;
  });

  afterEach(() => {
    // Restore original implementations
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
    document.execCommand = originalExecCommand;
    vi.restoreAllMocks();
  });

  describe('copyToClipboard', () => {
    describe('modern API (navigator.clipboard)', () => {
      it('should use navigator.clipboard.writeText when available', async () => {
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: writeTextMock },
          writable: true,
          configurable: true,
        });

        const result = await copyToClipboard('test text');

        expect(writeTextMock).toHaveBeenCalledWith('test text');
        expect(result).toBe(true);
      });

      it('should return false when clipboard API fails', async () => {
        const writeTextMock = vi.fn().mockRejectedValue(new Error('Permission denied'));
        Object.defineProperty(navigator, 'clipboard', {
          value: { writeText: writeTextMock },
          writable: true,
          configurable: true,
        });

        const result = await copyToClipboard('test text');

        expect(result).toBe(false);
      });
    });

    describe('fallback (execCommand)', () => {
      it('should use execCommand fallback when clipboard API unavailable', async () => {
        // Remove clipboard API
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        const execCommandMock = vi.fn().mockReturnValue(true);
        document.execCommand = execCommandMock;

        // Mock document.createElement and related methods
        const mockTextArea = {
          value: '',
          style: {} as CSSStyleDeclaration,
          focus: vi.fn(),
          select: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockTextArea as unknown as HTMLElement);
        vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);
        vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);

        const result = await copyToClipboard('fallback text');

        expect(document.createElement).toHaveBeenCalledWith('textarea');
        expect(mockTextArea.value).toBe('fallback text');
        expect(mockTextArea.focus).toHaveBeenCalled();
        expect(mockTextArea.select).toHaveBeenCalled();
        expect(execCommandMock).toHaveBeenCalledWith('copy');
        expect(result).toBe(true);
      });

      it('should return false when execCommand fails', async () => {
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        document.execCommand = vi.fn().mockReturnValue(false);

        const mockTextArea = {
          value: '',
          style: {} as CSSStyleDeclaration,
          focus: vi.fn(),
          select: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockTextArea as unknown as HTMLElement);
        vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);
        vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);

        const result = await copyToClipboard('test');

        expect(result).toBe(false);
      });

      it('should position textarea offscreen', async () => {
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        document.execCommand = vi.fn().mockReturnValue(true);

        const mockTextArea = {
          value: '',
          style: {} as CSSStyleDeclaration,
          focus: vi.fn(),
          select: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockTextArea as unknown as HTMLElement);
        vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);
        vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);

        await copyToClipboard('test');

        expect(mockTextArea.style.position).toBe('fixed');
        expect(mockTextArea.style.left).toBe('-9999px');
        expect(mockTextArea.style.top).toBe('-9999px');
      });

      it('should clean up textarea after copy', async () => {
        Object.defineProperty(navigator, 'clipboard', {
          value: undefined,
          writable: true,
          configurable: true,
        });

        document.execCommand = vi.fn().mockReturnValue(true);

        const mockTextArea = {
          value: '',
          style: {} as CSSStyleDeclaration,
          focus: vi.fn(),
          select: vi.fn(),
        };
        vi.spyOn(document, 'createElement').mockReturnValue(mockTextArea as unknown as HTMLElement);
        const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);
        const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation(() => mockTextArea as unknown as HTMLElement);

        await copyToClipboard('test');

        expect(appendSpy).toHaveBeenCalledWith(mockTextArea);
        expect(removeSpy).toHaveBeenCalledWith(mockTextArea);
      });
    });

    describe('error handling', () => {
      it('should return false and log error on exception', async () => {
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: vi.fn().mockRejectedValue(new Error('Clipboard error')),
          },
          writable: true,
          configurable: true,
        });

        const result = await copyToClipboard('test');

        expect(result).toBe(false);
      });
    });
  });
});
