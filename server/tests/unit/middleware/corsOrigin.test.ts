import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { ForbiddenError } from '../../../src/errors/ApiError';
import {
  createServerCorsOptionsDelegate,
  createServerCorsOriginGuard,
  type CorsOriginGuard,
} from '../../../src/middleware/corsOrigin';

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

function createRequestLike(options: {
  host?: string;
  protocol?: string;
}): Pick<Request, 'headers' | 'protocol' | 'get'> {
  const headers: Request['headers'] = {};

  if (options.host) {
    headers.host = options.host;
  }

  return {
    headers,
    protocol: options.protocol ?? 'http',
    get: (name: string) => name.toLowerCase() === 'host' ? options.host : undefined,
  };
}

function evaluateDelegatedOrigin(
  req: Pick<Request, 'headers' | 'protocol' | 'get'>,
  origin?: string,
): { value?: boolean | string; error?: Error } {
  const delegate = createServerCorsOptionsDelegate({
    clientUrl: '',
    nodeEnv: 'production',
  });

  let optionsResult: { error?: Error; origin?: CorsOriginGuard | boolean | string } | undefined;

  delegate(req as Request, (error, options) => {
    optionsResult = {
      error: error ?? undefined,
      origin: options?.origin as CorsOriginGuard | boolean | string | undefined,
    };
  });

  if (!optionsResult) {
    throw new Error('CORS options delegate callback was not called');
  }

  if (optionsResult.error) {
    return { error: optionsResult.error };
  }

  if (typeof optionsResult.origin === 'function') {
    return evaluateOrigin(optionsResult.origin, origin);
  }

  return { value: optionsResult.origin };
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
    expect(result.error).toBeInstanceOf(ForbiddenError);
    expect((result.error as ForbiddenError).statusCode).toBe(403);
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

  it('allows same-origin browser access derived from the current request host in production', () => {
    const result = evaluateDelegatedOrigin(createRequestLike({
      host: '10.0.0.5:8443',
      protocol: 'https',
    }), 'https://10.0.0.5:8443');

    expect(result).toEqual({
      value: 'https://10.0.0.5:8443',
      error: undefined,
    });
  });

  it('allows same-origin browser access for internal hostnames derived from the current request host', () => {
    const result = evaluateDelegatedOrigin(createRequestLike({
      host: 'internal-sanctuary.local:8443',
      protocol: 'https',
    }), 'https://internal-sanctuary.local:8443');

    expect(result).toEqual({
      value: 'https://internal-sanctuary.local:8443',
      error: undefined,
    });
  });

  it('rejects browser origins when the current request host is missing', () => {
    const result = evaluateDelegatedOrigin(createRequestLike({
      protocol: 'https',
    }), 'https://10.0.0.5:8443');

    expect(result.value).toBeUndefined();
    expect(result.error).toBeInstanceOf(ForbiddenError);
    expect((result.error as ForbiddenError).statusCode).toBe(403);
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('rejects browser origins when the current request host cannot form a valid origin', () => {
    const result = evaluateDelegatedOrigin(createRequestLike({
      host: 'not a valid host',
      protocol: 'https',
    }), 'https://10.0.0.5:8443');

    expect(result.value).toBeUndefined();
    expect(result.error).toBeInstanceOf(ForbiddenError);
    expect((result.error as ForbiddenError).statusCode).toBe(403);
    expect(result.error?.message).toBe('Not allowed by CORS');
  });

  it('rejects browser origins that do not match the current request origin in production', () => {
    const result = evaluateDelegatedOrigin(createRequestLike({
      host: '10.0.0.5:8443',
      protocol: 'https',
    }), 'https://evil.example.com');

    expect(result.value).toBeUndefined();
    expect(result.error).toBeInstanceOf(ForbiddenError);
    expect((result.error as ForbiddenError).statusCode).toBe(403);
    expect(result.error?.message).toBe('Not allowed by CORS');
  });
});
