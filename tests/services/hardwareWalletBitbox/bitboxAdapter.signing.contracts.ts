import { describe, expect, it, vi } from 'vitest';

import {
  bitcoinLib as bitcoin,
  constants,
  createBitBoxAdapter,
  mockGetKeypathFromString,
  mockIsErrorAbort,
  mockPsbtFromBase64,
  seedSigningAdapter,
} from './bitboxAdapterTestHarness';

export function registerBitBoxSigningTests(): void {
  describe('PSBT signing', () => {
    it('maps signPSBT abort, busy, and generic failures', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());

      const abortErr = new Error('abort');
      mockPsbtFromBase64.mockImplementationOnce(() => {
        throw abortErr;
      });
      mockIsErrorAbort.mockImplementationOnce((err: unknown) => err === abortErr);
      await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Transaction rejected on device');

      mockPsbtFromBase64.mockImplementationOnce(() => {
        throw new Error('device busy');
      });
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('BitBox02 is busy');

      mockPsbtFromBase64.mockImplementationOnce(() => {
        throw new Error('unexpected');
      });
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.signPSBT({ psbt: 'x', inputPaths: [] })).rejects.toThrow('Failed to sign transaction: unexpected');

      mockPsbtFromBase64.mockImplementationOnce(() => {
        throw 'unexpected';
      });
      mockIsErrorAbort.mockReturnValueOnce(false);
      await expect(adapter.signPSBT({ psbt: '', inputPaths: [] })).rejects.toThrow(
        'Failed to sign transaction: Unknown error'
      );
    });

    it('signs and finalizes a PSBT with mocked BitBox responses', async () => {
      const adapter = createBitBoxAdapter();
      const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64)]);
      seedSigningAdapter(adapter, mockBtcSignSimple);

      const mockPsbt = {
        data: {
          globalMap: { unsignedTx: {} },
          inputs: [{
            witnessUtxo: { value: 1000 },
            bip32Derivation: [{
              path: "m/84'/0'/0'/0/0",
              pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex'),
              masterFingerprint: Buffer.from('aabbccdd', 'hex'),
            }],
            sighashType: 1,
          }],
          outputs: [{}],
        },
        txInputs: [{ hash: Buffer.alloc(32, 1), index: 0, sequence: 0xfffffffd }],
        txOutputs: [{ value: 900, address: 'bc1qexample' }],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'bitbox-signed-psbt'),
      };
      mockPsbtFromBase64.mockReturnValue(mockPsbt);

      const result = await adapter.signPSBT({
        psbt: 'base64-psbt',
        inputPaths: ["m/84'/0'/0'/0/0"],
        accountPath: "m/84'/0'/0'",
      });

      expect(mockBtcSignSimple).toHaveBeenCalledTimes(1);
      expect(mockPsbt.updateInput).toHaveBeenCalledTimes(1);
      expect(mockPsbt.finalizeAllInputs).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        psbt: 'bitbox-signed-psbt',
        signatures: 1,
      });
    });

    it('defaults sequence to 0xffffffff when txInput.sequence is undefined', async () => {
      const adapter = createBitBoxAdapter();
      const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64)]);
      seedSigningAdapter(adapter, mockBtcSignSimple);

      mockPsbtFromBase64.mockReturnValue({
        data: {
          globalMap: { unsignedTx: {} },
          inputs: [{
            witnessUtxo: { value: 500 },
            bip32Derivation: [{
              path: "m/84'/0'/0'/0/0",
              pubkey: Buffer.from(`02${'aa'.repeat(32)}`, 'hex'),
            }],
            sighashType: 1,
          }],
          outputs: [{}],
        },
        txInputs: [{ hash: Buffer.alloc(32, 5), index: 0 }],
        txOutputs: [{ value: 400, address: 'bc1qfallback' }],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-default-seq'),
      });

      await adapter.signPSBT({
        psbt: 'no-sequence-psbt',
        accountPath: "m/84'/0'/0'",
        inputPaths: ["m/84'/0'/0'/0/0"],
      });

      const [, , , inputs] = mockBtcSignSimple.mock.calls[0];
      expect(inputs[0].sequence).toBe(0xffffffff);
    });

    it('maps signPSBT scriptType overrides to simpleType constants', async () => {
      const adapter = createBitBoxAdapter();
      const mockBtcSignSimple = vi.fn().mockResolvedValue([]);
      seedSigningAdapter(adapter, mockBtcSignSimple);

      const makeEmptyPsbt = () => ({
        data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
        txInputs: [],
        txOutputs: [],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-empty'),
      });

      mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
      await adapter.signPSBT({ psbt: 'a', inputPaths: [], accountPath: "m/84'/0'/0'", scriptType: 'p2wpkh' });
      expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
        expect.any(Number),
        10,
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
        2,
        0
      );

      mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
      await adapter.signPSBT({
        psbt: 'b',
        inputPaths: [],
        accountPath: "m/84'/0'/0'",
        scriptType: 'p2sh-p2wpkh',
      });
      expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
        expect.any(Number),
        11,
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
        2,
        0
      );

      mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
      await adapter.signPSBT({ psbt: 'c', inputPaths: [], accountPath: "m/84'/0'/0'", scriptType: 'p2tr' });
      expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
        expect.any(Number),
        12,
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
        2,
        0
      );

      mockPsbtFromBase64.mockReturnValueOnce(makeEmptyPsbt());
      await adapter.signPSBT({ psbt: 'd', inputPaths: [], accountPath: "m/84'/0'/0'", scriptType: 'unknown' as any });
      expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
        expect.any(Number),
        10,
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
        2,
        0
      );
    });

    it('derives account path from request inputPaths, PSBT metadata, and default fallback', async () => {
      const adapter = createBitBoxAdapter();
      const mockBtcSignSimple = vi.fn().mockResolvedValue([]);
      seedSigningAdapter(adapter, mockBtcSignSimple);

      mockPsbtFromBase64.mockReturnValueOnce({
        data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
        txInputs: [],
        txOutputs: [],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-a'),
      });
      await adapter.signPSBT({ psbt: 'a', inputPaths: ["m/84'/0'/0'/0/9"] });
      expect(mockGetKeypathFromString).toHaveBeenCalledWith("m/84'/0'/0'");

      mockPsbtFromBase64.mockReturnValueOnce({
        data: {
          globalMap: { unsignedTx: {} },
          inputs: [{ bip32Derivation: [{ path: "m/49'/1'/0'/1/3", pubkey: Buffer.alloc(33, 2) }] }],
          outputs: [],
        },
        txInputs: [{ hash: Buffer.alloc(32, 1), index: 0, sequence: 0 }],
        txOutputs: [],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-b'),
      });
      await adapter.signPSBT({ psbt: 'b', inputPaths: [] });
      expect(mockGetKeypathFromString).toHaveBeenCalledWith("m/49'/1'/0'");
      expect(mockBtcSignSimple).toHaveBeenLastCalledWith(
        30,
        expect.any(Number),
        expect.any(Array),
        expect.any(Array),
        expect.any(Array),
        2,
        0
      );

      mockPsbtFromBase64.mockReturnValueOnce({
        data: { globalMap: { unsignedTx: {} }, inputs: [{}], outputs: [] },
        txInputs: [{ hash: Buffer.alloc(32, 2), index: 0, sequence: 0 }],
        txOutputs: [],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-c'),
      });
      await adapter.signPSBT({ psbt: 'c', inputPaths: [] });
      expect(mockGetKeypathFromString).toHaveBeenCalledWith("m/84'/0'/0'");
    });

    it('handles non-witness inputs, keypath fallbacks, change outputs, and output type decoding', async () => {
      const adapter = createBitBoxAdapter();
      const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64), new Uint8Array(64), new Uint8Array(64)]);
      seedSigningAdapter(adapter, mockBtcSignSimple);

      const fromBech32 = bitcoin.address.fromBech32 as unknown as ReturnType<typeof vi.fn>;
      const fromBase58Check = bitcoin.address.fromBase58Check as unknown as ReturnType<typeof vi.fn>;
      fromBech32.mockImplementation((address: string) => {
        if (address === 'bc1wsh') return { version: 0, data: new Uint8Array(32) };
        if (address === 'bc1tr') return { version: 1, data: new Uint8Array(32) };
        throw new Error('not bech32');
      });
      fromBase58Check.mockImplementation((address: string) => {
        if (address === '1pkh') return { version: 0, hash: Buffer.alloc(20, 1) };
        if (address === '3sh') return { version: 5, hash: Buffer.alloc(20, 2) };
        throw new Error('not base58');
      });

      mockPsbtFromBase64.mockReturnValue({
        data: {
          globalMap: { unsignedTx: {} },
          inputs: [
            {
              nonWitnessUtxo: Buffer.from([1, 2, 3]),
              bip32Derivation: [{ path: "m/84'/0'/0'/0/0", pubkey: Buffer.from(`02${'11'.repeat(32)}`, 'hex') }],
              sighashType: 1,
            },
            {
              witnessUtxo: { value: 2000 },
              bip32Derivation: [],
              sighashType: 1,
            },
            {
              witnessUtxo: { value: 3000 },
              sighashType: 1,
            },
          ],
          outputs: [
            { bip32Derivation: [{ path: "84'/0'/0'/1/0" }] },
            {},
            {},
            {},
            {},
          ],
        },
        txInputs: [
          { hash: Buffer.alloc(32, 1), index: 0, sequence: 1 },
          { hash: Buffer.alloc(32, 2), index: 1, sequence: 2 },
          { hash: Buffer.alloc(32, 3), index: 0, sequence: 3 },
        ],
        txOutputs: [
          { value: 1000, address: 'bc1change' },
          { value: 2000, address: 'bc1wsh' },
          { value: 3000, address: 'bc1tr' },
          { value: 4000, address: '1pkh' },
          { value: 5000, address: '3sh' },
        ],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-complex'),
      });

      const result = await adapter.signPSBT({
        psbt: 'complex-psbt',
        accountPath: "m/84'/0'/0'",
        inputPaths: ["m/84'/0'/0'/0/0", "m/84'/0'/0'/0/1"],
        scriptType: 'p2sh-p2wpkh',
      });

      expect(result).toEqual({ psbt: 'signed-complex', signatures: 3 });

      const [coin, simpleType, keypathAccount, inputs, outputs] = mockBtcSignSimple.mock.calls[0];
      expect(coin).toBe(31);
      expect(simpleType).toBe(11);
      expect(keypathAccount).toEqual([84, 0, 0]);

      expect(inputs[0].prevOutValue).toBe('1234');
      expect(inputs[1].keypath).toEqual([84, 0, 0, 0, 1]);
      expect(inputs[2].keypath).toEqual([84, 0, 0, 0, 0]);

      expect(outputs[0]).toMatchObject({ ours: true, keypath: [84, 0, 0, 1, 0], value: '1000' });
      expect(outputs[1]).toMatchObject({ ours: false, type: 41, value: '2000' });
      expect(outputs[2]).toMatchObject({ ours: false, type: 42, value: '3000' });
      expect(outputs[3]).toMatchObject({ ours: false, type: 43, value: '4000' });
      expect(outputs[4]).toMatchObject({ ours: false, type: 44, value: '5000' });
    });

    it('uses default address and sighash branches when output address and input sighash are missing', async () => {
      const adapter = createBitBoxAdapter();
      const mockBtcSignSimple = vi.fn().mockResolvedValue([new Uint8Array(64).fill(7)]);
      seedSigningAdapter(adapter, mockBtcSignSimple);

      const mockPsbt = {
        data: {
          globalMap: { unsignedTx: {} },
          inputs: [{
            witnessUtxo: { value: 1500 },
            bip32Derivation: [{
              path: "m/84'/0'/0'/0/0",
              pubkey: Buffer.from(`02${'22'.repeat(32)}`, 'hex'),
            }],
          }],
          outputs: [{}],
        },
        txInputs: [{ hash: Buffer.alloc(32, 9), index: 1, sequence: 0xfffffffd }],
        txOutputs: [{ value: 1200 }],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(() => 'signed-default-branches'),
      };
      mockPsbtFromBase64.mockReturnValue(mockPsbt);

      const result = await adapter.signPSBT({
        psbt: 'default-branch-psbt',
        accountPath: "m/84'/0'/0'",
        inputPaths: ["m/84'/0'/0'/0/0"],
      });

      expect(result).toEqual({ psbt: 'signed-default-branches', signatures: 1 });

      const [, , , , outputs] = mockBtcSignSimple.mock.calls[0];
      expect(outputs[0]).toMatchObject({
        ours: false,
        type: 40,
        value: '1200',
        payload: new Uint8Array(0),
      });

      const [, update] = mockPsbt.updateInput.mock.calls[0];
      const signature: Buffer = update.partialSig[0].signature;
      expect(signature[signature.length - 1]).toBe(1);
    });
  });
}
