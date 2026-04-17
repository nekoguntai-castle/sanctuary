import type { ZodIssue, ZodType } from 'zod';
import { InvalidInputError } from '../../errors/ApiError';

export type AdminValidationMessage = string | ((issues: ZodIssue[]) => string);

function formatIssue(issue: ZodIssue): string {
  const path = issue.path.join('.');
  /* v8 ignore next -- route validation issues normally include a path */
  return path ? `${path}: ${issue.message}` : issue.message;
}

/**
 * Parse an admin request body with a shared Zod schema while preserving
 * the admin API's existing InvalidInputError response envelope.
 */
export function parseAdminRequestBody<T>(
  schema: ZodType<T>,
  body: unknown,
  message?: AdminValidationMessage
): T {
  const result = schema.safeParse(body);
  if (result.success) {
    return result.data;
  }

  const formattedMessage = typeof message === 'function'
    ? message(result.error.issues)
    : message ?? result.error.issues.map(formatIssue).join(', ');

  throw new InvalidInputError(formattedMessage);
}
