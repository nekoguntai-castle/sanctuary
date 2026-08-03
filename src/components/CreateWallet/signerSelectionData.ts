import { WalletType, type Device } from '../../types';

export function getSignerAccountTypeLabel(walletType: WalletType): 'single-sig' | 'multisig' {
  return walletType === WalletType.MULTI_SIG ? 'multisig' : 'single-sig';
}

export function getSignerSelectionDescription(walletType: WalletType): string {
  if (walletType === WalletType.SINGLE_SIG) {
    return 'Select the device that will control this wallet.';
  }

  return 'Select the devices that will participate in this multisig quorum.';
}

export function getHiddenDeviceSummary(count: number): string {
  return `${count} device${count !== 1 ? 's' : ''} hidden`;
}

export function getHiddenDeviceDescription(devices: Device[], accountTypeLabel: string): string {
  const names = devices.map(device => device.label).join(', ');
  const verb = devices.length === 1 ? "doesn't" : "don't";
  return `${names} ${verb} have a ${accountTypeLabel} derivation path.`;
}
