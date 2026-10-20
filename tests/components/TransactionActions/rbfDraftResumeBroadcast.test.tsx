/**
 * An RBF draft resumed from the drafts list must broadcast with the metadata
 * the server checks (rbf-draft--multi-recipient-amount-recipient-mismatch):
 * `recipient` is `state.outputs[0].address` and `amount` the draft's
 * effective amount, compared with the first external output and the sum of
 * every external output of the replacement intent.
 *
 * Chains the real pieces: rbfDraftRequest -> stored draft -> resumed wizard
 * state and txData -> useBroadcast's request body.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  broadcastTransaction: vi.fn(),
  format: vi.fn((sats: number) => `${sats} sats`),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({ showSuccess: vi.fn(), showWarning: vi.fn() }),
}));
vi.mock('../../../src/hooks/useNotificationSound', () => ({
  useNotificationSound: () => ({ playEventSound: vi.fn() }),
}));
vi.mock('../../../src/contexts/CurrencyContext', () => ({
  useCurrency: () => ({ format: mocks.format }),
  usePriceFreeFormatter: () => ({ format: mocks.format, unit: 'sats' }),
}));
vi.mock('../../../src/api/transactions', () => ({ broadcastTransaction: mocks.broadcastTransaction }));
vi.mock('../../../src/providers/QueryProvider', () => ({
  queryClient: { refetchQueries: vi.fn().mockResolvedValue(undefined), invalidateQueries: vi.fn() },
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mocks.logger }));

import { useBroadcast } from '../../../src/hooks/send/useBroadcast';
import { rbfDraftRequest } from '../../../src/components/TransactionActions/transactionActionsData';
import { createDraftInitialTxData } from '../../../src/components/send/SendTransactionWizard/draftTransactionData';
import {
  buildDraftTxData,
  buildInitialState,
} from '../../../src/components/send/SendTransactionPage/sendTransactionPageHelpers';
import type { RBFTransactionResponse } from '../../../src/api/bitcoin';
import type { DraftTransaction } from '../../../src/api/drafts';
import type { TransactionState } from '../../../src/contexts/send/types';

const txid = 'a'.repeat(64);

const baseResult: RBFTransactionResponse = {
  psbtBase64: 'cHNidP8rbf',
  signingContext: {} as RBFTransactionResponse['signingContext'],
  intentId: 'intent-rbf',
  intentDigest: 'b'.repeat(64),
  fee: 2000,
  feeRate: 20,
  feeDelta: 1000,
  inputs: [{ txid: 'c'.repeat(64), vout: 0, value: 200000 }],
  outputs: [],
  recipient: null,
  amount: null,
};

/** The draft the server stores and returns for the request (outputs keep their order). */
const storedDraft = (result: RBFTransactionResponse): DraftTransaction => {
  const { replacesTxid: _replacesTxid, ...request } = rbfDraftRequest({
    originalLabel: 'bump',
    rbfStatus: { replaceable: true, currentFeeRate: 10 },
    result,
    txid,
  });
  return {
    id: 'draft-rbf',
    walletId: 'wallet-1',
    userId: 'user-1',
    recipient: request.recipient,
    amount: Number(request.amount),
    feeRate: Number(request.feeRate),
    selectedUtxoIds: request.selectedUtxoIds ?? [],
    enableRBF: true,
    subtractFees: false,
    sendMax: false,
    isRBF: true,
    outputs: (request.outputs ?? []).map(output => ({ address: output.address, amount: Number(output.amount) })),
    psbtBase64: request.psbtBase64,
    signingIntentId: request.intentId,
    signingIntentDigest: request.intentDigest,
    signedPsbtBase64: 'signed-psbt',
    fee: Number(request.fee),
    totalInput: Number(request.totalInput),
    totalOutput: Number(request.totalOutput),
    changeAmount: Number(request.changeAmount),
    changeAddress: request.changeAddress,
    effectiveAmount: Number(request.effectiveAmount),
    inputPaths: [],
    status: 'signed',
    signedDeviceIds: ['device-1'],
    createdAt: '2026-10-17T00:00:00.000Z',
    updatedAt: '2026-10-17T00:00:00.000Z',
  } as DraftTransaction;
};

const resumeAndBroadcast = async (result: RBFTransactionResponse) => {
  const draft = storedDraft(result);
  const state = buildInitialState({
    draftData: draft,
    utxos: [],
    addresses: [],
    showInfo: vi.fn(),
    walletType: 'single_sig',
  }) as unknown as TransactionState;
  const txData = createDraftInitialTxData({ draftTxData: buildDraftTxData(draft), state, utxos: [] });
  expect(txData).not.toBeNull();

  const controller = new AbortController();
  const { result: hook } = renderHook(() => useBroadcast({
    walletId: 'wallet-1',
    wallet: { id: 'wallet-1', type: 'single_sig', name: 'Primary Wallet' } as Parameters<typeof useBroadcast>[0]['wallet'],
    state,
    txData,
    unsignedPsbt: state.unsignedPsbt,
    signedRawTx: null,
    setIsBroadcasting: vi.fn(),
    setError: vi.fn(),
    setApprovalAction: vi.fn(),
    beginBroadcast: () => ({ signal: controller.signal, isCurrent: () => true }),
  }));
  let ok = false;
  await act(async () => {
    ok = await hook.current.broadcastTransaction();
  });
  expect(ok).toBe(true);
  return mocks.broadcastTransaction.mock.calls[0][1];
};

describe('resumed RBF draft broadcast body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.broadcastTransaction.mockResolvedValue({ txid: 'f'.repeat(64), broadcasted: true, persistenceStatus: 'complete' });
  });

  it('carries the canonical recipient and summed amount of a multi-recipient replacement', async () => {
    const body = await resumeAndBroadcast({
      ...baseResult,
      outputs: [
        { address: 'bc1qfirst', value: 40000, isChange: false },
        { address: 'bc1qsecond', value: 30000, isChange: false },
        { address: 'bc1qchange', value: 128000, isChange: true },
      ],
      recipient: 'bc1qfirst',
      amount: 70000,
    });

    expect(body).toMatchObject({ draftId: 'draft-rbf', recipient: 'bc1qfirst', amount: 70000, fee: 2000 });
  });

  it('carries the external recipient when the wallet\'s own receive output comes first', async () => {
    const body = await resumeAndBroadcast({
      ...baseResult,
      outputs: [
        { address: 'bc1qownreceive', value: 10000, isChange: false },
        { address: 'bc1qexternal', value: 40000, isChange: false },
        { address: 'bc1qchange', value: 148000, isChange: true },
      ],
      recipient: 'bc1qexternal',
      amount: 40000,
    });

    expect(body).toMatchObject({ recipient: 'bc1qexternal', amount: 40000 });
  });

  it('still builds and broadcasts a resumed consolidation bump unchanged', async () => {
    const body = await resumeAndBroadcast({
      ...baseResult,
      outputs: [
        { address: 'bc1qownreceive', value: 150000, isChange: false },
        { address: 'bc1qchange', value: 48000, isChange: true },
      ],
    });

    expect(body).toMatchObject({
      recipient: 'bc1qownreceive',
      amount: 150000,
      fee: 2000,
      utxos: [{ txid: 'c'.repeat(64), vout: 0, address: '', amount: 0 }],
      intentId: 'intent-rbf',
      intentDigest: 'b'.repeat(64),
    });
  });
});
