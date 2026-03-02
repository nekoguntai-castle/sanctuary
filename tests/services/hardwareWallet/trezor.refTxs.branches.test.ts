import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { fetchRefTxs } from '../../../services/hardwareWallet/adapters/trezor/refTxs';

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

vi.mock('../../../utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: vi.fn(),
  }),
}));

function makeRawTxHex(): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 10;
  tx.addInput(Buffer.alloc(32, 1), 1, 0xfffffffd);
  tx.addOutput(Buffer.from(`0014${'22'.repeat(20)}`, 'hex'), 12_345);
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
        script: Buffer.from(`0014${'11'.repeat(20)}`, 'hex'),
        value: 50_000,
      },
    } as any);
  });
  psbt.addOutput({
    script: Buffer.from(`0014${'33'.repeat(20)}`, 'hex'),
    value: 40_000,
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

    const refTxs = await fetchRefTxs(psbt);

    expect(mockApiGet).toHaveBeenCalledTimes(2);
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
        amount: 12_345,
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

    const refTxs = await fetchRefTxs(psbt);

    expect(refTxs).toHaveLength(1);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to fetch reference transaction',
      expect.any(Object)
    );
  });
});
