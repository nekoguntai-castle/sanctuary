import { describe, expect, it } from 'vitest';
import { WEBHOOK_REDACTED_VALUE } from '@sanctuary/shared/constants/webhooks';
import { redactWebhookDiagnosticHeaders } from '../../../../src/services/webhooks/diagnostics';

describe('webhook diagnostic header redaction', () => {
  it('preserves names and replaces every value independent of name or type', () => {
    expect(redactWebhookDiagnosticHeaders({
      Authorization: 'Bearer secret',
      'X-API-Key': 'api-key',
      'X-Arbitrary': 'arbitrary-secret',
      'X-Number': 42,
      'X-Object': { nested: 'secret' },
      'X-Null': null,
    })).toEqual({
      Authorization: WEBHOOK_REDACTED_VALUE,
      'X-API-Key': WEBHOOK_REDACTED_VALUE,
      'X-Arbitrary': WEBHOOK_REDACTED_VALUE,
      'X-Number': WEBHOOK_REDACTED_VALUE,
      'X-Object': WEBHOOK_REDACTED_VALUE,
      'X-Null': WEBHOOK_REDACTED_VALUE,
    });
  });

  it.each([null, undefined, 'secret', 42, ['secret']])(
    'fails closed for malformed legacy shape %j',
    value => {
      expect(redactWebhookDiagnosticHeaders(value)).toBeNull();
    },
  );

  it('is idempotent for already-redacted objects', () => {
    const redacted = { 'X-Arbitrary': WEBHOOK_REDACTED_VALUE };
    expect(redactWebhookDiagnosticHeaders(redacted)).toEqual(redacted);
  });
});
