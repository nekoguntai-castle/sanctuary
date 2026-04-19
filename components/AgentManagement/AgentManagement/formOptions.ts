import type {
  AgentManagementOptions,
  AgentOptionDevice,
  AgentOptionUser,
  AgentOptionWallet,
} from '../../../src/api/admin';
import type { AgentFormState } from './formState';

export type SelectOption = {
  value: string;
  label: string;
};

function walletBelongsToUser(wallet: AgentOptionWallet, userId: string): boolean {
  return wallet.accessUserIds.includes(userId);
}

function walletMatchesUser(wallet: AgentOptionWallet, userId: string): boolean {
  return !userId || walletBelongsToUser(wallet, userId);
}

function isFundingWallet(wallet: AgentOptionWallet, userId: string): boolean {
  return wallet.type === 'multi_sig' && walletMatchesUser(wallet, userId);
}

function isOperationalWallet(
  wallet: AgentOptionWallet,
  form: AgentFormState,
  selectedFundingWallet?: AgentOptionWallet
): boolean {
  return (
    wallet.type === 'single_sig' &&
    wallet.id !== form.fundingWalletId &&
    walletMatchesUser(wallet, form.userId) &&
    walletsShareNetwork(wallet, selectedFundingWallet)
  );
}

function walletsShareNetwork(wallet: AgentOptionWallet, selectedFundingWallet?: AgentOptionWallet): boolean {
  return !selectedFundingWallet || wallet.network === selectedFundingWallet.network;
}

function deviceCanSignFundingWallet(device: AgentOptionDevice, fundingWalletId: string): boolean {
  return !fundingWalletId || device.walletIds.includes(fundingWalletId);
}

function hasWallet(wallets: AgentOptionWallet[], walletId: string): boolean {
  return wallets.some(wallet => wallet.id === walletId);
}

function hasDevice(devices: AgentOptionDevice[], deviceId: string): boolean {
  return devices.some(device => device.id === deviceId);
}

function hasInvalidFundingSelection(form: AgentFormState, fundingWallets: AgentOptionWallet[]): boolean {
  return Boolean(form.fundingWalletId) && !hasWallet(fundingWallets, form.fundingWalletId);
}

function hasInvalidOperationalSelection(form: AgentFormState, operationalWallets: AgentOptionWallet[]): boolean {
  return Boolean(form.operationalWalletId) && !hasWallet(operationalWallets, form.operationalWalletId);
}

function hasInvalidSignerSelection(form: AgentFormState, signerDevices: AgentOptionDevice[]): boolean {
  return Boolean(form.signerDeviceId) && !hasDevice(signerDevices, form.signerDeviceId);
}

export function getSelectedFundingWallet(
  wallets: AgentOptionWallet[],
  fundingWalletId: string
): AgentOptionWallet | undefined {
  return wallets.find(wallet => wallet.id === fundingWalletId);
}

export function getFundingWallets(wallets: AgentOptionWallet[], userId: string): AgentOptionWallet[] {
  return wallets.filter(wallet => isFundingWallet(wallet, userId));
}

export function getOperationalWallets(
  wallets: AgentOptionWallet[],
  form: AgentFormState,
  selectedFundingWallet?: AgentOptionWallet
): AgentOptionWallet[] {
  return wallets.filter(wallet => isOperationalWallet(wallet, form, selectedFundingWallet));
}

export function getSignerDevices(devices: AgentOptionDevice[], fundingWalletId: string): AgentOptionDevice[] {
  return devices.filter(device => deviceCanSignFundingWallet(device, fundingWalletId));
}

export function canSubmitAgentForm(form: AgentFormState): boolean {
  return Boolean(
    form.name.trim() &&
    form.userId &&
    form.fundingWalletId &&
    form.operationalWalletId &&
    form.signerDeviceId
  );
}

export function setAgentFormUser(form: AgentFormState, userId: string): AgentFormState {
  return {
    ...form,
    userId,
    fundingWalletId: '',
    operationalWalletId: '',
    signerDeviceId: '',
  };
}

export function setAgentFormFundingWallet(form: AgentFormState, fundingWalletId: string): AgentFormState {
  return {
    ...form,
    fundingWalletId,
    operationalWalletId: '',
    signerDeviceId: '',
  };
}

export function reconcileAgentFormSelections(
  form: AgentFormState,
  fundingWallets: AgentOptionWallet[],
  operationalWallets: AgentOptionWallet[],
  signerDevices: AgentOptionDevice[]
): AgentFormState {
  if (hasInvalidFundingSelection(form, fundingWallets)) {
    return setAgentFormFundingWallet(form, '');
  }

  let nextForm = form;
  if (hasInvalidOperationalSelection(nextForm, operationalWallets)) {
    nextForm = { ...nextForm, operationalWalletId: '' };
  }

  if (hasInvalidSignerSelection(nextForm, signerDevices)) {
    nextForm = { ...nextForm, signerDeviceId: '' };
  }

  return nextForm;
}

export function toUserOptions(users: AgentOptionUser[]): SelectOption[] {
  return users.map(user => ({ value: user.id, label: user.username }));
}

export function toWalletOptions(wallets: AgentOptionWallet[]): SelectOption[] {
  return wallets.map(wallet => ({ value: wallet.id, label: `${wallet.name} · ${wallet.network}` }));
}

export function toDeviceOptions(devices: AgentManagementOptions['devices']): SelectOption[] {
  return devices.map(device => ({ value: device.id, label: `${device.label} · ${device.fingerprint}` }));
}
