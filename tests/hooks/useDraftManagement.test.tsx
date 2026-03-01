import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  showSuccess: vi.fn(),
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock('../../hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    showSuccess: mocks.showSuccess,
  }),
}));

vi.mock('../../src/api/drafts', () => ({
  createDraft: mocks.createDraft,
  updateDraft: mocks.updateDraft,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import { ApiError } from '../../src/api/client';
import { useDraftManagement } from '../../hooks/send/useDraftManagement';

const baseTxData = {
  psbtBase64: 'unsigned-psbt',
  fee: 111,
  totalInput: 10111,
  totalOutput: 10000,
  changeAmount: 0,
  changeAddress: 'bc1qchange',
  effectiveAmount: 10000,
  utxos: [{ txid: 'a'.repeat(64), vout: 1, address: 'bc1qutxo', amount: 10111 }],
  outputs: [{ address: 'bc1qrecipient', amount: 10000 }],
  inputPaths: ["m/84'/0'/0'/0/0"],
  decoyOutputs: [],
} as any;

function createState(overrides: Record<string, unknown> = {}) {
  return {
    outputs: [{ address: 'bc1qrecipient', amount: '10000', sendMax: false }],
    feeRate: 3,
    rbfEnabled: true,
    subtractFees: false,
    payjoinUrl: null,
    draftId: null,
    ...overrides,
  } as any;
}

function createDeps(overrides: Partial<Parameters<typeof useDraftManagement>[0]> = {}) {
  return {
    walletId: 'wallet-1',
    state: createState(),
    txData: baseTxData,
    unsignedPsbt: 'unsigned-psbt',
    signedDevices: new Set<string>(),
    createTransaction: vi.fn(),
    setIsSavingDraft: vi.fn(),
    setError: vi.fn(),
    ...overrides,
  };
}

describe('useDraftManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDraft.mockResolvedValue({ id: 'draft-1' });
    mocks.updateDraft.mockResolvedValue(undefined);
  });

  it('returns null when it must create a transaction but createTransaction fails', async () => {
    const deps = createDeps({
      txData: null,
      createTransaction: vi.fn().mockResolvedValue(null),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = 'placeholder';
    await act(async () => {
      draftId = await result.current.saveDraft();
    });

    expect(draftId).toBeNull();
    expect(deps.setIsSavingDraft).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it('creates a new draft and persists signed state when signatures exist', async () => {
    const deps = createDeps({
      state: createState({
        outputs: [{ address: 'bc1qmax', amount: '12345', sendMax: true }],
      }),
      txData: {
        ...baseTxData,
        effectiveAmount: undefined,
        outputs: undefined,
        utxos: [],
      } as any,
      unsignedPsbt: 'signed-psbt',
      signedDevices: new Set(['dev-1']),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = null;
    await act(async () => {
      draftId = await result.current.saveDraft('Payroll');
    });

    expect(draftId).toBe('draft-1');
    expect(mocks.createDraft).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        recipient: 'bc1qmax',
        amount: 12345,
        selectedUtxoIds: undefined,
        outputs: [{ address: 'bc1qmax', amount: 0, sendMax: true }],
        inputs: undefined,
        label: 'Payroll',
      })
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Saving signed PSBT to newly created draft',
      expect.objectContaining({
        draftId: 'draft-1',
        signedDevices: ['dev-1'],
      })
    );
    expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-1', {
      signedPsbtBase64: 'signed-psbt',
      signedDeviceId: 'dev-1',
    });
    expect(mocks.showSuccess).toHaveBeenCalledWith('Transaction saved as draft', 'Draft Saved');
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('updates an existing draft without signature fields when no signing occurred', async () => {
    const deps = createDeps({
      state: createState({ draftId: 'draft-existing' }),
      unsignedPsbt: 'unsigned-psbt',
      signedDevices: new Set(),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = null;
    await act(async () => {
      draftId = await result.current.saveDraft();
    });

    expect(draftId).toBe('draft-existing');
    expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-existing', {
      signedPsbtBase64: undefined,
      signedDeviceId: undefined,
    });
    expect(mocks.showSuccess).toHaveBeenCalledWith('Draft updated successfully', 'Draft Saved');
  });

  it('sets ApiError message when save fails with ApiError', async () => {
    mocks.createDraft.mockRejectedValueOnce(new ApiError('invalid request', 400));
    const deps = createDeps();
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = 'placeholder';
    await act(async () => {
      draftId = await result.current.saveDraft();
    });

    expect(draftId).toBeNull();
    expect(deps.setError).toHaveBeenCalledWith('invalid request');
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to save draft',
      expect.objectContaining({ error: expect.any(ApiError) })
    );
    expect(deps.setIsSavingDraft).toHaveBeenNthCalledWith(1, true);
    expect(deps.setIsSavingDraft).toHaveBeenLastCalledWith(false);
  });

  it('sets fallback error when save fails with a non-ApiError', async () => {
    mocks.updateDraft.mockRejectedValueOnce(new Error('write failed'));
    const deps = createDeps({
      state: createState({ draftId: 'draft-existing' }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = 'placeholder';
    await act(async () => {
      draftId = await result.current.saveDraft();
    });

    expect(draftId).toBeNull();
    expect(deps.setError).toHaveBeenCalledWith('Failed to save draft');
  });
});
