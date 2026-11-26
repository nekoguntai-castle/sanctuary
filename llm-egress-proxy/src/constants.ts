/**
 * LLM Egress Proxy Constants
 *
 * Configuration constants sourced from the validated config module.
 */

import { config } from './config';

// Rate limiting configuration
export const RATE_LIMIT_WINDOW_MS = config.rateLimitWindowMs;
export const RATE_LIMIT_MAX_REQUESTS = config.rateLimitMaxRequests;

// AI request timeout
export const AI_REQUEST_TIMEOUT_MS = config.aiRequestTimeoutMs;

// AI analysis timeout (longer for complex analysis prompts)
export const AI_ANALYSIS_TIMEOUT_MS = config.aiAnalysisTimeoutMs;
