import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';

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

vi.mock('../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: () => ({
    showSuccess: mocks.showSuccess,
  }),
}));

vi.mock('../../src/api/drafts', () => ({
  createDraft: mocks.createDraft,
  updateDraft: mocks.updateDraft,
}));

vi.mock('../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import { useDraftManagement } from '../../src/hooks/send/useDraftManagement';
import { ApiError } from '../../src/api/client';

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
  const controller = new AbortController();
  return {
    walletId: 'wallet-1',
    state: createState(),
    txData: baseTxData,
    unsignedPsbt: 'unsigned-psbt',
    signedDevices: new Set<string>(),
    createTransaction: vi.fn(),
    beginDraftSave: () => ({ signal: controller.signal, isCurrent: () => true }),
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

  it('refuses to save when the reviewed transaction no longer has an owner', async () => {
    const deps = createDeps({ beginDraftSave: () => null });
    const { result } = renderHook(() => useDraftManagement(deps));

    await act(async () => {
      expect(await result.current.saveDraft()).toBeNull();
    });

    expect(deps.setIsSavingDraft).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
  });

  it('does not publish or navigate after draft-save ownership is lost', async () => {
    let resolveUpdate!: () => void;
    let current = true;
    mocks.updateDraft.mockReturnValueOnce(new Promise<void>(resolve => { resolveUpdate = resolve; }));
    const controller = new AbortController();
    const deps = createDeps({
      state: createState({ draftId: 'draft-existing' }),
      beginDraftSave: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let savePromise!: Promise<string | null>;
    act(() => { savePromise = result.current.saveDraft(); });
    current = false;
    controller.abort();
    resolveUpdate();

    await act(async () => expect(await savePromise).toBeNull());
    expect(mocks.showSuccess).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(deps.setError).not.toHaveBeenCalledWith(expect.any(String));
    expect(deps.setIsSavingDraft).not.toHaveBeenLastCalledWith(false);
  });

  it('drops a newly created draft id when ownership is lost during creation', async () => {
    let current = true;
    mocks.createDraft.mockImplementationOnce(async () => {
      current = false;
      return { id: 'stale-draft' };
    });
    const controller = new AbortController();
    const deps = createDeps({
      beginDraftSave: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    await expect(result.current.saveDraft()).resolves.toBeNull();
    expect(mocks.showSuccess).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('drops a new signed draft when ownership is lost during signed-state persistence', async () => {
    let current = true;
    mocks.updateDraft.mockImplementationOnce(async () => { current = false; });
    const controller = new AbortController();
    const deps = createDeps({
      unsignedPsbt: 'signed-psbt',
      signedDevices: new Set(['device-1']),
      beginDraftSave: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    await expect(result.current.saveDraft()).resolves.toBeNull();
    expect(mocks.updateDraft).toHaveBeenCalled();
    expect(mocks.showSuccess).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('rechecks ownership after success notification before navigating', async () => {
    let current = true;
    mocks.showSuccess.mockImplementationOnce(() => { current = false; });
    const controller = new AbortController();
    const deps = createDeps({
      state: createState({ draftId: 'draft-existing' }),
      beginDraftSave: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    await expect(result.current.saveDraft()).resolves.toBeNull();
    expect(mocks.showSuccess).toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['an abort', new DOMException('cancelled', 'AbortError')],
    ['a non-abort DOM failure', new DOMException('network failed', 'NetworkError')],
  ])('handles %s without publishing stale navigation', async (_label, error) => {
    mocks.createDraft.mockRejectedValueOnce(error);
    const deps = createDeps();
    const { result } = renderHook(() => useDraftManagement(deps));

    await expect(result.current.saveDraft()).resolves.toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
    if (error.name === 'AbortError') {
      expect(deps.setError).not.toHaveBeenCalledWith(expect.any(String));
    } else {
      expect(deps.setError).toHaveBeenCalledWith('Failed to save draft');
    }
  });

  it('ignores a rejection that settles after draft ownership is lost', async () => {
    let current = true;
    mocks.createDraft.mockImplementationOnce(async () => {
      current = false;
      throw new Error('stale write failure');
    });
    const controller = new AbortController();
    const deps = createDeps({
      beginDraftSave: () => ({ signal: controller.signal, isCurrent: () => current }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    await expect(result.current.saveDraft()).resolves.toBeNull();
    expect(deps.setError).not.toHaveBeenCalledWith(expect.any(String));
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
      }),
      expect.any(AbortSignal),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      'Saving signed PSBT to newly created draft',
      expect.objectContaining({
        draftId: 'draft-1',
        signedDevices: ['dev-1'],
      })
    );
    expect(mocks.updateDraft).toHaveBeenCalledWith(
      'wallet-1',
      'draft-1',
      { signedPsbtBase64: 'signed-psbt', signedDeviceId: 'dev-1' },
      expect.any(AbortSignal),
    );
    expect(mocks.showSuccess).toHaveBeenCalledWith('Transaction saved as draft', 'Draft Saved');
    expect(mocks.navigate).toHaveBeenCalledWith('/wallets/wallet-1');
  });

  it('preserves structured transaction sendMax metadata in a saved draft', async () => {
    const deps = createDeps({
      state: createState({
        outputs: [{ address: 'bc1qmax', amount: '', sendMax: true }],
      }),
      txData: {
        ...baseTxData,
        effectiveAmount: 10_000,
        outputs: [{ address: 'bc1qmax', amount: 0, sendMax: true }],
      } as any,
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    await act(async () => {
      await result.current.saveDraft();
    });

    expect(mocks.createDraft).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        sendMax: true,
        outputs: [{ address: 'bc1qmax', amount: 0, sendMax: true }],
      }),
      expect.any(AbortSignal),
    );
  });

  it('defaults omitted sendMax metadata to false when saving transaction outputs', async () => {
    const deps = createDeps({
      state: createState({ outputs: [{ address: 'bc1qrecipient', amount: '10000' }] }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    await act(async () => {
      await result.current.saveDraft();
    });

    expect(mocks.createDraft).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        outputs: [{ address: 'bc1qrecipient', amount: 10_000, sendMax: false }],
      }),
      expect.any(AbortSignal),
    );
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
    expect(mocks.updateDraft).toHaveBeenCalledWith(
      'wallet-1',
      'draft-existing',
      { signedPsbtBase64: undefined, signedDeviceId: undefined },
      expect.any(AbortSignal),
    );
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

  it('uses fallback arrays when tx data omits utxos/input paths and skips signed-state update', async () => {
    const deps = createDeps({
      txData: {
        ...baseTxData,
        utxos: undefined,
        inputPaths: undefined,
      } as any,
      unsignedPsbt: null,
      signedDevices: new Set(),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = null;
    await act(async () => {
      draftId = await result.current.saveDraft();
    });

    expect(draftId).toBe('draft-1');
    expect(mocks.createDraft).toHaveBeenCalledWith(
      'wallet-1',
      expect.objectContaining({
        selectedUtxoIds: undefined,
        inputs: undefined,
        inputPaths: [],
      }),
      expect.any(AbortSignal),
    );
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it('stores signed PSBT for new drafts when PSBT changed even without signed device ids', async () => {
    const deps = createDeps({
      txData: {
        ...baseTxData,
        psbtBase64: 'old-psbt',
      } as any,
      unsignedPsbt: 'new-psbt',
      signedDevices: new Set(),
    });
    const { result } = renderHook(() => useDraftManagement(deps));

    let draftId: string | null = null;
    await act(async () => {
      draftId = await result.current.saveDraft();
    });

    expect(draftId).toBe('draft-1');
    expect(mocks.updateDraft).toHaveBeenCalledWith(
      'wallet-1',
      'draft-1',
      { signedPsbtBase64: 'new-psbt', signedDeviceId: undefined },
      expect.any(AbortSignal),
    );
  });

  it.each(['.', '1.5', '9007199254740992'])(
    'refuses invalid normalized draft amount %j before the draft API',
    async (amount) => {
      const deps = createDeps({
        state: createState({ outputs: [{ address: 'bc1qrecipient', amount, sendMax: false }] }),
      });
      const { result } = renderHook(() => useDraftManagement(deps));

      await act(async () => {
        expect(await result.current.saveDraft()).toBeNull();
      });

      expect(mocks.createDraft).not.toHaveBeenCalled();
      expect(deps.setError).toHaveBeenCalledWith('Failed to save draft');
    },
  );

  it('refuses an invalid resumed-draft amount before the update API', async () => {
    const deps = createDeps({
      state: createState({
        draftId: 'draft-existing',
        outputs: [{ address: 'bc1qrecipient', amount: '.', sendMax: false }],
      }),
    });
    const { result } = renderHook(() => useDraftManagement(deps));
    await act(async () => {
      expect(await result.current.saveDraft()).toBeNull();
    });
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it('refuses unsafe effective and output amounts returned during draft construction', async () => {
    const unsafeValues = [
      { effectiveAmount: Number.MAX_SAFE_INTEGER + 1 },
      { effectiveAmount: undefined, outputs: [{ address: 'bc1qrecipient', amount: 1.5 }] },
    ];

    for (const override of unsafeValues) {
      vi.clearAllMocks();
      const deps = createDeps({ txData: { ...baseTxData, ...override } as any });
      const { result, unmount } = renderHook(() => useDraftManagement(deps));
      await act(async () => {
        expect(await result.current.saveDraft()).toBeNull();
      });
      expect(mocks.createDraft).not.toHaveBeenCalled();
      unmount();
    }
  });
});
