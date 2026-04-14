import { describe } from 'vitest';
import { registerElectrumConnectionEdgeDataContracts } from './electrumConnection/electrum.connection.edge-data.contracts';
import { registerElectrumConnectionNetworkConfigContracts } from './electrumConnection/electrum.connection.network-config.contracts';
import { registerElectrumConnectionProxyContracts } from './electrumConnection/electrum.connection.proxy.contracts';
import { registerElectrumConnectionRequestContracts } from './electrumConnection/electrum.connection.requests.contracts';
import { registerElectrumConnectionTlsContracts } from './electrumConnection/electrum.connection.tls.contracts';
import { setupElectrumConnectionTestHooks } from './electrumConnection/electrumConnectionTestHarness';

describe('ElectrumClient connection and transport internals', () => {
  setupElectrumConnectionTestHooks();
  registerElectrumConnectionNetworkConfigContracts();
  registerElectrumConnectionTlsContracts();
  registerElectrumConnectionProxyContracts();
  registerElectrumConnectionRequestContracts();
  registerElectrumConnectionEdgeDataContracts();
});
