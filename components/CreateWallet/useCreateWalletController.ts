import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as devicesApi from '../../src/api/devices';
import { Device, WalletType } from '../../types';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useCreateWallet } from '../../hooks/queries/useWallets';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import type { CreateWalletState, CreateWalletStep, Network, ScriptType } from './types';
import {
  buildCreateWalletPayload,
  canAdvanceCreateWalletStep,
  getCompatibleDevices,
  getDisplayAccount,
  getIncompatibleDevices,
  getNextCreateWalletStep,
  getNextSelectedDeviceIds,
} from './createWalletData';

const log = createLogger('CreateWallet');

export function useCreateWalletController() {
  const navigate = useNavigate();
  const { handleError } = useErrorHandler();
  const createWalletMutation = useCreateWallet();
  const [step, setStep] = useState<CreateWalletStep>(1);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [walletName, setWalletName] = useState('');
  const [scriptType, setScriptType] = useState<ScriptType>('native_segwit');
  const [network, setNetwork] = useState<Network>('mainnet');
  const [quorumM, setQuorumM] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const loadDevices = async () => {
      try {
        const apiDevices = await devicesApi.getDevices();
        if (isMounted) setAvailableDevices(apiDevices);
      } catch (error) {
        logError(log, error, 'Failed to load devices');
        if (isMounted) setAvailableDevices([]);
      }
    };

    void loadDevices();

    return () => {
      isMounted = false;
    };
  }, []);

  const createWalletState: CreateWalletState = {
    walletType,
    selectedDeviceIds,
    walletName,
    scriptType,
    network,
    quorumM,
  };

  const compatibleDevices = useMemo(
    () => getCompatibleDevices(availableDevices, walletType),
    [availableDevices, walletType]
  );
  const incompatibleDevices = useMemo(
    () => getIncompatibleDevices(availableDevices, walletType),
    [availableDevices, walletType]
  );
  const canContinue = canAdvanceCreateWalletStep(step, createWalletState);

  const toggleDevice = useCallback(
    (deviceId: string) => {
      setSelectedDeviceIds(current => getNextSelectedDeviceIds(current, walletType, deviceId));
    },
    [walletType]
  );

  const handleBack = useCallback(() => {
    if (step > 1) {
      setStep((step - 1) as CreateWalletStep);
      return;
    }

    navigate('/wallets');
  }, [navigate, step]);

  const handleNext = useCallback(() => {
    const result = getNextCreateWalletStep(step, createWalletState);

    if (result.error) {
      handleError(result.error.message, result.error.title);
      return;
    }

    if (result.nextStep) setStep(result.nextStep);
  }, [createWalletState, handleError, step]);

  const handleCreate = useCallback(async () => {
    if (!walletType) return;

    setIsSubmitting(true);

    try {
      const created = await createWalletMutation.mutateAsync(buildCreateWalletPayload(createWalletState));
      navigate(`/wallets/${created.id}`);
    } catch (error) {
      log.error('Failed to create wallet', { error });
      handleError(error, 'Failed to Create Wallet');
    } finally {
      setIsSubmitting(false);
    }
  }, [createWalletMutation, createWalletState, handleError, navigate, walletType]);

  return {
    step,
    availableDevices,
    walletType,
    setWalletType,
    selectedDeviceIds,
    walletName,
    setWalletName,
    scriptType,
    setScriptType,
    network,
    setNetwork,
    quorumM,
    setQuorumM,
    compatibleDevices,
    incompatibleDevices,
    canContinue,
    isSubmitting,
    getDisplayAccount,
    toggleDevice,
    handleBack,
    handleNext,
    handleCreate,
  };
}
