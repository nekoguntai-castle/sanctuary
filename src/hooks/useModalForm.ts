/**
 * useModalForm - Reusable hook for modal form state management
 *
 * Combines form field state, loading state, error state, and submit handling
 * into a single hook to reduce boilerplate in modal components.
 *
 * @example
 * const { values, error, isSubmitting, setField, handleSubmit, reset } = useModalForm({
 *   initialValues: { username: '', password: '', isAdmin: false },
 *   onSubmit: async (values) => { await createUser(values); },
 *   onSuccess: () => { onClose(); },
 * });
 */

import { useState, useCallback, useRef } from 'react';
import { extractErrorMessage } from '../utils/errorHandler';

interface UseModalFormOptions<T extends Record<string, unknown>> {
  initialValues: T;
  onSubmit: (values: T) => Promise<void>;
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
  resetOnSuccess?: boolean;
}

interface UseModalFormReturn<T extends Record<string, unknown>> {
  values: T;
  error: string | null;
  isSubmitting: boolean;
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  setValues: (values: Partial<T>) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
  reset: () => void;
}

export function useModalForm<T extends Record<string, unknown>>(
  options: UseModalFormOptions<T>
): UseModalFormReturn<T> {
  const { initialValues, onSubmit, onSuccess, onError, resetOnSuccess = true } = options;

  const [values, setValuesState] = useState<T>(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setValuesState(prev => ({ ...prev, [field]: value }));
    setError(null);
  }, []);

  const setValues = useCallback((partial: Partial<T>) => {
    setValuesState(prev => ({ ...prev, ...partial }));
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setValuesState(initialValues);
    setError(null);
    setIsSubmitting(false);
  }, [initialValues]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setIsSubmitting(true);
    try {
      await onSubmit(values);
      if (resetOnSuccess) reset();
      onSuccess?.();
    } catch (err) {
      setError(extractErrorMessage(err));
      onError?.(err);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [values, onSubmit, onSuccess, onError, reset, resetOnSuccess]);

  return { values, error, isSubmitting, setField, setValues, handleSubmit, reset };
}
