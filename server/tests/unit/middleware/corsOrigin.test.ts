import { describe, expect, it } from 'vitest';
import { createServerCorsOriginGuard, type CorsOriginGuard } from '../../../src/middleware/corsOrigin';

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

describe('createServerCorsOriginGuard', () => {
  it('allows requests without an Origin header', () => {
    const guard = createServerCorsOriginGuard({
      clientUrl: 'https://app.example.com',
      nodeEnv: 'production',
    });

    expect(evaluateOrigin(guard)).toEqual({ value: false, error: undefined });
  });

  it('allows the configured client URL in production', () => {
    const guard = createServerCorsOriginGuard({
      clientUrl: 'https://app.example.com',
      nodeEnv: 'production',
    });

    expect(evaluateOrigin(guard, 'https://app.example.com')).toEqual({
      value: 'https://app.example.com',
      error: undefined,
    });
  });

  it('allows additional configured origins in production', () => {
    const guard = createServerCorsOriginGuard({
      allowedOrigins: ['https://admin.example.com'],
      clientUrl: 'https://app.example.com',
      nodeEnv: 'production',
    });

    expect(evaluateOrigin(guard, 'https://admin.example.com')).toEqual({
      value: 'https://admin.example.com',
      error: undefined,
    });
  });

  it('rejects unlisted browser origins in production', () => {
    const guard = createServerCorsOriginGuard({
      allowedOrigins: ['https://admin.example.com'],
      clientUrl: 'https://app.example.com',
      nodeEnv: 'production',
    });

    const result = evaluateOrigin(guard, 'https://evil.example.com');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('rejects browser origins in production when no origin is configured', () => {
    const guard = createServerCorsOriginGuard({
      clientUrl: '',
      nodeEnv: 'production',
    });

    const result = evaluateOrigin(guard, 'https://app.example.com');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('allows loopback browser origins in development', () => {
    const guard = createServerCorsOriginGuard({
      clientUrl: '',
      nodeEnv: 'development',
    });

    expect(evaluateOrigin(guard, 'http://127.0.0.1:5173')).toEqual({
      value: 'http://127.0.0.1:5173',
      error: undefined,
    });
  });

  it('rejects non-loopback browser origins in development unless configured', () => {
    const guard = createServerCorsOriginGuard({
      clientUrl: '',
      nodeEnv: 'development',
    });

    const result = evaluateOrigin(guard, 'https://preview.example.com');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('rejects malformed browser origins in development', () => {
    const guard = createServerCorsOriginGuard({
      clientUrl: '',
      nodeEnv: 'development',
    });

    const result = evaluateOrigin(guard, 'not a url');

    expect(result.value).toBeUndefined();
    expect(result.error?.message).toBe('Not allowed by CORS');
  });
});
