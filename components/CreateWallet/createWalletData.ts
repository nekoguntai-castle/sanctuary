import { WalletType, type Device, type DeviceAccount } from '../../types';
import type {
  CreateWalletPayload,
  CreateWalletState,
  CreateWalletStep,
} from './types';

const SINGLE_SIG_PURPOSE = 'single_sig';
const MULTISIG_PURPOSE = 'multisig';

export interface NextStepResult {
  nextStep?: CreateWalletStep;
  error?: {
    message: string;
    title: string;
  };
}

export function getRequiredAccountPurpose(walletType: WalletType): 'single_sig' | 'multisig' {
  return walletType === WalletType.MULTI_SIG ? MULTISIG_PURPOSE : SINGLE_SIG_PURPOSE;
}

export function hasCompatibleAccount(device: Device, walletType: WalletType): boolean {
  const accounts = device.accounts ?? [];

  if (accounts.length === 0) {
    const path = device.derivationPath || '';
    const isMultisigPath = path.includes("48'");
    return walletType === WalletType.MULTI_SIG ? isMultisigPath : !isMultisigPath;
  }

  const requiredPurpose = getRequiredAccountPurpose(walletType);
  return accounts.some(account => account.purpose === requiredPurpose);
}

export function getDisplayAccount(device: Device, walletType: WalletType): DeviceAccount | null {
  const accounts = device.accounts ?? [];
  if (accounts.length === 0) return null;

  const requiredPurpose = getRequiredAccountPurpose(walletType);
  return accounts.find(account => account.purpose === requiredPurpose) ?? null;
}

export function getCompatibleDevices(devices: Device[], walletType: WalletType | null): Device[] {
  if (!walletType) return devices;
  return devices.filter(device => hasCompatibleAccount(device, walletType));
}

export function getIncompatibleDevices(devices: Device[], walletType: WalletType | null): Device[] {
  if (!walletType) return [];
  return devices.filter(device => !hasCompatibleAccount(device, walletType));
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
  const isMultisig = state.walletType === WalletType.MULTI_SIG;

  return {
    name: state.walletName,
    type: state.walletType === WalletType.SINGLE_SIG ? 'single_sig' : 'multi_sig',
    scriptType: state.scriptType,
    network: state.network,
    quorum: isMultisig ? state.quorumM : undefined,
    totalSigners: isMultisig ? state.selectedDeviceIds.size : undefined,
    deviceIds: Array.from(state.selectedDeviceIds),
  };
}
