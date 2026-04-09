/**
 * Pagination Utilities
 *
 * Shared helpers for endpoints that support optional pagination via
 * ?limit=N&offset=M query parameters.
 */

import type { Response } from 'express';
import { validatePagination } from './errors';

const DEFAULT_UNPAGED_LIMIT = 1000;

interface PaginationResult {
  effectiveLimit: number;
  effectiveOffset: number;
  hasPagination: boolean;
}

/**
 * Extract pagination parameters from query string.
 * When no pagination params are provided, returns a capped default limit.
 */
export function extractPagination(
  query: { limit?: string; offset?: string },
  defaultLimit = DEFAULT_UNPAGED_LIMIT,
): PaginationResult {
  const hasPagination = query.limit !== undefined || query.offset !== undefined;
  const { limit, offset } = validatePagination(
    query.limit as string,
    query.offset as string,
    defaultLimit,
  );
  return {
    effectiveLimit: hasPagination ? limit : defaultLimit,
    effectiveOffset: hasPagination ? offset : 0,
    hasPagination,
  };
}

/**
 * Set truncation headers for unpaged responses so clients know
 * the result was capped at the default limit.
 */
export function setTruncationHeaders(
  res: Response,
  resultLength: number,
  pagination: PaginationResult,
): void {
  if (!pagination.hasPagination) {
    res.setHeader('X-Result-Limit', String(pagination.effectiveLimit));
    res.setHeader('X-Result-Truncated', resultLength >= pagination.effectiveLimit ? 'true' : 'false');
  }
}
