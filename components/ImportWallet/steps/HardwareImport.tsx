import React from 'react';
import { ScriptType, HardwareDeviceType } from '../importHelpers';
import { XpubData } from '../hooks/useImportState';
import {
  ConnectedHardwareOptions,
  DeviceConnectionPanel,
  DeviceTypeSelection,
  HardwareErrorMessage,
  HardwareImportHeader,
  TrezorWorkflowNotice,
} from './HardwareImportSections';
import { useHardwareImportActions } from './useHardwareImportActions';

interface HardwareImportProps {
  hardwareDeviceType: HardwareDeviceType;
  setHardwareDeviceType: (type: HardwareDeviceType) => void;
  deviceConnected: boolean;
  setDeviceConnected: (connected: boolean) => void;
  deviceLabel: string | null;
  setDeviceLabel: (label: string | null) => void;
  scriptType: ScriptType;
  setScriptType: (type: ScriptType) => void;
  accountIndex: number;
  setAccountIndex: (index: number) => void;
  xpubData: XpubData | null;
  setXpubData: (data: XpubData | null) => void;
  isFetchingXpub: boolean;
  setIsFetchingXpub: (fetching: boolean) => void;
  isConnecting: boolean;
  setIsConnecting: (connecting: boolean) => void;
  hardwareError: string | null;
  setHardwareError: (error: string | null) => void;
}

export const HardwareImport: React.FC<HardwareImportProps> = ({
  hardwareDeviceType,
  setHardwareDeviceType,
  deviceConnected,
  setDeviceConnected,
  deviceLabel,
  setDeviceLabel,
  scriptType,
  setScriptType,
  accountIndex,
  setAccountIndex,
  xpubData,
  setXpubData,
  isFetchingXpub,
  setIsFetchingXpub,
  isConnecting,
  setIsConnecting,
  hardwareError,
  setHardwareError,
}) => {
  const {
    handleAccountIndexChange,
    handleConnectDevice,
    handleDeviceTypeSelect,
    handleFetchXpub,
    handleScriptTypeSelect,
    ledgerSupported,
  } = useHardwareImportActions({
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
  });

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      <HardwareImportHeader />

      <div className="space-y-6">
        <DeviceTypeSelection
          hardwareDeviceType={hardwareDeviceType}
          ledgerSupported={ledgerSupported}
          onDeviceTypeSelect={handleDeviceTypeSelect}
        />
        <TrezorWorkflowNotice hardwareDeviceType={hardwareDeviceType} />
        <DeviceConnectionPanel
          deviceConnected={deviceConnected}
          deviceLabel={deviceLabel}
          hardwareDeviceType={hardwareDeviceType}
          isConnecting={isConnecting}
          ledgerSupported={ledgerSupported}
          onConnectDevice={handleConnectDevice}
        />

        {deviceConnected && (
          <ConnectedHardwareOptions
            accountIndex={accountIndex}
            isFetchingXpub={isFetchingXpub}
            scriptType={scriptType}
            xpubData={xpubData}
            onAccountIndexChange={handleAccountIndexChange}
            onFetchXpub={handleFetchXpub}
            onScriptTypeSelect={handleScriptTypeSelect}
          />
        )}

        <HardwareErrorMessage hardwareError={hardwareError} />
      </div>
    </div>
  );
};
