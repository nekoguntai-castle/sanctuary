import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTransactionComposition } from '../../../components/send/steps/OutputsStep/hooks/useTransactionComposition';
import * as txApi from '../../../src/api/transactions';

vi.mock('../../../src/api/transactions', () => ({
  analyzeSpendPrivacy: vi.fn(),
  getWalletPrivacy: vi.fn(),
}));

type HookInput = Parameters<typeof useTransactionComposition>[0];

function makeInput(overrides: Partial<HookInput> = {}): HookInput {
  return {
    walletId: 'wallet-1',
    utxos: [],
    spendableUtxos: [],
    showCoinControl: false,
    selectedUTXOs: new Set<string>(),
    selectedTotal: 0,
    estimatedFee: 0,
    totalOutputAmount: 0,
    feeRate: 0,
    fees: null,
    outputs: [{ amount: '0', sendMax: false }],
    ...overrides,
  };
}

describe('useTransactionComposition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(txApi.getWalletPrivacy).mockResolvedValue({ utxos: [] } as never);
    vi.mocked(txApi.analyzeSpendPrivacy).mockResolvedValue({ score: 80 } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('groups UTXOs and computes balances, max values, and warning branches', async () => {
    const input = makeInput({
      utxos: [
        { id: 'spent', amount: 10, spent: true } as any,
        { id: 'frozen', amount: 100, frozen: true } as any,
        { id: 'locked', amount: 200, lockedByDraftId: 'd1' } as any,
        { id: 'unspendable', amount: 300, spendable: false } as any,
        { id: 'available', amount: 400 } as any,
      ],
      spendableUtxos: [{ amount: 1000 } as any, { amount: 500 } as any],
      estimatedFee: 100,
      totalOutputAmount: 500,
      feeRate: 30,
      fees: { hourFee: 10 },
      outputs: [
        { amount: '200', sendMax: false },
        { amount: 'abc', sendMax: false },
        { amount: '999', sendMax: true },
      ],
    });

    const { result } = renderHook(() => useTransactionComposition(input));

    await waitFor(() => expect(txApi.getWalletPrivacy).toHaveBeenCalledWith('wallet-1'));

    expect(result.current.available).toHaveLength(1);
    expect(result.current.manuallyFrozen).toHaveLength(1);
    expect(result.current.draftLocked).toHaveLength(2);
    expect(result.current.effectiveAvailable).toBe(1500);
    expect(result.current.maxSendable).toBe(1400);
    expect(result.current.calculateMaxForOutput(0)).toBe(1400);
    expect(result.current.calculateMaxForOutput(1)).toBe(1200);
    expect(result.current.remainingNeeded).toBe(0);
    expect(result.current.feeWarnings).toEqual([
      'Fee is 20.0% of the amount being sent',
      'Fee rate (30 sat/vB) is 3.0x the economy rate (10 sat/vB)',
    ]);
  });

  it('uses selected UTXOs for coin control, floors max values at zero, and emits no warnings for low/no fees', async () => {
    const { result } = renderHook(() =>
      useTransactionComposition(
        makeInput({
          showCoinControl: true,
          selectedUTXOs: new Set(['u1']),
          selectedTotal: 50,
          estimatedFee: 100,
          totalOutputAmount: 25,
          outputs: [{ amount: '25', sendMax: false }],
        })
      )
    );

    await waitFor(() => expect(txApi.getWalletPrivacy).toHaveBeenCalled());

    expect(result.current.effectiveAvailable).toBe(50);
    expect(result.current.maxSendable).toBe(0);
    expect(result.current.calculateMaxForOutput(0)).toBe(0);
    expect(result.current.remainingNeeded).toBe(75);
    expect(result.current.feeWarnings).toEqual([
      'Fee is 400.0% of the amount being sent',
    ]);
  });

  it('covers low-fee percentage path and economy-rate fallbacks (minimumFee and default)', async () => {
    const { result: withMinimum } = renderHook(() =>
      useTransactionComposition(
        makeInput({
          totalOutputAmount: 1000,
          estimatedFee: 50, // 5% (no percentage warning)
          feeRate: 11,
          fees: { minimumFee: 5 }, // hourFee missing -> minimumFee fallback
        })
      )
    );

    await waitFor(() => expect(txApi.getWalletPrivacy).toHaveBeenCalled());
    expect(withMinimum.current.feeWarnings).toEqual([
      'Fee rate (11 sat/vB) is 2.2x the economy rate (5 sat/vB)',
    ]);

    const { result: withDefaultSlowRate } = renderHook(() =>
      useTransactionComposition(
        makeInput({
          totalOutputAmount: 1000,
          estimatedFee: 10, // 1%
          feeRate: 3,
          fees: {}, // hourFee + minimumFee missing -> default 1
        })
      )
    );

    await waitFor(() => expect(txApi.getWalletPrivacy).toHaveBeenCalledTimes(2));
    expect(withDefaultSlowRate.current.feeWarnings).toEqual([
      'Fee rate (3 sat/vB) is 3.0x the economy rate (1 sat/vB)',
    ]);

    const { result: atThreshold } = renderHook(() =>
      useTransactionComposition(
        makeInput({
          totalOutputAmount: 1000,
          estimatedFee: 10,
          feeRate: 20, // exactly 2x
          fees: { hourFee: 10 },
        })
      )
    );

    await waitFor(() => expect(txApi.getWalletPrivacy).toHaveBeenCalledTimes(3));
    expect(atThreshold.current.feeWarnings).toEqual([]);
  });

  it('loads privacy map and runs debounced privacy analysis; then clears analysis when coin control is turned off', async () => {
    vi.useFakeTimers();
    vi.mocked(txApi.getWalletPrivacy).mockResolvedValue({
      utxos: [{ txid: 'privacy-tx', vout: 2, score: 70 }],
    } as never);
    vi.mocked(txApi.analyzeSpendPrivacy).mockResolvedValue({ score: 77 } as never);

    const { result, rerender } = renderHook(
      (props: HookInput) => useTransactionComposition(props),
      {
        initialProps: makeInput({
          showCoinControl: true,
          selectedUTXOs: new Set(['txid-a:0']),
          selectedTotal: 1000,
        }),
      }
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(txApi.getWalletPrivacy).toHaveBeenCalledWith('wallet-1');
    expect(result.current.utxoPrivacyMap.get('privacy-tx:2')).toMatchObject({ txid: 'privacy-tx', vout: 2 });
    expect(txApi.analyzeSpendPrivacy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });
    expect(txApi.analyzeSpendPrivacy).toHaveBeenCalledWith('wallet-1', ['txid-a:0']);
    expect(result.current.privacyAnalysis).toEqual({ score: 77 });
    expect(result.current.privacyLoading).toBe(false);

    await act(async () => {
      rerender(
        makeInput({
          showCoinControl: false,
          selectedUTXOs: new Set(['txid-a:0']),
          selectedTotal: 1000,
        })
      );
      await Promise.resolve();
    });
    expect(result.current.privacyAnalysis).toBeNull();
  });

  it('handles privacy API failures without throwing and resets loading state', async () => {
    vi.useFakeTimers();
    vi.mocked(txApi.getWalletPrivacy).mockRejectedValue(new Error('privacy map failed'));
    vi.mocked(txApi.analyzeSpendPrivacy).mockRejectedValue(new Error('privacy analysis failed'));

    const { result } = renderHook(() =>
      useTransactionComposition(
        makeInput({
          showCoinControl: true,
          selectedUTXOs: new Set(['txid-b:1']),
          selectedTotal: 500,
        })
      )
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(301);
    });

    expect(txApi.analyzeSpendPrivacy).toHaveBeenCalledWith('wallet-1', ['txid-b:1']);
    expect(result.current.privacyAnalysis).toBeNull();
    expect(result.current.privacyLoading).toBe(false);
    expect(result.current.utxoPrivacyMap.size).toBe(0);
  });
});
