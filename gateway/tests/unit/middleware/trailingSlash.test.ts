/**
 * Trailing Slash Middleware Tests
 *
 * Tests the URL normalization middleware that strips trailing slashes
 * for consistent routing behavior across mobile clients.
 */

import { describe, it, expect, vi } from 'vitest';
import { Request, Response } from 'express';
import { normalizeTrailingSlash } from '../../../src/middleware/trailingSlash';

describe('Trailing Slash Middleware', () => {
  function createMockRequest(path: string, url?: string): Partial<Request> {
    return {
      path,
      url: url || path,
    };
  }

  function createMockResponse(): Partial<Response> {
    return {};
  }

  describe('URL normalization', () => {
    it('should strip single trailing slash from path', () => {
      const req = createMockRequest('/api/v1/wallets/', '/api/v1/wallets/');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/wallets');
      expect(next).toHaveBeenCalled();
    });

    it('should strip multiple trailing slashes', () => {
      const req = createMockRequest('/api/v1/wallets///', '/api/v1/wallets///');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/wallets');
      expect(next).toHaveBeenCalled();
    });

    it('should not modify paths without trailing slashes', () => {
      const req = createMockRequest('/api/v1/wallets', '/api/v1/wallets');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/wallets');
      expect(next).toHaveBeenCalled();
    });

    it('should preserve root path /', () => {
      const req = createMockRequest('/', '/');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/');
      expect(next).toHaveBeenCalled();
    });

    it('should preserve query parameters after stripping slash', () => {
      const req = createMockRequest('/api/v1/wallets/', '/api/v1/wallets/?page=1&limit=10');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/wallets?page=1&limit=10');
      expect(next).toHaveBeenCalled();
    });

    it('should handle deep nested paths with trailing slash', () => {
      const req = createMockRequest(
        '/api/v1/wallets/123/transactions/456/',
        '/api/v1/wallets/123/transactions/456/'
      );
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/wallets/123/transactions/456');
      expect(next).toHaveBeenCalled();
    });

    it('should handle URL with hash fragment', () => {
      const req = createMockRequest('/api/v1/docs/', '/api/v1/docs/#section');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      // Hash fragments typically aren't sent to server, but test the behavior
      expect(req.url).toBe('/api/v1/docs#section');
      expect(next).toHaveBeenCalled();
    });

    it('should preserve query parameters before hash fragments', () => {
      const req = createMockRequest('/api/v1/docs/', '/api/v1/docs/?tab=overview#section');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/docs?tab=overview#section');
      expect(next).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should always call next()', () => {
      const testCases = [
        { path: '/', url: '/' },
        { path: '/api', url: '/api' },
        { path: '/api/', url: '/api/' },
        { path: '/a/b/c/', url: '/a/b/c/' },
      ];

      testCases.forEach(({ path, url }) => {
        const req = createMockRequest(path, url);
        const res = createMockResponse();
        const next = vi.fn();

        normalizeTrailingSlash(req as Request, res as Response, next);

        expect(next).toHaveBeenCalled();
      });
    });

    it('should handle empty path gracefully', () => {
      // Edge case: if somehow path is empty but has trailing slash in URL
      const req = createMockRequest('', '/');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      // Empty path doesn't end with '/', so URL unchanged
      expect(req.url).toBe('/');
      expect(next).toHaveBeenCalled();
    });

    it('should not modify URL when path check fails', () => {
      // Path without trailing slash but URL might have one (edge case)
      const req = createMockRequest('/api/v1/test', '/api/v1/test');
      const res = createMockResponse();
      const next = vi.fn();

      normalizeTrailingSlash(req as Request, res as Response, next);

      expect(req.url).toBe('/api/v1/test');
      expect(next).toHaveBeenCalled();
    });
  });
});
