import { vi, type Mock } from 'vitest';
/**
 * Feature Gate Middleware Tests
 *
 * Tests for feature flag middleware including top-level and experimental flags.
 */

import { Request, Response, NextFunction } from 'express';
import {
  requireFeature,
  requireAllFeatures,
  requireAnyFeature,
  isFeatureEnabledAsync,
} from '../../../src/middleware/featureGate';
import { featureFlagService } from '../../../src/services/featureFlagService';

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock config module
const mockFeatures = {
  hardwareWalletSigning: true,
  qrCodeSigning: true,
  multisigWallets: true,
  batchSync: true,
  payjoinSupport: false,
  batchTransactions: true,
  rbfTransactions: true,
  priceAlerts: false,
  aiAssistant: false,
  sanctuaryConsole: false,
  telegramNotifications: false,
  treasuryAutopilot: false,
  treasuryIntelligence: false,
  websocketV2Events: true,
  experimental: {
    taprootAddresses: false,
    silentPayments: false,
    coinJoin: false,
  },
};

vi.mock('../../../src/config', () => ({
  getConfig: () => ({
    features: mockFeatures,
  }),
}));

// Mock the featureFlagService to use our mockFeatures
vi.mock('../../../src/services/featureFlagService', () => ({
  featureFlagService: {
    isEnabled: vi.fn((flag: string) => {
      if (flag.startsWith('experimental.')) {
        const key = flag.replace('experimental.', '');
        return Promise.resolve(mockFeatures.experimental[key as keyof typeof mockFeatures.experimental] ?? false);
      }
      return Promise.resolve(mockFeatures[flag as keyof typeof mockFeatures] ?? false);
    }),
  },
}));

