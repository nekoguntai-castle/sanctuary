/**
 * Internationalization Middleware Tests
 *
 * Tests for locale detection and request-scoped translation including:
 * - Explicit locale header (X-Locale)
 * - Accept-Language parsing
 * - Request translator attachment
 * - Locale helper function
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

type TestNextFunction = (error?: unknown) => void;

// Mock i18n service
const mockI18nService = vi.hoisted(() => ({
  isSupported: vi.fn((locale: string) => ['en', 'es', 'fr', 'de', 'ja'].includes(locale)),
  parseAcceptLanguage: vi.fn((header?: string) => {
    if (!header) return 'en';
    const primary = header.split(',')[0].split(';')[0].trim().split('-')[0];
    return ['en', 'es', 'fr', 'de', 'ja'].includes(primary) ? primary : 'en';
  }),
  translate: vi.fn((keyOrNs: string, keyOrOpts?: string | object, opts?: object) => {
    if (typeof keyOrOpts === 'string') {
      return `[${opts && (opts as any).locale}] ${keyOrNs}.${keyOrOpts}`;
    }
    return `[${keyOrOpts && (keyOrOpts as any).locale}] ${keyOrNs}`;
  }),
}));

vi.mock('../../../src/i18n/i18nService', () => ({
  i18nService: mockI18nService,
  TranslateOptions: {},
}));

import { i18nMiddleware, getRequestLocale } from '../../../src/middleware/i18n';

describe('i18n Middleware', () => {
  let req: any;
  let res: any;
  let next: Mock<TestNextFunction>;

  beforeEach(() => {
    vi.clearAllMocks();

    req = {
      headers: {},
    };

    res = {};
    next = vi.fn<TestNextFunction>();
  });

  describe('i18nMiddleware', () => {
    describe('locale detection', () => {
      it('should use explicit X-Locale header when provided and supported', () => {
        req.headers['x-locale'] = 'es';
        const middleware = i18nMiddleware();

        middleware(req, res, next);

        expect(req.locale).toBe('es');
        expect(mockI18nService.isSupported).toHaveBeenCalledWith('es');
        expect(next).toHaveBeenCalled();
      });

      it('should ignore unsupported X-Locale header', () => {
        req.headers['x-locale'] = 'unsupported';
        mockI18nService.isSupported.mockReturnValueOnce(false);
        const middleware = i18nMiddleware();

        middleware(req, res, next);

        // Should fall back to Accept-Language parsing
        expect(mockI18nService.parseAcceptLanguage).toHaveBeenCalled();
      });

      it('should use Accept-Language header when no X-Locale', () => {
        req.headers['accept-language'] = 'fr-FR,fr;q=0.9,en;q=0.8';
        const middleware = i18nMiddleware();

        middleware(req, res, next);

        expect(req.locale).toBe('fr');
        expect(mockI18nService.parseAcceptLanguage).toHaveBeenCalledWith('fr-FR,fr;q=0.9,en;q=0.8');
      });

      it('should default to en when no locale headers', () => {
        const middleware = i18nMiddleware();

        middleware(req, res, next);

        expect(req.locale).toBe('en');
        expect(mockI18nService.parseAcceptLanguage).toHaveBeenCalledWith(undefined);
      });

      it('should prioritize X-Locale over Accept-Language', () => {
        req.headers['x-locale'] = 'de';
        req.headers['accept-language'] = 'fr-FR';
        const middleware = i18nMiddleware();

        middleware(req, res, next);

        expect(req.locale).toBe('de');
        expect(mockI18nService.parseAcceptLanguage).not.toHaveBeenCalled();
      });
    });

    describe('translator attachment', () => {
      it('should attach translate function to request', () => {
        req.headers['x-locale'] = 'es';
        const middleware = i18nMiddleware();

        middleware(req, res, next);

        expect(req.t).toBeDefined();
        expect(typeof req.t).toBe('function');
      });

      it('should translate with simple key', () => {
        req.headers['x-locale'] = 'es';
        const middleware = i18nMiddleware();

        middleware(req, res, next);
        const result = req.t('greeting');

        expect(mockI18nService.translate).toHaveBeenCalledWith(
          'greeting',
          expect.objectContaining({ locale: 'es' })
        );
      });

      it('should translate with namespace and key', () => {
        req.headers['x-locale'] = 'fr';
        const middleware = i18nMiddleware();

        middleware(req, res, next);
        const result = req.t('errors', 'notFound');

        expect(mockI18nService.translate).toHaveBeenCalledWith(
          'errors',
          'notFound',
          expect.objectContaining({ locale: 'fr' })
        );
      });

      it('should pass through options to translate', () => {
        req.headers['x-locale'] = 'de';
        const middleware = i18nMiddleware();

        middleware(req, res, next);
        req.t('greeting', { name: 'Test' });

        expect(mockI18nService.translate).toHaveBeenCalledWith(
          'greeting',
          expect.objectContaining({
            locale: 'de',
            name: 'Test',
          })
        );
      });

      it('should pass through options with namespace', () => {
        req.headers['x-locale'] = 'ja';
        const middleware = i18nMiddleware();

        middleware(req, res, next);
        req.t('common', 'welcome', { name: 'User' });

        expect(mockI18nService.translate).toHaveBeenCalledWith(
          'common',
          'welcome',
          expect.objectContaining({
            locale: 'ja',
            name: 'User',
          })
        );
      });
    });
  });

  describe('getRequestLocale', () => {
    it('should return locale from request', () => {
      req.locale = 'fr';

      const result = getRequestLocale(req);

      expect(result).toBe('fr');
    });

    it('should default to en when no locale set', () => {
      const result = getRequestLocale(req);

      expect(result).toBe('en');
    });

    it('should return correct locale after middleware runs', () => {
      req.headers['x-locale'] = 'es';
      const middleware = i18nMiddleware();

      middleware(req, res, next);

      expect(getRequestLocale(req)).toBe('es');
    });
  });
});
