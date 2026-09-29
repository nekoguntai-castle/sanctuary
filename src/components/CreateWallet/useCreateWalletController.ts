import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as devicesApi from '../../api/devices';
import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';
import { Device, WalletType } from '../../types';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import { useLatestRequest } from '../../hooks/useLatestRequest';
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
  reconcileSelectedSigners,
} from './createWalletData';

const log = createLogger('CreateWallet');

export function useCreateWalletController() {
  const navigate = useNavigate();
  const { selectedNetwork } = useActiveNetwork();
  const { handleError } = useErrorHandler();
  const createWalletMutation = useCreateWallet();
  const [step, setStep] = useState<CreateWalletStep>(1);
  const [availableDevices, setAvailableDevices] = useState<Device[]>([]);
  const [refreshStatus, setRefreshStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [connectingDevice, setConnectingDevice] = useState(false);
  const returnFocus = useRef(false);
  const [walletType, setWalletType] = useState<WalletType | null>(null);
  const [selectedSigners, setSelectedSigners] = useState<CreateWalletState['selectedSigners']>([]);
  const [walletName, setWalletName] = useState('');
  const [scriptType, setScriptType] = useState<ScriptType>(WalletScriptType.NATIVE_SEGWIT);
  const selectionPolicy = useRef({ walletType, scriptType, selectedNetwork });
  selectionPolicy.current = { walletType, scriptType, selectedNetwork };
  const [desiredQuorumM, setDesiredQuorumM] = useState(2);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const previousNetwork = useRef(selectedNetwork);
  const creation = useLatestRequest();
  const deviceRefresh = useLatestRequest();
  const scopeRef = useRef({ network: selectedNetwork });
  if (scopeRef.current.network !== selectedNetwork) {
    // Retire synchronously, including network A -> B -> A transitions.
    scopeRef.current = { network: selectedNetwork };
    creation.invalidate();
    setIsSubmitting(false);
  }
  const renderScope = scopeRef.current;

  const refreshDevices = useCallback(async () => {
    const token = deviceRefresh.begin();
    setRefreshStatus('loading');
    try {
      const devices = await devicesApi.getDevices();
      if (!deviceRefresh.isCurrent(token)) return;
      setAvailableDevices(devices);
      setSelectedSigners(current => {
        const policy = selectionPolicy.current;
        return reconcileSelectedSigners(current, devices, policy.walletType, policy.scriptType, policy.selectedNetwork);
      });
      setRefreshStatus('ready');
    } catch (error) {
      if (!deviceRefresh.isCurrent(token)) return;
      logError(log, error, 'Failed to load devices');
      setRefreshStatus('error');
    }
  }, [deviceRefresh]);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);

  useEffect(() => {
    if (connectingDevice || !returnFocus.current) return;
    returnFocus.current = false;
    document.getElementById('create-wallet-connect-device')?.focus();
  }, [connectingDevice]);

  useEffect(() => {
    if (previousNetwork.current === selectedNetwork) return;
    previousNetwork.current = selectedNetwork;
    setSelectedSigners([]);
    setStep(current => current === 1 ? current : 2);
  }, [selectedNetwork]);

  // Effective quorum: re-clamped to the selected signer count on every
  // render so the review step can never show M > N and the step gate stays
  // defensive-only. Derived (not mutated in place) so a transient dip in
  // selection count doesn't permanently destroy the user's chosen quorum --
  // it's recovered once the signer count rises back to or above it.
  // Kept at the desired value while nothing is selected yet.
  const quorumM = useMemo(
    () => (selectedSigners.length === 0
      ? desiredQuorumM
      : Math.min(desiredQuorumM, selectedSigners.length)),
    [desiredQuorumM, selectedSigners]
  );

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
  const canContinue = (step === 1 || refreshStatus === 'ready') && canAdvanceCreateWalletStep(step, createWalletState);

  const beginDeviceConnection = useCallback(() => {
    deviceRefresh.invalidate();
    setConnectingDevice(true);
  }, [deviceRefresh]);
  const returnToSigners = useCallback(() => {
    returnFocus.current = true;
    setConnectingDevice(false);
    void refreshDevices();
  }, [refreshDevices]);

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
      if (!walletType || refreshStatus !== 'ready') return;
      const device = availableDevices.find(candidate => candidate.id === deviceId);
      if (!device) return;
      const account = getExactAccount(device, walletType, scriptType, selectedNetwork);
      if (!account) return;
      setSelectedSigners(current => getNextSelectedSigners(current, walletType, {
        deviceId,
        deviceAccountId: account.id,
      }));
    },
    [availableDevices, refreshStatus, scriptType, selectedNetwork, walletType]
  );
  const getDisplayAccountForNetwork = useCallback(
    (device: Device, type: WalletType) => getExactAccount(device, type, scriptType, selectedNetwork),
    [scriptType, selectedNetwork]
  );

  const handleBack = useCallback(() => {
    // Back abandons this review; accepted creation still updates the query cache.
    scopeRef.current = { network: selectedNetwork };
    creation.invalidate();
    setIsSubmitting(false);
    if (step > 1) {
      setStep((step - 1) as CreateWalletStep);
      return;
    }

    navigate('/wallets');
  }, [creation, navigate, selectedNetwork, step]);

  const handleNext = useCallback(() => {
    if (step > 1 && refreshStatus !== 'ready') return;
    const result = getNextCreateWalletStep(step, createWalletState);

    if (result.error) {
      handleError(result.error.message, result.error.title);
      return;
    }

    if (result.nextStep) setStep(result.nextStep);
  }, [createWalletState, handleError, refreshStatus, step]);

  const handleCreate = useCallback(async () => {
    if (!walletType || refreshStatus !== 'ready') return;

    if (scopeRef.current !== renderScope) return;
    const token = creation.begin();
    if (!creation.isCurrent(token)) return;
    setIsSubmitting(true);

    try {
      const created = await createWalletMutation.mutateAsync(buildCreateWalletPayload(createWalletState));
      if (creation.isCurrent(token)) navigate(`/wallets/${created.id}`);
    } catch (error) {
      if (!creation.isCurrent(token)) return;
      log.error('Failed to create wallet', { error });
      handleError(error, 'Failed to Create Wallet');
    } finally {
      if (creation.isCurrent(token)) setIsSubmitting(false);
    }
  }, [creation, createWalletMutation, createWalletState, handleError, navigate, refreshStatus, renderScope, walletType]);

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
    setQuorumM: setDesiredQuorumM,
    compatibleDevices,
    incompatibleDevices,
    canContinue,
    isSubmitting,
    getDisplayAccount: getDisplayAccountForNetwork,
    toggleDevice,
    handleBack,
    handleNext,
    handleCreate,
    connectingDevice,
    beginDeviceConnection,
    returnToSigners,
    refreshingDevices: refreshStatus === 'loading',
    refreshError: refreshStatus === 'error' ? 'Could not refresh available signers. Retry before continuing.' : null,
    refreshDevices,
  };
}
