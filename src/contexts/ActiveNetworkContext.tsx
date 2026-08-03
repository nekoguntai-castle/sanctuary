import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useUserPreference } from '../hooks/useUserPreference';
import {
  isMainnetNetwork,
  toTabNetwork,
  type TabNetwork,
} from '../app/networks';

interface ActiveNetworkContextValue {
  selectedNetwork: TabNetwork;
  isMainnet: boolean;
  setSelectedNetwork: (network: TabNetwork) => void;
}

const ActiveNetworkContext = createContext<ActiveNetworkContextValue | undefined>(undefined);

export const ActiveNetworkProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [storedNetwork, setStoredNetwork] = useUserPreference<TabNetwork>('selectedNetwork', 'mainnet');
  const selectedNetwork = toTabNetwork(storedNetwork);

  useEffect(() => {
    if (storedNetwork !== selectedNetwork) {
      setStoredNetwork(selectedNetwork);
    }
  }, [selectedNetwork, setStoredNetwork, storedNetwork]);

  const setSelectedNetwork = useCallback(
    (network: TabNetwork) => {
      setStoredNetwork(toTabNetwork(network));
    },
    [setStoredNetwork]
  );

  const value = useMemo<ActiveNetworkContextValue>(
    () => ({
      selectedNetwork,
      isMainnet: isMainnetNetwork(selectedNetwork),
      setSelectedNetwork,
    }),
    [selectedNetwork, setSelectedNetwork]
  );

  return (
    <ActiveNetworkContext.Provider value={value}>
      {children}
    </ActiveNetworkContext.Provider>
  );
};

export function useActiveNetwork(): ActiveNetworkContextValue {
  const context = useContext(ActiveNetworkContext);
  if (!context) {
    throw new Error('useActiveNetwork must be used within an ActiveNetworkProvider');
  }
  return context;
}

export function useOptionalActiveNetwork(): ActiveNetworkContextValue | undefined {
  return useContext(ActiveNetworkContext);
}
