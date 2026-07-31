import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
  WEBHOOK_AUTH_TYPE_NONE,
  WEBHOOK_DEFAULT_WALLET_TRANSACTION_EVENTS,
  WEBHOOK_PAYLOAD_PROFILE_GENERIC,
  WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
  WEBHOOK_VALUATION_MODE_DISABLED,
  WEBHOOK_VALUATION_MODE_REQUIRED,
} from '../../../shared/constants/webhooks';
import {
  buildWebhookInput,
  clampNumber,
  DEFAULT_EVENTS,
  defaultForm,
  formatTimestamp,
  parseHeaderConfigUpdate,
  parseEventTypes,
  parseJsonObject,
  type WebhookFormState,
} from '../../../components/WalletDetail/webhooks/model';

describe('wallet webhook form model', () => {
  it('derives default built-in values from shared webhook constants', () => {
    const form = defaultForm();

    expect(DEFAULT_EVENTS).toBe(WEBHOOK_DEFAULT_WALLET_TRANSACTION_EVENTS.join(','));
    expect(form.payloadProfile).toBe(WEBHOOK_PAYLOAD_PROFILE_GENERIC);
    expect(form.authType).toBe(WEBHOOK_AUTH_TYPE_NONE);
    expect(form.valuationMode).toBe(WEBHOOK_VALUATION_MODE_DISABLED);
  });

  it('builds mapped JSON input with shared built-in profile, auth, and valuation values', () => {
    const form: WebhookFormState = {
      ...defaultForm(),
      name: 'External receiver',
      url: 'https://example.com/webhook',
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
      authType: WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
      secret: 'shared-secret',
      valuationMode: WEBHOOK_VALUATION_MODE_REQUIRED,
    };

    expect(buildWebhookInput(form)).toMatchObject({
      name: 'External receiver',
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
      authType: WEBHOOK_AUTH_TYPE_CONFIGURED_HMAC_SHA256,
      secret: 'shared-secret',
      profileConfig: {
        valuation: {
          mode: WEBHOOK_VALUATION_MODE_REQUIRED,
          currency: 'USD',
        },
      },
    });
  });

  it('builds optional filter/header config and mapped JSON fallback branches', () => {
    expect(buildWebhookInput({
      ...defaultForm(),
      name: 'Filtered endpoint',
      url: 'https://example.com/webhook',
      filtersJson: '{"direction":"received"}',
      headerConfigJson: '{"headers":{"x-static":"yes"}}',
    })).toMatchObject({
      filters: { direction: 'received' },
      headerConfig: { headers: { 'x-static': 'yes' } },
    });

    expect(buildWebhookInput({
      ...defaultForm(),
      name: 'Mapped endpoint',
      url: 'https://example.com/webhook',
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
    }).profileConfig).toEqual({
      body: expect.objectContaining({
        eventId: { path: 'eventId' },
      }),
    });

    expect(buildWebhookInput({
      ...defaultForm(),
      name: 'Mapped endpoint',
      url: 'https://example.com/webhook',
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
      valuationMode: WEBHOOK_VALUATION_MODE_REQUIRED,
      valuationCurrency: '   ',
    })).toMatchObject({
      profileConfig: {
        valuation: {
          currency: 'USD',
        },
      },
    });

    expect(() => buildWebhookInput({
      ...defaultForm(),
      name: 'Mapped endpoint',
      url: 'https://example.com/webhook',
      payloadProfile: WEBHOOK_PAYLOAD_PROFILE_MAPPED_JSON,
      bodyMappingJson: '',
    })).toThrow('Body mapping JSON is required for mapped JSON webhooks');
  });

  it('parses event lists and JSON object fields', () => {
    expect(parseEventTypes(' wallet.transaction.received, ,wallet.transaction.sent ')).toEqual([
      'wallet.transaction.received',
      'wallet.transaction.sent',
    ]);
    expect(parseJsonObject('Filters JSON', '')).toBeUndefined();
    expect(parseJsonObject('Filters JSON', '{"direction":"received"}')).toEqual({ direction: 'received' });

    expect(() => parseJsonObject('Filters JSON', 'null')).toThrow('Filters JSON must be a JSON object');
    expect(() => parseJsonObject('Filters JSON', '[]')).toThrow('Filters JSON must be a JSON object');
    expect(() => parseJsonObject('Filters JSON', '"value"')).toThrow('Filters JSON must be a JSON object');
  });

  it('builds header deltas and rejects output-only redaction markers', () => {
    expect(parseHeaderConfigUpdate('')).toBeUndefined();
    expect(parseHeaderConfigUpdate('{"X-API-Key":"replacement","X-Old":null}')).toEqual({
      headers: { 'X-API-Key': 'replacement', 'X-Old': null },
    });
    expect(() => parseHeaderConfigUpdate('{"Authorization":"[REDACTED]"}'))
      .toThrow('Header Authorization must be replaced with its real value or removed');
    expect(() => parseHeaderConfigUpdate('{"X-API-Key":42}'))
      .toThrow('Header X-API-Key must be a string or null');

    expect(() => buildWebhookInput({
      ...defaultForm(),
      name: 'Endpoint',
      url: 'https://example.com/webhook',
      headerConfigJson: '{"headers":{"X-API-Key":null}}',
    })).toThrow('Header X-API-Key must be a string');
    expect(() => buildWebhookInput({
      ...defaultForm(),
      name: 'Endpoint',
      url: 'https://example.com/webhook',
      headerConfigJson: '{"headers":{"X-API-Key":"[REDACTED]"}}',
    })).toThrow('Header X-API-Key must be replaced with its real value or removed');
    expect(() => buildWebhookInput({
      ...defaultForm(),
      name: 'Endpoint',
      url: 'https://example.com/webhook',
      headerConfigJson: '{"headers":[]}',
    })).toThrow('Headers and HMAC JSON headers must be a JSON object');
  });

  it('clamps numeric form input and formats timestamps', () => {
    expect(clampNumber('not-a-number', 1, 25)).toBe(1);
    expect(clampNumber('0', 1, 25)).toBe(1);
    expect(clampNumber('26', 1, 25)).toBe(25);
    expect(clampNumber('2.6', 1, 25)).toBe(3);

    expect(formatTimestamp(null)).toBe('-');
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
    expect(formatTimestamp('2026-05-22T00:00:00.000Z')).toContain('2026');
  });
});
