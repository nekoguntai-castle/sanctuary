import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportWalletFooter } from '../../../src/components/ImportWallet/ImportWalletFooter';
import { useImportState } from '../../../src/components/ImportWallet/hooks/useImportState';
import { useImportWalletActions } from '../../../src/components/ImportWallet/useImportWalletActions';
import * as walletsApi from '../../../src/api/wallets';
import type { TabNetwork } from '../../../src/app/networks';
import type { ImportValidationResult } from '../../../src/api/wallets';

vi.mock('../../../src/api/wallets', () => ({ validateImport: vi.fn() }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const valid = { valid: true, network: 'mainnet', suggestedName: 'A suggestion' } as ImportValidationResult;
function setup() {
  const mutateAsync = vi.fn().mockResolvedValue({ wallet: { id: 'new-wallet' } });
  const navigate = vi.fn();
  const hook = renderHook(({ network }) => {
    const state = useImportState(network);
    return { state, actions: useImportWalletActions({ state, importWalletMutation: { mutateAsync }, navigate }) };
  }, { initialProps: { network: 'mainnet' as TabNetwork } });
  act(() => {
    hook.result.current.state.setFormat('descriptor');
    hook.result.current.state.setImportData('descriptor A');
    hook.result.current.state.setStep(2);
  });
  return { ...hook, mutateAsync, navigate };
}
beforeEach(() => { vi.resetAllMocks(); });
describe('import input ownership', () => {
  it.each(['success', 'error'] as const)('ignores A validation %s after B starts without clearing its spinner', async outcome => {
    const a = deferred<ImportValidationResult>();
    const b = deferred<ImportValidationResult>();
    vi.mocked(walletsApi.validateImport).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { result, mutateAsync } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.actions.handleNext(); });
    act(() => { result.current.state.setImportData('descriptor B'); });
    act(() => { second = result.current.actions.handleNext(); });
    await act(async () => {
      if (outcome === 'success') a.resolve(valid);
      else a.reject(new Error('retired A'));
      await first;
    });
    expect(result.current.state.step).toBe(2);
    expect(result.current.state.validationResult).toBeNull();
    expect(result.current.state.validationError).toBeNull();
    expect(result.current.state.walletName).toBe('');
    expect(result.current.state.isValidating).toBe(true);
    await act(async () => { b.resolve({ ...valid, suggestedName: 'B suggestion' }); await second; });
    expect(result.current.state.step).toBe(3);
    await act(async () => { await result.current.actions.handleNext(); });
    await act(async () => { await result.current.actions.handleImport(); });
    expect(mutateAsync).toHaveBeenCalledWith({ data: 'descriptor B', name: 'B suggestion', network: 'mainnet' });
  });

  it('does not revive review when an input edit is queued between validation continuations', async () => {
    const pending = deferred<ImportValidationResult>();
    vi.mocked(walletsApi.validateImport).mockReturnValueOnce(pending.promise);
    const { result } = setup();
    let request!: Promise<void>;
    act(() => { request = result.current.actions.handleNext(); });
    await act(async () => {
      pending.resolve(valid);
      queueMicrotask(() => queueMicrotask(() => result.current.state.setImportData('descriptor B')));
      await request;
    });
    expect(result.current.state.step).toBe(2);
    expect(result.current.state.validationResult).toBeNull();
  });

  it.each(['roundtrip', 'back', 'format', 'network', 'unmount'] as const)('invalidates pending validation on %s', async change => {
    const pending = deferred<ImportValidationResult>();
    vi.mocked(walletsApi.validateImport).mockReturnValueOnce(pending.promise);
    const { result, rerender, unmount, mutateAsync } = setup();
    let request!: Promise<void>;
    act(() => { request = result.current.actions.handleNext(); });
    act(() => {
      if (change === 'roundtrip') {
        result.current.state.setImportData('descriptor B');
        result.current.state.setImportData('descriptor A');
      } else if (change === 'back') result.current.actions.handleBack();
      else if (change === 'format') result.current.state.setFormat('json');
    });
    if (change === 'network') rerender({ network: 'signet' });
    if (change === 'unmount') unmount();
    await act(async () => { pending.resolve(valid); await request; });
    expect(result.current.state.validationResult).toBeNull();
    expect(result.current.state.walletName).toBe('');
    expect(mutateAsync).not.toHaveBeenCalled();
    if (change !== 'unmount') expect(result.current.state.isValidating).toBe(false);
  });

  it('preserves an accepted snapshot when returning from review to naming', async () => {
    vi.mocked(walletsApi.validateImport).mockResolvedValue(valid);
    const { result, mutateAsync } = setup();
    await act(async () => { await result.current.actions.handleNext(); });
    await act(async () => { await result.current.actions.handleNext(); });
    act(() => result.current.actions.handleBack());
    expect(result.current.state.step).toBe(3);
    expect(result.current.state.validationResult).toEqual(valid);
    await act(async () => { await result.current.actions.handleNext(); });
    await act(async () => { await result.current.actions.handleImport(); });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ data: 'descriptor A' }));
  });

  it.each([3, 4])('returns step %i to input and rejects a retained import action after editing', async step => {
    vi.mocked(walletsApi.validateImport).mockResolvedValue(valid);
    const { result, mutateAsync, navigate } = setup();
    await act(async () => { await result.current.actions.handleNext(); });
    if (step === 4) await act(async () => { await result.current.actions.handleNext(); });
    expect(result.current.state.step).toBe(step);
    expect(result.current.state.validatedInput).not.toBeNull();
    const retainedImport = result.current.actions.handleImport;

    act(() => result.current.state.setImportData('descriptor B'));
    expect(result.current.state.step).toBe(2);
    expect(result.current.state.validatedInput).toBeNull();
    expect(result.current.state.validationResult).toBeNull();
    await act(async () => { await retainedImport(); });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.state.isImporting).toBe(false);
  });

  it('clears the accepted snapshot when returning from naming to input', async () => {
    vi.mocked(walletsApi.validateImport).mockResolvedValue(valid);
    const { result } = setup();
    await act(async () => { await result.current.actions.handleNext(); });
    expect(result.current.state.validatedInput).not.toBeNull();
    act(() => result.current.actions.handleBack());
    expect(result.current.state.step).toBe(2);
    expect(result.current.state.validatedInput).toBeNull();
    expect(result.current.state.validationResult).toBeNull();
  });

  it('rejects import without an accepted snapshot even when review fields are populated', async () => {
    const { result, mutateAsync, navigate } = setup();
    act(() => {
      result.current.state.setValidationResult(valid);
      result.current.state.setWalletName('Unvalidated wallet');
      result.current.state.setStep(4);
    });
    expect(result.current.state.validatedInput).toBeNull();
    await act(async () => { await result.current.actions.handleImport(); });
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(result.current.state.isImporting).toBe(false);
  });

  it.each(['absent', 'stale'] as const)('disables import for an %s accepted snapshot', async snapshotState => {
    vi.mocked(walletsApi.validateImport).mockResolvedValue(valid);
    const { result } = setup();
    await act(async () => { await result.current.actions.handleNext(); });
    await act(async () => { await result.current.actions.handleNext(); });
    const acceptedState = result.current.state;
    const onImport = vi.fn();
    const onNext = vi.fn();
    const footer = render(<ImportWalletFooter state={acceptedState} onImport={onImport} onNext={onNext} />);
    expect(screen.getByRole('button', { name: /Import Wallet/i })).toBeEnabled();

    if (snapshotState === 'stale') act(() => result.current.state.setImportData('descriptor B'));
    footer.rerender(<ImportWalletFooter
      state={snapshotState === 'absent' ? { ...acceptedState, validatedInput: null } : acceptedState}
      onImport={onImport}
      onNext={onNext}
    />);
    const button = screen.getByRole('button', { name: /Import Wallet/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('does not accept a validation snapshot after another input takes ownership', () => {
    const { result } = setup();
    let snapshot!: ReturnType<typeof result.current.state.beginValidation>;
    act(() => { snapshot = result.current.state.beginValidation(); });
    act(() => result.current.state.setImportData('descriptor B'));
    act(() => result.current.state.acceptValidation(snapshot, valid));
    expect(result.current.state.validatedInput).toBeNull();
    expect(result.current.state.validationResult).toBeNull();
  });

  it.each([null, { ...valid, valid: false }])('does not retain an importable snapshot for rejected validation %j', rejection => {
    const { result } = setup();
    act(() => {
      const snapshot = result.current.state.beginValidation();
      result.current.state.acceptValidation(snapshot, rejection);
    });
    expect(result.current.state.validatedInput).toBeNull();
  });

  it('validates and imports the explicit hardware-generated descriptor', async () => {
    vi.mocked(walletsApi.validateImport).mockResolvedValue(valid);
    const { result, mutateAsync } = setup();
    act(() => {
      result.current.state.setFormat('hardware');
      result.current.state.setXpubData({ xpub: 'xpub-test', fingerprint: '12345678', path: "m/84'/0'/0'" });
    });
    await act(async () => { await result.current.actions.handleNext(); });
    const descriptor = vi.mocked(walletsApi.validateImport).mock.calls[0][0].descriptor;
    expect(descriptor).toContain('xpub-test');
    expect(result.current.state.step).toBe(3);
    await act(async () => { await result.current.actions.handleNext(); });
    await act(async () => { await result.current.actions.handleImport(); });
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ data: descriptor }));
  });

  it.each(['script', 'account', 'device', 'xpub'] as const)('invalidates hardware validation when %s changes', async change => {
    const pending = deferred<ImportValidationResult>();
    vi.mocked(walletsApi.validateImport).mockReturnValueOnce(pending.promise);
    const { result } = setup();
    act(() => {
      result.current.state.setFormat('hardware');
      result.current.state.setXpubData({ xpub: 'xpub-test', fingerprint: '12345678', path: "m/84'/0'/0'" });
    });
    let request!: Promise<void>;
    act(() => { request = result.current.actions.handleNext(); });
    act(() => {
      if (change === 'script') result.current.state.setScriptType('nested_segwit');
      else if (change === 'account') result.current.state.setAccountIndex(1);
      else if (change === 'device') result.current.state.setHardwareDeviceType('trezor');
      else result.current.state.setXpubData(null);
    });
    await act(async () => { pending.resolve(valid); await request; });
    expect(result.current.state.step).toBe(2);
    expect(result.current.state.validationResult).toBeNull();
    expect(result.current.state.walletName).toBe('');
  });
});
