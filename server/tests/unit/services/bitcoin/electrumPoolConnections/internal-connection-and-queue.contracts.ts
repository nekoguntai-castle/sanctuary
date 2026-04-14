import { describe } from 'vitest';
import type { ElectrumPoolTestContext } from './electrumPoolConnectionsTestHarness';
import { registerElectrumPoolInternalHealthSelectionTests } from './internal-health-selection.contracts';
import { registerElectrumPoolInternalLifecycleTests } from './internal-lifecycle.contracts';
import { registerElectrumPoolInternalReconnectMetricsTests } from './internal-reconnect-metrics.contracts';

export function registerElectrumPoolInternalConnectionTests(context: ElectrumPoolTestContext): void {
  describe('internal connection and queue branches', () => {
    registerElectrumPoolInternalLifecycleTests(context);
    registerElectrumPoolInternalHealthSelectionTests(context);
    registerElectrumPoolInternalReconnectMetricsTests(context);
  });
}
