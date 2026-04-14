import { describe, expect, it } from 'vitest';
import {
  manager,
} from './electrumManagerTestHarness';

export function registerElectrumManagerHealthMetricContracts() {
  describe('getHealthMetrics', () => {
    it('should return correct metrics', () => {
      const metrics = manager.getHealthMetrics();

      expect(metrics).toHaveProperty('isRunning');
      expect(metrics).toHaveProperty('networks');
      expect(metrics).toHaveProperty('totalSubscribedAddresses');
      expect(typeof metrics.totalSubscribedAddresses).toBe('number');
    });
  });
}
