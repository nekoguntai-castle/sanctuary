import { useCallback, useEffect, useRef } from 'react';
import type { DeviceType } from '../../../services/hardwareWallet/types';
import type {
  HardwareWalletConnectionLease,
  HardwareWalletService,
} from '../../../services/hardwareWallet/service';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import { loadHardwareWalletRuntime } from '../../../services/hardwareWallet/loader';
import { createLogger } from '../../../utils/logger';
import {
  getDefaultHardwareImportModel,
  getDerivationPath,
  HardwareDeviceType,
  ScriptType,
} from '../importHelpers';
import type { ImportNetworkOwner, XpubData } from '../hooks/useImportState';

const log = createLogger('ImportWallet');

export function useHardwareImportActions({
  hardwareDeviceType,
  hardwareDeviceModel,
  scriptType,
  accountIndex,
  setHardwareDeviceType,
  setHardwareDeviceModel,
  setDeviceConnected,
  setDeviceLabel,
  setScriptType,
  setAccountIndex,
  setXpubData,
  setIsFetchingXpub,
  setIsConnecting,
  setHardwareError,
  networkOwner,
  isNetworkOwnerCurrent,
}: {
  hardwareDeviceType: HardwareDeviceType;
  hardwareDeviceModel: string;
  scriptType: ScriptType;
  accountIndex: number;
  setHardwareDeviceType: (type: HardwareDeviceType) => void;
  setHardwareDeviceModel: (model: string) => void;
  setDeviceConnected: (connected: boolean) => void;
  setDeviceLabel: (label: string | null) => void;
  setScriptType: (type: ScriptType) => void;
  setAccountIndex: (index: number) => void;
  setXpubData: (data: XpubData | null) => void;
  setIsFetchingXpub: (fetching: boolean) => void;
  setIsConnecting: (connecting: boolean) => void;
  setHardwareError: (error: string | null) => void;
  networkOwner: ImportNetworkOwner;
  isNetworkOwnerCurrent: (owner: ImportNetworkOwner) => boolean;
}) {
  const ledgerSupported = isSecureContext();
  const connectionRef = useRef<{
    service: HardwareWalletService;
    lease: HardwareWalletConnectionLease;
  } | null>(null);
  const connectionGenerationRef = useRef(0);
  const fetchGenerationRef = useRef(0);

  const releaseCurrentConnection = useCallback(async (invalidate = true) => {
    if (invalidate) connectionGenerationRef.current += 1;
    const connection = connectionRef.current;
    connectionRef.current = null;
    if (!connection) return;
    try {
      await connection.service.releaseConnection(connection.lease);
    } catch (error) {
      log.warn('Failed to release hardware import session', { error });
    }
  }, []);

  useEffect(() => () => {
    void releaseCurrentConnection();
  }, [networkOwner.network, networkOwner.generation, releaseCurrentConnection]);

  const handleDeviceTypeSelect = (type: HardwareDeviceType) => {
    void releaseCurrentConnection();
    fetchGenerationRef.current += 1;
    setIsConnecting(false);
    setIsFetchingXpub(false);
    setHardwareDeviceType(type);
    setHardwareDeviceModel(getDefaultHardwareImportModel(type));
    setDeviceConnected(false);
    setXpubData(null);
  };

  const handleDeviceModelSelect = (model: string) => {
    void releaseCurrentConnection();
    fetchGenerationRef.current += 1;
    setIsConnecting(false);
    setIsFetchingXpub(false);
    setHardwareDeviceModel(model);
    setDeviceConnected(false);
    setXpubData(null);
  };

  const handleScriptTypeSelect = (type: ScriptType) => {
    fetchGenerationRef.current += 1;
    setIsFetchingXpub(false);
    setScriptType(type);
    setXpubData(null);
  };

  const handleAccountIndexChange = (value: string) => {
    fetchGenerationRef.current += 1;
    setIsFetchingXpub(false);
    setAccountIndex(Math.max(0, parseInt(value, 10) || 0));
    setXpubData(null);
  };

  const handleConnectDevice = async () => {
    const owner = networkOwner;
    if (!isNetworkOwnerCurrent(owner)) return;
    const generation = ++connectionGenerationRef.current;
    fetchGenerationRef.current += 1;
    const ownsOperation = () => (
      isNetworkOwnerCurrent(owner)
      && connectionGenerationRef.current === generation
    );
    setIsConnecting(true);
    setIsFetchingXpub(false);
    setHardwareError(null);
    setDeviceConnected(false);
    setDeviceLabel(null);
    setXpubData(null);

    try {
      await releaseCurrentConnection(false);
      if (!ownsOperation()) return;
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      if (!ownsOperation()) return;
      const connection = await hardwareWalletService.connectWithLease(hardwareDeviceType as DeviceType, {
        chainEnvironment: owner.network,
        expectedModel: hardwareDeviceModel,
      });
      if (!ownsOperation()) {
        try {
          await hardwareWalletService.releaseConnection(connection.lease);
        } catch (releaseError) {
          log.warn('Failed to release stale hardware import session', { error: releaseError });
        }
        return;
      }
      connectionRef.current = {
        service: hardwareWalletService,
        lease: connection.lease,
      };
      setDeviceConnected(true);
      setDeviceLabel(connection.device.name || hardwareDeviceModel);
    } catch (error) {
      if (ownsOperation()) {
        log.error('Failed to connect hardware device', { error });
        setHardwareError(hardwareErrorMessage(error, 'Failed to connect device'));
      }
    } finally {
      if (ownsOperation()) setIsConnecting(false);
    }
  };

  const handleFetchXpub = async () => {
    const owner = networkOwner;
    if (!isNetworkOwnerCurrent(owner)) return;
    const connectionGeneration = connectionGenerationRef.current;
    const fetchGeneration = ++fetchGenerationRef.current;
    const ownsOperation = () => (
      isNetworkOwnerCurrent(owner)
      && connectionGenerationRef.current === connectionGeneration
      && fetchGenerationRef.current === fetchGeneration
    );
    setIsFetchingXpub(true);
    setHardwareError(null);

    try {
      const connection = connectionRef.current;
      if (!connection) throw new Error('Connect a hardware device before fetching its xpub');
      const path = getDerivationPath(scriptType, accountIndex, owner.network);
      const result = await connection.service.getXpubForLease(connection.lease, path);
      if (
        !ownsOperation()
        || connectionRef.current !== connection
      ) return;

      if (result.xpub && result.fingerprint) {
        setXpubData({
          xpub: result.xpub,
          fingerprint: result.fingerprint,
          path,
        });
      } else {
        setHardwareError('Failed to retrieve xpub from device');
      }
    } catch (error) {
      if (ownsOperation()) {
        log.error('Failed to fetch xpub', { error });
        setHardwareError(hardwareErrorMessage(error, 'Failed to fetch xpub'));
      }
    } finally {
      if (ownsOperation()) setIsFetchingXpub(false);
    }
  };

  return {
    handleAccountIndexChange,
    handleConnectDevice,
    handleDeviceModelSelect,
    handleDeviceTypeSelect,
    handleFetchXpub,
    handleScriptTypeSelect,
    ledgerSupported,
  };
}

function hardwareErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
