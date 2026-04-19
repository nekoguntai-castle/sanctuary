import type { Dispatch, SetStateAction } from 'react';
import type { ElectrumServer } from '../../types';
import * as adminApi from '../../src/api/admin';
import { extractErrorMessage } from '../../utils/errorHandler';
import type { NetworkTab } from './types';
import { getServersForNetwork, replaceServersForNetwork } from './nodeConfigData';

export function useElectrumServerControls({
  allServers,
  setAllServers,
}: {
  allServers: ElectrumServer[];
  setAllServers: Dispatch<SetStateAction<ElectrumServer[]>>;
}) {
  const handleTestConnection = async (host: string, port: number, ssl: boolean) => {
    try {
      return await adminApi.testElectrumConnection({ host, port, useSsl: ssl });
    } catch (error) {
      return {
        success: false,
        message: extractErrorMessage(error, 'Connection failed'),
      };
    }
  };

  const handleServersChange = (network: NetworkTab, servers: ElectrumServer[]) => {
    setAllServers(prev => replaceServersForNetwork(prev, network, servers));
  };

  return {
    getServersForNetwork: (network: NetworkTab) => getServersForNetwork(allServers, network),
    handleServersChange,
    handleTestConnection,
  };
}
