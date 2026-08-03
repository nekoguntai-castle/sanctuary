import type { Address } from '../../../../types';
import type { AddressFormat } from './types';

export function getAddressBalanceLabel(
  address: Pick<Address, 'balance' | 'used'>,
  format: AddressFormat,
): string {
  if (address.balance > 0) {
    return format(address.balance);
  }

  return address.used ? format(0) : '-';
}
