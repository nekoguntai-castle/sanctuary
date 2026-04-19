import type { Address } from '../../../types';

interface PayjoinStatus {
  enabled: boolean;
  configured: boolean;
}

export function getUnusedReceiveAddresses(addresses: Address[]): Address[] {
  return addresses.filter(address => !address.isChange && !address.used);
}

export function getDisplayReceiveAddresses(
  addresses: Address[],
  fetchedAddresses: Address[]
): Address[] {
  const fromProps = getUnusedReceiveAddresses(addresses);
  if (fromProps.length > 0) return fromProps;
  return getUnusedReceiveAddresses(fetchedAddresses);
}

export function shouldFetchUnusedReceiveAddresses(
  addresses: Address[],
  fetchAttempted: boolean,
  hasFetchCallback: boolean
): boolean {
  if (getUnusedReceiveAddresses(addresses).length > 0) return false;
  if (fetchAttempted) return false;
  if (addresses.length === 0) return false;
  return hasFetchCallback;
}

export function getSelectedReceiveAddress(
  unusedReceiveAddresses: Address[],
  selectedReceiveAddressId: string | null
): Address | undefined {
  if (selectedReceiveAddressId) {
    const selected = unusedReceiveAddresses.find(address => address.id === selectedReceiveAddressId);
    if (selected) return selected;
  }

  return unusedReceiveAddresses[0];
}

export function getPayjoinAvailable(status: PayjoinStatus): boolean {
  return status.enabled && status.configured;
}

export function getPayjoinAmountSats(receiveAmount: string): number | undefined {
  const parsedAmount = receiveAmount ? parseFloat(receiveAmount) : NaN;
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return undefined;
  return Math.round(parsedAmount * 100_000_000);
}

export function getPayjoinUriOptions(receiveAmount: string): { amount: number } | undefined {
  const amountSats = getPayjoinAmountSats(receiveAmount);
  return amountSats ? { amount: amountSats } : undefined;
}

export function getPayjoinAddressIdentifier(address: Address): string {
  return address.id ?? address.address;
}

export function getReceiveDisplayValue(payjoinUri: string | null, receiveAddress: string): string {
  return payjoinUri || receiveAddress;
}

export function getReceiveValueLabel(payjoinEnabled: boolean): string {
  return payjoinEnabled ? 'BIP21 URI (with Payjoin)' : 'Receive Address';
}

export function getReceiveHelpText(payjoinEnabled: boolean): string {
  return payjoinEnabled
    ? 'Share this URI with a Payjoin-capable wallet for enhanced privacy.'
    : 'Send only Bitcoin (BTC) to this address.';
}
