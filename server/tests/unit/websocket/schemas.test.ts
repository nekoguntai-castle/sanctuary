/**
 * WebSocket Schemas Unit Tests
 *
 * Tests for Zod validation schemas used to validate incoming WebSocket messages.
 * These schemas provide runtime validation for message types and structures.
 */

import {
  AuthMessageSchema,
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  SubscribeBatchMessageSchema,
  UnsubscribeBatchMessageSchema,
  PingMessageSchema,
  PongMessageSchema,
  ClientMessageSchema,
  GatewayAuthResponseSchema,
  GatewayMessageSchema,
  parseClientMessage,
  parseGatewayMessage,
} from '../../../src/websocket/schemas';
import { WEBSOCKET_CLIENT_MESSAGE_TYPES } from '@sanctuary/shared/types/websocket';

const clientSchemaMessageTypes = (): string[] => {
  const schemaOptions = (ClientMessageSchema as unknown as { options: unknown[] }).options;
  return schemaOptions.map((schema) => {
    const literal = (schema as {
      shape: {
        type: {
          value?: string;
          values?: string[] | Set<string>;
          _def?: { values?: string[] | Set<string> };
        };
      };
    }).shape.type;
    if (literal.value) return literal.value;
    const values = literal.values ?? literal._def?.values;
    if (Array.isArray(values)) return values[0];
    if (values instanceof Set) return Array.from(values)[0];
    throw new Error('Unable to read websocket client message literal');
  });
};

