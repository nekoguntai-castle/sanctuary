/**
 * Electrum Client
 *
 * Public API and connection lifecycle orchestrator for communicating with
 * Electrum servers. Coordinates the connection, protocol, and method modules
 * to provide a complete Electrum client interface.
 */

import net from 'net';
import tls from 'tls';
import { EventEmitter } from 'events';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { createConnection, wrapSocketInTls, applySocketOptimizations } from './connection';
import {
  createRequestMessage,
  createBatchMessage,
  ElectrumFrameDecoder,
  ELECTRUM_MAX_BATCH_RESPONSE_BYTES,
  ElectrumBatchResponseTooLargeError,
  rejectAllPendingRequests,
} from './protocol';
import { getDefaultTimeouts } from './clientConfig';
import { handleIncomingData } from './dataHandler';
import * as publicApi from './publicApi';
import * as methods from './methods';
import type {
  ElectrumConfig,
  ElectrumServerFeatures,
  TransactionDetails,
  BitcoinNetwork,
  PendingRequest,
} from './types';
import {
  resolveElectrumConnectionConfig,
  type ResolvedConnectionConfig,
} from './connectionConfigResolver';
import type { NodeRequestOptions } from '../nodeClient';

const log = createLogger('ELECTRUM:SVC_CLIENT');

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(String(signal.reason ?? 'Electrum request cancelled'));
}

async function awaitForCaller<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

interface ConnectionState {
  cleanup: () => void;
  handleSuccess: () => void;
  handleError: (error: Error) => void;
}

