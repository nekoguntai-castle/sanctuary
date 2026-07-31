import { WEBHOOK_REDACTED_VALUE } from '@sanctuary/shared/constants/webhooks';

/**
 * Preserve diagnostic header names while treating every value as secret.
 * Legacy non-object shapes fail closed to null.
 */
export function redactWebhookDiagnosticHeaders(
  headers: unknown,
): Record<string, string> | null {
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
    return null;
  }

  return Object.fromEntries(
    Object.keys(headers).map(name => [name, WEBHOOK_REDACTED_VALUE]),
  );
}
