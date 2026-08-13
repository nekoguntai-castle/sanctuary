/**
 * Wallet signer account resolution.
 *
 * Wallet policy creation must bind each signer to one concrete DeviceAccount.
 * This module deliberately has no purpose, arbitrary-account, or legacy-device
 * fallback: ambiguous or inconsistent signer identity fails before descriptor
 * construction.
 */

import { InvalidInputError } from "../../errors/ApiError";
import { normalizeDerivationPath } from "@sanctuary/shared/utils/bitcoin";
import {
  accountPathMatchesWalletPolicy,
  parseCanonicalAccountPath,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  accountPurposeForWalletType,
  type DeviceAccountPurpose,
  type WalletScriptType,
  type WalletType,
} from "@sanctuary/shared/constants/walletIdentity";
import type {
  CreateWalletInput,
  WalletNetwork,
  WalletSignerBinding,
  WalletSignerInput,
} from "./types";

export type { WalletSignerBinding, WalletSignerInput } from "./types";

export interface WalletSignerAccount {
  id: string;
  deviceId: string;
  purpose: string;
  scriptType: string;
  derivationPath: string;
  xpub: string;
}

export interface WalletSignerDevice {
  id: string;
  label: string;
  fingerprint: string;
  accounts: readonly WalletSignerAccount[];
}

export interface WalletSignerResolutionInput {
  type: WalletType;
  scriptType: WalletScriptType;
  network?: WalletNetwork;
  signers: readonly WalletSignerInput[];
}

export interface DescriptorDeviceInfo {
  fingerprint: string;
  xpub: string;
  derivationPath: string;
}

export interface SignerBindingPolicySnapshot {
  deviceId: string;
  deviceAccountId: string;
  signerFingerprint: string;
  signerXpub: string;
  signerDerivationPath: string;
  signerPurpose: string;
  signerScriptType: string;
}

const walletNetwork = (input: { network?: WalletNetwork }): WalletNetwork => {
  return input.network ?? "mainnet";
};

const accountError = (device: WalletSignerDevice, detail: string): InvalidInputError => {
  return new InvalidInputError(`Device "${device.label}" account is invalid: ${detail}`);
};

const validateAccountPath = (
  device: WalletSignerDevice,
  account: WalletSignerAccount,
  input: Pick<WalletSignerResolutionInput, "type" | "scriptType" | "network">,
): void => {
  const normalized = normalizeDerivationPath(account.derivationPath);
  const parsed = parseCanonicalAccountPath(normalized);
  if (!parsed) {
    throw accountError(device, "derivation path must be a hardened account-level path");
  }

  const expectedPurpose = accountPurposeForWalletType(input.type);
  if (parsed.policy.accountPurpose !== expectedPurpose || account.purpose !== expectedPurpose) {
    throw accountError(device, `purpose must be ${expectedPurpose}`);
  }
  if (parsed.policy.scriptType !== input.scriptType || account.scriptType !== input.scriptType) {
    throw accountError(device, `script type must be ${input.scriptType}`);
  }
  if (!accountPathMatchesWalletPolicy(normalized, {
    walletType: input.type,
    scriptType: input.scriptType,
    chainEnvironment: walletNetwork(input),
  })) {
    throw accountError(device, `coin type does not match ${walletNetwork(input)}`);
  }
};

const assertUniqueSignerInputs = (signers: readonly WalletSignerInput[]): void => {
  if (signers.length === 0) throw new InvalidInputError("At least one explicit signer is required");
  const deviceIds = new Set<string>();
  const accountIds = new Set<string>();
  const signerIndices = new Set<number>();

  for (const [position, signer] of signers.entries()) {
    if (!Number.isSafeInteger(signer.signerIndex) || signer.signerIndex < 0) {
      throw new InvalidInputError("Signer index must be a non-negative safe integer");
    }
    if (deviceIds.has(signer.deviceId)) throw new InvalidInputError("Duplicate signer device");
    if (accountIds.has(signer.deviceAccountId)) throw new InvalidInputError("Duplicate signer account");
    if (signerIndices.has(signer.signerIndex)) throw new InvalidInputError("Duplicate signer index");
    if (signer.signerIndex !== position) {
      throw new InvalidInputError("Signer indices must be contiguous and match request order");
    }
    deviceIds.add(signer.deviceId);
    accountIds.add(signer.deviceAccountId);
    signerIndices.add(signer.signerIndex);
  }
};

