import { describe, expect, it, vi } from 'vitest';
import * as bip66 from 'bip66';

import {
  createBitBoxAdapter,
  mockPsbtFromBase64,
  seedSigningAdapter,
} from './bitboxAdapterTestHarness';

const makePsbt = (input: any, output: any = {}, txOutput: any = { value: 1, address: 'bc1qexternal' }) => ({
  data: { globalMap: { unsignedTx: {} }, inputs: [input], outputs: [output] },
  txInputs: [{ hash: Buffer.alloc(32), index: 0, sequence: 1 }],
  txOutputs: [txOutput],
  version: 2,
  locktime: 0,
  updateInput: vi.fn(),
  finalizeAllInputs: vi.fn(),
  toBase64: vi.fn(),
});

const derivation = {
  path: "m/84'/0'/0'/0/0",
  pubkey: Buffer.alloc(33, 2),
};

export function registerBitBoxFailClosedTests(): void {
  describe('fail-closed signing evidence', () => {
    it.each([
      ['missing prevout value', { bip32Derivation: [derivation] }, {}, { value: 1, address: 'bc1qexternal' }, 'missing prevout value'],
      ['negative prevout value', { witnessUtxo: { value: -1 }, bip32Derivation: [derivation] }, {}, { value: 1, address: 'bc1qexternal' }, 'negative'],
      ['missing keypath', { witnessUtxo: { value: 2 } }, {}, { value: 1, address: 'bc1qexternal' }, 'exactly one BIP32 keypath'],
      ['unproven change', { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] }, { bip32Derivation: [{ path: "m/84'/0'/0'/1/0" }] }, { value: 1, address: 'bc1qchange' }, 'exact script proof'],
      ['ambiguous change', { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] }, { bip32Derivation: [{ path: "m/84'/0'/0'/1/0" }, { path: "m/84'/0'/0'/1/1" }] }, { value: 1, address: 'bc1qchange' }, 'ambiguous BIP32 derivations'],
      ['missing external address', { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] }, {}, { value: 1 }, 'has no address'],
    ])('rejects %s', async (_name, input, output, txOutput, message) => {
      const adapter = createBitBoxAdapter();
      const signer = vi.fn();
      seedSigningAdapter(adapter, signer);
      mockPsbtFromBase64.mockReturnValueOnce(makePsbt(input, output, txOutput));

      await expect(adapter.signPSBT({ psbt: 'unsafe', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow(message);
      expect(signer).not.toHaveBeenCalled();
    });

    it('rejects signature count and length mismatches', async () => {
      const adapter = createBitBoxAdapter();
      const signer = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([new Uint8Array(63)]);
      seedSigningAdapter(adapter, signer);
      const psbt = makePsbt(
        { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] },
        {},
        { value: 1, address: '1external' },
      );
      vi.mocked((await import('bitcoinjs-lib')).address.fromBase58Check).mockReturnValue({
        version: 0, hash: Buffer.alloc(20),
      });
      mockPsbtFromBase64.mockReturnValue(psbt);

      await expect(adapter.signPSBT({ psbt: 'none', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('0 signatures for 1 inputs');
      await expect(adapter.signPSBT({ psbt: 'short', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('must be exactly 64 bytes');
      expect(psbt.updateInput).not.toHaveBeenCalled();
    });

    it('DER-encodes compact ECDSA signatures before PSBT finalization', async () => {
      const adapter = createBitBoxAdapter();
      const compact = Uint8Array.from([
        ...new Uint8Array(32).fill(0x80),
        ...new Uint8Array(32).fill(0x01),
      ]);
      seedSigningAdapter(adapter, vi.fn().mockResolvedValue([compact]));
      const psbt = makePsbt(
        { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] },
        {},
        { value: 1, address: '1external' },
      );
      vi.mocked((await import('bitcoinjs-lib')).address.fromBase58Check).mockReturnValue({
        version: 0, hash: Buffer.alloc(20),
      });
      mockPsbtFromBase64.mockReturnValue(psbt);

      await adapter.signPSBT({ psbt: 'compact', accountPath: "m/84'/0'/0'" });

      const encoded = psbt.updateInput.mock.calls[0][1].partialSig[0].signature as Buffer;
      expect(encoded[encoded.length - 1]).toBe(1);
      expect(bip66.check(encoded.subarray(0, -1))).toBe(true);
      const decoded = bip66.decode(encoded.subarray(0, -1));
      expect(Buffer.from(decoded.r).subarray(-32)).toEqual(Buffer.from(compact.slice(0, 32)));
      expect(Buffer.from(decoded.s).subarray(-32)).toEqual(Buffer.from(compact.slice(32)));
      expect(psbt.finalizeAllInputs).toHaveBeenCalledOnce();
    });

    it('rejects ambiguous signature pubkeys and invalid sighash types', async () => {
      const adapter = createBitBoxAdapter();
      const compact = new Uint8Array(64).fill(1);
      seedSigningAdapter(adapter, vi.fn().mockResolvedValue([compact]));
      vi.mocked((await import('bitcoinjs-lib')).address.fromBase58Check).mockReturnValue({
        version: 0, hash: Buffer.alloc(20),
      });

      mockPsbtFromBase64.mockReturnValueOnce(makePsbt({
        witnessUtxo: { value: 2 },
        bip32Derivation: [{ path: derivation.path }],
      }, {}, { value: 1, address: '1external' }));
      await expect(adapter.signPSBT({ psbt: 'no-pubkey', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('no unambiguous input public key');

      mockPsbtFromBase64.mockReturnValueOnce(makePsbt({
        witnessUtxo: { value: 2 },
        bip32Derivation: [derivation],
        sighashType: 256,
      }, {}, { value: 1, address: '1external' }));
      await expect(adapter.signPSBT({ psbt: 'bad-sighash', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('unsupported sighash type');
    });

    it('uses an input derivation as account evidence before rejecting missing value evidence', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());
      mockPsbtFromBase64.mockReturnValueOnce(makePsbt(
        { bip32Derivation: [derivation] },
        {},
        { value: 1, address: '1external' },
      ));

      await expect(adapter.signPSBT({ psbt: 'psbt-account-evidence' }))
        .rejects.toThrow('account path is required before PSBT parsing');
    });

    it('rejects disagreeing account evidence before payload construction', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());
      mockPsbtFromBase64.mockReturnValueOnce(makePsbt(
        { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] },
      ));
      await expect(adapter.signPSBT({
        psbt: 'account-disagreement',
        accountPath: "m/49'/0'/0'",
      })).rejects.toThrow('account path evidence disagrees');
    });

    it('rejects disagreeing pre-parse signer and request account evidence', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());

      await expect(adapter.signPSBT({
        psbt: 'pre-parse-account-disagreement',
        accountPath: "m/84'/0'/0'",
        signingContext: {
          signers: [{ accountPath: "m/84'/1'/0'" }],
        } as any,
      })).rejects.toThrow('pre-parse account path evidence disagrees');
      expect(mockPsbtFromBase64).not.toHaveBeenCalled();
    });

    it('rejects parsed PSBT account evidence that disagrees with signer context', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());
      mockPsbtFromBase64.mockReturnValueOnce(makePsbt({
        witnessUtxo: { value: 2 },
        bip32Derivation: [derivation],
      }));

      await expect(adapter.signPSBT({
        psbt: 'parsed-account-disagreement',
        signingContext: {
          signers: [{ accountPath: "m/84'/1'/0'" }],
        } as any,
      })).rejects.toThrow('parsed PSBT account path disagrees with pre-parse evidence');
    });

    it('rejects malformed parsed PSBT account evidence after exact signer context', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());
      mockPsbtFromBase64.mockReturnValueOnce(makePsbt({
        witnessUtxo: { value: 2 },
        bip32Derivation: [{ ...derivation, path: "m/84'/0'" }],
      }));

      await expect(adapter.signPSBT({
        psbt: 'malformed-parsed-account',
        signingContext: {
          signers: [{ accountPath: "m/84'/0'/0'" }],
        } as any,
      })).rejects.toThrow('account path is not an exact account path');
    });

    it('rejects signer context when the parsed PSBT has no account evidence', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());
      mockPsbtFromBase64.mockReturnValueOnce({
        ...makePsbt({}),
        data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] },
        txInputs: [],
        txOutputs: [],
      });

      await expect(adapter.signPSBT({
        psbt: 'missing-parsed-account',
        signingContext: {
          signers: [{ accountPath: "m/84'/0'/0'" }],
        } as any,
      })).rejects.toThrow('account path is missing');
    });

    it('treats an absent PSBT output map as an external output', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn().mockResolvedValue([]));
      vi.mocked((await import('bitcoinjs-lib')).address.fromBase58Check).mockReturnValue({
        version: 0, hash: Buffer.alloc(20),
      });
      const psbt = makePsbt(
        { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] },
        {},
        { value: 1, address: '1external' },
      );
      psbt.data.outputs = [];
      mockPsbtFromBase64.mockReturnValueOnce(psbt);
      await expect(adapter.signPSBT({ psbt: 'no-output-map', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('0 signatures for 1 inputs');
    });

    it.each([
      ['non-account request path', { accountPath: "m/84'/0'/0'/0/0" }, { ...makePsbt({}), data: { globalMap: { unsignedTx: {} }, inputs: [], outputs: [] }, txInputs: [], txOutputs: [] }, 'pre-parse account path is not exact'],
      ['non-address input keypath', { accountPath: "m/84'/0'/0'" }, makePsbt({ witnessUtxo: { value: 2 }, bip32Derivation: [{ ...derivation, path: "m/84'/0'/0'/2/0" }] }), 'outside the selected account'],
      ['disagreeing input hint', { accountPath: "m/84'/0'/0'", inputPaths: ["m/84'/0'/0'/0/1"] }, makePsbt({ witnessUtxo: { value: 2 }, bip32Derivation: [derivation] }), 'request keypath disagrees'],
      ['missing unsigned input', { accountPath: "m/84'/0'/0'" }, { ...makePsbt({ witnessUtxo: { value: 2 }, bip32Derivation: [derivation] }), txInputs: [] }, 'no unsigned transaction input'],
      ['receive metadata on output', { accountPath: "m/84'/0'/0'" }, makePsbt({ witnessUtxo: { value: 2 }, bip32Derivation: [derivation] }, { bip32Derivation: [{ path: "m/84'/0'/0'/0/1" }] }), 'not an exact change path'],
    ])('rejects %s', async (_name, request, psbt, message) => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn());
      mockPsbtFromBase64.mockReturnValueOnce(psbt);
      await expect(adapter.signPSBT({ psbt: 'boundary', ...request } as any)).rejects.toThrow(message);
    });

    it('decodes an external bech32 payload before signature-count validation', async () => {
      const adapter = createBitBoxAdapter();
      seedSigningAdapter(adapter, vi.fn().mockResolvedValue([]));
      vi.mocked((await import('bitcoinjs-lib')).address.fromBech32).mockReturnValue({
        version: 0, prefix: 'bc', data: Buffer.alloc(20, 7),
      });
      mockPsbtFromBase64.mockReturnValueOnce(makePsbt(
        { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] },
        {},
        { value: 1, address: 'bc1qexternal' },
      ));
      await expect(adapter.signPSBT({ psbt: 'bech32', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('0 signatures for 1 inputs');
    });

    it('rejects a later input from a different valid account before device signing', async () => {
      const adapter = createBitBoxAdapter();
      const signer = vi.fn();
      seedSigningAdapter(adapter, signer);
      mockPsbtFromBase64.mockReturnValueOnce({
        data: {
          globalMap: { unsignedTx: {} },
          inputs: [
            { witnessUtxo: { value: 2 }, bip32Derivation: [derivation] },
            {
              witnessUtxo: { value: 3 },
              bip32Derivation: [{
                ...derivation,
                path: "m/84'/0'/1'/0/0",
              }],
            },
          ],
          outputs: [],
        },
        txInputs: [
          { hash: Buffer.alloc(32), index: 0, sequence: 1 },
          { hash: Buffer.alloc(32, 1), index: 0, sequence: 1 },
        ],
        txOutputs: [],
        version: 2,
        locktime: 0,
        updateInput: vi.fn(),
        finalizeAllInputs: vi.fn(),
        toBase64: vi.fn(),
      });

      await expect(adapter.signPSBT({ psbt: 'foreign-account-input', accountPath: "m/84'/0'/0'" }))
        .rejects.toThrow('input 1 keypath is outside the selected account');
      expect(signer).not.toHaveBeenCalled();
    });
  });
}
