/**
 * CreateWallet Component
 *
 * Main orchestrator for the wallet creation wizard.
 * Manages state, step navigation, device compatibility, and wallet creation.
 * Delegates step rendering to focused subcomponents.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import * as devicesApi from '../../src/api/devices';
import { Device, WalletType, DeviceAccount } from '../../types';
import { Button } from '../ui/Button';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import { useCreateWallet } from '../../hooks/queries/useWallets';
import type { ScriptType, Network } from './types';
import { WalletTypeStep } from './WalletTypeStep';
import { SignerSelectionStep } from './SignerSelectionStep';
import { ConfigurationStep } from './ConfigurationStep';
import { ReviewStep } from './ReviewStep';

const log = createLogger('CreateWallet');

export const CreateWallet: React.FC = () => {
  const navigate = useNavigate();
  const { handleError } = useErrorHandler();
  const createWalletMutation = useCreateWallet();
  const [step, setStep] = useState(1);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);

  // Form State
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [walletName, setWalletName] = useState('');
  const [scriptType, setScriptType] = useState<ScriptType>('native_segwit');
  const [network, setNetwork] = useState<Network>('mainnet');
  const [quorumM, setQuorumM] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const loadDevices = async () => {
      try {
        const apiDevices = await devicesApi.getDevices();
        // Use API devices directly - they include accounts array
        setAvailableDevices(apiDevices);
      } catch (error) {
        logError(log, error, 'Failed to load devices');
        setAvailableDevices([]);
        // Non-critical - user can still create wallet without devices shown
      }
    };

    loadDevices();
  }, []);

  /**
   * Check if a device has an account compatible with the wallet type
   */
  const hasCompatibleAccount = (device: Device, type: WalletType): boolean => {
    if (!device.accounts || device.accounts.length === 0) {
      // Legacy devices without accounts array - check derivationPath
      // m/48' paths are multisig, m/44'/49'/84'/86' are single-sig
      const path = device.derivationPath || '';
      const isMultisigPath = path.includes("48'");
      return type === WalletType.MULTI_SIG ? isMultisigPath : !isMultisigPath;
    }

    const requiredPurpose = type === WalletType.MULTI_SIG ? 'multisig' : 'single_sig';
    return device.accounts.some(a => a.purpose === requiredPurpose);
  };

  /**
   * Get the appropriate account for display based on wallet type
   */
  const getDisplayAccount = (device: Device, type: WalletType): DeviceAccount | null => {
    if (!device.accounts || device.accounts.length === 0) return null;
    const requiredPurpose = type === WalletType.MULTI_SIG ? 'multisig' : 'single_sig';
    return device.accounts.find(a => a.purpose === requiredPurpose) || null;
  };

  /**
   * Filter devices based on wallet type - only show compatible devices
   */
  const compatibleDevices = useMemo(() => {
    if (!walletType) return availableDevices;
    return availableDevices.filter(d => hasCompatibleAccount(d, walletType));
  }, [availableDevices, walletType]);

  /**
   * Devices that are NOT compatible (for showing warning)
   */
  const incompatibleDevices = useMemo(() => {
    if (!walletType) return [];
    return availableDevices.filter(d => !hasCompatibleAccount(d, walletType));
  }, [availableDevices, walletType]);

  const toggleDevice = (id: string) => {
    const next = new Set(selectedDeviceIds);
    if (walletType === WalletType.SINGLE_SIG) {
        // For single sig, behave like radio button
        next.clear();
        next.add(id);
    } else {
        // For multi sig, behave like checkbox
        if (next.has(id)) next.delete(id);
        else next.add(id);
    }
    setSelectedDeviceIds(next);
  };

  const handleNext = () => {
    if (step === 1 && walletType) setStep(2);
    else if (step === 2 && selectedDeviceIds.size > 0) {
        // Validate M-of-N on transition
        if (walletType === WalletType.MULTI_SIG && selectedDeviceIds.size < 2) {
            handleError('Multisig requires at least 2 devices.', 'Validation Error');
            return;
        }
        setStep(3);
    }
    else if (step === 3 && walletName) setStep(4);
  };

  const handleCreate = async () => {
    setIsSubmitting(true);

    try {
      // Create wallet via API with device IDs
      // The backend will automatically generate descriptors from device xpubs
      const created = await createWalletMutation.mutateAsync({
        name: walletName,
        type: walletType === WalletType.SINGLE_SIG ? 'single_sig' : 'multi_sig',
        scriptType: scriptType,
        network: network,
        quorum: walletType === WalletType.MULTI_SIG ? quorumM : undefined,
        totalSigners: walletType === WalletType.MULTI_SIG ? selectedDeviceIds.size : undefined,
        deviceIds: Array.from(selectedDeviceIds),
      });

      // Navigate to wallet detail page (React Query automatically invalidates wallet list)
      navigate(`/wallets/${created.id}`);
    } catch (error) {
      log.error('Failed to create wallet', { error });
      handleError(error, 'Failed to Create Wallet');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12">
        {/* Header Navigation */}
        <div className="flex items-center justify-between mb-8">
            <button
                onClick={() => { if(step > 1) setStep(step-1); else navigate('/wallets'); }}
                className="flex items-center text-sanctuary-500 hover:text-sanctuary-900 dark:hover:text-sanctuary-100 transition-colors"
            >
                <ArrowLeft className="w-4 h-4 mr-1" /> {step === 1 ? 'Cancel' : 'Back'}
            </button>
            <div className="flex space-x-2">
                {[1, 2, 3, 4].map(s => (
                    <div
                        key={s}
                        className={`h-2 rounded-full transition-all duration-300 ${s === step ? 'w-8 bg-sanctuary-800 dark:bg-sanctuary-200' : s < step ? 'w-2 bg-success-500' : 'w-2 bg-sanctuary-200 dark:bg-sanctuary-800'}`}
                    />
                ))}
            </div>
        </div>

        <div className="min-h-[400px] flex flex-col justify-between">
            {/* Step Content */}
            <div className="flex-1">
                {step === 1 && (
                  <WalletTypeStep walletType={walletType} setWalletType={setWalletType} />
                )}
                {step === 2 && walletType && (
                  <SignerSelectionStep
                    walletType={walletType}
                    compatibleDevices={compatibleDevices}
                    incompatibleDevices={incompatibleDevices}
                    selectedDeviceIds={selectedDeviceIds}
                    toggleDevice={toggleDevice}
                    getDisplayAccount={getDisplayAccount}
                  />
                )}
                {step === 3 && walletType && (
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
                )}
                {step === 4 && walletType && (
                  <ReviewStep
                    walletName={walletName}
                    walletType={walletType}
                    network={network}
                    scriptType={scriptType}
                    quorumM={quorumM}
                    selectedDeviceIds={selectedDeviceIds}
                    availableDevices={availableDevices}
                  />
                )}
            </div>

            {/* Footer Actions */}
            <div className="mt-8 pt-8 border-t border-sanctuary-200 dark:border-sanctuary-800 flex justify-end">
                {step < 4 ? (
                    <Button
                        size="lg"
                        onClick={handleNext}
                        disabled={
                            (step === 1 && !walletType) ||
                            (step === 2 && selectedDeviceIds.size === 0) ||
                            (step === 3 && !walletName)
                        }
                    >
                        Next Step <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                ) : (
                    <Button
                        size="lg"
                        onClick={handleCreate}
                        isLoading={isSubmitting}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white dark:bg-emerald-600 dark:hover:bg-emerald-700"
                    >
                        <Check className="w-4 h-4 mr-2" /> Construct Wallet
                    </Button>
                )}
            </div>
        </div>
    </div>
  );
};
