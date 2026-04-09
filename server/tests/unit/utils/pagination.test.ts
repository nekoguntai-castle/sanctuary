import { describe, it, expect, vi } from 'vitest';
import { extractPagination, setTruncationHeaders } from '../../../src/utils/pagination';

describe('extractPagination', () => {
  it('returns defaults when no params provided', () => {
    const result = extractPagination({});
    expect(result).toEqual({
      effectiveLimit: 1000,
      effectiveOffset: 0,
      hasPagination: false,
    });
  });

  it('uses explicit limit and offset when provided', () => {
    const result = extractPagination({ limit: '50', offset: '10' });
    expect(result).toEqual({
      effectiveLimit: 50,
      effectiveOffset: 10,
      hasPagination: true,
    });
  });

  it('treats limit-only as paginated', () => {
    const result = extractPagination({ limit: '25' });
    expect(result.hasPagination).toBe(true);
    expect(result.effectiveLimit).toBe(25);
  });

  it('treats offset-only as paginated', () => {
    const result = extractPagination({ offset: '5' });
    expect(result.hasPagination).toBe(true);
    expect(result.effectiveOffset).toBe(5);
  });

  it('accepts a custom default limit', () => {
    const result = extractPagination({}, 500);
    expect(result.effectiveLimit).toBe(500);
  });
});

describe('setTruncationHeaders', () => {
  function mockResponse() {
    const headers: Record<string, string> = {};
    return {
      setHeader: vi.fn((key: string, value: string) => { headers[key] = value; }),
      headers,
    } as unknown as import('express').Response;
  }

  it('sets headers when not paginated and results are below limit', () => {
    const res = mockResponse();
    const pagination = { effectiveLimit: 1000, effectiveOffset: 0, hasPagination: false };
    setTruncationHeaders(res, 50, pagination);
    expect(res.setHeader).toHaveBeenCalledWith('X-Result-Limit', '1000');
    expect(res.setHeader).toHaveBeenCalledWith('X-Result-Truncated', 'false');
  });

  it('sets truncated=true when results reach the limit', () => {
    const res = mockResponse();
    const pagination = { effectiveLimit: 1000, effectiveOffset: 0, hasPagination: false };
    setTruncationHeaders(res, 1000, pagination);
    expect(res.setHeader).toHaveBeenCalledWith('X-Result-Truncated', 'true');
  });

  it('does not set headers when paginated', () => {
    const res = mockResponse();
    const pagination = { effectiveLimit: 50, effectiveOffset: 10, hasPagination: true };
    setTruncationHeaders(res, 50, pagination);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('uses effectiveLimit from pagination result in header value', () => {
    const res = mockResponse();
    const pagination = { effectiveLimit: 500, effectiveOffset: 0, hasPagination: false };
    setTruncationHeaders(res, 500, pagination);
    expect(res.setHeader).toHaveBeenCalledWith('X-Result-Limit', '500');
    expect(res.setHeader).toHaveBeenCalledWith('X-Result-Truncated', 'true');
  });
});
