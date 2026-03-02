import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useImportState } from '../../../../components/ImportWallet/hooks/useImportState';

describe('useImportState', () => {
  it('resets validation state via resetValidation', () => {
    const { result } = renderHook(() => useImportState());

    act(() => {
      result.current.setValidationResult({
        walletNameSuggestion: 'Imported Wallet',
      } as any);
      result.current.setValidationError('validation failed');
    });

    expect(result.current.validationResult).not.toBeNull();
    expect(result.current.validationError).toBe('validation failed');

    act(() => {
      result.current.resetValidation();
    });

    expect(result.current.validationResult).toBeNull();
    expect(result.current.validationError).toBeNull();
  });
});
