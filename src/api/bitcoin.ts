/**
 * Bitcoin API
 *
 * API calls for Bitcoin network operations
 */

import apiClient from './client';
import type { BitcoinTransactionDetails, BlockHeader } from '../types';

// Re-export types for convenience
export type { BitcoinTransactionDetails, BlockHeader } from '../types';

export interface HealthCheckResult {
  timestamp: string;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

export interface ServerStats {
  serverId: string;
  label: string;
  host: string;
  port: number;
  connectionCount: number;
  healthyConnections: number;
  totalRequests: number;
  failedRequests: number;
  isHealthy: boolean;
  lastHealthCheck: string | null;
  // Backoff state
  consecutiveFailures: number;
  backoffLevel: number;
  cooldownUntil: string | null;
  weight: number;
  // Health check history (most recent first)
  healthHistory: HealthCheckResult[];
}

export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalAcquisitions: number;
  averageAcquisitionTimeMs: number;
  healthCheckFailures: number;
  serverCount: number;
  servers: ServerStats[];
}

export interface BitcoinStatus {
  connected: boolean;
  server?: string;
  protocol?: string;
  blockHeight?: number;
  network?: string;
  host?: string;
  useSsl?: boolean;
  explorerUrl?: string;
  confirmationThreshold?: number;
  deepConfirmationThreshold?: number;
  error?: string;
  pool?: {
    enabled: boolean;
    minConnections: number;
    maxConnections: number;
    configuredMin?: number;
    configuredMax?: number;
    stats: PoolStats | null;
  } | null;
}

export interface FeeEstimates {
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum?: number;
}

export interface AddressInfo {
  address: string;
  balance: number;
  transactionCount: number;
  type: string;
}

export type BitcoinDashboardNetwork = 'mainnet' | 'testnet3' | 'testnet4' | 'signet';
export type BitcoinStatusNetwork = BitcoinDashboardNetwork;
export type BitcoinFeeNetwork = BitcoinStatusNetwork | 'regtest';

export interface ValidateAddressRequest {
  address: string;
  network?: 'mainnet' | 'testnet3' | 'testnet4' | 'signet' | 'regtest';
}

export interface ValidateAddressResponse {
  valid: boolean;
  error?: string;
  balance?: number;
  transactionCount?: number;
}

export interface SyncResult {
  message: string;
  addresses?: number;
  transactions: number;
  utxos: number;
}

export interface BroadcastTransactionRequest {
  rawTx: string;
}

export interface BroadcastTransactionResponse {
  txid: string;
  broadcasted: boolean;
}

export interface EstimateFeeRequest {
  inputCount: number;
  outputCount: number;
  scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
  feeRate: number;
}

export interface EstimateFeeResponse {
  size: number;
  fee: number;
  feeRate: number;
}

/**
 * Get Bitcoin network status
 */
export async function getStatus(network: BitcoinStatusNetwork = 'mainnet'): Promise<BitcoinStatus> {
  return apiClient.get<BitcoinStatus>('/bitcoin/status', { network });
}

/**
 * Get current fee estimates
 */
export async function getFeeEstimates(network?: BitcoinFeeNetwork): Promise<FeeEstimates> {
  return apiClient.get<FeeEstimates>('/bitcoin/fees', network ? { network } : undefined);
}

/**
 * Validate a Bitcoin address
 */
export async function validateAddress(data: ValidateAddressRequest): Promise<ValidateAddressResponse> {
  return apiClient.post<ValidateAddressResponse>('/bitcoin/address/validate', data);
}

/**
 * Get address information from blockchain
 */
export async function getAddressInfo(address: string, network?: string): Promise<AddressInfo> {
  const params = network ? { network } : undefined;
  return apiClient.get<AddressInfo>(`/bitcoin/address/${address}`, params);
}

/**
 * Sync wallet with blockchain
 */
export async function syncWallet(walletId: string): Promise<SyncResult> {
  return apiClient.post<SyncResult>(`/bitcoin/wallet/${walletId}/sync`);
}

/**
 * Sync address with blockchain
 */
export async function syncAddress(addressId: string): Promise<SyncResult> {
  return apiClient.post<SyncResult>(`/bitcoin/address/${addressId}/sync`);
}

/**
 * Get transaction details from blockchain
 */
export async function getTransactionDetails(txid: string): Promise<BitcoinTransactionDetails> {
  return apiClient.get<BitcoinTransactionDetails>(`/bitcoin/transaction/${txid}`);
}

/**
 * Broadcast a transaction to the network
 */
export async function broadcastTransaction(
  data: BroadcastTransactionRequest
): Promise<BroadcastTransactionResponse> {
  return apiClient.post<BroadcastTransactionResponse>('/bitcoin/broadcast', data);
}

/**
 * Update transaction confirmations
 */
export async function updateConfirmations(walletId: string): Promise<{ message: string; updated: number }> {
  return apiClient.post<{ message: string; updated: number }>(
    `/bitcoin/wallet/${walletId}/update-confirmations`
  );
}

/**
 * Get block header
 */
export async function getBlockHeader(height: number): Promise<BlockHeader> {
  return apiClient.get<BlockHeader>(`/bitcoin/block/${height}`);
}

/**
 * Estimate transaction fee
 */
