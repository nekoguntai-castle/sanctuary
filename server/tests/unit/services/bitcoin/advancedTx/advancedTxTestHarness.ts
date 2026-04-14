import { beforeEach, vi } from 'vitest';
/**
 * Advanced Transaction Test Harness
 *
 * Shared mocks and default setup for RBF/CPFP advanced transaction contract tests.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../../mocks/electrum';

vi.mock('../../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../../src/services/bitcoin/electrum', () => ({
  getElectrumClient: vi.fn().mockReturnValue(mockElectrumClient),
}));

vi.mock('../../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

export function registerAdvancedTxTestSetup() {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();

    // Default system settings
    mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
      key: 'dustThreshold',
      value: '546',
    });
  });
}
