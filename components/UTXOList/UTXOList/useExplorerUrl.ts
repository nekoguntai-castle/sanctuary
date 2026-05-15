import { useEffect, useState } from 'react';
import * as bitcoinApi from '../../../src/api/bitcoin';
import { createLogger } from '../../../utils/logger';
import { getDefaultNodeExternalServiceUrl } from '@sanctuary/shared/constants/nodeConfig';

const log = createLogger('UTXOList');
const DEFAULT_EXPLORER_URL = getDefaultNodeExternalServiceUrl('mainnet');

export function useExplorerUrl(): string {
  const [explorerUrl, setExplorerUrl] = useState(DEFAULT_EXPLORER_URL);

  useEffect(() => {
    let isMounted = true;

    const fetchExplorerUrl = async () => {
      try {
        const status = await bitcoinApi.getStatus();
        if (isMounted && status.explorerUrl) setExplorerUrl(status.explorerUrl);
      } catch (err) {
        log.error('Failed to fetch explorer URL', { error: err });
      }
    };

    fetchExplorerUrl();

    return () => {
      isMounted = false;
    };
  }, []);

  return explorerUrl;
}
