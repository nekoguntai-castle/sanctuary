/**
 * useModalForm Hook Tests
 *
 * Tests for the modal form state management hook that handles form field state,
 * loading state, error handling, submit with double-submit prevention, and reset.
 */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModalForm } from '../../hooks/useModalForm';

vi.mock('../../utils/errorHandler', () => ({
  extractErrorMessage: vi.fn((err: unknown) => err instanceof Error ? err.message : String(err)),
}));

interface TestFormValues extends Record<string, unknown> {
  username: string;
  email: string;
  isAdmin: boolean;
}

const defaultInitialValues: TestFormValues = {
  username: '',
  email: '',
  isAdmin: false,
};

describe('useModalForm', () => {
  let mockOnSubmit: ReturnType<typeof vi.fn<(values: TestFormValues) => Promise<void>>>;
  let mockOnSuccess: ReturnType<typeof vi.fn<() => void>>;
  let mockOnError: ReturnType<typeof vi.fn<(error: unknown) => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit = vi.fn().mockResolvedValue(undefined);
    mockOnSuccess = vi.fn();
    mockOnError = vi.fn();
  });

  describe('Initial State', () => {
    it('should have values matching initialValues', () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      expect(result.current.values).toEqual(defaultInitialValues);
    });

    it('should have error as null initially', () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      expect(result.current.error).toBeNull();
    });

    it('should have isSubmitting as false initially', () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      expect(result.current.isSubmitting).toBe(false);
    });
  });

  describe('setField', () => {
    it('should update a single field', () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      act(() => {
        result.current.setField('username', 'alice');
      });

      expect(result.current.values.username).toBe('alice');
      expect(result.current.values.email).toBe('');
      expect(result.current.values.isAdmin).toBe(false);
    });

    it('should clear error when setting a field', async () => {
      mockOnSubmit.mockRejectedValueOnce(new Error('submit failed'));

      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      // Trigger an error first
      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.error).toBe('submit failed');

      // setField should clear the error
      act(() => {
        result.current.setField('username', 'bob');
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('setValues', () => {
    it('should update multiple fields at once', () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      act(() => {
        result.current.setValues({ username: 'charlie', isAdmin: true });
      });

      expect(result.current.values.username).toBe('charlie');
      expect(result.current.values.email).toBe('');
      expect(result.current.values.isAdmin).toBe(true);
    });

    it('should clear error when setting values', async () => {
      mockOnSubmit.mockRejectedValueOnce(new Error('submit failed'));

      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.error).toBe('submit failed');

      act(() => {
        result.current.setValues({ email: 'test@example.com' });
      });

      expect(result.current.error).toBeNull();
    });
  });

  describe('handleSubmit', () => {
    it('should call onSubmit with current values', async () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      act(() => {
        result.current.setField('username', 'dave');
      });

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'dave', email: '', isAdmin: false })
      );
    });

    it('should call onSuccess after successful submit', async () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
          onSuccess: mockOnSuccess,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(mockOnSuccess).toHaveBeenCalledTimes(1);
    });

    it('should reset values on success when resetOnSuccess is true (default)', async () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      act(() => {
        result.current.setField('username', 'eve');
        result.current.setField('email', 'eve@example.com');
      });

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.values).toEqual(defaultInitialValues);
    });

    it('should NOT reset values on success when resetOnSuccess is false', async () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
          resetOnSuccess: false,
        })
      );

      act(() => {
        result.current.setField('username', 'frank');
      });

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.values.username).toBe('frank');
    });

    it('should set error on failure and call onError', async () => {
      const submitError = new Error('Network error');
      mockOnSubmit.mockRejectedValueOnce(submitError);

      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
          onError: mockOnError,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.error).toBe('Network error');
      expect(mockOnError).toHaveBeenCalledTimes(1);
      expect(mockOnError).toHaveBeenCalledWith(submitError);
    });

    it('should set isSubmitting false after error', async () => {
      mockOnSubmit.mockRejectedValueOnce(new Error('fail'));

      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.isSubmitting).toBe(false);
    });

    it('should prevent default on form event', async () => {
      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      const mockEvent = { preventDefault: vi.fn() } as unknown as React.FormEvent;

      await act(async () => {
        await result.current.handleSubmit(mockEvent);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('should prevent double submit when called twice rapidly', async () => {
      let resolveSubmit: () => void;
      mockOnSubmit.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveSubmit = resolve;
          })
      );

      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      // Fire two submits without awaiting the first
      let firstSubmit: Promise<void>;
      let secondSubmit: Promise<void>;

      act(() => {
        firstSubmit = result.current.handleSubmit();
        secondSubmit = result.current.handleSubmit();
      });

      // Resolve the pending submit
      await act(async () => {
        resolveSubmit!();
        await firstSubmit!;
        await secondSubmit!;
      });

      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('reset', () => {
    it('should restore initial values and clear error', async () => {
      mockOnSubmit.mockRejectedValueOnce(new Error('error'));

      const { result } = renderHook(() =>
        useModalForm({
          initialValues: defaultInitialValues,
          onSubmit: mockOnSubmit,
        })
      );

      // Modify values and trigger an error
      act(() => {
        result.current.setField('username', 'grace');
        result.current.setField('email', 'grace@example.com');
      });

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.values.username).toBe('grace');
      expect(result.current.error).toBe('error');

      // Reset should restore everything
      act(() => {
        result.current.reset();
      });

      expect(result.current.values).toEqual(defaultInitialValues);
      expect(result.current.error).toBeNull();
      expect(result.current.isSubmitting).toBe(false);
    });
  });
});
