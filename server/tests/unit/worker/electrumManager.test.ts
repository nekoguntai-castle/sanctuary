import { describe } from 'vitest';

import { registerElectrumManagerSetup } from './electrumManager/electrumManagerTestHarness';
import { registerElectrumManagerEventContracts } from './electrumManager/electrumManager.events.contracts';
import { registerElectrumManagerHealthMetricContracts } from './electrumManager/electrumManager.health-metrics.contracts';
import { registerElectrumManagerIsConnectedContracts } from './electrumManager/electrumManager.is-connected.contracts';
import { registerElectrumManagerReconcileContracts } from './electrumManager/electrumManager.reconcile.contracts';
import { registerElectrumManagerStandaloneContracts } from './electrumManager/electrumManager.standalone.contracts';
import { registerElectrumManagerStartContracts } from './electrumManager/electrumManager.start.contracts';
import { registerElectrumManagerWalletSubscriptionContracts } from './electrumManager/electrumManager.wallet-subscriptions.contracts';

describe('ElectrumSubscriptionManager', () => {
  registerElectrumManagerSetup();
  registerElectrumManagerReconcileContracts();
  registerElectrumManagerStartContracts();
  registerElectrumManagerEventContracts();
  registerElectrumManagerWalletSubscriptionContracts();
  registerElectrumManagerStandaloneContracts();
  registerElectrumManagerHealthMetricContracts();
  registerElectrumManagerIsConnectedContracts();
});
