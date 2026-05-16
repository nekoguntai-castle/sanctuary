import { describe, expect, it } from 'vitest';
import {
  MONITORING_SERVICE_IDS,
  isMonitoringServiceId,
} from '@sanctuary/shared/constants/adminMonitoring';

describe('admin monitoring constants', () => {
  it('defines the configurable monitoring service IDs', () => {
    expect(MONITORING_SERVICE_IDS).toEqual(['grafana', 'prometheus', 'jaeger']);
  });

  it('guards unknown service IDs', () => {
    expect(isMonitoringServiceId('grafana')).toBe(true);
    expect(isMonitoringServiceId('prometheus')).toBe(true);
    expect(isMonitoringServiceId('jaeger')).toBe(true);
    expect(isMonitoringServiceId('loki')).toBe(false);
    expect(isMonitoringServiceId('')).toBe(false);
    expect(isMonitoringServiceId(null)).toBe(false);
  });
});
