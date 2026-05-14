/**
 * AI Service
 *
 * This service forwards AI requests to the isolated LLM egress proxy.
 * The backend NEVER makes external AI calls directly.
 *
 * SECURITY ARCHITECTURE:
 * - Backend: Forwards requests, manages configuration, executes query results
 * - LLM Egress Proxy: Makes all external AI calls, receives only sanitized data
 * - Isolation: LLM egress proxy cannot access DB, keys, or signing operations
 *
 * DATA FLOW:
 * 1. User requests AI feature (suggest label, NL query)
 * 2. Backend forwards to LLM egress proxy
 * 3. LLM egress proxy fetches sanitized data via /internal/ai/* endpoints
 * 4. LLM egress proxy calls external AI
 * 5. LLM egress proxy returns suggestion
 * 6. Backend returns to user (suggestions only - user must confirm)
 */

// Types
export type { TransactionContext, QueryResult } from './types';

// Config
export { forceSyncConfig } from './config';

// Health
export { getConfigStatus, isEnabled, isLlmEgressProxyAvailable, checkHealth } from './health';

// Features
export {
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
} from './features';

// Re-import for the aggregated service object
import { forceSyncConfig } from './config';
import { getConfigStatus, isEnabled, isLlmEgressProxyAvailable, checkHealth } from './health';
import {
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
} from './features';

/**
 * AI Service - exported for use in API routes
 */
export const aiService = {
  getConfigStatus,
  isEnabled,
  isLlmEgressProxyAvailable,
  checkHealth,
  suggestTransactionLabel,
  executeNaturalQuery,
  detectOllama,
  detectProviderEndpoint,
  listModels,
  forceSyncConfig,
};
