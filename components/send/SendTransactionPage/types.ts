import type { BlockData, QueuedBlocksSummary } from '../../../src/api/bitcoin';
import type { DraftTransaction } from '../../../src/api/drafts';
import type { Device, FeeEstimate, UTXO, Wallet } from '../../../types';
import type { SerializableTransactionState, WalletAddress } from '../../../contexts/send/types';

export interface DraftTransactionData {
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  changeAddress?: string;
  effectiveAmount: number;
  selectedUtxoIds: string[];
  inputPaths?: string[];
}

export interface LoadedSendTransactionPageData {
  devices: Device[];
  draftTxData?: DraftTransactionData;
  fees: FeeEstimate | null;
  initialState?: Partial<SerializableTransactionState>;
  mempoolBlocks: BlockData[];
  queuedBlocksSummary: QueuedBlocksSummary | null;
  utxos: UTXO[];
  wallet: Wallet | null;
  walletAddresses: WalletAddress[];
}

export interface SendTransactionPageController extends LoadedSendTransactionPageData {
  calculateFee: (numInputs: number, numOutputs: number, rate: number) => number;
  error: string | null;
  handleCancel: () => void;
  loading: boolean;
  walletId?: string;
}

export interface SendTransactionRouteState {
  draft?: DraftTransaction;
  preSelected?: string[];
}

export type SendTransactionLoadResult =
  | { kind: 'viewer' }
  | { data: LoadedSendTransactionPageData; kind: 'loaded' };
