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
import { createRequestMessage, createBatchMessage, rejectAllPendingRequests } from './protocol';
import { getDefaultTimeouts } from './clientConfig';
import { handleIncomingData } from './dataHandler';
import * as publicApi from './publicApi';
import * as methods from './methods';
import type {
  ElectrumConfig,
  TransactionDetails,
  BitcoinNetwork,
  PendingRequest,
} from './types';
import {
  resolveElectrumConnectionConfig,
  type ResolvedConnectionConfig,
} from './connectionConfigResolver';

const log = createLogger('ELECTRUM:SVC_CLIENT');

interface ConnectionState {
  cleanup: () => void;
  handleSuccess: () => void;
  handleError: (error: Error) => void;
}

class ElectrumClient extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private buffer = '';
  private connected = false;
  private serverVersion: { server: string; protocol: string } | null = null;
  private explicitConfig: ElectrumConfig | null = null;
  private scriptHashToAddress = new Map<string, string>();  // Map scripthash to address
  private subscribedHeaders = false;
  private network: BitcoinNetwork; // Bitcoin network

  // Timeouts (adjusted for Tor when proxy is enabled)
  private requestTimeoutMs: number;
  private batchRequestTimeoutMs: number;

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
    if (connectionConfig.protocol === 'ssl') {
      this.finishTlsConnection(baseSocket, connectionConfig, state);
    } else {
      this.finishTcpConnection(baseSocket, connectionConfig, state);
    }
    this.attachSocketHandlers();
  }

  private finishTlsConnection(
    baseSocket: net.Socket,
    connectionConfig: ResolvedConnectionConfig,
    state: ConnectionState
  ): void {
    const { host, port, allowSelfSignedCert, proxy } = connectionConfig;
    const { tlsSocket, handshakePromise } = wrapSocketInTls(
      baseSocket, host, port, allowSelfSignedCert, !!proxy?.enabled
    );
    this.socket = tlsSocket;
    handshakePromise
      .then(() => state.handleSuccess())
      .catch((err) => state.handleError(err));
  }

  private finishTcpConnection(
    baseSocket: net.Socket,
    connectionConfig: ResolvedConnectionConfig,
    state: ConnectionState
  ): void {
    const { host, port, protocol, proxy } = connectionConfig;
    this.socket = baseSocket;
    log.info(`Connected to ${host}:${port} (${protocol})${proxy?.enabled ? ' via proxy' : ''}`);
    applySocketOptimizations(baseSocket);
    state.handleSuccess();
  }

  private attachSocketHandlers(): void {
    this.socket!.on('data', (data) => this.handleData(data));
    this.socket!.on('error', (error) => this.handleSocketError(error));
    this.socket!.on('close', () => this.handleSocketClose());
    this.socket!.on('end', () => this.handleSocketEnd());
  }

  private handleSocketError(error: Error): void {
    log.error('Socket error', { error: getErrorMessage(error) });
    rejectAllPendingRequests(this.pendingRequests, new Error(`Socket error: ${error.message}`));
  }

  private handleSocketClose(): void {
    log.debug('Connection closed');
    this.connected = false;
    rejectAllPendingRequests(this.pendingRequests, new Error('Connection closed unexpectedly'));
  }

  private handleSocketEnd(): void {
    log.debug('Connection ended');
    this.connected = false;
    rejectAllPendingRequests(this.pendingRequests, new Error('Connection ended'));
  }

  /**
   * Disconnect from Electrum server
   */
  disconnect(): void {
    rejectAllPendingRequests(this.pendingRequests, new Error('Connection closed'));

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
      this.serverVersion = null;
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
    this.buffer = handleIncomingData(
      this.buffer, data, this.pendingRequests, this, this.scriptHashToAddress
    );
  }

  // REQUEST/RESPONSE PRIMITIVES
  // ===========================================================================

  /**
   * Send request to Electrum server
   */
  private async request(method: string, params: unknown[] = []): Promise<unknown> {
    if (!this.connected || !this.socket) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const id = ++this.requestId;

      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          log.warn(`Request timeout: method=${method} id=${id} pendingCount=${this.pendingRequests.size}`);
          reject(new Error(`Request timeout after ${this.requestTimeoutMs}ms`));
        }
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeoutId });

      const message = createRequestMessage(method, params, id);
      log.debug(`Sending request: method=${method} id=${id} pendingCount=${this.pendingRequests.size}`);
      this.socket!.write(message);
    });
  }

  /**
   * Send multiple requests to Electrum server in a single batch.
   * Each request is sent on its own line but in quick succession.
   * Returns results in the same order as requests.
   */
  private async batchRequest(requests: Array<{ method: string; params: unknown[] }>): Promise<unknown[]> {
    if (requests.length === 0) return [];

    if (!this.connected || !this.socket) {
      await this.connect();
    }

    const startId = this.requestId + 1;
    const requestPromises: Promise<unknown>[] = [];

    const { message, ids } = createBatchMessage(requests, startId);
    this.requestId += requests.length;

    for (let i = 0; i < requests.length; i++) {
      const id = ids[i];
      const promise = new Promise<unknown>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          if (this.pendingRequests.has(id)) {
            this.pendingRequests.delete(id);
            log.warn(`Batch request timeout: method=${requests[i].method} id=${id} pendingCount=${this.pendingRequests.size}`);
            reject(new Error(`Batch request timeout after ${this.batchRequestTimeoutMs}ms for id ${id}`));
          }
        }, this.batchRequestTimeoutMs);

        this.pendingRequests.set(id, { resolve, reject, timeoutId });
      });
      requestPromises.push(promise);
    }

    log.debug(`Sending batch: count=${requests.length} firstId=${startId} lastId=${this.requestId} pendingCount=${this.pendingRequests.size}`);
    this.socket!.write(message);

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

  async ping(): Promise<null> {
    return publicApi.ping((method, params) => this.request(method, params));
  }

  async getAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number }> {
    return publicApi.getAddressBalance(
      (method, params) => this.request(method, params), address, this.network
    );
  }

  async getAddressHistory(address: string): Promise<Array<{ tx_hash: string; height: number }>> {
    return publicApi.getAddressHistory(
      (method, params) => this.request(method, params), address, this.network
    );
  }

  async getAddressUTXOs(address: string): Promise<Array<{
    tx_hash: string; tx_pos: number; height: number; value: number;
  }>> {
    return publicApi.getAddressUTXOs(
      (method, params) => this.request(method, params), address, this.network
    );
  }

  async getTransaction(txid: string, _verbose: boolean = false): Promise<TransactionDetails> {
    return publicApi.getTransaction(
      (method, params) => this.request(method, params), txid, this.network
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
  async getBlockHeader(height: number): Promise<any> {
    return publicApi.getBlockHeader(
      (method, params) => this.request(method, params), height
    );
  }

  async getBlockHeight(): Promise<number> {
    return publicApi.getBlockHeight(
      (method, params) => this.request(method, params)
    );
  }

  async testVerboseSupport(testTxid?: string): Promise<boolean> {
    return publicApi.testVerboseSupport(
      (method, params) => this.request(method, params), testTxid
    );
  }

  async getAddressHistoryBatch(addresses: string[]): Promise<Map<string, Array<{ tx_hash: string; height: number }>>> {
    return publicApi.getAddressHistoryBatch(
      (reqs) => this.batchRequest(reqs), addresses, this.network
    );
  }

  async getAddressUTXOsBatch(addresses: string[]): Promise<Map<string, Array<{ tx_hash: string; tx_pos: number; height: number; value: number }>>> {
    return publicApi.getAddressUTXOsBatch(
      (reqs) => this.batchRequest(reqs), addresses, this.network
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches NodeClientInterface signature
  async getTransactionsBatch(txids: string[], _verbose: boolean = true): Promise<Map<string, any>> {
    return publicApi.getTransactionsBatch(
      (reqs) => this.batchRequest(reqs),
      (rawTx) => this.decodeRawTransaction(rawTx),
      txids
    );
  }
}

export { ElectrumClient };
export default ElectrumClient;
