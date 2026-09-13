import { useEffect, useState } from 'react';
import * as bitcoinApi from '../../../api/bitcoin';
import { createLogger } from '../../../utils/logger';

const log = createLogger('UTXOList');

/**
 * Resolve the configured block-explorer base for a specific network.
 *
 * The network is required rather than defaulted. `bitcoinApi.getStatus()`
 * silently defaults to mainnet, so omitting it here asked the server for the
 * *mainnet* explorer and discarded whatever the operator had configured for
 * testnet3/testnet4/signet — the returned base then pointed at a mainnet
 * explorer for a testnet address whenever the mainnet explorer was customised.
 *
 * Returns `null` while unresolved, or when the network is unknown, so callers
 * render a non-link placeholder instead of a wrong-network URL.
 */
export function useExplorerUrl(network: string | null | undefined): string | null {
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!network) {
      setExplorerUrl(null);
      return;
    }

    let isMounted = true;

    const fetchExplorerUrl = async () => {
      try {
        const status = await bitcoinApi.getStatus(network);
        // isMounted is per-effect-run, so a response for a previous network
        // cannot land after that effect was cleaned up on the switch.
        if (isMounted) setExplorerUrl(status.explorerUrl ?? null);
      } catch (err) {
        log.error('Failed to fetch explorer URL', { error: err });
        if (isMounted) setExplorerUrl(null);
      }
    };

    fetchExplorerUrl();

    return () => {
      isMounted = false;
    };
  }, [network]);

  return explorerUrl;
}
