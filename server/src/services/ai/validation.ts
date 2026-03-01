/**
 * AI Response Validation
 *
 * Validates responses from the AI container.
 */

import { createLogger } from '../../utils/logger';

const log = createLogger('AI');

/**
 * Validate AI container response
 * @param response The response to validate
 * @param requiredFields Fields that must be present in the response
 * @returns The validated response or null if validation fails
 */
export function validateResponse<T>(response: unknown, requiredFields: string[]): T | null {
  if (!response || typeof response !== 'object') {
    log.warn('Response validation failed: not an object', { response });
    return null;
  }

  for (const field of requiredFields) {
    if (!(field in response)) {
      log.warn('Response validation failed: missing field', { field, response });
      return null;
    }
  }

  return response as T;
}
