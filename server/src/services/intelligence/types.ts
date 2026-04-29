/**
 * Treasury Intelligence Types
 */

export const INSIGHT_TYPE_VALUES = ['utxo_health', 'fee_timing', 'anomaly', 'tax', 'consolidation'] as const;
export const INSIGHT_SEVERITY_VALUES = ['info', 'warning', 'critical'] as const;
export const INSIGHT_STATUS_VALUES = ['active', 'dismissed', 'acted_on', 'expired'] as const;
export const INSIGHT_UPDATE_STATUS_VALUES = ['dismissed', 'acted_on'] as const;
export const INTELLIGENCE_MESSAGE_ROLE_VALUES = ['user', 'assistant'] as const;
export const INTELLIGENCE_ENDPOINT_TYPE_VALUES = ['container', 'host', 'remote'] as const;

export type InsightType = (typeof INSIGHT_TYPE_VALUES)[number];
export type InsightSeverity = (typeof INSIGHT_SEVERITY_VALUES)[number];
export type InsightStatus = (typeof INSIGHT_STATUS_VALUES)[number];

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
  endpointType?: (typeof INTELLIGENCE_ENDPOINT_TYPE_VALUES)[number];
  reason?: string;
}
