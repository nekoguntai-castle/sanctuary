import type { DeviceType } from '../../../services/hardwareWallet/types';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import { loadHardwareWalletRuntime } from '../../../services/hardwareWallet/loader';
import { createLogger } from '../../../utils/logger';
import type { TabNetwork } from '../../../app/networks';
import {
  getDefaultHardwareImportModel,
  getDerivationPath,
  HardwareDeviceType,
  ScriptType,
} from '../importHelpers';
import { XpubData } from '../hooks/useImportState';

const log = createLogger('ImportWallet');

export function useHardwareImportActions({
  hardwareDeviceType,
  hardwareDeviceModel,
  scriptType,
  accountIndex,
  network,
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
}: {
  hardwareDeviceType: HardwareDeviceType;
  hardwareDeviceModel: string;
  scriptType: ScriptType;
  accountIndex: number;
  network: TabNetwork;
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
}) {
  const ledgerSupported = isSecureContext();

  const handleDeviceTypeSelect = (type: HardwareDeviceType) => {
    setHardwareDeviceType(type);
    setHardwareDeviceModel(getDefaultHardwareImportModel(type));
    setDeviceConnected(false);
    setXpubData(null);
  };

  const handleDeviceModelSelect = (model: string) => {
    setHardwareDeviceModel(model);
    setDeviceConnected(false);
    setXpubData(null);
  };

  const handleScriptTypeSelect = (type: ScriptType) => {
    setScriptType(type);
    setXpubData(null);
  };

  const handleAccountIndexChange = (value: string) => {
    setAccountIndex(Math.max(0, parseInt(value, 10) || 0));
    setXpubData(null);
  };

  const handleConnectDevice = async () => {
    setIsConnecting(true);
    setHardwareError(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      const device = await hardwareWalletService.connect(hardwareDeviceType as DeviceType, {
        chainEnvironment: network,
        expectedModel: hardwareDeviceModel,
      });
      setDeviceConnected(true);
      setDeviceLabel(device.name || hardwareDeviceModel);
    } catch (error) {
      log.error('Failed to connect hardware device', { error });
      setHardwareError(hardwareErrorMessage(error, 'Failed to connect device'));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleFetchXpub = async () => {
    setIsFetchingXpub(true);
    setHardwareError(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      const path = getDerivationPath(scriptType, accountIndex, network);
      const result = await hardwareWalletService.getXpub(path);

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
      log.error('Failed to fetch xpub', { error });
      setHardwareError(hardwareErrorMessage(error, 'Failed to fetch xpub'));
    } finally {
      setIsFetchingXpub(false);
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
