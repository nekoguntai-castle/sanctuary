import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportFormat } from '../../../src/components/ImportWallet/importHelpers';
import { useDescriptorInputHandlers } from '../../../src/components/ImportWallet/steps/useDescriptorInputHandlers';

const readers: ControlledReader[] = [];
class ControlledReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { readers.push(this); }
  readAsText() {}
  resolve(text: string) { this.onload?.({ target: { result: text } }); }
  reject() { this.onerror?.(); }
}
const upload = (name = 'wallet.txt') => ({ target: { files: [new File(['data'], name)], value: name } }) as unknown as ChangeEvent<HTMLInputElement>;
function setup() {
  const props = { format: 'descriptor' as const, setImportData: vi.fn(), setValidationError: vi.fn(), resetValidation: vi.fn() };
  return { ...renderHook(() => useDescriptorInputHandlers(props)), ...props };
}
beforeEach(() => { readers.length = 0; vi.stubGlobal('FileReader', ControlledReader); });
afterEach(() => vi.unstubAllGlobals());
describe('descriptor file ownership', () => {
  it('invalidates validation immediately even when the selected file is rejected', () => {
    const { result, resetValidation } = setup();
    act(() => result.current.handleFileUpload(upload('wrong.exe')));
    expect(resetValidation).toHaveBeenCalledOnce();
    expect(readers).toHaveLength(0);
  });
  it('keeps the newest file when reads finish in reverse order', () => {
    const { result, setImportData, resetValidation } = setup();
    act(() => result.current.handleFileUpload(upload()));
    expect(resetValidation).toHaveBeenCalledOnce();
    act(() => result.current.handleFileUpload(upload()));
    act(() => readers[1].resolve('wpkh(B)'));
    act(() => readers[0].resolve('wpkh(A)'));
    expect(setImportData.mock.calls).toEqual([[''], [''], ['wpkh(B)']]);
  });
  it('invalidates a pending file when its format changes', () => {
    const setImportData = vi.fn();
    const setValidationError = vi.fn();
    const { result, rerender } = renderHook(({ format }) => useDescriptorInputHandlers({
      format, setImportData, setValidationError, resetValidation: vi.fn(),
    }), { initialProps: { format: 'descriptor' as ImportFormat } });
    act(() => result.current.handleFileUpload(upload()));
    rerender({ format: 'json' });
    setImportData.mockClear();
    act(() => readers[0].resolve('wpkh(old)'));
    expect(setImportData).not.toHaveBeenCalled();
  });
  it.each(['text', 'rejected-file', 'unmount'] as const)('rejects old read success and failure after %s', action => {
    const { result, setImportData, setValidationError, unmount } = setup();
    act(() => result.current.handleFileUpload(upload()));
    if (action === 'text') act(() => result.current.handleTextChange('wpkh(typed)'));
    else if (action === 'rejected-file') act(() => result.current.handleFileUpload(upload('wrong.exe')));
    else unmount();
    setImportData.mockClear();
    setValidationError.mockClear();
    act(() => { readers[0].resolve('wpkh(old)'); readers[0].reject(); });
    expect(setImportData).not.toHaveBeenCalled();
    expect(setValidationError).not.toHaveBeenCalled();
  });
});
