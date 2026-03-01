/**
 * AI Service - Re-export from modularized ai/ directory
 *
 * This file preserves backward compatibility for existing imports.
 * All implementation has been moved to ./ai/ subdirectory.
 */

export {
  aiService,
  forceSyncConfig,
  isEnabled,
  isContainerAvailable,
  checkHealth,
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  listModels,
  pullModel,
  deleteModel,
} from './ai';

export type { TransactionContext, QueryResult } from './ai';
