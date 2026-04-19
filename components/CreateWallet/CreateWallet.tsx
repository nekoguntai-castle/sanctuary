import React from 'react';
import { useCreateWalletController } from './useCreateWalletController';
import { CreateWalletProgress } from './CreateWalletProgress';
import { CreateWalletStepContent } from './CreateWalletStepContent';
import { CreateWalletFooter } from './CreateWalletFooter';

export const CreateWallet: React.FC = () => {
  const wallet = useCreateWalletController();

  return (
    <div className="max-w-4xl mx-auto pb-12">
        <CreateWalletProgress step={wallet.step} onBack={wallet.handleBack} />

        <div className="min-h-[400px] flex flex-col justify-between">
            <div className="flex-1">
                <CreateWalletStepContent
                  step={wallet.step}
                  walletType={wallet.walletType}
                  setWalletType={wallet.setWalletType}
                  compatibleDevices={wallet.compatibleDevices}
                  incompatibleDevices={wallet.incompatibleDevices}
                  selectedDeviceIds={wallet.selectedDeviceIds}
                  toggleDevice={wallet.toggleDevice}
                  getDisplayAccount={wallet.getDisplayAccount}
                  walletName={wallet.walletName}
                  setWalletName={wallet.setWalletName}
                  network={wallet.network}
                  setNetwork={wallet.setNetwork}
                  scriptType={wallet.scriptType}
                  setScriptType={wallet.setScriptType}
                  quorumM={wallet.quorumM}
                  setQuorumM={wallet.setQuorumM}
                  availableDevices={wallet.availableDevices}
                />
            </div>

            <CreateWalletFooter
              step={wallet.step}
              canContinue={wallet.canContinue}
              isSubmitting={wallet.isSubmitting}
              onNext={wallet.handleNext}
              onCreate={wallet.handleCreate}
            />
        </div>
    </div>
  );
};
