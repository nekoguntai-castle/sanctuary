import type { Address } from '../../../../types';
import type { AddressGroups } from './types';

/**
 * Partition addresses into receive/change groups. An explicit API `isChange`
 * value wins over derivation-path parsing so server-classified records stay
 * authoritative.
 */
export function splitAddresses(addresses: Address[]): AddressGroups {
  return {
    receiveAddresses: addresses.filter(address => !isChangeAddress(address)),
    changeAddresses: addresses.filter(isChangeAddress),
  };
}

/**
 * Standard BIP derivation path: m/purpose'/coin'/account'/change/index.
 * The second-to-last segment is `0` for receive and `1` for internal change.
 */
export function isChangeAddress(address: Address): boolean {
  if (typeof address.isChange === 'boolean') {
    return address.isChange;
  }

  const derivationPath = typeof address.derivationPath === 'string' ? address.derivationPath : '';
  const parts = derivationPath.split('/');
  if (parts.length < 2) {
    return false;
  }

  return parts[parts.length - 2] === '1';
}
