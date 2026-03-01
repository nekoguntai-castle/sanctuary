/**
 * DraftList Module Types
 *
 * Shared types for the DraftList component and its subcomponents.
 */
import { DraftTransaction } from '../../src/api/drafts';
import { FlowInput, FlowOutput } from '../TransactionFlowPreview';
import { WalletType } from '../../types';

// Expiration urgency levels
export type ExpirationUrgency = 'normal' | 'warning' | 'critical' | 'expired';

export interface ExpirationInfo {
  text: string;
  urgency: ExpirationUrgency;
  diffMs: number;
}

export interface WalletAddressInfo {
  address: string;
}

export interface DraftListProps {
  walletId: string;
  walletType: WalletType;
  quorum?: { m: number; n: number };
  onResume?: (draft: DraftTransaction) => void;
  canEdit?: boolean;
  onDraftsChange?: (count: number) => void;
  walletAddresses?: WalletAddressInfo[];
  walletName?: string;
}

export interface FeeWarning {
  level: string;
  percent: number;
  message: string;
}

export interface FlowPreviewData {
  inputs: FlowInput[];
  outputs: FlowOutput[];
  fee: number;
  feeRate: number;
  totalInput: number;
  totalOutput: number;
}

export interface DraftRowProps {
  draft: DraftTransaction;
  walletType: WalletType;
  quorum?: { m: number; n: number };
  canEdit: boolean;
  isExpanded: boolean;
  deleteConfirm: string | null;
  format: (sats: number) => string;
  getAddressLabel: (address: string) => string | undefined;
  onResume: (draft: DraftTransaction) => void;
  onDelete: (draftId: string) => void;
  onDownloadPsbt: (draft: DraftTransaction) => void;
  onUploadPsbt: (draftId: string, file: File) => void;
  onToggleExpand: (draftId: string) => void;
  onSetDeleteConfirm: (draftId: string | null) => void;
}
