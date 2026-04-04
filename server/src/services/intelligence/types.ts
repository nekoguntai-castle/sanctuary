/**
 * Treasury Intelligence Types
 */

export type InsightType = 'utxo_health' | 'fee_timing' | 'anomaly' | 'tax' | 'consolidation';
export type InsightSeverity = 'info' | 'warning' | 'critical';
export type InsightStatus = 'active' | 'dismissed' | 'acted_on' | 'expired';

export interface WalletIntelligenceSettings {
  enabled: boolean;
  notifyTelegram: boolean;
  notifyPush: boolean;
  /** Minimum severity for notifications: info, warning, critical */
  severityFilter: InsightSeverity;
  /** Which insight types to enable */
  typeFilter: InsightType[];
}

export interface IntelligenceConfig {
  wallets: Record<string, WalletIntelligenceSettings>;
}

export const DEFAULT_INTELLIGENCE_SETTINGS: WalletIntelligenceSettings = {
  enabled: false,
  notifyTelegram: true,
  notifyPush: true,
  severityFilter: 'info',
  typeFilter: ['utxo_health', 'fee_timing', 'anomaly', 'tax', 'consolidation'],
};

export interface AnalysisContext {
  utxoHealth?: Record<string, unknown>;
  feeHistory?: Record<string, unknown>;
  spendingVelocity?: Record<string, unknown>;
  utxoAgeProfile?: Record<string, unknown>;
}

export interface AnalysisResult {
  title: string;
  summary: string;
  severity: InsightSeverity;
  analysis: string;
}

export interface IntelligenceStatus {
  available: boolean;
  ollamaConfigured: boolean;
  endpointType?: 'bundled' | 'host' | 'remote';
  reason?: string;
}
