import { WalletType, type Device, type DeviceAccount } from '../../types';
import {
  accountPurposeForWalletType,
  type DeviceAccountPurpose,
} from '@sanctuary/shared/constants/walletIdentity';
import {
  accountPathMatchesWalletPolicy,
} from '@sanctuary/shared/constants/walletPolicy';
import type { TabNetwork } from '../../app/networks';
import type {
  CreateWalletPayload,
  CreateWalletState,
  CreateWalletStep,
  ScriptType,
  SelectedSigner,
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

function accountMatchesSelection(
  account: DeviceAccount,
  requiredPurpose: DeviceAccountPurpose,
  scriptType: ScriptType,
  network: TabNetwork
): boolean {
  return account.purpose === requiredPurpose
    && account.scriptType === scriptType
    && accountPathMatchesWalletPolicy(account.derivationPath, {
      walletType: requiredPurpose === 'multisig' ? WalletType.MULTI_SIG : WalletType.SINGLE_SIG,
      scriptType,
      chainEnvironment: network,
    });
}

export function getExactAccount(
  device: Device,
  walletType: WalletType,
  scriptType: ScriptType,
  network: TabNetwork
): DeviceAccount | null {
  const requiredPurpose = getRequiredAccountPurpose(walletType);
  const matches = (device.accounts ?? []).filter(account => (
    accountMatchesSelection(account, requiredPurpose, scriptType, network)
  ));
  return matches.length === 1 ? matches[0] : null;
}

export function getCompatibleDevices(
  devices: Device[],
  walletType: WalletType | null,
  scriptType: ScriptType,
  network: TabNetwork
): Device[] {
  if (!walletType) return devices;
  return devices.filter(device => getExactAccount(device, walletType, scriptType, network) !== null);
}

export function getIncompatibleDevices(
  devices: Device[],
  walletType: WalletType | null,
  scriptType: ScriptType,
  network: TabNetwork
): Device[] {
  if (!walletType) return [];
  return devices.filter(device => getExactAccount(device, walletType, scriptType, network) === null);
}

export function getNextSelectedSigners(
  selectedSigners: SelectedSigner[],
  walletType: WalletType | null,
  signer: SelectedSigner
): SelectedSigner[] {
  const isSelected = selectedSigners.some(current => current.deviceId === signer.deviceId);

  if (walletType === WalletType.SINGLE_SIG) {
    return isSelected ? [] : [signer];
  }

  if (isSelected) {
    return selectedSigners.filter(current => current.deviceId !== signer.deviceId);
  }

  return [...selectedSigners, signer];
}

export function canAdvanceCreateWalletStep(
  step: CreateWalletStep,
  state: Pick<CreateWalletState, 'walletType' | 'selectedSigners' | 'walletName'>
): boolean {
  if (step === 1) return Boolean(state.walletType);
  if (step === 2) return state.selectedSigners.length > 0;
  if (step === 3) return Boolean(state.walletName);
  return true;
}

export function getNextCreateWalletStep(
  step: CreateWalletStep,
  state: Pick<CreateWalletState, 'walletType' | 'selectedSigners' | 'walletName'>
): NextStepResult {
  if (step === 1 && state.walletType) return { nextStep: 2 };

  if (step === 2 && state.selectedSigners.length > 0) {
    if (state.walletType === WalletType.MULTI_SIG && state.selectedSigners.length < 2) {
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
  if (state.selectedSigners.length === 0) {
    throw new Error('At least one exact signer account is required');
  }

  const isMultisig = walletType === WalletType.MULTI_SIG;

  return {
    name: state.walletName,
    type: walletType,
    scriptType: state.scriptType,
    network: state.network,
    quorum: isMultisig ? state.quorumM : undefined,
    totalSigners: isMultisig ? state.selectedSigners.length : undefined,
    signers: state.selectedSigners.map((signer, signerIndex) => ({
      ...signer,
      signerIndex,
    })),
  };
}
