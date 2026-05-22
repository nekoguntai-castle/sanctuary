/**
 * UI & Theme Types
 *
 * Theme options, background options, notification sounds,
 * table column configuration, and related UI types.
 */

import type { GlobalBackgroundPatternId } from '../themes/patterns';

export type BackgroundOption = GlobalBackgroundPatternId;

export type ThemeOption =
  | 'sanctuary'
  | 'serenity'
  | 'forest'
  | 'cyber'
  | 'sunrise'
  | 'ocean'
  | 'sunset'
  | 'sakura-yoshino'
  | 'sakura-sumie'
  | 'midnight'
  | 'bamboo'
  | 'copper'
  | 'desert'
  | 'seasonal';

export type SoundType = 'chime' | 'bell' | 'coin' | 'success' | 'gentle' | 'zen' | 'ping' | 'pop' | 'harp' | 'retro' | 'marimba' | 'glass' | 'synth' | 'drop' | 'sparkle' | 'drums' | 'whistle' | 'brass' | 'windchime' | 'click' | 'none';

export interface EventSoundConfig {
  enabled: boolean;
  sound: SoundType;
}

export interface NotificationSounds {
  enabled: boolean;
  volume: number; // 0-100
  // Per-event sound configuration
  confirmation?: EventSoundConfig; // Transaction confirmed
  receive?: EventSoundConfig;      // Bitcoin received
  send?: EventSoundConfig;         // Transaction broadcast
  // Legacy fields for backwards compatibility
  confirmationChime?: boolean;
  soundType?: SoundType;
}

export interface WalletTelegramSettings {
  enabled: boolean;
  notifyReceived: boolean;
  notifySent: boolean;
  notifyConsolidation: boolean;
  notifyDraft: boolean;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  enabled: boolean;
  wallets: Record<string, WalletTelegramSettings>;
}

export interface WalletAutopilotSettings {
  enabled: boolean;
  maxFeeRate: number;
  minUtxoCount: number;
  dustThreshold: number;
  cooldownHours: number;
  notifyTelegram: boolean;
  notifyPush: boolean;
  minDustCount: number;
  maxUtxoSize: number;
}

export interface WalletWebhookEndpoint {
  id: string;
  walletId: string;
  name: string;
  enabled: boolean;
  url: string;
  eventTypes: string[];
  filters: Record<string, unknown> | null;
  payloadProfile: string;
  authType: string;
  hasSecret: boolean;
  headerConfig: Record<string, unknown> | null;
  profileConfig: Record<string, unknown> | null;
  retryConfig: Record<string, unknown> | null;
  maxAttempts: number;
  failureNotificationEnabled: boolean;
  createdByUserId: string | null;
  lastDeliveryStatus: string | null;
  lastDeliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletWebhookDelivery {
  id: string;
  endpointId: string;
  walletId: string;
  eventId: string;
  eventType: string;
  payloadProfile: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  deliveredAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  requestBodyHash: string | null;
  requestHeadersRedacted: Record<string, unknown> | null;
  responseBodyHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletWebhookInput {
  name: string;
  enabled?: boolean;
  url: string;
  eventTypes: string[];
  filters?: Record<string, unknown>;
  payloadProfile?: string;
  authType?: string;
  secret?: string;
  headerConfig?: Record<string, unknown>;
  profileConfig?: Record<string, unknown>;
  retryConfig?: Record<string, unknown>;
  maxAttempts?: number;
  failureNotificationEnabled?: boolean;
}

export interface WalletWebhookReplayResult {
  success: boolean;
  queued: boolean;
  message: string;
  delivery: WalletWebhookDelivery;
}

export interface UtxoHealthStatus {
  totalUtxos: number;
  dustCount: number;
  dustValue: string;      // BigInt serialized as string
  totalValue: string;
  avgUtxoSize: string;
  smallestUtxo: string;
  largestUtxo: string;
  consolidationCandidates: number;
}

export interface FeeSnapshot {
  timestamp: number;
  fastest: number;
  halfHour: number;
  hour: number;
  economy: number;
  minimum: number;
}

export interface AutopilotStatus {
  utxoHealth: UtxoHealthStatus;
  feeSnapshot: FeeSnapshot | null;
  settings: WalletAutopilotSettings;
}

export interface TableColumnConfig {
  id: string;
  label: string;
  sortable?: boolean;
  sortKey?: string;
  defaultVisible?: boolean;
  required?: boolean;        // Cannot be hidden (e.g., name column)
  align?: 'left' | 'center' | 'right';
}

export type WalletColumnId = 'name' | 'type' | 'devices' | 'sync' | 'pending' | 'balance';

export type DeviceColumnId = 'label' | 'type' | 'fingerprint' | 'accounts' | 'wallets' | 'actions';

export interface SeasonalBackgrounds {
  spring?: BackgroundOption;
  summer?: BackgroundOption;
  fall?: BackgroundOption;
  winter?: BackgroundOption;
}
