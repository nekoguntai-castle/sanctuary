import * as bitcoin from 'bitcoinjs-lib';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { fetchRefTxs } from '../../../src/services/hardwareWallet/adapters/trezor/refTxs';

const {
  mockApiGet,
  mockLoggerWarn,
} = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockLoggerWarn: vi.fn(),
}));

vi.mock('../../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: vi.fn(),
  }),
}));

/** Convert hex to Uint8Array (bitcoinjs-lib v7 requires Uint8Array, not Buffer, in jsdom) */
function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function makeRawTxHex(): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 10;
  tx.addInput(new Uint8Array(32).fill(1), 1, 0xfffffffd);
  tx.addOutput(hexToBytes(`0014${'22'.repeat(20)}`), BigInt(12_345));
  return tx.toHex();
}

function makePsbtWithInputs(hashes: string[]): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  hashes.forEach((hash, idx) => {
    psbt.addInput({
      hash,
      index: idx % 2,
      sequence: 0xfffffffd - idx,
      witnessUtxo: {
        script: hexToBytes(`0014${'11'.repeat(20)}`),
        value: BigInt(50_000),
      },
    } as any);
  });
  psbt.addOutput({
    script: hexToBytes(`0014${'33'.repeat(20)}`),
    value: BigInt(40_000),
  });
  return psbt;
}

describe('trezor refTxs branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ hex: makeRawTxHex() });
  });

  it('fetches unique txids only and normalizes raw transaction shape', async () => {
    const psbt = makePsbtWithInputs([
      'aa'.repeat(32),
      'aa'.repeat(32),
      'bb'.repeat(32),
    ]);

    const refTxs = await fetchRefTxs(psbt, 'wallet-primary');

    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(mockApiGet).toHaveBeenNthCalledWith(
      1,
      `/wallets/wallet-primary/transactions/${'aa'.repeat(32)}/raw`
    );
    expect(mockApiGet).toHaveBeenNthCalledWith(
      2,
      `/wallets/wallet-primary/transactions/${'bb'.repeat(32)}/raw`
    );
    expect(refTxs).toHaveLength(2);
    expect(refTxs[0]).toEqual(
      expect.objectContaining({
        hash: 'aa'.repeat(32),
        version: 2,
        lock_time: 10,
      })
    );
    expect(refTxs[0].inputs[0]).toEqual(
      expect.objectContaining({
        prev_index: 1,
        sequence: 0xfffffffd,
      })
    );
    expect(refTxs[0].bin_outputs[0]).toEqual(
      expect.objectContaining({
        amount: BigInt(12_345),
      })
    );
  });

  it('continues when raw-transaction fetch fails and logs a warning', async () => {
    const psbt = makePsbtWithInputs([
      'cc'.repeat(32),
      'dd'.repeat(32),
    ]);

    mockApiGet
      .mockResolvedValueOnce({ hex: makeRawTxHex() })
      .mockRejectedValueOnce(new Error('ref tx unavailable'));

    const refTxs = await fetchRefTxs(psbt, 'wallet-primary');

    expect(refTxs).toHaveLength(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to fetch reference transaction',
      expect.any(Object)
    );
  });

  it('keeps the same txid scoped to the wallet selected for signing', async () => {
    const txid = 'ee'.repeat(32);
    const psbt = makePsbtWithInputs([txid]);

    await fetchRefTxs(psbt, 'wallet-one');
    await fetchRefTxs(psbt, 'wallet-two');

    expect(mockApiGet).toHaveBeenNthCalledWith(
      1,
      `/wallets/wallet-one/transactions/${txid}/raw`
    );
    expect(mockApiGet).toHaveBeenNthCalledWith(
      2,
      `/wallets/wallet-two/transactions/${txid}/raw`
    );
  });
});
