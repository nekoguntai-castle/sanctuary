import type { ElectrumClient } from './electrum';
import type { ElectrumPool, NetworkType, PooledConnectionHandle } from './electrumPool';
import type { NodeClientInterface, NodeRequestOptions } from './nodeClient';

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason));
}

async function acquireAbortably(
  pool: ElectrumPool,
  options?: NodeRequestOptions,
): Promise<PooledConnectionHandle> {
  options?.signal?.throwIfAborted();
  // Keep the pool's configured acquisition timeout. The caller signal still
  // detaches promptly, and a handle delivered afterward is released below.
  // Passing the much larger stage deadline here would turn a five-second
  // capacity bound into a multi-minute queue wait.
  const pending = pool.acquire({ purpose: 'node-request' });
  const signal = options?.signal;
  if (!signal) return pending;

  return new Promise<PooledConnectionHandle>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      settled = true;
      reject(cancellationError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    void pending.then(
      (handle) => {
        if (settled) {
          handle.release();
          return;
        }
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve(handle);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Stable request facade backed by one borrowed pool connection per operation.
 * Subscription ownership deliberately stays on the pool's dedicated client.
 */
export class PooledNodeClient implements NodeClientInterface {
  constructor(
    private readonly pool: ElectrumPool,
    private readonly network: NetworkType,
  ) {}

  private async withClient<T>(
    options: NodeRequestOptions | undefined,
    operation: (client: ElectrumClient) => Promise<T>,
  ): Promise<T> {
    const handle = await acquireAbortably(this.pool, options);
    try {
      options?.signal?.throwIfAborted();
      return await operation(handle.client);
    } finally {
      handle.release();
    }
  }

  async connect(): Promise<void> {
    await this.withClient(undefined, async () => undefined);
  }

  disconnect(): void {
    // The registry owns the shared pool lifecycle.
  }

  isConnected(): boolean {
    return this.pool.isPoolInitialized();
  }

  getServerVersion() {
    return this.withClient(undefined, client => client.getServerVersion());
  }

  getServerFeatures() {
    return this.withClient(undefined, client => client.getServerFeatures());
  }

  getBlockHeight(options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getBlockHeight(options));
  }

  getBlockHeader(height: number, options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getBlockHeader(height, options));
  }

  getAddressHistory(address: string, options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getAddressHistory(address, options));
  }

  getAddressBalance(address: string) {
    return this.withClient(undefined, client => client.getAddressBalance(address));
  }

  getAddressUTXOs(address: string, options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getAddressUTXOs(address, options));
  }

  getTransaction(txid: string, verbose = false, options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getTransaction(txid, verbose, options));
  }

  broadcastTransaction(rawTx: string) {
    return this.withClient(undefined, client => client.broadcastTransaction(rawTx));
  }

  estimateFee(blocks: number) {
    return this.withClient(undefined, client => client.estimateFee(blocks));
  }

  subscribeAddress(_address: string): Promise<string | null> {
    return Promise.reject(new Error(
      `Subscriptions for ${this.network} require the dedicated Electrum client`,
    ));
  }

  subscribeAddressBatch(_addresses: string[]): Promise<Map<string, string | null>> {
    return Promise.reject(new Error(
      `Subscriptions for ${this.network} require the dedicated Electrum client`,
    ));
  }

  getAddressHistoryBatch(addresses: string[], options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getAddressHistoryBatch(addresses, options));
  }

  getAddressUTXOsBatch(addresses: string[], options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getAddressUTXOsBatch(addresses, options));
  }

  getTransactionsBatch(txids: string[], verbose = true, options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getTransactionsBatch(txids, verbose, options));
  }

  getRawTransactionEvidence(txid: string, options?: NodeRequestOptions) {
    return this.withClient(options, client => client.getRawTransactionEvidence(txid, options));
  }

  getRawTransactionEvidenceBatch(txids: string[], options?: NodeRequestOptions) {
    return this.withClient(
      options,
      client => client.getRawTransactionEvidenceBatch(txids, options),
    );
  }
}