describe('WebSocket Schemas', () => {
  describe('AuthMessageSchema', () => {
    it('should validate valid auth message', () => {
      const message = {
        type: 'auth',
        data: { token: 'valid-jwt-token' },
      };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('auth');
        expect(result.data.data.token).toBe('valid-jwt-token');
      }
    });

    it('should reject auth message with empty token', () => {
      const message = {
        type: 'auth',
        data: { token: '' },
      };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject auth message without token', () => {
      const message = {
        type: 'auth',
        data: {},
      };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject auth message without data', () => {
      const message = { type: 'auth' };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject message with wrong type', () => {
      const message = {
        type: 'authenticate',
        data: { token: 'token' },
      };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('SubscribeMessageSchema', () => {
    it('should validate valid subscribe message', () => {
      const message = {
        type: 'subscribe',
        data: { channel: 'wallet:abc-123' },
      };

      const result = SubscribeMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.channel).toBe('wallet:abc-123');
      }
    });

    it('should reject subscribe with empty channel', () => {
      const message = {
        type: 'subscribe',
        data: { channel: '' },
      };

      const result = SubscribeMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject subscribe without channel', () => {
      const message = {
        type: 'subscribe',
        data: {},
      };

      const result = SubscribeMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('UnsubscribeMessageSchema', () => {
    it('should validate valid unsubscribe message', () => {
      const message = {
        type: 'unsubscribe',
        data: { channel: 'wallet:abc-123' },
      };

      const result = UnsubscribeMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.channel).toBe('wallet:abc-123');
      }
    });

    it('should reject unsubscribe with empty channel', () => {
      const message = {
        type: 'unsubscribe',
        data: { channel: '' },
      };

      const result = UnsubscribeMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('SubscribeBatchMessageSchema', () => {
    it('should validate valid subscribe_batch message', () => {
      const message = {
        type: 'subscribe_batch',
        data: { channels: ['wallet:abc', 'wallet:def', 'system'] },
      };

      const result = SubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.channels).toHaveLength(3);
      }
    });

    it('should validate subscribe_batch with single channel', () => {
      const message = {
        type: 'subscribe_batch',
        data: { channels: ['wallet:abc'] },
      };

      const result = SubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should validate subscribe_batch with empty array', () => {
      const message = {
        type: 'subscribe_batch',
        data: { channels: [] },
      };

      const result = SubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject subscribe_batch with empty channel strings', () => {
      const message = {
        type: 'subscribe_batch',
        data: { channels: ['wallet:abc', '', 'system'] },
      };

      const result = SubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject subscribe_batch without channels array', () => {
      const message = {
        type: 'subscribe_batch',
        data: {},
      };

      const result = SubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('UnsubscribeBatchMessageSchema', () => {
    it('should validate valid unsubscribe_batch message', () => {
      const message = {
        type: 'unsubscribe_batch',
        data: { channels: ['wallet:abc', 'wallet:def'] },
      };

      const result = UnsubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject unsubscribe_batch with empty channel strings', () => {
      const message = {
        type: 'unsubscribe_batch',
        data: { channels: [''] },
      };

      const result = UnsubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('PingMessageSchema', () => {
    it('should validate valid ping message', () => {
      const message = { type: 'ping' };

      const result = PingMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject message with wrong type', () => {
      const message = { type: 'pong' };

      const result = PingMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('PongMessageSchema', () => {
    it('should validate valid pong message', () => {
      const message = { type: 'pong' };

      const result = PongMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject message with wrong type', () => {
      const message = { type: 'ping' };

      const result = PongMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('ClientMessageSchema (discriminated union)', () => {
    it('should stay in parity with shared client message types', () => {
      expect(clientSchemaMessageTypes()).toEqual([...WEBSOCKET_CLIENT_MESSAGE_TYPES]);
    });

    it('should validate auth message', () => {
      const message = {
        type: 'auth',
        data: { token: 'jwt-token' },
      };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('auth');
      }
    });

    it('should validate subscribe message', () => {
      const message = {
        type: 'subscribe',
        data: { channel: 'wallet:123' },
      };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should validate unsubscribe message', () => {
      const message = {
        type: 'unsubscribe',
        data: { channel: 'wallet:123' },
      };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should validate subscribe_batch message', () => {
      const message = {
        type: 'subscribe_batch',
        data: { channels: ['wallet:123'] },
      };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should validate unsubscribe_batch message', () => {
      const message = {
        type: 'unsubscribe_batch',
        data: { channels: ['wallet:123'] },
      };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should validate ping message', () => {
      const message = { type: 'ping' };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should validate pong message', () => {
      const message = { type: 'pong' };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject unknown message type', () => {
      const message = { type: 'unknown' };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject message without type', () => {
      const message = { data: { token: 'test' } };

      const result = ClientMessageSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject null', () => {
      const result = ClientMessageSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it('should reject undefined', () => {
      const result = ClientMessageSchema.safeParse(undefined);
      expect(result.success).toBe(false);
    });

    it('should reject non-object types', () => {
      expect(ClientMessageSchema.safeParse('string').success).toBe(false);
      expect(ClientMessageSchema.safeParse(123).success).toBe(false);
      expect(ClientMessageSchema.safeParse([]).success).toBe(false);
    });
  });

  describe('GatewayAuthResponseSchema', () => {
    it('should validate valid gateway auth response', () => {
      const validHmac = 'a'.repeat(64); // 64 hex chars
      const message = {
        type: 'auth_response',
        response: validHmac,
      };

      const result = GatewayAuthResponseSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should accept valid SHA-256 HMAC response', () => {
      const validHmac = '0123456789abcdef'.repeat(4); // 64 hex chars
      const message = {
        type: 'auth_response',
        response: validHmac,
      };

      const result = GatewayAuthResponseSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should reject HMAC with wrong length', () => {
      const shortHmac = 'a'.repeat(32);
      const message = {
        type: 'auth_response',
        response: shortHmac,
      };

      const result = GatewayAuthResponseSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject HMAC with non-hex characters', () => {
      const invalidHmac = 'g'.repeat(64); // 'g' is not a hex char
      const message = {
        type: 'auth_response',
        response: invalidHmac,
      };

      const result = GatewayAuthResponseSchema.safeParse(message);
      expect(result.success).toBe(false);
    });

    it('should reject missing response field', () => {
      const message = { type: 'auth_response' };

      const result = GatewayAuthResponseSchema.safeParse(message);
      expect(result.success).toBe(false);
    });
  });

  describe('GatewayMessageSchema', () => {
    it('should validate gateway auth response', () => {
      const message = {
        type: 'auth_response',
        response: 'a'.repeat(64),
      };

      const result = GatewayMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should allow other message types after auth', () => {
      const message = {
        type: 'event',
        event: { type: 'transaction', data: {} },
      };

      const result = GatewayMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should allow custom gateway message types', () => {
      const message = { type: 'forward_event' };

      const result = GatewayMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });
});

describe('parseClientMessage', () => {
  it('should parse valid auth message from JSON string', () => {
    const raw = JSON.stringify({
      type: 'auth',
      data: { token: 'jwt-token-here' },
    });

    const result = parseClientMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('auth');
    }
  });

  it('should parse valid subscribe message', () => {
    const raw = JSON.stringify({
      type: 'subscribe',
      data: { channel: 'wallet:abc-123' },
    });

    const result = parseClientMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('subscribe');
    }
  });

  it('should parse valid ping message', () => {
    const raw = JSON.stringify({ type: 'ping' });

    const result = parseClientMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('ping');
    }
  });

  it('should return error for invalid JSON', () => {
    const raw = 'not valid json';

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON');
    }
  });

  it('should return error for truncated JSON', () => {
    const raw = '{ "type": "auth", "data": { "token":';

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON');
    }
  });

  it('should return validation error for unknown type', () => {
    const raw = JSON.stringify({ type: 'invalid_type' });

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
    }
  });

  it('should return validation error with field path', () => {
    const raw = JSON.stringify({
      type: 'auth',
      data: { token: '' }, // Empty token should fail min(1)
    });

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
      expect(result.error).toContain('data.token');
    }
  });

  it('should return validation error for missing required field', () => {
    const raw = JSON.stringify({
      type: 'subscribe',
      data: {}, // Missing channel
    });

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
    }
  });

  it('should handle empty string input', () => {
    const result = parseClientMessage('');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON');
    }
  });

  it('should handle null JSON value', () => {
    const raw = 'null';

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
  });

  it('should handle array JSON value', () => {
    const raw = '[]';

    const result = parseClientMessage(raw);
    expect(result.success).toBe(false);
  });

  it('should handle primitive JSON values', () => {
    expect(parseClientMessage('"string"').success).toBe(false);
    expect(parseClientMessage('123').success).toBe(false);
    expect(parseClientMessage('true').success).toBe(false);
  });
});

describe('parseGatewayMessage', () => {
  it('should parse valid gateway auth response', () => {
    const raw = JSON.stringify({
      type: 'auth_response',
      response: 'a'.repeat(64),
    });

    const result = parseGatewayMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('auth_response');
    }
  });

  it('should parse valid gateway event message', () => {
    const raw = JSON.stringify({
      type: 'forward_event',
      event: { type: 'transaction', data: { txid: 'abc' } },
    });

    const result = parseGatewayMessage(raw);
    expect(result.success).toBe(true);
  });

  it('should return error for invalid JSON', () => {
    const raw = 'not json';

    const result = parseGatewayMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON');
    }
  });

  it('should validate gateway message with any type field (union fallback)', () => {
    // GatewayMessageSchema uses a union - invalid auth_response falls back to generic type
    const raw = JSON.stringify({
      type: 'auth_response',
      response: 'invalid',
    });

    const result = parseGatewayMessage(raw);
    // The union accepts any object with a type field as fallback
    expect(result.success).toBe(true);
  });

  it('should return validation details when gateway payload is missing type', () => {
    const raw = JSON.stringify({
      response: 'a'.repeat(64),
    });

    const result = parseGatewayMessage(raw);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Validation failed');
    }
  });

  it('should use GatewayAuthResponseSchema for strict auth validation', () => {
    // For strict auth validation, use the specific schema directly
    const invalid = { type: 'auth_response', response: 'invalid' };
    const strictResult = GatewayAuthResponseSchema.safeParse(invalid);
    expect(strictResult.success).toBe(false);

    const valid = { type: 'auth_response', response: 'a'.repeat(64) };
    const validResult = GatewayAuthResponseSchema.safeParse(valid);
    expect(validResult.success).toBe(true);
  });

  it('should handle empty string input', () => {
    const result = parseGatewayMessage('');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Invalid JSON');
    }
  });
});

describe('Schema edge cases', () => {
  describe('channel validation', () => {
    it('should accept various valid channel formats', () => {
      const channels = [
        'wallet:abc-123-def-456',
        'system',
        'blocks',
        'mempool',
        'wallet:uuid:transaction',
        'address:addr123',
      ];

      for (const channel of channels) {
        const message = {
          type: 'subscribe',
          data: { channel },
        };

        const result = SubscribeMessageSchema.safeParse(message);
        expect(result.success).toBe(true);
      }
    });

    it('should accept channels with special characters', () => {
      const message = {
        type: 'subscribe',
        data: { channel: 'wallet:abc_123.test' },
      };

      const result = SubscribeMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe('token validation', () => {
    it('should accept long JWT tokens', () => {
      const longToken = 'eyJ'.repeat(100) + 'signature';
      const message = {
        type: 'auth',
        data: { token: longToken },
      };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });

    it('should accept single character token', () => {
      const message = {
        type: 'auth',
        data: { token: 'a' },
      };

      const result = AuthMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });

  describe('batch operations', () => {
    it('should handle large channel arrays', () => {
      const channels = Array.from({ length: 100 }, (_, i) => `wallet:${i}`);
      const message = {
        type: 'subscribe_batch',
        data: { channels },
      };

      const result = SubscribeBatchMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.data.channels).toHaveLength(100);
      }
    });
  });

  describe('extra properties', () => {
    it('should allow extra properties on messages', () => {
      const message = {
        type: 'ping',
        extraField: 'ignored',
        anotherField: 123,
      };

      const result = PingMessageSchema.safeParse(message);
      expect(result.success).toBe(true);
    });
  });
});
