import type { DeviceType } from '../../../services/hardwareWallet/types';
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
    const owner = networkOwner;
    if (!isNetworkOwnerCurrent(owner)) return;
    setIsConnecting(true);
    setHardwareError(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      if (!isNetworkOwnerCurrent(owner)) return;
      const device = await hardwareWalletService.connect(hardwareDeviceType as DeviceType, {
        chainEnvironment: owner.network,
        expectedModel: hardwareDeviceModel,
      });
      if (!isNetworkOwnerCurrent(owner)) return;
      setDeviceConnected(true);
      setDeviceLabel(device.name || hardwareDeviceModel);
    } catch (error) {
      if (isNetworkOwnerCurrent(owner)) {
        log.error('Failed to connect hardware device', { error });
        setHardwareError(hardwareErrorMessage(error, 'Failed to connect device'));
      }
    } finally {
      if (isNetworkOwnerCurrent(owner)) setIsConnecting(false);
    }
  };

  const handleFetchXpub = async () => {
    const owner = networkOwner;
    if (!isNetworkOwnerCurrent(owner)) return;
    setIsFetchingXpub(true);
    setHardwareError(null);

    try {
      const { hardwareWalletService } = await loadHardwareWalletRuntime();
      if (!isNetworkOwnerCurrent(owner)) return;
      const path = getDerivationPath(scriptType, accountIndex, owner.network);
      const result = await hardwareWalletService.getXpub(path);
      if (!isNetworkOwnerCurrent(owner)) return;

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
      if (isNetworkOwnerCurrent(owner)) {
        log.error('Failed to fetch xpub', { error });
        setHardwareError(hardwareErrorMessage(error, 'Failed to fetch xpub'));
      }
    } finally {
      if (isNetworkOwnerCurrent(owner)) setIsFetchingXpub(false);
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
