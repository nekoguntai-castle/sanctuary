import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as devicesApi from '../../api/devices';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { Device, WalletType } from '../../types';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import { useErrorHandler } from '../../hooks/useErrorHandler';
import { useCreateWallet } from '../../hooks/queries/useWallets';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import type { CreateWalletState, CreateWalletStep, ScriptType } from './types';
import {
  buildCreateWalletPayload,
  canAdvanceCreateWalletStep,
  getExactAccount,
  getCompatibleDevices,
  getIncompatibleDevices,
  getNextCreateWalletStep,
  getNextSelectedSigners,
} from './createWalletData';

const log = createLogger('CreateWallet');

export function useCreateWalletController() {
  const navigate = useNavigate();
  const { selectedNetwork } = useActiveNetwork();
  const { handleError } = useErrorHandler();
  const createWalletMutation = useCreateWallet();
  const [step, setStep] = useState<CreateWalletStep>(1);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [selectedSigners, setSelectedSigners] = useState<CreateWalletState['selectedSigners']>([]);
  const [walletName, setWalletName] = useState('');
  const [scriptType, setScriptType] = useState<ScriptType>(WalletScriptType.NATIVE_SEGWIT);
  const [quorumM, setQuorumM] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previousNetwork = useRef(selectedNetwork);

  useEffect(() => {
    let isMounted = true;

    const loadDevices = async () => {
      try {
        const apiDevices = await devicesApi.getDevices();
        /* v8 ignore next -- unmount guard for an async load race */
        if (isMounted) setAvailableDevices(apiDevices);
      } catch (error) {
        logError(log, error, 'Failed to load devices');
        /* v8 ignore next -- unmount guard for an async load race */
        if (isMounted) setAvailableDevices([]);
      }
    };

    void loadDevices();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (previousNetwork.current === selectedNetwork) return;
    previousNetwork.current = selectedNetwork;
    setSelectedSigners([]);
    setStep(current => current === 1 ? current : 2);
  }, [selectedNetwork]);

  const createWalletState: CreateWalletState = {
    walletType,
    selectedSigners,
    walletName,
    scriptType,
    network: selectedNetwork,
    quorumM,
  };

  const compatibleDevices = useMemo(
    () => getCompatibleDevices(availableDevices, walletType, scriptType, selectedNetwork),
    [availableDevices, scriptType, selectedNetwork, walletType]
  );
  const incompatibleDevices = useMemo(
    () => getIncompatibleDevices(availableDevices, walletType, scriptType, selectedNetwork),
    [availableDevices, scriptType, selectedNetwork, walletType]
  );
  const selectedDeviceIds = useMemo(
    () => new Set(selectedSigners.map(signer => signer.deviceId)),
    [selectedSigners]
  );
  const canContinue = canAdvanceCreateWalletStep(step, createWalletState);

  const selectWalletType = useCallback((nextWalletType: WalletType) => {
    if (walletType !== nextWalletType) {
      setSelectedSigners([]);
      setScriptType(WalletScriptType.NATIVE_SEGWIT);
    }
    setWalletType(nextWalletType);
  }, [walletType]);
  const selectScriptType = useCallback((nextScriptType: ScriptType) => {
    if (scriptType !== nextScriptType) {
      setSelectedSigners([]);
      setStep(currentStep => currentStep === 1 ? currentStep : 2);
    }
    setScriptType(nextScriptType);
  }, [scriptType]);
  const toggleDevice = useCallback(
    (deviceId: string) => {
      if (!walletType) return;
      const device = availableDevices.find(candidate => candidate.id === deviceId);
      if (!device) return;
      const account = getExactAccount(device, walletType, scriptType, selectedNetwork);
      if (!account) return;
      setSelectedSigners(current => getNextSelectedSigners(current, walletType, {
        deviceId,
        deviceAccountId: account.id,
      }));
    },
    [availableDevices, scriptType, selectedNetwork, walletType]
  );
  const getDisplayAccountForNetwork = useCallback(
    (device: Device, type: WalletType) => getExactAccount(device, type, scriptType, selectedNetwork),
    [scriptType, selectedNetwork]
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
    /* v8 ignore next -- UI navigation cannot reach create without a selected wallet type */
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
    setWalletType: selectWalletType,
    selectedSigners,
    selectedDeviceIds,
    walletName,
    setWalletName,
    scriptType,
    setScriptType: selectScriptType,
    network: selectedNetwork,
    quorumM,
    setQuorumM,
    compatibleDevices,
    incompatibleDevices,
    canContinue,
    isSubmitting,
    getDisplayAccount: getDisplayAccountForNetwork,
    toggleDevice,
    handleBack,
    handleNext,
    handleCreate,
  };
}
