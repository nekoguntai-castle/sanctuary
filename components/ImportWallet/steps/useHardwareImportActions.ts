import type { DeviceType } from '../../../services/hardwareWallet/types';
import { isSecureContext } from '../../../services/hardwareWallet/environment';
import { loadHardwareWalletRuntime } from '../../../services/hardwareWallet/loader';
import { createLogger } from '../../../utils/logger';
import { getDerivationPath, HardwareDeviceType, ScriptType } from '../importHelpers';
import { XpubData } from '../hooks/useImportState';

const log = createLogger('ImportWallet');

export function useHardwareImportActions({
  hardwareDeviceType,
  scriptType,
  accountIndex,
  setHardwareDeviceType,
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
  scriptType: ScriptType;
  accountIndex: number;
  setHardwareDeviceType: (type: HardwareDeviceType) => void;
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
      const device = await hardwareWalletService.connect(hardwareDeviceType as DeviceType);
      setDeviceConnected(true);
      setDeviceLabel(device.name || fallbackDeviceLabel(hardwareDeviceType));
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
      const path = getDerivationPath(scriptType, accountIndex);
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
    handleDeviceTypeSelect,
    handleFetchXpub,
    handleScriptTypeSelect,
    ledgerSupported,
  };
}

function fallbackDeviceLabel(hardwareDeviceType: HardwareDeviceType): string {
  return hardwareDeviceType === 'trezor' ? 'Trezor Device' : 'Ledger Device';
}

function hardwareErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}
