import { PresetServer, Network } from './types';

// Preset servers for each network
export const PRESET_SERVERS: Record<Network, PresetServer[]> = {
  mainnet: [
    { name: 'Blockstream (SSL)', host: 'electrum.blockstream.info', port: 50002, useSsl: true },
    { name: 'Blockstream (TCP)', host: 'electrum.blockstream.info', port: 50001, useSsl: false },
  ],
  testnet: [
    { name: 'Blockstream Testnet', host: 'electrum.blockstream.info', port: 60002, useSsl: true },
    { name: 'Aranguren Testnet', host: 'testnet.aranguren.org', port: 51002, useSsl: true },
    { name: 'Hsmiths Testnet', host: 'testnet.hsmiths.com', port: 53012, useSsl: true },
  ],
  signet: [
    { name: 'Mutinynet Signet', host: 'electrum.mutinynet.com', port: 50002, useSsl: true },
  ],
};
