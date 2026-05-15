import { WalletType, type Device, type DeviceAccount } from '../../types';
import {
  accountPurposeForWalletType,
  type DeviceAccountPurpose,
} from '@sanctuary/shared/constants/walletIdentity';
import { derivationPathMatchesNetwork } from '../../utils/derivationPathGroups';
import type { TabNetwork } from '../../src/app/networks';
import type {
  CreateWalletPayload,
  CreateWalletState,
  CreateWalletStep,
} from './types';

export interface NextStepResult {
  nextStep?: CreateWalletStep;
  error?: {
    message: string;
    title: string;
  };
}

export function getRequiredAccountPurpose(walletType: WalletType): DeviceAccountPurpose {
  return accountPurposeForWalletType(walletType);
}

export function hasCompatibleAccount(device: Device, walletType: WalletType): boolean {
  return hasCompatibleNetworkAccount(device, walletType, 'mainnet');
}

function scopeAccountsByNetwork(accounts: DeviceAccount[], network: TabNetwork): DeviceAccount[] {
  return accounts.filter(account => (
    derivationPathMatchesNetwork(account.derivationPath, network)
  ));
}

export function hasCompatibleNetworkAccount(
  device: Device,
  walletType: WalletType,
  network: TabNetwork
): boolean {
  const accounts = device.accounts ?? [];

  if (accounts.length === 0) {
    const path = device.derivationPath || '';
    const isMultisigPath = path.includes("48'");
    const networkMatches = !path || derivationPathMatchesNetwork(path, network);
    return networkMatches && (walletType === WalletType.MULTI_SIG ? isMultisigPath : !isMultisigPath);
  }

  const requiredPurpose = getRequiredAccountPurpose(walletType);
  return scopeAccountsByNetwork(accounts, network).some(account => account.purpose === requiredPurpose);
}

export function getDisplayAccount(device: Device, walletType: WalletType, network: TabNetwork): DeviceAccount | null {
  const accounts = device.accounts ?? [];
  if (accounts.length === 0) return null;

  const requiredPurpose = getRequiredAccountPurpose(walletType);
  return scopeAccountsByNetwork(accounts, network).find(account => account.purpose === requiredPurpose) ?? null;
}

export function getCompatibleDevices(devices: Device[], walletType: WalletType | null, network: TabNetwork): Device[] {
  if (!walletType) return devices;
  return devices.filter(device => hasCompatibleNetworkAccount(device, walletType, network));
}

export function getIncompatibleDevices(devices: Device[], walletType: WalletType | null, network: TabNetwork): Device[] {
  if (!walletType) return [];
  return devices.filter(device => !hasCompatibleNetworkAccount(device, walletType, network));
}

export function getNextSelectedDeviceIds(
  selectedDeviceIds: Set<string>,
  walletType: WalletType | null,
  deviceId: string
): Set<string> {
  const next = new Set(selectedDeviceIds);

  if (walletType === WalletType.SINGLE_SIG) {
    next.clear();
    next.add(deviceId);
    return next;
  }

  if (next.has(deviceId)) {
    next.delete(deviceId);
    return next;
  }

  next.add(deviceId);
  return next;
}

export function canAdvanceCreateWalletStep(
  step: CreateWalletStep,
  state: Pick<CreateWalletState, 'walletType' | 'selectedDeviceIds' | 'walletName'>
): boolean {
  if (step === 1) return Boolean(state.walletType);
  if (step === 2) return state.selectedDeviceIds.size > 0;
  if (step === 3) return Boolean(state.walletName);
  return true;
}

export function getNextCreateWalletStep(
  step: CreateWalletStep,
  state: Pick<CreateWalletState, 'walletType' | 'selectedDeviceIds' | 'walletName'>
): NextStepResult {
  if (step === 1 && state.walletType) return { nextStep: 2 };

  if (step === 2 && state.selectedDeviceIds.size > 0) {
    if (state.walletType === WalletType.MULTI_SIG && state.selectedDeviceIds.size < 2) {
      return {
        error: {
          message: 'Multisig requires at least 2 devices.',
          title: 'Validation Error',
        },
      };
    }

    return { nextStep: 3 };
  }

  if (step === 3 && state.walletName) return { nextStep: 4 };

  return {};
}

export function buildCreateWalletPayload(state: CreateWalletState): CreateWalletPayload {
  const walletType = state.walletType;
  if (!walletType) {
    throw new Error('Wallet type is required');
  }

  const isMultisig = walletType === WalletType.MULTI_SIG;

  return {
    name: state.walletName,
    type: walletType,
    scriptType: state.scriptType,
    network: state.network,
    quorum: isMultisig ? state.quorumM : undefined,
    totalSigners: isMultisig ? state.selectedDeviceIds.size : undefined,
    deviceIds: Array.from(state.selectedDeviceIds),
  };
}
