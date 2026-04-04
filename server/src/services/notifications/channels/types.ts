/**
 * Notification Channel Types
 *
 * Defines the interface for pluggable notification channels.
 * Channels can be added for Telegram, Push, Webhook, Slack, Discord, Email, etc.
 */

/**
 * Transaction notification data
 */
export interface TransactionNotification {
  txid: string;
  type: 'received' | 'sent' | 'consolidation' | 'self_transfer';
  amount: bigint;
}

/**
 * Draft notification data
 */
export interface DraftNotification {
  id: string;
  amount: bigint;
  recipient: string;
  label?: string | null;
  feeRate: number;
}

/**
 * Consolidation suggestion notification data
 */
export interface ConsolidationSuggestionNotification {
  walletId: string;
  walletName: string;
  feeRate: number;
  utxoHealth: {
    totalUtxos: number;
    dustCount: number;
    dustValue: bigint;
    totalValue: bigint;
  };
  estimatedSavings: string;
  reason: string;
}

/**
 * Result of a notification attempt
 */
export interface NotificationResult {
  success: boolean;
  channelId: string;
  usersNotified: number;
  errors?: string[];
}

/**
 * AI insight notification data
 */
export interface AIInsightNotification {
  id: string;
  type: string;
  severity: string;
  title: string;
  summary: string;
  walletName: string;
}

/**
 * Channel capabilities
 */
export interface ChannelCapabilities {
  supportsTransactions: boolean;
  supportsDrafts: boolean;
  supportsConsolidationSuggestions: boolean;
  supportsAIInsights: boolean;
  supportsRichFormatting: boolean;
  supportsImages: boolean;
}

/**
 * Notification Channel Handler Interface
 *
 * Implement this interface to add a new notification channel.
 */
export interface NotificationChannelHandler {
  /** Unique identifier for this channel */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of the channel */
  description: string;

  /** Channel capabilities */
  capabilities: ChannelCapabilities;

  /**
   * Check if channel is enabled/configured
   */
  isEnabled(): Promise<boolean>;

  /**
   * Send transaction notifications
   * @param walletId - The wallet that received/sent transactions
   * @param transactions - Array of transactions to notify about
   * @returns Result of the notification attempt
   */
  notifyTransactions(
    walletId: string,
    transactions: TransactionNotification[]
  ): Promise<NotificationResult>;

  /**
   * Send draft notification (optional)
   * @param walletId - The wallet the draft was created for
   * @param draft - The draft transaction data
   * @param createdByUserId - The user who created the draft (won't be notified)
   * @returns Result of the notification attempt
   */
  notifyDraft?(
    walletId: string,
    draft: DraftNotification,
    createdByUserId: string
  ): Promise<NotificationResult>;

  /**
   * Send consolidation suggestion notification (optional)
   * @param walletId - The wallet to consolidate
   * @param suggestion - The consolidation suggestion data
   * @returns Result of the notification attempt
   */
  notifyConsolidationSuggestion?(
    walletId: string,
    suggestion: ConsolidationSuggestionNotification
  ): Promise<NotificationResult>;

  /**
   * Send AI insight notification (optional)
   * @param walletId - The wallet the insight is about
   * @param insight - The AI-generated insight data
   * @returns Result of the notification attempt
   */
  notifyAIInsight?(
    walletId: string,
    insight: AIInsightNotification
  ): Promise<NotificationResult>;
}
