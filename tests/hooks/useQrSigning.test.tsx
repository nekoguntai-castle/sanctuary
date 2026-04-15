import { act,renderHook } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useQrSigning } from '../../hooks/send/useQrSigning';

const mocks = vi.hoisted(() => ({
  updateDraft: vi.fn(),
  downloadBinary: vi.fn(),
  fromBase64: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/api/drafts', () => ({
  updateDraft: mocks.updateDraft,
}));

vi.mock('../../utils/download', () => ({
  downloadBinary: mocks.downloadBinary,
}));

vi.mock('../../utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

vi.mock('bitcoinjs-lib', () => ({
  Psbt: {
    fromBase64: mocks.fromBase64,
  },
}));

const originalFileReader = globalThis.FileReader;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function mockFileReader({
  bytes,
  fail,
  nullResult,
}: {
  bytes?: Uint8Array;
  fail?: boolean;
  nullResult?: boolean;
}) {
  class MockFileReader {
    onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
    onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;

    readAsArrayBuffer(_file: Blob) {
      if (fail) {
        this.onerror?.({} as ProgressEvent<FileReader>);
        return;
      }

      if (nullResult) {
        this.onload?.({
          target: { result: null },
        } as unknown as ProgressEvent<FileReader>);
        return;
      }

      this.onload?.({
        target: {
          result: toArrayBuffer(bytes ?? new Uint8Array()),
        },
      } as unknown as ProgressEvent<FileReader>);
    }
  }

  globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
}

function createDeps(overrides: Partial<Parameters<typeof useQrSigning>[0]> = {}) {
  return {
    walletId: 'wallet-1',
    wallet: {
      id: 'wallet-1',
      name: 'Primary Wallet',
      type: 'single_sig',
      network: 'mainnet',
      balance: 0,
    } as any,
    draftId: null,
    txData: null,
    unsignedPsbt: null,
    setError: vi.fn(),
    setUnsignedPsbt: vi.fn(),
    setSignedDevices: vi.fn(),
    ...overrides,
  };
}

describe('useQrSigning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateDraft.mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.FileReader = originalFileReader;
  });

  it('sets an error when download is requested without an available PSBT', () => {
    const deps = createDeps();
    const { result } = renderHook(() => useQrSigning(deps));

    act(() => {
      result.current.downloadPsbt();
    });

    expect(deps.setError).toHaveBeenCalledWith('No PSBT available to download');
    expect(mocks.downloadBinary).not.toHaveBeenCalled();
  });

  it('downloads PSBT bytes and falls back to default filename when wallet name is missing', () => {
    const deps = createDeps({
      wallet: {
        id: 'wallet-1',
        name: '',
        type: 'single_sig',
      } as any,
      txData: {
        psbtBase64: btoa('hello'),
      } as any,
    });
    const { result } = renderHook(() => useQrSigning(deps));

    act(() => {
      result.current.downloadPsbt();
    });

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'PSBT does not start with magic bytes',
      expect.objectContaining({
        bytes: [104, 101, 108, 108, 111],
      })
    );
    expect(mocks.downloadBinary).toHaveBeenCalledWith(expect.any(Uint8Array), 'transaction_unsigned.psbt');
  });

  it('rejects uploads when FileReader fails', async () => {
    mockFileReader({ fail: true });
    const deps = createDeps();
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await expect(result.current.uploadSignedPsbt(file)).rejects.toThrow('Failed to read file');
  });

  it('falls back to an empty ArrayBuffer when FileReader delivers a null result', async () => {
    mockFileReader({ nullResult: true });
    const deps = createDeps();
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    // Empty buffer becomes an empty base64 string after the binary decode pipeline.
    // The upload resolves without throwing, exercising the `|| new ArrayBuffer(0)` fallback.
    await act(async () => {
      await result.current.uploadSignedPsbt(file, 'device-null');
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('');
  });

  it('uploads binary PSBT, defaults device id, and persists to draft', async () => {
    const binaryBytes = new Uint8Array([0x70, 0x73, 0x62, 0x74, 0xff]);
    mockFileReader({ bytes: binaryBytes });

    const deps = createDeps({ draftId: 'draft-1' });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');
    const expectedBase64 = btoa(String.fromCharCode(...binaryBytes));

    await act(async () => {
      await result.current.uploadSignedPsbt(file);
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith(expectedBase64);
    const updater = vi.mocked(deps.setSignedDevices).mock.calls[0][0];
    const updatedSet = updater(new Set<string>());
    expect(updatedSet.has('psbt-signed')).toBe(true);
    expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-1', {
      signedPsbtBase64: expectedBase64,
      signedDeviceId: 'psbt-signed',
    });
  });

  it('rejects multisig upload when signature does not match selected fingerprint', async () => {
    const textBytes = new TextEncoder().encode('uploaded-psbt');
    mockFileReader({ bytes: textBytes });

    const uploadedPsbt = {
      data: {
        inputs: [
          {
            partialSig: [{ pubkey: Buffer.from('02'.repeat(33), 'hex') }],
            bip32Derivation: [
              {
                pubkey: Buffer.from('03'.repeat(33), 'hex'),
                masterFingerprint: Buffer.from('deadbeef', 'hex'),
              },
            ],
          },
        ],
      },
    };
    mocks.fromBase64.mockReturnValueOnce(uploadedPsbt);

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await expect(
      result.current.uploadSignedPsbt(file, 'device-1', 'f00dbabe')
    ).rejects.toThrow('does not contain a signature from the selected device');

    expect(deps.setUnsignedPsbt).not.toHaveBeenCalled();
    expect(deps.setSignedDevices).not.toHaveBeenCalled();
  });

  it('accepts multisig upload when expected signature fingerprint is present', async () => {
    const textBytes = new TextEncoder().encode('validated-psbt');
    mockFileReader({ bytes: textBytes });

    const matchingPubkey = Buffer.from('04'.repeat(33), 'hex');
    const uploadedPsbt = {
      data: {
        inputs: [
          {
            partialSig: [{ pubkey: matchingPubkey }],
            bip32Derivation: [
              {
                pubkey: matchingPubkey,
                masterFingerprint: Buffer.from('f00dbabe', 'hex'),
              },
            ],
          },
        ],
      },
    };
    mocks.fromBase64.mockReturnValueOnce(uploadedPsbt);

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await act(async () => {
      await result.current.uploadSignedPsbt(file, 'device-1', 'f00dbabe');
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('validated-psbt');
    expect(mocks.logger.debug).toHaveBeenCalledWith('Signature validation passed');
  });

  it('continues after validation parse failure and combines multisig PSBTs', async () => {
    const textBytes = new TextEncoder().encode('new-psbt');
    mockFileReader({ bytes: textBytes });

    const existingPsbtObj = {
      data: {
        inputs: [
          {
            partialSig: [{ pubkey: Buffer.from('11'.repeat(33), 'hex') }],
          },
        ],
      },
      combine: vi.fn(),
      toBase64: vi.fn(() => 'combined-psbt'),
    };
    const newPsbtObj = {
      data: {
        inputs: [
          {
            partialSig: [{ pubkey: Buffer.from('22'.repeat(33), 'hex') }],
          },
        ],
      },
    };

    mocks.fromBase64
      .mockImplementationOnce(() => {
        throw new Error('validation parse failure');
      })
      .mockReturnValueOnce(existingPsbtObj)
      .mockReturnValueOnce(newPsbtObj);

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-psbt',
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await act(async () => {
      await result.current.uploadSignedPsbt(file, 'device-2', 'f00dbabe');
    });

    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Could not validate signature',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(existingPsbtObj.combine).toHaveBeenCalledWith(newPsbtObj);
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('combined-psbt');
  });

  it('handles mixed validation inputs and combines PSBTs with inputs lacking signatures', async () => {
    const textBytes = new TextEncoder().encode('mixed-branch-psbt');
    mockFileReader({ bytes: textBytes });

    const mismatchedPubkey = Buffer.from('31'.repeat(33), 'hex');
    const matchingPubkey = Buffer.from('32'.repeat(33), 'hex');

    const uploadedPsbt = {
      data: {
        inputs: [
          {},
          {
            partialSig: [{ pubkey: mismatchedPubkey }],
            bip32Derivation: [
              {
                pubkey: mismatchedPubkey,
                masterFingerprint: Buffer.from('aaaaaaaa', 'hex'),
              },
            ],
          },
          {
            partialSig: [{ pubkey: matchingPubkey }],
            bip32Derivation: [
              {
                pubkey: matchingPubkey,
                masterFingerprint: Buffer.from('f00dbabe', 'hex'),
              },
            ],
          },
        ],
      },
    };

    const existingPsbtObj = {
      data: {
        inputs: [
          {},
          { partialSig: [{ pubkey: Buffer.from('41'.repeat(33), 'hex') }] },
        ],
      },
      combine: vi.fn(),
      toBase64: vi.fn(() => 'combined-with-mixed-inputs'),
    };

    const newPsbtObj = {
      data: {
        inputs: [
          {},
          { partialSig: [{ pubkey: Buffer.from('51'.repeat(33), 'hex') }] },
        ],
      },
    };

    mocks.fromBase64
      .mockReturnValueOnce(uploadedPsbt)
      .mockReturnValueOnce(existingPsbtObj)
      .mockReturnValueOnce(newPsbtObj);

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-psbt',
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await act(async () => {
      await result.current.uploadSignedPsbt(file, 'device-branches', 'f00dbabe');
    });

    expect(existingPsbtObj.combine).toHaveBeenCalledWith(newPsbtObj);
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('combined-with-mixed-inputs');
  });

  it('falls back to uploaded base64 when combine fails and tolerates draft persist errors', async () => {
    const textBytes = new TextEncoder().encode('text-psbt  \n');
    mockFileReader({ bytes: textBytes });
    mocks.fromBase64.mockImplementationOnce(() => {
      throw new Error('combine failed');
    });
    mocks.updateDraft.mockRejectedValueOnce(new Error('persist failed'));

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-psbt',
      draftId: 'draft-2',
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await expect(result.current.uploadSignedPsbt(file, 'device-3')).resolves.toBeUndefined();

    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('text-psbt');
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'PSBT combine failed',
      expect.objectContaining({ error: expect.any(Error) })
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to persist uploaded PSBT to draft',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('rejects when state update throws inside upload handler', async () => {
    const textBytes = new TextEncoder().encode('psbt-value');
    mockFileReader({ bytes: textBytes });

    const deps = createDeps({
      setUnsignedPsbt: vi.fn(() => {
        throw new Error('state update failed');
      }),
    });
    const { result } = renderHook(() => useQrSigning(deps));
    const file = new File(['dummy'], 'signed.psbt');

    await expect(result.current.uploadSignedPsbt(file, 'device-4')).rejects.toThrow('state update failed');
  });

  it('combines QR-signed PSBT for multisig and persists to draft', async () => {
    const existingPsbtObj = {
      data: {
        inputs: [{ partialSig: [{ pubkey: Buffer.from('aa'.repeat(33), 'hex') }] }],
      },
      combine: vi.fn(),
      toBase64: vi.fn(() => 'qr-combined-psbt'),
    };
    const newPsbtObj = {
      data: {
        inputs: [{ partialSig: [{ pubkey: Buffer.from('bb'.repeat(33), 'hex') }] }],
      },
    };

    mocks.fromBase64.mockReturnValueOnce(existingPsbtObj).mockReturnValueOnce(newPsbtObj);

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-qr-psbt',
      draftId: 'draft-qr',
    });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt('new-qr-psbt', 'device-qr');
    });

    expect(existingPsbtObj.combine).toHaveBeenCalledWith(newPsbtObj);
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('qr-combined-psbt');
    expect(mocks.updateDraft).toHaveBeenCalledWith('wallet-1', 'draft-qr', {
      signedPsbtBase64: 'qr-combined-psbt',
      signedDeviceId: 'device-qr',
    });
  });

  it('combines QR-signed PSBT when some inputs do not contain partial signatures', async () => {
    const existingPsbtObj = {
      data: {
        inputs: [
          {},
          { partialSig: [{ pubkey: Buffer.from('61'.repeat(33), 'hex') }] },
        ],
      },
      combine: vi.fn(),
      toBase64: vi.fn(() => 'qr-combined-mixed'),
    };
    const newPsbtObj = {
      data: {
        inputs: [
          {},
          { partialSig: [{ pubkey: Buffer.from('71'.repeat(33), 'hex') }] },
        ],
      },
    };

    mocks.fromBase64.mockReturnValueOnce(existingPsbtObj).mockReturnValueOnce(newPsbtObj);

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-qr-psbt',
      draftId: null,
    });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt('incoming-qr-psbt', 'device-qr-mixed');
    });

    expect(existingPsbtObj.combine).toHaveBeenCalledWith(newPsbtObj);
    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('qr-combined-mixed');
    expect(mocks.updateDraft).not.toHaveBeenCalled();
  });

  it('falls back to QR payload when combine fails and ignores draft persist errors', async () => {
    mocks.fromBase64.mockImplementationOnce(() => {
      throw new Error('qr combine failed');
    });
    mocks.updateDraft.mockRejectedValueOnce(new Error('draft write failed'));

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-qr-psbt',
      draftId: 'draft-qr',
    });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt('incoming-qr-psbt', 'device-qr');
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('incoming-qr-psbt');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to combine PSBTs, using new PSBT',
      expect.objectContaining({ error: 'qr combine failed' })
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to persist QR signature to draft',
      expect.objectContaining({ error: expect.any(Error) })
    );
  });

  it('falls back to QR payload when combine throws a non-Error value', async () => {
    mocks.fromBase64.mockImplementationOnce(() => {
      throw 'non-error combine failure';
    });

    const deps = createDeps({
      wallet: { id: 'wallet-1', name: 'Multisig Wallet', type: 'multi_sig' } as any,
      unsignedPsbt: 'existing-qr-psbt',
      draftId: null,
    });
    const { result } = renderHook(() => useQrSigning(deps));

    await act(async () => {
      await result.current.processQrSignedPsbt('incoming-qr-psbt', 'device-qr-nonerror');
    });

    expect(deps.setUnsignedPsbt).toHaveBeenCalledWith('incoming-qr-psbt');
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      'Failed to combine PSBTs, using new PSBT',
      expect.objectContaining({ error: 'non-error combine failure' })
    );
  });
});