class ElectrumClient extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private connectionPromise: Promise<void> | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private readonly frameDecoder = new ElectrumFrameDecoder();
  private connected = false;
  private serverVersion: { server: string; protocol: string } | null = null;
  private explicitConfig: ElectrumConfig | null = null;
  private scriptHashToAddress = new Map<string, string>();  // Map scripthash to address
  private subscribedHeaders = false;
  private network: BitcoinNetwork; // Bitcoin network

  // Timeouts (adjusted for Tor when proxy is enabled)
  private requestTimeoutMs: number;
  private batchRequestTimeoutMs: number;
  private readonly maxBatchResponseBytes = ELECTRUM_MAX_BATCH_RESPONSE_BYTES;

  /**
   * Create an ElectrumClient
   * @param explicitConfig Optional config to use instead of database/env config
   */
  constructor(explicitConfig?: ElectrumConfig) {
    super();
    this.explicitConfig = explicitConfig || null;
    this.network = explicitConfig?.network ?? 'mainnet'; // Default to mainnet

    // Get timeout defaults from config
    const defaults = getDefaultTimeouts();

    // Calculate timeouts - increase for Tor connections
    const isProxyEnabled = explicitConfig?.proxy?.enabled ?? false;
    const multiplier = isProxyEnabled ? defaults.torTimeoutMultiplier : 1;

    this.requestTimeoutMs = (explicitConfig?.requestTimeoutMs ?? defaults.requestTimeoutMs) * multiplier;
    this.batchRequestTimeoutMs = (explicitConfig?.batchRequestTimeoutMs ?? defaults.batchRequestTimeoutMs) * multiplier;

    if (isProxyEnabled) {
      log.debug(`ElectrumClient configured with Tor timeouts: request=${this.requestTimeoutMs}ms, batch=${this.batchRequestTimeoutMs}ms`);
    }
  }

  /**
   * Set the network for this client (used when created without explicitConfig)
   */
  setNetwork(network: BitcoinNetwork): void {
    this.network = network;
  }

  /**
   * Get the network for this client
   */
  getNetwork(): BitcoinNetwork {
    return this.network;
  }

  /**
   * Connect to Electrum server
   */
  async connect(): Promise<void> {
    if (this.connected && this.socket) return;
    if (this.connectionPromise) return this.connectionPromise;
    const attempt = this.establishConnection();
    this.connectionPromise = attempt;
    try {
      await attempt;
    } finally {
      this.connectionPromise = null;
    }
  }

  private async establishConnection(): Promise<void> {
    const connectionConfig = await this.resolveConnectionConfig();
    const defaults = getDefaultTimeouts();
    const connectionTimeoutMs = this.explicitConfig?.connectionTimeoutMs ?? defaults.connectionTimeoutMs;
    return this.openConnection(connectionConfig, connectionTimeoutMs);
  }

  private async resolveConnectionConfig(): Promise<ResolvedConnectionConfig> {
    return resolveElectrumConnectionConfig(this.explicitConfig, this.network);
  }

  private openConnection(
    connectionConfig: ResolvedConnectionConfig,
    connectionTimeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const { host, port, protocol, allowSelfSignedCert, proxy } = connectionConfig;
      let connectionTimeout: NodeJS.Timeout | null = null;
      let settled = false;

      const cleanup = () => {
        if (connectionTimeout) {
          clearTimeout(connectionTimeout);
          connectionTimeout = null;
        }
      };

      const handleSuccess = () => {
        /* v8 ignore next -- socket success/error race guard is defensive */
        if (settled) return;
        settled = true;
        cleanup();
        this.connected = true;
        resolve();
      };

      const handleError = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.connected = false;
        if (this.socket) {
          this.socket.destroy();
        }
        reject(error);
      };

      const state = { cleanup, handleSuccess, handleError };

      try {
        connectionTimeout = setTimeout(() => {
          const timeoutError = new Error(`Connection timeout after ${connectionTimeoutMs}ms to ${host}:${port} (${protocol})${proxy?.enabled ? ' via proxy' : ''}`);
          log.warn(`Connection timeout`, { host, port, protocol, proxy: proxy?.enabled, timeoutMs: connectionTimeoutMs });
          handleError(timeoutError);
        }, connectionTimeoutMs);

        createConnection(host, port, proxy, connectionTimeoutMs)
          .then((baseSocket) => this.finishSocketConnection(baseSocket, connectionConfig, state))
          .catch((error) => {
            log.error('Connection error', { error: getErrorMessage(error) });
            handleError(error as Error);
          });
      } catch (error) {
        log.error('Connection setup error', { error: getErrorMessage(error) });
        handleError(error as Error);
      }
    });
  }

  private finishSocketConnection(
    baseSocket: net.Socket,
    connectionConfig: ResolvedConnectionConfig,
    state: ConnectionState
  ): void {
    let socket: net.Socket | tls.TLSSocket;
    if (connectionConfig.protocol === 'ssl') {
      socket = this.finishTlsConnection(baseSocket, connectionConfig, state);
    } else {
      socket = this.finishTcpConnection(baseSocket, connectionConfig, state);
    }
    this.attachSocketHandlers(socket);
  }

  private finishTlsConnection(
    baseSocket: net.Socket,
    connectionConfig: ResolvedConnectionConfig,
    state: ConnectionState
  ): tls.TLSSocket {
    const { host, port, allowSelfSignedCert, proxy } = connectionConfig;
    const { tlsSocket, handshakePromise } = wrapSocketInTls(
      baseSocket, host, port, allowSelfSignedCert, !!proxy?.enabled
    );
    this.frameDecoder.reset();
    this.socket = tlsSocket;
    handshakePromise
      .then(() => state.handleSuccess())
      .catch((err) => state.handleError(err));
    return tlsSocket;
  }

  private finishTcpConnection(
    baseSocket: net.Socket,
    connectionConfig: ResolvedConnectionConfig,
    state: ConnectionState
  ): net.Socket {
    const { host, port, protocol, proxy } = connectionConfig;
    this.frameDecoder.reset();
    this.socket = baseSocket;
    log.info(`Connected to ${host}:${port} (${protocol})${proxy?.enabled ? ' via proxy' : ''}`);
    applySocketOptimizations(baseSocket);
    state.handleSuccess();
    return baseSocket;
  }

  private attachSocketHandlers(socket: net.Socket | tls.TLSSocket): void {
    // Overlapping connect attempts can leave an older socket emitting late.
    // Only the currently installed socket may mutate framing or request state.
    socket.on('data', (data) => {
      if (socket === this.socket) this.handleData(data);
    });
    socket.on('error', (error) => this.handleSocketError(socket, error));
    socket.on('close', () => this.handleSocketClose(socket));
    socket.on('end', () => this.handleSocketEnd(socket));
  }

  private handleSocketError(socket: net.Socket | tls.TLSSocket, error: Error): void {
    if (socket !== this.socket) return;
    log.error('Socket error', { error: getErrorMessage(error) });
    rejectAllPendingRequests(this.pendingRequests, new Error(`Socket error: ${error.message}`));
  }

  private handleSocketClose(socket: net.Socket | tls.TLSSocket): void {
    if (socket !== this.socket) return;
    log.debug('Connection closed');
    const notifyClose = this.connected;
    this.connected = false;
    this.socket = null;
    this.frameDecoder.reset();
    this.serverVersion = null;
    rejectAllPendingRequests(this.pendingRequests, new Error('Connection closed unexpectedly'));
    if (notifyClose) this.emit('close');
  }

  private handleSocketEnd(socket: net.Socket | tls.TLSSocket): void {
    if (socket !== this.socket) return;
    log.debug('Connection ended');
    const notifyClose = this.connected;
    this.connected = false;
    this.socket = null;
    this.frameDecoder.reset();
    this.serverVersion = null;
    rejectAllPendingRequests(this.pendingRequests, new Error('Connection ended'));
    if (notifyClose) this.emit('close');
  }

  /**
   * Disconnect from Electrum server
   */
  disconnect(): void {
    rejectAllPendingRequests(this.pendingRequests, new Error('Connection closed'));

    if (this.socket) {
      const socket = this.socket;
      this.connected = false;
      this.serverVersion = null;
      this.socket = null;
      this.frameDecoder.reset();
      socket.destroy();
      this.scriptHashToAddress.clear();
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  // ===========================================================================
  // INTERNAL HELPERS (delegated to methods module)
  // ===========================================================================

  /**
   * Decode raw transaction hex to structured format
   */
  private decodeRawTransaction(rawTx: string): TransactionDetails {
    return methods.decodeRawTransaction(rawTx, this.network);
  }

  // ===========================================================================
  // DATA HANDLING
  // ===========================================================================

  /**
   * Handle incoming socket data - delegates to standalone handleIncomingData
   */
  private handleData(data: Buffer): void {
    try {
      handleIncomingData(
        this.frameDecoder,
        data,
        this.pendingRequests,
        this,
        this.scriptHashToAddress,
      );
    } catch (error) {
      const protocolError = error instanceof Error
        ? error
        : new Error('Electrum protocol framing failed');
      log.error('Electrum protocol framing failed; closing connection', {
        error: getErrorMessage(protocolError),
      });
      this.failClosedConnection(protocolError);
      return;
    }
  }

  private failClosedConnection(error: Error): void {
    const socket = this.socket;
    const notifyClose = this.connected;
    this.connected = false;
    this.socket = null;
    this.serverVersion = null;
    this.frameDecoder.reset();
    rejectAllPendingRequests(this.pendingRequests, error);
    socket?.destroy();
    if (notifyClose) this.emit('close');
  }

  // REQUEST/RESPONSE PRIMITIVES
  // ===========================================================================

  /**
   * Send request to Electrum server
   */
  private async request(
    method: string,
    params: unknown[] = [],
    options?: NodeRequestOptions,
  ): Promise<unknown> {
    options?.signal?.throwIfAborted();
    if (!this.connected || !this.socket) {
      await awaitForCaller(this.connect(), options?.signal);
    }
    options?.signal?.throwIfAborted();

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      const cleanup = (): void => {
        options?.signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = (): void => {
        const pending = this.pendingRequests.get(id)!;
        this.pendingRequests.delete(id);
        clearTimeout(pending.timeoutId);
        cleanup();
        reject(abortError(options!.signal!));
      };

      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        cleanup();
        log.warn(`Request timeout: method=${method} id=${id} pendingCount=${this.pendingRequests.size}`);
        reject(new Error(`Request timeout after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId, method, params, cleanup });
      options?.signal?.addEventListener('abort', onAbort, { once: true });

      const message = createRequestMessage(method, params, id);
      log.debug(`Sending request: method=${method} id=${id} pendingCount=${this.pendingRequests.size}`);
      try {
        this.socket!.write(message);
      } catch (error) {
        this.pendingRequests.delete(id);
        clearTimeout(timeoutId);
        cleanup();
        return reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Send multiple requests to Electrum server in a single batch.
   * Each request is sent on its own line but in quick succession.
   * Returns results in the same order as requests.
   */
  private async batchRequest(
    requests: Array<{ method: string; params: unknown[] }>,
    options?: NodeRequestOptions,
  ): Promise<unknown[]> {
    if (requests.length === 0) return [];
    options?.signal?.throwIfAborted();

    if (!this.connected || !this.socket) {
      await awaitForCaller(this.connect(), options?.signal);
    }
    options?.signal?.throwIfAborted();

    const startId = this.requestId + 1;
    const requestPromises: Promise<unknown>[] = [];
    const activeIds = new Set<number>();
    let responseBytes = 0;

    const { message, ids } = createBatchMessage(requests, startId);
    this.requestId += requests.length;

    const cleanupBatchEntry = (id: number): void => {
      activeIds.delete(id);
      if (activeIds.size === 0) {
        options?.signal?.removeEventListener('abort', onAbort);
      }
    };
    const rejectPendingBatch = (reason: unknown): void => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      for (const id of [...activeIds]) {
        const pending = this.pendingRequests.get(id)!;
        this.pendingRequests.delete(id);
        clearTimeout(pending.timeoutId);
        pending.cleanup?.();
        pending.reject(error);
      }
    };
    const onAbort = (): void => rejectPendingBatch(abortError(options!.signal!));
    const accountResponseBytes = (frameBytes: number): void => {
      responseBytes += frameBytes;
      if (responseBytes > this.maxBatchResponseBytes) {
        throw new ElectrumBatchResponseTooLargeError(
          responseBytes,
          this.maxBatchResponseBytes,
        );
      }
    };

    for (let i = 0; i < requests.length; i++) {
      const id = ids[i];
      const promise = new Promise<unknown>((resolve, reject) => {
        const cleanup = (): void => cleanupBatchEntry(id);
        const timeoutId = setTimeout(() => {
          this.pendingRequests.delete(id);
          cleanup();
          log.warn(`Batch request timeout: method=${requests[i].method} id=${id} pendingCount=${this.pendingRequests.size}`);
          reject(new Error(`Batch request timeout after ${this.batchRequestTimeoutMs}ms for id ${id}`));
        }, this.batchRequestTimeoutMs);

        this.pendingRequests.set(id, {
          resolve,
          reject,
          timeoutId,
          method: requests[i].method,
          params: requests[i].params,
          cleanup,
          accountResponseBytes,
        });
        activeIds.add(id);
      });
      requestPromises.push(promise);
    }

    options?.signal?.addEventListener('abort', onAbort, { once: true });

    log.debug(`Sending batch: count=${requests.length} firstId=${startId} lastId=${this.requestId} pendingCount=${this.pendingRequests.size}`);
    try {
      this.socket!.write(message);
    } catch (error) {
      rejectPendingBatch(error);
      return Promise.all(requestPromises);
    }

    return Promise.all(requestPromises);
  }

  // ===========================================================================
  // PUBLIC API - delegates to publicApi module
  // ===========================================================================

  async getServerVersion(): Promise<{ server: string; protocol: string }> {
    if (this.serverVersion) {
      return this.serverVersion;
    }
    this.serverVersion = await publicApi.getServerVersion(
      (method, params) => this.request(method, params)
    );
    return this.serverVersion;
  }

  async getServerFeatures(): Promise<ElectrumServerFeatures> {
    return publicApi.getServerFeatures(
      (method, params) => this.request(method, params)
    );
  }

  async ping(): Promise<null> {
    return publicApi.ping((method, params) => this.request(method, params));
  }

  async getAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    return publicApi.getAddressBalance(
      (method, params) => this.request(method, params), address, this.network
    );
  }

  async getAddressHistory(address: string, options?: NodeRequestOptions): Promise<Array<{ tx_hash: string; height: number }>> {
    return publicApi.getAddressHistory(
      (method, params) => this.request(method, params, options), address, this.network
    );
  }

  async getAddressUTXOs(address: string, options?: NodeRequestOptions): Promise<Array<{
    tx_hash: string; tx_pos: number; height: number; value: number;
  }>> {
    return publicApi.getAddressUTXOs(
      (method, params) => this.request(method, params, options), address, this.network
    );
  }

  async getTransaction(txid: string, _verbose: boolean = false, options?: NodeRequestOptions): Promise<TransactionDetails> {
    return publicApi.getTransaction(
      (method, params) => this.request(method, params, options), txid, this.network
    );
  }

  async broadcastTransaction(rawTx: string): Promise<string> {
    return publicApi.broadcastTransaction(
      (method, params) => this.request(method, params), rawTx
    );
  }

  async estimateFee(blocks: number = 6): Promise<number> {
    return publicApi.estimateFee(
      (method, params) => this.request(method, params), blocks
    );
  }

  async subscribeAddress(address: string): Promise<string | null> {
    return publicApi.subscribeAddress(
      (method, params) => this.request(method, params),
      address, this.network, this.scriptHashToAddress
    );
  }

  unsubscribeAddress(address: string): void {
    publicApi.unsubscribeAddress(address, this.network, this.scriptHashToAddress);
  }

  async subscribeAddressBatch(addresses: string[]): Promise<Map<string, string | null>> {
    return publicApi.subscribeAddressBatch(
      (reqs) => this.batchRequest(reqs),
      addresses, this.network, this.scriptHashToAddress
    );
  }

  async subscribeHeaders(): Promise<{ height: number; hex: string }> {
    this.subscribedHeaders = true;
    return publicApi.subscribeHeaders(
      (method, params) => this.request(method, params)
    );
  }

  isSubscribedToHeaders(): boolean {
    return this.subscribedHeaders;
  }

  getSubscribedAddresses(): string[] {
    return Array.from(this.scriptHashToAddress.values());
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Electrum returns varying formats per server implementation
  async getBlockHeader(height: number, options?: NodeRequestOptions): Promise<any> {
    return publicApi.getBlockHeader(
      (method, params) => this.request(method, params, options), height
    );
  }

  async getBlockHeaders(startHeight: number, count: number): Promise<string[]> {
    return publicApi.getBlockHeaders(
      (method, params) => this.request(method, params),
      startHeight,
      count,
    );
  }

  async getBlockHeight(options?: NodeRequestOptions): Promise<number> {
    return publicApi.getBlockHeight(
      (method, params) => this.request(method, params, options)
    );
  }

  async testVerboseSupport(testTxid?: string): Promise<boolean> {
    return publicApi.testVerboseSupport(
      (method, params) => this.request(method, params), testTxid
    );
  }

  async getAddressHistoryBatch(addresses: string[], options?: NodeRequestOptions): Promise<Map<string, Array<{ tx_hash: string; height: number }>>> {
    return publicApi.getAddressHistoryBatch(
      (reqs) => this.batchRequest(reqs, options), addresses, this.network
    );
  }

  async getAddressUTXOsBatch(addresses: string[], options?: NodeRequestOptions): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>> {
    return publicApi.getAddressUTXOsBatch(
      (reqs) => this.batchRequest(reqs, options), addresses, this.network
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches NodeClientInterface signature
  async getTransactionsBatch(txids: string[], _verbose: boolean = true, options?: NodeRequestOptions): Promise<Map<string, any>> {
    return publicApi.getTransactionsBatch(
      (reqs) => this.batchRequest(reqs, options),
      (rawTx) => this.decodeRawTransaction(rawTx),
      txids,
      options,
    );
  }
}

export { ElectrumClient };
export default ElectrumClient;
