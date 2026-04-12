/**
 * Validate Middleware Tests
 *
 * Tests for the Zod validation middleware that validates
 * request body, params, and query against schemas.
 */

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validate } from '../../../src/middleware/validate';
import { ValidationError } from '../../../src/errors/ApiError';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    ...overrides,
  } as Request;
}

describe('validate middleware', () => {
  const res = {} as Response;

  it('passes validation and replaces req.body with parsed value', () => {
    const schema = z.object({ name: z.string() });
    const middleware = validate({ body: schema });

    const req = createMockReq({ body: { name: 'test' } });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toEqual({ name: 'test' });
  });

  it('validates and replaces req.params', () => {
    const schema = z.object({ id: z.string().uuid() });
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const middleware = validate({ params: schema });

    const req = createMockReq({ params: { id } as any });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.params).toEqual({ id });
  });

  it('validates and replaces req.query', () => {
    const schema = z.object({ page: z.string() });
    const middleware = validate({ query: schema });

    const req = createMockReq({ query: { page: '1' } as any });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ page: '1' });
  });

  it('validates and replaces getter-backed req.query values', () => {
    const schema = z.object({ page: z.coerce.number() });
    const middleware = validate({ query: schema });

    const req = createMockReq();
    Object.defineProperty(req, 'query', {
      configurable: true,
      enumerable: true,
      get: () => ({ page: '2' }),
    });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.query).toEqual({ page: 2 });
  });

  it('validates body, params, and query together', () => {
    const middleware = validate({
      body: z.object({ name: z.string() }),
      params: z.object({ id: z.string() }),
      query: z.object({ verbose: z.string() }),
    });

    const req = createMockReq({
      body: { name: 'test' },
      params: { id: 'abc' } as any,
      query: { verbose: 'true' } as any,
    });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('calls next with ValidationError on body validation failure', () => {
    const schema = z.object({ name: z.string().min(1) });
    const middleware = validate({ body: schema });

    const req = createMockReq({ body: { name: 123 } });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe('Validation failed');
    expect(error.details).toHaveProperty('issues');
    expect(error.details!.issues).toBeInstanceOf(Array);
    expect((error.details!.issues as any[])[0]).toHaveProperty('path');
    expect((error.details!.issues as any[])[0]).toHaveProperty('message');
  });

  it('calls next with ValidationError on params validation failure', () => {
    const schema = z.object({ id: z.string().uuid() });
    const middleware = validate({ params: schema });

    const req = createMockReq({ params: { id: 'not-a-uuid' } as any });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('calls next with ValidationError on query validation failure', () => {
    const schema = z.object({ page: z.coerce.number().positive() });
    const middleware = validate({ query: schema });

    const req = createMockReq({ query: { page: 'not-a-number' } as any });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ValidationError);
  });

  it('passes through non-Zod errors', () => {
    const schema = z.object({}).transform(() => {
      throw new TypeError('unexpected');
    });
    const middleware = validate({ body: schema });

    const req = createMockReq({ body: {} });
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe('unexpected');
  });

  it('calls next with no args when no schemas are provided', () => {
    const middleware = validate({});
    const req = createMockReq();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('maps multiple Zod issues to the details array', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const middleware = validate({ body: schema });

    const req = createMockReq({ body: { name: 123, age: 'not-number' } });
    const next = vi.fn();

    middleware(req, res, next);

    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(ValidationError);
    const issues = error.details!.issues as any[];
    expect(issues.length).toBe(2);
    expect(issues[0].path).toBe('name');
    expect(issues[1].path).toBe('age');
  });
});