describe('Feature Gate Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: NextFunction;
  let jsonMock: Mock;
  let statusMock: Mock;
  let isEnabledMock: Mock;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockRequest = {
      path: '/test',
      method: 'POST',
    };
    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };
    nextFunction = vi.fn();
    isEnabledMock = featureFlagService.isEnabled as unknown as Mock;

    // Reset feature flags to default state
    mockFeatures.hardwareWalletSigning = true;
    mockFeatures.qrCodeSigning = true;
    mockFeatures.multisigWallets = true;
    mockFeatures.batchSync = true;
    mockFeatures.payjoinSupport = false;
    mockFeatures.batchTransactions = true;
    mockFeatures.rbfTransactions = true;
    mockFeatures.priceAlerts = false;
    mockFeatures.aiAssistant = false;
    mockFeatures.telegramNotifications = false;
    mockFeatures.treasuryAutopilot = false;
    mockFeatures.treasuryIntelligence = false;
    mockFeatures.websocketV2Events = true;
    mockFeatures.experimental.taprootAddresses = false;
    mockFeatures.experimental.silentPayments = false;
    mockFeatures.experimental.coinJoin = false;

    // Restore default feature service behavior
    isEnabledMock.mockReset();
    isEnabledMock.mockImplementation((flag: string) => {
      if (flag.startsWith('experimental.')) {
        const key = flag.replace('experimental.', '');
        return Promise.resolve(
          mockFeatures.experimental[key as keyof typeof mockFeatures.experimental] ?? false
        );
      }
      return Promise.resolve(mockFeatures[flag as keyof typeof mockFeatures] ?? false);
    });
  });

  describe('requireFeature', () => {
    it('should call next when feature is enabled', async () => {
      const middleware = requireFeature('hardwareWalletSigning');

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when feature is disabled', async () => {
      const middleware = requireFeature('payjoinSupport');

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Feature not available',
        feature: 'payjoinSupport',
      }));
    });

    it('should handle experimental features', async () => {
      mockFeatures.experimental.taprootAddresses = true;

      const middleware = requireFeature('experimental.taprootAddresses');

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
    });

    it('should block disabled experimental features', async () => {
      const middleware = requireFeature('experimental.silentPayments');

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should use config fallback when feature service fails and allow enabled flag', async () => {
      isEnabledMock.mockRejectedValueOnce(new Error('service unavailable'));
      const middleware = requireFeature('hardwareWalletSigning');

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should use config fallback when feature service fails and block disabled flag', async () => {
      isEnabledMock.mockRejectedValueOnce(new Error('service unavailable'));
      const middleware = requireFeature('payjoinSupport');

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should use config fallback for experimental features when service fails', async () => {
      mockFeatures.experimental.taprootAddresses = true;
      isEnabledMock.mockRejectedValueOnce(new Error('service unavailable'));

      await requireFeature('experimental.taprootAddresses')(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      expect(nextFunction).toHaveBeenCalled();

      vi.clearAllMocks();
      isEnabledMock.mockRejectedValueOnce(new Error('service unavailable'));

      await requireFeature('experimental.silentPayments')(
        mockRequest as Request,
        mockResponse as Response,
        nextFunction,
      );

      expect(statusMock).toHaveBeenCalledWith(403);
    });
  });

  describe('requireAllFeatures', () => {
    it('should call next when all features are enabled', async () => {
      const middleware = requireAllFeatures([
        'hardwareWalletSigning',
        'qrCodeSigning',
      ]);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when any feature is disabled', async () => {
      const middleware = requireAllFeatures([
        'hardwareWalletSigning',
        'payjoinSupport', // disabled
      ]);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Features not available',
        disabledFeatures: ['payjoinSupport'],
      }));
    });

    it('should list all disabled features', async () => {
      const middleware = requireAllFeatures([
        'hardwareWalletSigning',
        'payjoinSupport',
        'priceAlerts',
      ]);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        disabledFeatures: expect.arrayContaining(['payjoinSupport', 'priceAlerts']),
      }));
    });

    it('should use config fallback when feature service fails', async () => {
      isEnabledMock.mockRejectedValue(new Error('service unavailable'));
      const middleware = requireAllFeatures(['hardwareWalletSigning', 'payjoinSupport']);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should allow request when fallback config has all required features enabled', async () => {
      isEnabledMock.mockRejectedValue(new Error('service unavailable'));
      const middleware = requireAllFeatures(['hardwareWalletSigning', 'batchTransactions']);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });
  });

  describe('requireAnyFeature', () => {
    it('should call next when any feature is enabled', async () => {
      const middleware = requireAnyFeature([
        'payjoinSupport', // disabled
        'hardwareWalletSigning', // enabled
      ]);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });

    it('should return 403 when no features are enabled', async () => {
      const middleware = requireAnyFeature([
        'payjoinSupport',
        'priceAlerts',
        'aiAssistant',
      ]);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
      expect(jsonMock).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Features not available',
        requiredAnyOf: ['payjoinSupport', 'priceAlerts', 'aiAssistant'],
      }));
    });

    it('should use fallback and block when service fails with no enabled fallback features', async () => {
      isEnabledMock.mockRejectedValue(new Error('service unavailable'));
      const middleware = requireAnyFeature(['payjoinSupport', 'priceAlerts']);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(403);
    });

    it('should use fallback and allow when service fails but one fallback feature is enabled', async () => {
      isEnabledMock.mockRejectedValue(new Error('service unavailable'));
      const middleware = requireAnyFeature(['payjoinSupport', 'hardwareWalletSigning']);

      await middleware(mockRequest as Request, mockResponse as Response, nextFunction);

      expect(nextFunction).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });
  });

  describe('isFeatureEnabledAsync', () => {
    it('returns service value when feature service succeeds', async () => {
      await expect(isFeatureEnabledAsync('hardwareWalletSigning')).resolves.toBe(true);
    });

    it('falls back to config when feature service throws', async () => {
      isEnabledMock.mockRejectedValueOnce(new Error('service unavailable'));

      await expect(isFeatureEnabledAsync('payjoinSupport')).resolves.toBe(false);
    });
  });

});
