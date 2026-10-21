import { WalletType, type Device, type DeviceAccount } from '../../types';
import {
  accountPurposeForWalletType,
  WalletScriptType,
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

/** Single-sig script types in picker order; the first supported one is the signer's default. */
export const SINGLE_SIG_SCRIPT_ORDER: readonly ScriptType[] = [
  WalletScriptType.NATIVE_SEGWIT,
  WalletScriptType.TAPROOT,
  WalletScriptType.NESTED_SEGWIT,
  WalletScriptType.LEGACY,
];

/** Script types for which the device has exactly one matching account. */
export function getSupportedScriptTypes(
  device: Device,
  walletType: WalletType,
  network: TabNetwork
): ScriptType[] {
  return SINGLE_SIG_SCRIPT_ORDER.filter(type => getExactAccount(device, walletType, type, network) !== null);
}

/**
 * Single-sig signers are listed when they support any script type (the type is
 * chosen afterwards); multisig keeps the exact match on its fixed script type.
 */
function isDeviceCompatible(
  device: Device,
  walletType: WalletType,
  scriptType: ScriptType,
  network: TabNetwork
): boolean {
  if (walletType === WalletType.SINGLE_SIG) {
    return getSupportedScriptTypes(device, walletType, network).length > 0;
  }
  return getExactAccount(device, walletType, scriptType, network) !== null;
}

export interface SignerBinding {
  scriptType: ScriptType;
  account: DeviceAccount;
}

/**
 * The account a signer would be bound to. Single-sig keeps the current script
 * type when the device supports it, else takes the device's first supported
 * type; multisig stays on the current (fixed) script type.
 */
export function resolveSignerBinding(
  device: Device,
  walletType: WalletType,
  scriptType: ScriptType,
  network: TabNetwork
): SignerBinding | null {
  const supported = walletType === WalletType.SINGLE_SIG
    ? getSupportedScriptTypes(device, walletType, network)
    : [scriptType];
  const resolved: ScriptType | undefined = supported.includes(scriptType) ? scriptType : supported[0];
  if (!resolved) return null;
  const account = getExactAccount(device, walletType, resolved, network);
  return account ? { scriptType: resolved, account } : null;
}

function findSelectedSingleSigDevice(selected: SelectedSigner[], devices: Device[]): Device | undefined {
  const deviceId = selected[0]?.deviceId;
  return deviceId === undefined ? undefined : devices.find(candidate => candidate.id === deviceId);
}

/** Script types the step-3 picker may offer: the selected single-sig signer's, or all of them. */
export function getSelectionScriptTypes(
  selected: SelectedSigner[],
  devices: Device[],
  walletType: WalletType | null,
  network: TabNetwork
): ScriptType[] {
  const device = walletType === WalletType.SINGLE_SIG ? findSelectedSingleSigDevice(selected, devices) : undefined;
  return device ? getSupportedScriptTypes(device, WalletType.SINGLE_SIG, network) : [...SINGLE_SIG_SCRIPT_ORDER];
}

/**
 * Rebind a single-sig selection to another script type in place. Returns the
 * selection unchanged when nothing is selected, and null when the selected
 * signer has no exact account for that type (the caller then ignores the change).
 */
export function rebindSingleSigSelection(
  selected: SelectedSigner[],
  devices: Device[],
  scriptType: ScriptType,
  network: TabNetwork
): SelectedSigner[] | null {
  if (selected.length === 0) return selected;
  const device = findSelectedSingleSigDevice(selected, devices);
  const account = device ? getExactAccount(device, WalletType.SINGLE_SIG, scriptType, network) : null;
  return account ? [{ deviceId: selected[0].deviceId, deviceAccountId: account.id }] : null;
}

export function getCompatibleDevices(
  devices: Device[],
  walletType: WalletType | null,
  scriptType: ScriptType,
  network: TabNetwork
): Device[] {
  if (!walletType) return devices;
  return devices.filter(device => isDeviceCompatible(device, walletType, scriptType, network));
}

export function getIncompatibleDevices(
  devices: Device[],
  walletType: WalletType | null,
  scriptType: ScriptType,
  network: TabNetwork
): Device[] {
  if (!walletType) return [];
  return devices.filter(device => !isDeviceCompatible(device, walletType, scriptType, network));
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

/** Retain only bindings whose exact device account still matches the current policy. */
export function reconcileSelectedSigners(
  selected: SelectedSigner[], devices: Device[], walletType: WalletType | null,
  scriptType: ScriptType, network: TabNetwork
): SelectedSigner[] {
  if (!walletType) return [];
  return selected.filter(signer => {
    const device = devices.find(candidate => candidate.id === signer.deviceId);
    if (!device) return false;
    return getExactAccount(device, walletType, scriptType, network)?.id === signer.deviceAccountId;
  });
}

function quorumExceedsSelectedSigners(
  state: Pick<CreateWalletState, 'walletType' | 'selectedSigners' | 'quorumM'>
): boolean {
  return state.walletType === WalletType.MULTI_SIG
    && state.quorumM > state.selectedSigners.length;
}

export function canAdvanceCreateWalletStep(
  step: CreateWalletStep,
  state: Pick<CreateWalletState, 'walletType' | 'selectedSigners' | 'walletName' | 'quorumM'>
): boolean {
  if (step === 1) return Boolean(state.walletType);
  if (step === 2) return state.selectedSigners.length > 0;
  if (step === 3) return Boolean(state.walletName) && !quorumExceedsSelectedSigners(state);
  return true;
}

export function getNextCreateWalletStep(
  step: CreateWalletStep,
  state: Pick<CreateWalletState, 'walletType' | 'selectedSigners' | 'walletName' | 'quorumM'>
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

  if (step === 3 && state.walletName) {
    // Defensive: unreachable once the controller re-clamps quorumM on every
    // selectedSigners change, but the gate must not depend on that timing.
    if (quorumExceedsSelectedSigners(state)) {
      return {
        error: {
          message: 'Quorum cannot exceed the number of selected signers.',
          title: 'Validation Error',
        },
      };
    }

    return { nextStep: 4 };
  }

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
