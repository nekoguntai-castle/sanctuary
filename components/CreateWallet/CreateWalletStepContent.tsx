import React from 'react';
import { WalletType, type Device, type DeviceAccount } from '../../types';
import type { CreateWalletStep, Network, ScriptType } from './types';
import { WalletTypeStep } from './WalletTypeStep';
import { SignerSelectionStep } from './SignerSelectionStep';
import { ConfigurationStep } from './ConfigurationStep';
import { ReviewStep } from './ReviewStep';

interface CreateWalletStepContentProps {
  step: CreateWalletStep;
  walletType: WalletType | null;
  setWalletType: (walletType: WalletType) => void;
  compatibleDevices: Device[];
  incompatibleDevices: Device[];
  selectedDeviceIds: Set<string>;
  toggleDevice: (id: string) => void;
  getDisplayAccount: (device: Device, walletType: WalletType) => DeviceAccount | null;
  walletName: string;
  setWalletName: (walletName: string) => void;
  network: Network;
  setNetwork: (network: Network) => void;
  scriptType: ScriptType;
  setScriptType: (scriptType: ScriptType) => void;
  quorumM: number;
  setQuorumM: (quorumM: number) => void;
  availableDevices: Device[];
}

export const CreateWalletStepContent: React.FC<CreateWalletStepContentProps> = ({
  step,
  walletType,
  setWalletType,
  compatibleDevices,
  incompatibleDevices,
  selectedDeviceIds,
  toggleDevice,
  getDisplayAccount,
  walletName,
  setWalletName,
  network,
  setNetwork,
  scriptType,
  setScriptType,
  quorumM,
  setQuorumM,
  availableDevices,
}) => {
  if (step === 1) return <WalletTypeStep walletType={walletType} setWalletType={setWalletType} />;

  if (step === 2 && walletType) {
    return (
      <SignerSelectionStep
        walletType={walletType}
        compatibleDevices={compatibleDevices}
        incompatibleDevices={incompatibleDevices}
        selectedDeviceIds={selectedDeviceIds}
        toggleDevice={toggleDevice}
        getDisplayAccount={getDisplayAccount}
      />
    );
  }

  if (step === 3 && walletType) {
    return (
      <ConfigurationStep
        walletType={walletType}
        walletName={walletName}
        setWalletName={setWalletName}
        network={network}
        setNetwork={setNetwork}
        scriptType={scriptType}
        setScriptType={setScriptType}
        quorumM={quorumM}
        setQuorumM={setQuorumM}
        selectedDeviceCount={selectedDeviceIds.size}
      />
    );
  }

  if (step === 4 && walletType) {
    return (
      <ReviewStep
        walletName={walletName}
        walletType={walletType}
        network={network}
        scriptType={scriptType}
        quorumM={quorumM}
        selectedDeviceIds={selectedDeviceIds}
        availableDevices={availableDevices}
      />
    );
  }

  return null;
};
