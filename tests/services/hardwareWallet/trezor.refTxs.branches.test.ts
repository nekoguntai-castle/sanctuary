import * as bitcoin from 'bitcoinjs-lib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRefTxs } from '../../../src/services/hardwareWallet/adapters/trezor/refTxs';

const { mockApiGet, mockLoggerWarn } = vi.hoisted(() => ({
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

function makeRawTxHex(scriptByte = '22', value = 12_345n): string {
  const tx = new bitcoin.Transaction();
  tx.version = 2;
  tx.locktime = 10;
  tx.addInput(new Uint8Array(32).fill(1), 1, 0xfffffffd);
  tx.addOutput(hexToBytes(`0014${scriptByte.repeat(20)}`), value);
  return tx.toHex();
}

function makePsbtWithInputs(hashes: string[], indexes: number[] = []): bitcoin.Psbt {
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  hashes.forEach((hash, idx) => {
    psbt.addInput({
      hash,
      index: indexes[idx] ?? 0,
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

function makePsbtWithAuthenticatedPrevious(): {
  psbt: bitcoin.Psbt;
  previous: bitcoin.Transaction;
} {
  const previous = bitcoin.Transaction.fromHex(makeRawTxHex());
  const psbt = new bitcoin.Psbt({ network: bitcoin.networks.bitcoin });
  psbt.addInput({
    hash: previous.getId(),
    index: 0,
    nonWitnessUtxo: previous.toBuffer(),
    witnessUtxo: {
      script: previous.outs[0].script,
      value: previous.outs[0].value,
    },
  });
  psbt.addOutput({
    script: hexToBytes(`0014${'33'.repeat(20)}`),
    value: 10_000n,
  });
  return { psbt, previous };
}

describe('trezor refTxs branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ hex: makeRawTxHex() });
  });

  it('fetches unique authenticated txids only and normalizes raw transaction shape', async () => {
    const previousA = bitcoin.Transaction.fromHex(makeRawTxHex('11', 50_000n));
    previousA.addOutput(hexToBytes(`0014${'11'.repeat(20)}`), 50_000n);
    const rawA = previousA.toHex();
    const rawB = makeRawTxHex('11', 50_000n).replace('0a000000', '0b000000');
    const txidA = bitcoin.Transaction.fromHex(rawA).getId();
    const txidB = bitcoin.Transaction.fromHex(rawB).getId();
    const psbt = makePsbtWithInputs([txidA, txidA, txidB], [0, 1, 0]);
    mockApiGet.mockImplementation(async (url: string) => ({
      hex: url.includes(txidA) ? rawA : rawB,
    }));

    const refTxs = await fetchRefTxs(psbt, 'wallet-primary');

    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(mockApiGet).toHaveBeenNthCalledWith(
      1,
      `/wallets/wallet-primary/transactions/${txidA}/raw`,
      undefined,
      { enabled: false },
      { timeoutMs: 10_000 }
    );
    expect(mockApiGet).toHaveBeenNthCalledWith(
      2,
      `/wallets/wallet-primary/transactions/${txidB}/raw`,
      undefined,
      { enabled: false },
      { timeoutMs: 10_000 }
    );
    expect(refTxs).toHaveLength(2);
    expect(refTxs[0]).toEqual(
      expect.objectContaining({
        hash: txidA,
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
        amount: '50000',
      })
    );
  });

  it('rejects a remotely fetched transaction whose bytes do not match the requested txid', async () => {
    const psbt = makePsbtWithInputs(['aa'.repeat(32)]);

    await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
      'fetched transaction id differs from its outpoint'
    );
  });

  it.each([
    ['amount', { value: 50_001n, script: hexToBytes(`0014${'11'.repeat(20)}`) }],
    ['script', { value: 50_000n, script: hexToBytes(`0014${'12'.repeat(20)}`) }],
  ] as const)(
    'rejects a remotely fetched previous-output %s mismatch',
    async (_label, witnessUtxo) => {
      const raw = makeRawTxHex('11', 50_000n);
      const txid = bitcoin.Transaction.fromHex(raw).getId();
      const psbt = makePsbtWithInputs([txid]);
      psbt.data.inputs[0].witnessUtxo = witnessUtxo;
      mockApiGet.mockResolvedValueOnce({ hex: raw });

      await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
        'fetched previous output differs from witnessUtxo'
      );
    }
  );

  it('rejects a remotely fetched transaction missing the selected output', async () => {
    const raw = makeRawTxHex('11', 50_000n);
    const txid = bitcoin.Transaction.fromHex(raw).getId();
    const psbt = makePsbtWithInputs([txid], [1]);
    mockApiGet.mockResolvedValueOnce({ hex: raw });

    await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
      'does not contain selected output'
    );
  });

  it('rejects malformed successful API responses instead of treating them as transport failures', async () => {
    const psbt = makePsbtWithInputs(['aa'.repeat(32)]);
    mockApiGet.mockResolvedValueOnce({ hex: 'not-transaction-hex' });

    await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow();
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('uses an authenticated PSBT reference transaction without an API lookup', async () => {
    const { psbt, previous } = makePsbtWithAuthenticatedPrevious();

    const refTxs = await fetchRefTxs(psbt, 'wallet-primary');

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(refTxs).toEqual([
      expect.objectContaining({
        hash: previous.getId(),
        version: previous.version,
        lock_time: previous.locktime,
      }),
    ]);
  });

  it('uses a later authenticated PSBT reference for every input sharing its txid', async () => {
    const previous = bitcoin.Transaction.fromHex(makeRawTxHex('11', 50_000n));
    previous.addOutput(hexToBytes(`0014${'11'.repeat(20)}`), 50_000n);
    const psbt = makePsbtWithInputs([previous.getId(), previous.getId()], [0, 1]);
    psbt.data.inputs[1].nonWitnessUtxo = previous.toBuffer();

    const refTxs = await fetchRefTxs(psbt, 'wallet-primary');

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(refTxs).toHaveLength(1);
    expect(refTxs[0].hash).toBe(previous.getId());
    expect(refTxs[0].bin_outputs).toHaveLength(2);
  });

  it('rejects conflicting non-witness bytes for inputs sharing a txid', async () => {
    const previous = bitcoin.Transaction.fromHex(makeRawTxHex('11', 50_000n));
    previous.addOutput(hexToBytes(`0014${'11'.repeat(20)}`), 50_000n);
    const alternate = bitcoin.Transaction.fromBuffer(previous.toBuffer());
    alternate.setWitness(0, [hexToBytes('01')]);
    expect(alternate.getId()).toBe(previous.getId());
    const psbt = makePsbtWithInputs([previous.getId(), previous.getId()], [0, 1]);
    psbt.data.inputs[0].nonWitnessUtxo = previous.toBuffer();
    psbt.data.inputs[1].nonWitnessUtxo = alternate.toBuffer();

    await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
      'nonWitnessUtxo differs from the shared reference transaction'
    );
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('rejects a PSBT reference transaction whose bytes do not match the outpoint', async () => {
    const { psbt } = makePsbtWithAuthenticatedPrevious();
    psbt.data.inputs[0].nonWitnessUtxo = bitcoin.Transaction.fromHex(
      makeRawTxHex().replace(/.$/, '1')
    ).toBuffer();

    await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
      'nonWitnessUtxo transaction id differs'
    );
    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('fails closed when any required raw-transaction fetch fails', async () => {
    const raw = makeRawTxHex('11', 50_000n);
    const txid = bitcoin.Transaction.fromHex(raw).getId();
    const psbt = makePsbtWithInputs([txid, 'dd'.repeat(32)]);

    mockApiGet
      .mockResolvedValueOnce({ hex: raw })
      .mockRejectedValueOnce(new Error('ref tx unavailable'));

    await expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
      `Required reference transaction ${'dd'.repeat(32)} could not be fetched`
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Failed to fetch reference transaction',
      expect.any(Object)
    );
  });

  it('starts independent unique reference fetches in parallel while preserving input order', async () => {
    const rawA = makeRawTxHex('11', 50_000n);
    const rawB = makeRawTxHex('11', 50_000n).replace('0a000000', '0b000000');
    const txidA = bitcoin.Transaction.fromHex(rawA).getId();
    const txidB = bitcoin.Transaction.fromHex(rawB).getId();
    const psbt = makePsbtWithInputs([txidA, txidB]);
    let resolveFirst: ((value: { hex: string }) => void) | undefined;
    mockApiGet
      .mockImplementationOnce(
        () =>
          new Promise<{ hex: string }>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce({ hex: rawB });

    const refTxPromise = fetchRefTxs(psbt, 'wallet-primary');
    await vi.waitFor(() => expect(mockApiGet).toHaveBeenCalledTimes(2));
    resolveFirst?.({ hex: rawA });

    const refTxs = await refTxPromise;
    expect(refTxs.map(({ hash }) => hash)).toEqual([txidA, txidB]);
  });

  it('applies an aggregate timeout even when the API client does not settle', async () => {
    vi.useFakeTimers();
    try {
      const txid = 'aa'.repeat(32);
      const psbt = makePsbtWithInputs([txid]);
      mockApiGet.mockImplementationOnce(() => new Promise(() => undefined));

      const rejection = expect(fetchRefTxs(psbt, 'wallet-primary')).rejects.toThrow(
        `Timed out fetching required reference transactions: ${txid}`
      );
      await vi.advanceTimersByTimeAsync(12_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the same txid scoped to the wallet selected for signing', async () => {
    const raw = makeRawTxHex('11', 50_000n);
    const txid = bitcoin.Transaction.fromHex(raw).getId();
    const psbt = makePsbtWithInputs([txid]);
    mockApiGet.mockResolvedValue({ hex: raw });

    await fetchRefTxs(psbt, 'wallet-one');
    await fetchRefTxs(psbt, 'wallet-two');

    expect(mockApiGet).toHaveBeenNthCalledWith(
      1,
      `/wallets/wallet-one/transactions/${txid}/raw`,
      undefined,
      { enabled: false },
      { timeoutMs: 10_000 }
    );
    expect(mockApiGet).toHaveBeenNthCalledWith(
      2,
      `/wallets/wallet-two/transactions/${txid}/raw`,
      undefined,
      { enabled: false },
      { timeoutMs: 10_000 }
    );
  });
});
