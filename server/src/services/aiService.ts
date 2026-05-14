/**
 * AI Service - Re-export from modularized ai/ directory
 *
 * This file preserves backward compatibility for existing imports.
 * All implementation has been moved to ./ai/ subdirectory.
 */

export {
  aiService,
  forceSyncConfig,
  getConfigStatus,
  isEnabled,
  isLlmEgressProxyAvailable,
  checkHealth,
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
} from './ai';

export type { TransactionContext, QueryResult } from './ai';
