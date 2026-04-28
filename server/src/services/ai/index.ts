/**
 * AI Service
 *
 * This service forwards AI requests to the isolated AI container.
 * The backend NEVER makes external AI calls directly.
 *
 * SECURITY ARCHITECTURE:
 * - Backend: Forwards requests, manages configuration, executes query results
 * - AI Container: Makes all external AI calls, receives only sanitized data
 * - Isolation: AI container cannot access DB, keys, or signing operations
 *
 * DATA FLOW:
 * 1. User requests AI feature (suggest label, NL query)
 * 2. Backend forwards to AI container
 * 3. AI container fetches sanitized data via /internal/ai/* endpoints
 * 4. AI container calls external AI
 * 5. AI container returns suggestion
 * 6. Backend returns to user (suggestions only - user must confirm)
 */

// Types
export type { TransactionContext, QueryResult } from './types';

// Config
export { forceSyncConfig } from './config';

// Health
export { getConfigStatus, isEnabled, isContainerAvailable, checkHealth } from './health';

// Features
export {
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
  pullModel,
  deleteModel,
} from './features';

// Re-import for the aggregated service object
import { forceSyncConfig } from './config';
import { getConfigStatus, isEnabled, isContainerAvailable, checkHealth } from './health';
import {
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
  pullModel,
  deleteModel,
} from './features';

/**
 * AI Service - exported for use in API routes
 */
export const aiService = {
  getConfigStatus,
  isEnabled,
  isContainerAvailable,
  checkHealth,
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
  pullModel,
  deleteModel,
  forceSyncConfig,
};