export async function estimateFee(data: EstimateFeeRequest): Promise<EstimateFeeResponse> {
  return apiClient.post<EstimateFeeResponse>('/bitcoin/utils/estimate-fee', data);
}

/**
 * Advanced Transaction Features
 */

export interface AdvancedFeeEstimate {
  feeRate: number;
  blocks: number;
  minutes: number;
}

export interface AdvancedFeeEstimates {
  fastest: AdvancedFeeEstimate;
  fast: AdvancedFeeEstimate;
  medium: AdvancedFeeEstimate;
  slow: AdvancedFeeEstimate;
  minimum: AdvancedFeeEstimate;
}

export interface RBFCheckResult {
  replaceable: boolean;
  reason?: string;
  currentFeeRate?: number;
  minNewFeeRate?: number;
}

export interface RBFTransactionRequest {
  newFeeRate: number;
  walletId: string;
}

export interface RBFTransactionResponse {
  psbtBase64: string;
  fee: number;
  feeRate: number;
  feeDelta: number;
  inputs: Array<{ txid: string; vout: number; value: number }>;
  outputs: Array<{ address: string; value: number }>;
}

export interface CPFPTransactionRequest {
  parentTxid: string;
  parentVout: number;
  targetFeeRate: number;
  recipientAddress: string;
  walletId: string;
}

export interface CPFPTransactionResponse {
  psbtBase64: string;
  childFee: number;
  childFeeRate: number;
  parentFeeRate: number;
  effectiveFeeRate: number;
}

export interface BatchRecipient {
  address: string;
  amount: number;
  label?: string;
}

export interface BatchTransactionRequest {
  recipients: BatchRecipient[];
  feeRate: number;
  walletId: string;
  selectedUtxoIds?: string[];
}

export interface BatchTransactionResponse {
  psbtBase64: string;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  savedFees: number;
  recipientCount: number;
}

export interface OptimalFeeRequest {
  inputCount: number;
  outputCount: number;
  priority?: 'fastest' | 'fast' | 'medium' | 'slow' | 'minimum';
  scriptType?: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot';
  network?: BitcoinFeeNetwork;
}

export interface OptimalFeeResponse {
  fee: number;
  feeRate: number;
  size: number;
  confirmationTime: string;
}

/**
 * Get advanced fee estimates with time predictions
 */
export async function getAdvancedFeeEstimates(network?: BitcoinFeeNetwork): Promise<AdvancedFeeEstimates> {
  return apiClient.get<AdvancedFeeEstimates>('/bitcoin/fees/advanced', network ? { network } : undefined);
}

/**
 * Check if a transaction can be replaced with RBF
 */
export async function checkRBF(txid: string): Promise<RBFCheckResult> {
  return apiClient.post<RBFCheckResult>(`/bitcoin/transaction/${txid}/rbf-check`, {});
}

/**
 * Create an RBF replacement transaction
 */
export async function createRBFTransaction(
  txid: string,
  data: RBFTransactionRequest
): Promise<RBFTransactionResponse> {
  return apiClient.post<RBFTransactionResponse>(`/bitcoin/transaction/${txid}/rbf`, data);
}

/**
 * Create a CPFP transaction
 */
export async function createCPFPTransaction(
  data: CPFPTransactionRequest
): Promise<CPFPTransactionResponse> {
  return apiClient.post<CPFPTransactionResponse>('/bitcoin/transaction/cpfp', data);
}

/**
 * Create a batch transaction
 */
export async function createBatchTransaction(
  data: BatchTransactionRequest
): Promise<BatchTransactionResponse> {
  return apiClient.post<BatchTransactionResponse>('/bitcoin/transaction/batch', data);
}

/**
 * Estimate optimal fee for a transaction
 */
export async function estimateOptimalFee(data: OptimalFeeRequest): Promise<OptimalFeeResponse> {
  return apiClient.post<OptimalFeeResponse>('/bitcoin/utils/estimate-optimal-fee', data);
}

/**
 * Mempool and Block Data
 */

export interface BlockData {
  height: number | string;
  medianFee: number;
  feeRange: string;
  size: number;
  time: string;
  status: 'confirmed' | 'pending';
  txCount?: number;
  totalFees?: number;
}

export interface MempoolInfo {
  count: number;
  size: number;
  totalFees: number;
}

export interface QueuedBlocksSummary {
  blockCount: number;
  totalTransactions: number;
  averageFee: number;
  totalFees: number;
}

export interface MempoolData {
  mempool: BlockData[];
  blocks: BlockData[];
  mempoolInfo: MempoolInfo;
  queuedBlocksSummary?: QueuedBlocksSummary | null;
}

/**
 * Get mempool and recent blocks for visualization
 */
export async function getMempoolData(network: BitcoinDashboardNetwork = 'mainnet'): Promise<MempoolData> {
  return apiClient.get<MempoolData>('/bitcoin/mempool', { network });
}

/**
 * Address Lookup for Internal Wallet Detection
 */

export interface AddressLookupResult {
  walletId: string;
  walletName: string;
}

export interface AddressLookupResponse {
  lookup: Record<string, AddressLookupResult>;
}

/**
 * Look up which wallets own given addresses
 * Used to detect internal transfers in the send flow
 */
export async function lookupAddresses(addresses: string[]): Promise<AddressLookupResponse> {
  return apiClient.post<AddressLookupResponse>('/bitcoin/address-lookup', { addresses });
}
