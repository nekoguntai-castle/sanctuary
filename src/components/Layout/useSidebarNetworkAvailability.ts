import { useCallback, useEffect, useRef, useState } from 'react';
import * as bitcoinApi from '../../api/bitcoin';
import type { TabNetwork } from '../../app/networks';

export type NetworkAvailability = Record<TabNetwork, boolean>;

export const DEFAULT_NETWORK_AVAILABILITY: NetworkAvailability = {
  mainnet: true,
  testnet3: true,
  testnet4: true,
  signet: true,
};

const NODE_CONFIG_DISABLED_MESSAGE = 'sync is off in Node Configuration';

const isSameNetworkAvailability = (
  first: NetworkAvailability,
  second: NetworkAvailability,
): boolean => (
  first.mainnet === second.mainnet &&
  first.testnet3 === second.testnet3 &&
  first.testnet4 === second.testnet4 &&
  first.signet === second.signet
);

const isNodeConfigurationDisabledStatus = (
  status: bitcoinApi.BitcoinStatus | null,
): boolean => (
  status?.connected === false &&
  typeof status.error === 'string' &&
  status.error.includes(NODE_CONFIG_DISABLED_MESSAGE)
);

const getStatusForAvailability = async (
  network: Exclude<TabNetwork, 'mainnet'>,
): Promise<bitcoinApi.BitcoinStatus | null> => {
  try {
    return await bitcoinApi.getStatus(network);
  } catch {
    return null;
  }
};

export const getSidebarNetworkAvailability = async (): Promise<NetworkAvailability> => {
  const [testnet3Status, testnet4Status, signetStatus] = await Promise.all([
    getStatusForAvailability('testnet3'),
    getStatusForAvailability('testnet4'),
    getStatusForAvailability('signet'),
  ]);

  return {
    mainnet: true,
    testnet3: !isNodeConfigurationDisabledStatus(testnet3Status),
    testnet4: !isNodeConfigurationDisabledStatus(testnet4Status),
    signet: !isNodeConfigurationDisabledStatus(signetStatus),
  };
};

export function useSidebarNetworkAvailability({
  enabled,
  selectedNetwork,
  setSelectedNetwork,
}: {
  enabled: boolean;
  selectedNetwork: TabNetwork;
  setSelectedNetwork: (network: TabNetwork) => void;
}) {
  const [networkAvailability, setNetworkAvailability] = useState<NetworkAvailability>(
    DEFAULT_NETWORK_AVAILABILITY,
  );
  const networkAvailabilityRef = useRef<NetworkAvailability>(DEFAULT_NETWORK_AVAILABILITY);

  const applyNetworkAvailability = useCallback((availability: NetworkAvailability) => {
    if (isSameNetworkAvailability(networkAvailabilityRef.current, availability)) return;

    networkAvailabilityRef.current = availability;
    setNetworkAvailability(availability);
  }, []);

  useEffect(() => {
    if (!enabled) {
      applyNetworkAvailability(DEFAULT_NETWORK_AVAILABILITY);
      return;
    }

    let cancelled = false;

    const refreshNetworkAvailability = async () => {
      const availability = await getSidebarNetworkAvailability();
      /* v8 ignore next -- async unmount race guard; cleanup path prevents setting state after unmount. */
      if (cancelled) return;
      applyNetworkAvailability(availability);
    };

    void refreshNetworkAvailability();
    const interval = setInterval(refreshNetworkAvailability, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, applyNetworkAvailability]);

  useEffect(() => {
    if (networkAvailability[selectedNetwork]) return;
    setSelectedNetwork('mainnet');
  }, [networkAvailability, selectedNetwork, setSelectedNetwork]);

  return networkAvailability;
}