const findUniqueDevice = (
  devices: readonly WalletSignerDevice[],
  deviceId: string,
): WalletSignerDevice => {
  const matches = devices.filter((device) => device.id === deviceId);
  if (matches.length !== 1) {
    throw new InvalidInputError(
      matches.length === 0 ? `Signer device ${deviceId} was not loaded` : `Signer device ${deviceId} is ambiguous`,
    );
  }
  return matches[0];
};

const findUniqueAccount = (
  device: WalletSignerDevice,
  accountId: string,
): WalletSignerAccount => {
  const matches = device.accounts.filter((account) => account.id === accountId);
  if (matches.length !== 1) {
    throw accountError(
      device,
      matches.length === 0 ? `account ${accountId} does not belong to this device` : `account ${accountId} is ambiguous`,
    );
  }
  if (matches[0].deviceId !== device.id) {
    throw accountError(device, `account ${accountId} has inconsistent device ownership`);
  }
  return matches[0];
};

const bindingFromSigner = (
  devices: readonly WalletSignerDevice[],
  input: WalletSignerResolutionInput,
  signer: WalletSignerInput,
): WalletSignerBinding => {
  const device = findUniqueDevice(devices, signer.deviceId);
  const account = findUniqueAccount(device, signer.deviceAccountId);
  validateAccountPath(device, account, input);

  return Object.freeze({
    deviceId: device.id,
    deviceAccountId: account.id,
    signerIndex: signer.signerIndex,
    signerBindingVersion: 1 as const,
    signerFingerprint: device.fingerprint,
    signerXpub: account.xpub,
    signerDerivationPath: normalizeDerivationPath(account.derivationPath),
    signerPurpose: account.purpose as DeviceAccountPurpose,
    signerScriptType: account.scriptType as WalletScriptType,
  });
};

export function resolveWalletSignerBindings(
  devices: readonly WalletSignerDevice[],
  input: WalletSignerResolutionInput,
): readonly WalletSignerBinding[] {
  assertUniqueSignerInputs(input.signers);
  return Object.freeze(input.signers.map((signer) => bindingFromSigner(devices, input, signer)));
}

export function descriptorDeviceInfo(binding: WalletSignerBinding): DescriptorDeviceInfo {
  return Object.freeze({
    fingerprint: binding.signerFingerprint,
    xpub: binding.signerXpub,
    derivationPath: binding.signerDerivationPath,
  });
}

export function assertSignerBindingMatchesWallet(
  binding: SignerBindingPolicySnapshot,
  input: Pick<WalletSignerResolutionInput, "type" | "scriptType" | "network">,
): void {
  const device: WalletSignerDevice = {
    id: binding.deviceId,
    label: binding.deviceId,
    fingerprint: binding.signerFingerprint,
    accounts: [{
      id: binding.deviceAccountId,
      deviceId: binding.deviceId,
      purpose: binding.signerPurpose,
      scriptType: binding.signerScriptType,
      derivationPath: binding.signerDerivationPath,
      xpub: binding.signerXpub,
    }],
  };
  validateAccountPath(device, device.accounts[0], input);
}

const automaticExactAccount = (
  device: WalletSignerDevice,
  input: CreateWalletInput,
): WalletSignerAccount => {
  const exact = device.accounts.filter((account) => {
    try {
      validateAccountPath(device, account, input);
      return true;
    } catch (error) {
      if (error instanceof InvalidInputError) return false;
      /* v8 ignore next -- validateAccountPath only throws InvalidInputError */
      throw error;
    }
  });

  if (exact.length !== 1) {
    throw new InvalidInputError(
      `Device "${device.label}" must have exactly one matching ${walletNetwork(input)} ` +
      `${accountPurposeForWalletType(input.type)} ${input.scriptType} account; found ${exact.length}`,
    );
  }
  return exact[0];
};

/**
 * Compatibility projection for the current wallet-create orchestrator.
 * It remains fail-closed; explicit orchestration should use
 * resolveWalletSignerBindings() and descriptorDeviceInfo().
 */
export function buildDeviceInfo(device: WalletSignerDevice, input: CreateWalletInput): DescriptorDeviceInfo {
  const account = automaticExactAccount(device, input);
  return {
    fingerprint: device.fingerprint,
    xpub: account.xpub,
    derivationPath: normalizeDerivationPath(account.derivationPath),
  };
}
