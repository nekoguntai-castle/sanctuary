export type NotificationType =
  | 'transaction'
  | 'balance'
  | 'confirmation'
  | 'block'
  | 'success'
  | 'error'
  | 'warning'
  | 'info';

export interface NotificationData {
  type?: string;
  txid?: string;
  amount?: number;
  confirmations?: number;
  previousConfirmations?: number;
  walletId?: string;
  balance?: number;
  confirmed?: number;
  unconfirmed?: number;
  change?: number;
  height?: number;
  transactionCount?: number;
  blockHeight?: number;
  timestamp?: string;
  hash?: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message?: string;
  duration?: number;
  data?: NotificationData;
}
