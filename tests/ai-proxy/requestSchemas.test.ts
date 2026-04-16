import { describe, expect, it, vi } from 'vitest';

import {
  AnalyzeBodySchema,
  ChatBodySchema,
  ConfigBodySchema,
  DetectOllamaBodySchema,
  ModelBodySchema,
  QueryBodySchema,
  SuggestLabelBodySchema,
  parseRequestBody,
} from '../../ai-proxy/src/requestSchemas';

function makeRequest(body: unknown) {
  return { body } as any;
}

function makeResponse(): {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
} {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('AI proxy request schemas', () => {
  it('parses valid configuration bodies', () => {
    const res = makeResponse();

    const body = parseRequestBody(
      ConfigBodySchema,
      makeRequest({ enabled: true, endpoint: ' http://ollama:11434 ', model: ' llama3 ' }),
      res as any,
      'Invalid configuration body'
    );

    expect(body).toEqual({ enabled: true, endpoint: 'http://ollama:11434', model: 'llama3' });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs and unknown configuration fields', () => {
    const res = makeResponse();

    const body = parseRequestBody(
      ConfigBodySchema,
      makeRequest({ endpoint: 'not a url', extra: true }),
      res as any,
      'Invalid configuration body'
    );

    expect(body).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Invalid configuration body',
      details: expect.arrayContaining([
        expect.objectContaining({ message: expect.any(String), code: expect.any(String) }),
      ]),
    }));
  });

  it('treats missing request bodies as empty objects', () => {
    const res = makeResponse();

    const body = parseRequestBody(
      ConfigBodySchema,
      makeRequest(undefined),
      res as any,
      'Invalid configuration body'
    );

    expect(body).toEqual({});
    expect(res.status).not.toHaveBeenCalled();
  });

  it('validates required transaction, query, and model inputs', () => {
    expect(SuggestLabelBodySchema.parse({ transactionId: ' tx-1 ' })).toEqual({ transactionId: 'tx-1' });
    expect(QueryBodySchema.parse({ query: ' largest receives ', walletId: ' wallet-1 ' })).toEqual({
      query: 'largest receives',
      walletId: 'wallet-1',
    });
    expect(ModelBodySchema.parse({ model: ' llama3 ' })).toEqual({ model: 'llama3' });

    expect(() => SuggestLabelBodySchema.parse({ transactionId: '' })).toThrow();
    expect(() => QueryBodySchema.parse({ query: 'ok' })).toThrow();
    expect(() => ModelBodySchema.parse({ model: '' })).toThrow();
  });

  it('validates Ollama detection endpoints', () => {
    expect(DetectOllamaBodySchema.parse({
      customEndpoints: ['https://ai.example.test', 'http://192.0.2.10:11434'],
    })).toEqual({
      customEndpoints: ['https://ai.example.test', 'http://192.0.2.10:11434'],
    });

    expect(() => DetectOllamaBodySchema.parse({ customEndpoints: ['ftp://ai.example.test'] })).toThrow();
    expect(() => DetectOllamaBodySchema.parse({ customEndpoints: ['::::'] })).toThrow();
  });

  it('validates analysis type and context shape', () => {
    expect(AnalyzeBodySchema.parse({
      type: 'utxo_health',
      context: { walletId: 'wallet-1' },
    })).toEqual({
      type: 'utxo_health',
      context: { walletId: 'wallet-1' },
    });
    expect(AnalyzeBodySchema.parse({
      type: 'fee_timing',
      context: [{ feerate: 12 }],
    })).toEqual({
      type: 'fee_timing',
      context: [{ feerate: 12 }],
    });

    expect(() => AnalyzeBodySchema.parse({ type: 'unknown', context: {} })).toThrow();
    expect(() => AnalyzeBodySchema.parse({ type: 'tax', context: null })).toThrow();
  });

  it('validates chat messages', () => {
    expect(ChatBodySchema.parse({
      messages: [{ role: 'user', content: ' summarize wallet health ' }],
      walletContext: { balance: 1000 },
    })).toEqual({
      messages: [{ role: 'user', content: 'summarize wallet health' }],
      walletContext: { balance: 1000 },
    });

    expect(() => ChatBodySchema.parse({ messages: [] })).toThrow();
    expect(() => ChatBodySchema.parse({ messages: [{ role: 'tool', content: 'x' }] })).toThrow();
    expect(() => ChatBodySchema.parse({ messages: [{ role: 'user', content: '' }] })).toThrow();
  });
});
