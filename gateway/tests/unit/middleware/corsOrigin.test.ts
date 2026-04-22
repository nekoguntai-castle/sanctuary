import { describe, expect, it } from 'vitest';
import { createGatewayCorsOriginGuard, type CorsOriginGuard } from '../../../src/middleware/corsOrigin';

function evaluateOrigin(guard: CorsOriginGuard, origin?: string): { value?: boolean | string; error?: Error } {
  let result: { value?: boolean | string; error?: Error } | undefined;

  guard(origin, (error, value) => {
    result = {
      value,
      error: error ?? undefined,
    };
  });

  if (!result) {
    throw new Error('CORS origin callback was not called');
  }

  return result;
}

describe('createGatewayCorsOriginGuard', () => {
  it('allows native mobile and curl requests without an Origin header', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: [],
      nodeEnv: 'production',
    });

    expect(evaluateOrigin(guard)).toEqual({ value: false, error: undefined });
  });

  it('allows configured browser origins in production', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: ['https://mobile.example.com'],
      nodeEnv: 'production',
    });

    expect(evaluateOrigin(guard, 'https://mobile.example.com')).toEqual({
      value: 'https://mobile.example.com',
      error: undefined,
    });
  });

  it('rejects unlisted browser origins in production', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: ['https://mobile.example.com'],
      nodeEnv: 'production',
    });

    const result = evaluateOrigin(guard, 'https://evil.example.com');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('allows loopback browser origins in development when no allowlist is configured', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: [],
      nodeEnv: 'development',
    });

    expect(evaluateOrigin(guard, 'http://localhost:5173')).toEqual({
      value: 'http://localhost:5173',
      error: undefined,
    });
  });

  it('rejects non-loopback browser origins in development when no allowlist is configured', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: [],
      nodeEnv: 'development',
    });

    const result = evaluateOrigin(guard, 'https://preview.example.com');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('rejects malformed browser origins in development', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: [],
      nodeEnv: 'development',
    });

    const result = evaluateOrigin(guard, 'not a url');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('honors the allowlist in development when one is configured', () => {
    const guard = createGatewayCorsOriginGuard({
      allowedOrigins: ['http://localhost:3000'],
      nodeEnv: 'development',
    });

    const result = evaluateOrigin(guard, 'http://localhost:5173');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });
});
