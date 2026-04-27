import type { OutputEntry, WalletAddress } from '../../contexts/send/types';

export function isSecureBrowserContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

export function getAddressBorderClass(isValid: boolean | null, hasPayjoin: boolean): string {
  if (isValid === true) return 'border-green-500 dark:border-green-400';
  if (isValid === false) return 'border-rose-500 dark:border-rose-400';
  if (hasPayjoin) return 'border-zen-indigo dark:border-zen-indigo';
  return 'border-sanctuary-300 dark:border-sanctuary-700';
}

export function getCameraErrorMessage(error: unknown): string {
  const err = error as Error;

  if (err.name === 'NotAllowedError') {
    return 'Camera access denied. Please allow camera permissions and try again.';
  }

  if (err.name === 'NotFoundError') {
    return 'No camera found on this device.';
  }

  return `Camera error: ${err.message}`;
}

export function getReceiveAddresses(addresses: WalletAddress[]): WalletAddress[] {
  return addresses.filter((address) => !address.isChange);
}

export function isAmountInputValueAllowed(value: string, unit: string): boolean {
  const isValidBtc = value === '' || /^[0-9]*\.?[0-9]*$/.test(value);
  const isValidSats = value === '' || /^[0-9]*$/.test(value);

  return (unit === 'btc' && isValidBtc) || (unit !== 'btc' && isValidSats);
}

export function getAmountInputValue(
  output: OutputEntry,
  maxAmount: number,
  displayValue: string,
  formatAmount: (sats: number) => string
): string {
  return output.sendMax ? formatAmount(maxAmount) : displayValue;
}

export function getAmountInputClass(output: OutputEntry, disabled: boolean): string {
  const sendMaxClass = output.sendMax
    ? 'border-primary-400 dark:border-primary-500 bg-primary-50/50 dark:bg-primary-900/10'
    : 'border-sanctuary-300 dark:border-sanctuary-700';
  const disabledClass = disabled ? 'opacity-60 cursor-not-allowed' : '';

  return `block w-full px-4 py-2.5 pr-20 rounded-md border text-sm ${sendMaxClass} surface-muted focus:ring-2 focus:ring-sanctuary-500 focus:outline-none transition-colors ${disabledClass}`;
}

export function getMaxButtonClass(sendMax: boolean): string {
  return `px-3 py-2.5 text-xs font-medium rounded-lg border transition-colors ${
    sendMax
      ? 'bg-primary-500 dark:bg-sanctuary-600 text-white dark:text-sanctuary-100 border-primary-500 dark:border-sanctuary-500 hover:bg-primary-600 dark:hover:bg-sanctuary-500'
      : 'border-sanctuary-300 dark:border-sanctuary-700 text-sanctuary-600 dark:text-sanctuary-400 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800'
  }`;
}
