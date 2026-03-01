/**
 * Common API Types
 *
 * Shared types used across multiple API domains (errors, pagination, success responses).
 */

/**
 * Standard API error response
 */
export interface ApiErrorResponse {
  error: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Success response with message
 */
export interface SuccessResponse {
  success: boolean;
  message: string;
}
