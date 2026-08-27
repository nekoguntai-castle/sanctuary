import { expect, it, vi } from 'vitest';
import {
  createMockUTXO,
  mockElectrumClient,
} from '../../../../../mocks/electrum';
import {
  createTestContext,
  fetchUtxosPhase,
  type SyncContext,
} from '../../../../../../src/services/bitcoin/sync';
import { fetchAuthenticatedTransactions } from '../../../../../../src/services/bitcoin/sync/evidenceAuthentication';

export function registerFetchUtxosPhaseTests(): void {
  it('keeps authenticated siblings and counts an unresolved transaction only once', async () => {
    const address = 'utxo-partial-authentication';
    const acceptedUtxo = createMockUTXO({
      txid: 'a'.repeat(64), vout: 0, value: 100_000,
    });
    const unresolvedUtxo = createMockUTXO({
      txid: 'b'.repeat(64), vout: 1, value: 200_000,
    });
    mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
      new Map([[address, [acceptedUtxo, unresolvedUtxo]]]),
    );
    vi.mocked(fetchAuthenticatedTransactions).mockImplementationOnce(async (ctx) => {
      ctx.txDetailsCache.set(acceptedUtxo.tx_hash, {
        txid: acceptedUtxo.tx_hash, hex: '00', vin: [], vout: [],
      });
      ctx.rejectedEvidenceCount++;
      ctx.rejectedEvidenceReasons.set('fetch_budget_exhausted', 1);
      return new Set([acceptedUtxo.tx_hash]);
    });
    const addressRecord = { id: '1', address, scriptPubKey: '0014' };
    const ctx = createTestContext({
      addresses: [addressRecord] as any,
      addressMap: new Map([[address, addressRecord]]) as any,
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    expect(result.utxoResults).toEqual([{ address, utxos: [acceptedUtxo] }]);
    expect(result.rejectedEvidenceCount).toBe(1);
    expect(result.rejectedEvidenceReasons).toEqual(new Map([
      ['fetch_budget_exhausted', 1],
    ]));
  });

  it('records only unresolved fallback addresses when the local UTXO budget expires', async () => {
    vi.useFakeTimers();
    try {
      const acceptedAddress = 'utxo-accepted';
      const failedAddress = 'utxo-failed';
      const budgetAddress = 'utxo-budget';
      const acceptedUtxo = createMockUTXO({ value: 100000, height: 800000 });
      mockElectrumClient.getAddressUTXOsBatch.mockRejectedValue(new Error('Batch failed'));
      mockElectrumClient.getAddressUTXOs.mockImplementation(
        async (address: string, options?: { signal?: AbortSignal }) => {
          if (address === acceptedAddress) return [acceptedUtxo];
          if (address === failedAddress) throw new Error('Individual failed');
          return new Promise((_, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(options.signal?.reason),
              { once: true },
            );
          });
        },
      );
      const now = Date.now();
      const addresses = [acceptedAddress, failedAddress, budgetAddress].map((address, index) => ({
        id: String(index),
        address,
        scriptPubKey: '0014',
      }));
      const phaseProgress = {
        begin: vi.fn(() => true),
        finish: vi.fn(() => true),
        budgetExpired: vi.fn(() => true),
        activeStage: vi.fn(() => 'utxo_reconciliation' as const),
      };
      const ctx = createTestContext({
        addresses: addresses as any,
        addressMap: new Map(addresses.map(address => [address.address, address])) as any,
        client: mockElectrumClient as any,
        attemptRuntime: {
          signal: new AbortController().signal,
          deadlineAt: now + 100,
          phaseProgress,
        },
      });

      const pending = fetchUtxosPhase(ctx).then(
        result => result,
        error => error as unknown,
      );
      await vi.advanceTimersByTimeAsync(100);
      const result = await pending as SyncContext;

      expect(result).toBe(ctx);
      if (result !== ctx) return;
      expect(result.utxoResults).toEqual([{ address: acceptedAddress, utxos: [acceptedUtxo] }]);
      expect(result.rejectedEvidenceCount).toBe(2);
      expect(result.rejectedEvidenceReasons).toEqual(new Map([
        ['utxo_fetch_failed', 1],
        ['fetch_budget_exhausted', 1],
      ]));
      expect(phaseProgress.budgetExpired).toHaveBeenCalledOnce();
      expect(phaseProgress.begin).toHaveBeenCalledWith(
        'utxo_reconciliation',
        'Continuing UTXO reconciliation with authenticated evidence.',
        { completed: 2, total: 3, unit: 'addresses' },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not swallow attempt cancellation as an empty UTXO result', async () => {
    const controller = new AbortController();
    const reason = new Error('attempt cancelled');
    mockElectrumClient.getAddressUTXOsBatch.mockImplementation(async () => {
      controller.abort(reason);
      throw reason;
    });
    const ctx = createTestContext({
      addresses: [{ id: '1', address: 'addr1', scriptPubKey: '0014' } as any],
      client: mockElectrumClient as any,
      attemptRuntime: { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
    });

    await expect(fetchUtxosPhase(ctx)).rejects.toBe(reason);
    expect(mockElectrumClient.getAddressUTXOs).not.toHaveBeenCalled();
  });

  it('rejects a UTXO response when its canonical address script is unavailable', async () => {
    const address = 'tb1qmissingcanonicalscript';
    const utxo = createMockUTXO({ value: 100000, height: 800000 });
    mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
      new Map([[address, [utxo]]])
    );

    const ctx = createTestContext({
      addresses: [{ id: 'missing-script', address, scriptPubKey: null } as any],
      addressMap: new Map([[address, { id: 'missing-script', address, scriptPubKey: null }]]) as any,
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    expect(result.utxoResults).toEqual([]);
    expect(result.allUtxoKeys.size).toBe(0);
    expect(result.rejectedEvidenceCount).toBe(1);
    expect(fetchAuthenticatedTransactions).not.toHaveBeenCalled();
  });

  it('makes an omitted batch address retryable', async () => {
    mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(new Map());
    const ctx = createTestContext({
      addresses: [{ id: '1', address: 'addr1', scriptPubKey: '0014' } as any],
      addressMap: new Map([['addr1', { id: '1', address: 'addr1', scriptPubKey: '0014' }]]) as any,
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    expect(result.utxoResults).toEqual([]);
    expect(result.rejectedEvidenceCount).toBe(1);
  });

  it('should fetch UTXOs for all addresses', async () => {
    const addr1 = 'tb1qaddr1';
    const addr2 = 'tb1qaddr2';

    mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
      new Map([
        [addr1, [createMockUTXO({ value: 100000, height: 800000 })]],
        [addr2, [createMockUTXO({ value: 200000, height: 800001 })]],
      ])
    );

    const ctx = createTestContext({
      addresses: [
        { id: '1', address: addr1, scriptPubKey: '0014' } as any,
        { id: '2', address: addr2, scriptPubKey: '0014' } as any,
      ],
      addressMap: new Map([
        [addr1, { id: '1', address: addr1, scriptPubKey: '0014' }],
        [addr2, { id: '2', address: addr2, scriptPubKey: '0014' }],
      ]) as any,
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    expect(result.utxoResults.length).toBe(2);
    // utxosFetched counts total UTXO count, not addresses
    expect(result.stats.utxosFetched).toBeGreaterThanOrEqual(1);
  });

  it('should build UTXO data map with correct keys', async () => {
    const txid = 'utxo_tx'.padEnd(64, 'a');
    const vout = 1;

    mockElectrumClient.getAddressUTXOsBatch.mockResolvedValue(
      new Map([
        ['addr1', [{ tx_hash: txid, tx_pos: vout, value: 50000, height: 800000 }]],
      ])
    );

    const ctx = createTestContext({
      addresses: [{ id: '1', address: 'addr1', scriptPubKey: '0014' } as any],
      addressMap: new Map([['addr1', { id: '1', address: 'addr1', scriptPubKey: '0014' }]]) as any,
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    const key = `${txid}:${vout}`;
    expect(result.allUtxoKeys.has(key)).toBe(true);
    expect(result.utxoDataMap.get(key)).toBeDefined();
    expect(result.utxoDataMap.get(key)?.address).toBe('addr1');
  });

  it('should fall back to individual requests on batch failure', async () => {
    mockElectrumClient.getAddressUTXOsBatch.mockRejectedValue(new Error('Batch failed'));
    mockElectrumClient.getAddressUTXOs.mockResolvedValue([
      createMockUTXO({ value: 75000, height: 800000 }),
    ]);

    const ctx = createTestContext({
      addresses: [{ id: '1', address: 'addr1', scriptPubKey: '0014' } as any],
      addressMap: new Map([['addr1', { id: '1', address: 'addr1', scriptPubKey: '0014' }]]) as any,
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    expect(result.utxoResults.length).toBe(1);
    expect(mockElectrumClient.getAddressUTXOs).toHaveBeenCalled();
  });

  it('should continue when individual UTXO fallback fails for an address', async () => {
    mockElectrumClient.getAddressUTXOsBatch.mockRejectedValue(new Error('Batch failed'));
    mockElectrumClient.getAddressUTXOs.mockRejectedValue(new Error('Address lookup failed'));

    const ctx = createTestContext({
      addresses: [{ id: '1', address: 'addr1', scriptPubKey: '0014' } as any],
      client: mockElectrumClient as any,
    });

    const result = await fetchUtxosPhase(ctx);

    expect(result.utxoResults).toEqual([]);
    expect(result.rejectedEvidenceCount).toBe(1);
    expect(mockElectrumClient.getAddressUTXOs).toHaveBeenCalledWith('addr1');
  });
}
