import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TabNetwork } from '../NetworkTabs';
import { resolveInitialNetwork } from './walletListData';

export function useWalletNetworkParam() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedNetwork, setSelectedNetwork] = useState<TabNetwork>(
    () => resolveInitialNetwork(searchParams.get('network'))
  );

  const handleNetworkChange = (network: TabNetwork) => {
    setSelectedNetwork(network);
    const nextParams = new URLSearchParams(searchParams);
    if (network === 'mainnet') nextParams.delete('network');
    else nextParams.set('network', network);
    setSearchParams(nextParams, { replace: true });
  };

  return { selectedNetwork, handleNetworkChange };
}
