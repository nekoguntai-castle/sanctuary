/**
 * API Versioning Middleware Tests
 *
 * Tests version parsing from headers, query params, and URLs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Mock, MockedFunction } from 'vitest';

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  apiVersionMiddleware,
  requireApiVersion,
  maxApiVersion,
  isApiVersion,
  isApiVersionAtLeast,
} from '../../../src/middleware/apiVersion';

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return Object.assign(Object.create(null), {
    headers: {},
    query: {},
    path: '/api/v1/test',
  }, overrides);
}

type TestNextFunction = (error?: unknown) => void;

describe('API Version Middleware', () => {
  let mockReq: Request;
  let mockRes: Response;
  let mockNext: Mock<TestNextFunction>;
  let jsonMock: MockedFunction<Response['json']>;
  let statusMock: MockedFunction<Response['status']>;
  let setHeaderMock: MockedFunction<Response['setHeader']>;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = Object.create(null);
    jsonMock = vi.fn<Response['json']>().mockReturnValue(mockRes);
    setHeaderMock = vi.fn<Response['setHeader']>().mockReturnValue(mockRes);
    statusMock = vi.fn<Response['status']>().mockReturnValue(mockRes);
    Object.assign(mockRes, {
      status: statusMock,
      json: jsonMock,
      setHeader: setHeaderMock,
    });

    mockNext = vi.fn<TestNextFunction>();
  });

  describe('apiVersionMiddleware', () => {
    describe('version parsing precedence', () => {
      it('should use default version when no version specified', () => {
        const middleware = apiVersionMiddleware({ defaultVersion: 1 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 1, minor: 0 });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should fall back to configured default on non-versioned routes', () => {
        mockReq = createMockRequest({ ...mockReq, path: '/health' });
        const middleware = apiVersionMiddleware({ defaultVersion: 3, currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 3, minor: 0 });
        expect(mockNext).toHaveBeenCalled();
      });

      it('should parse version from Accept header', () => {
        mockReq.headers = { accept: 'application/vnd.sanctuary.v2+json' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version with minor from Accept header', () => {
        mockReq.headers = { accept: 'application/vnd.sanctuary.v2.1+json' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 1 });
      });

      it('should parse version from X-API-Version header', () => {
        mockReq.headers = { 'x-api-version': '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version with minor from X-API-Version header', () => {
        mockReq.headers = { 'x-api-version': '2.3' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 3 });
      });

      it('should ignore invalid Accept header and fall back to X-API-Version', () => {
        mockReq.headers = {
          accept: 'application/json',
          'x-api-version': '2',
        };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should ignore invalid X-API-Version header and fall back to query version', () => {
        mockReq.headers = { 'x-api-version': 'abc' };
        mockReq.query = { api_version: '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version from query parameter', () => {
        mockReq.query = { api_version: '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version with minor from query parameter', () => {
        mockReq.query = { api_version: '2.4' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 4 });
      });

      it('should ignore invalid query version and fall back to URL path', () => {
        mockReq.query = { api_version: 'abc' };
        mockReq = createMockRequest({ ...mockReq, path: '/api/v2/wallets' });
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should parse version from URL path', () => {
        mockReq = createMockRequest({ ...mockReq, path: '/api/v2/wallets' });
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion).toEqual({ major: 2, minor: 0 });
      });

      it('should prefer Accept header over X-API-Version', () => {
        mockReq.headers = {
          accept: 'application/vnd.sanctuary.v3+json',
          'x-api-version': '2',
        };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion.major).toBe(3);
      });

      it('should prefer X-API-Version over query parameter', () => {
        mockReq.headers = { 'x-api-version': '3' };
        mockReq.query = { api_version: '2' };
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(mockReq.apiVersion.major).toBe(3);
      });
    });

    describe('version validation', () => {
      it('should reject version below minimum', () => {
        mockReq.headers = { 'x-api-version': '1' };
        const middleware = apiVersionMiddleware({ minVersion: 2, currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unsupported API Version',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should reject version above current', () => {
        mockReq.headers = { 'x-api-version': '5' };
        const middleware = apiVersionMiddleware({ currentVersion: 2 });

        middleware(mockReq, mockRes, mockNext);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'Unknown API Version',
          })
        );
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('response headers', () => {
      it('should set X-API-Version header', () => {
        const middleware = apiVersionMiddleware();

        middleware(mockReq, mockRes, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('X-API-Version', '1.0');
      });

      it('should set X-API-Current-Version header', () => {
        const middleware = apiVersionMiddleware({ currentVersion: 3 });

        middleware(mockReq, mockRes, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('X-API-Current-Version', '3');
      });

      it('should set deprecation warning for deprecated versions', () => {
        mockReq.headers = { 'x-api-version': '1' };
        const middleware = apiVersionMiddleware({
          deprecatedVersions: [1],
          currentVersion: 2,
        });

        middleware(mockReq, mockRes, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('X-API-Deprecated', 'true');
        expect(setHeaderMock).toHaveBeenCalledWith(
          'Warning',
          expect.stringContaining('deprecated')
        );
      });

      it('should set sunset header for sunset versions', () => {
        mockReq.headers = { 'x-api-version': '1' };
        const middleware = apiVersionMiddleware({
          sunsetVersions: [{ version: 1, date: '2025-01-01' }],
          currentVersion: 2,
        });

        middleware(mockReq, mockRes, mockNext);

        expect(setHeaderMock).toHaveBeenCalledWith('Sunset', expect.any(String));
      });
    });
  });

  describe('requireApiVersion', () => {
    it('should pass when version meets requirement', () => {
      mockReq.apiVersion = { major: 2, minor: 0 };
      const middleware = requireApiVersion(2);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should pass when version exceeds requirement', () => {
      mockReq.apiVersion = { major: 3, minor: 0 };
      const middleware = requireApiVersion(2);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject when major version is too low', () => {
      mockReq.apiVersion = { major: 1, minor: 5 };
      const middleware = requireApiVersion(2);

      middleware(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'API Version Too Low',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should check minor version when major matches', () => {
      mockReq.apiVersion = { major: 2, minor: 0 };
      const middleware = requireApiVersion(2, 1);

      middleware(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should pass when minor version meets requirement', () => {
      mockReq.apiVersion = { major: 2, minor: 1 };
      const middleware = requireApiVersion(2, 1);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('maxApiVersion', () => {
    it('should pass when version is below max', () => {
      mockReq.apiVersion = { major: 1, minor: 0 };
      const middleware = maxApiVersion(2);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should pass when version equals max', () => {
      mockReq.apiVersion = { major: 2, minor: 0 };
      const middleware = maxApiVersion(2);

      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should reject when version exceeds max', () => {
      mockReq.apiVersion = { major: 3, minor: 0 };
      const middleware = maxApiVersion(2);

      middleware(mockReq, mockRes, mockNext);

      expect(statusMock).toHaveBeenCalledWith(410);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Endpoint Removed',
        })
      );
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('helper functions', () => {
    describe('isApiVersion', () => {
      it('should return true for exact major match', () => {
        mockReq.apiVersion = { major: 2, minor: 0 };

        expect(isApiVersion(mockReq, 2)).toBe(true);
      });

      it('should return true when minor is equal or higher', () => {
        mockReq.apiVersion = { major: 2, minor: 3 };

        expect(isApiVersion(mockReq, 2, 1)).toBe(true);
        expect(isApiVersion(mockReq, 2, 3)).toBe(true);
      });

      it('should return false for different major', () => {
        mockReq.apiVersion = { major: 2, minor: 0 };

        expect(isApiVersion(mockReq, 1)).toBe(false);
        expect(isApiVersion(mockReq, 3)).toBe(false);
      });
    });

    describe('isApiVersionAtLeast', () => {
      it('should return true when version exceeds requirement', () => {
        mockReq.apiVersion = { major: 3, minor: 0 };

        expect(isApiVersionAtLeast(mockReq, 2)).toBe(true);
      });

      it('should return true when version equals requirement', () => {
        mockReq.apiVersion = { major: 2, minor: 1 };

        expect(isApiVersionAtLeast(mockReq, 2, 1)).toBe(true);
      });

      it('should return false when version is below requirement', () => {
        mockReq.apiVersion = { major: 2, minor: 0 };

        expect(isApiVersionAtLeast(mockReq, 2, 1)).toBe(false);
        expect(isApiVersionAtLeast(mockReq, 3)).toBe(false);
      });
    });
  });
});
