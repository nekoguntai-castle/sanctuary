import type { PendingTransaction } from '../../src/types';

export interface BlockData {
  height: number | string;
  medianFee: number;
  avgFeeRate?: number; // Average fee rate in sat/vB
  feeRange: string;
  size: number; // in MB (approx)
  time: string;
  status: 'pending' | 'confirmed';
  txCount?: number; // Transaction count
  totalFees?: number; // Total fees in BTC
  hash?: string; // Block hash for confirmed blocks
}

export interface QueuedBlocksSummary {
  blockCount: number;
  totalTransactions: number;
  averageFee: number;
  totalFees: number;
}

export interface BlockVisualizerProps {
  blocks?: BlockData[];
  queuedBlocksSummary?: QueuedBlocksSummary | null;
  pendingTxs?: PendingTransaction[]; // User's pending transactions
  onBlockClick?: (feeRate: number) => void;
  compact?: boolean;
  explorerUrl?: string;
  onRefresh?: () => void; // Called when data should be refreshed (e.g., new block)
}
