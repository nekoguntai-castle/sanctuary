import type { Address } from "../../../../types";
import { parseAddressDerivationPath } from "../../../../shared/utils/bitcoin";
import type { AddressGroups } from "./types";

/**
 * Partition addresses into receive/change groups. An explicit API `isChange`
 * value wins over derivation-path parsing so server-classified records stay
 * authoritative.
 */
export function splitAddresses(addresses: Address[]): AddressGroups {
  return {
    receiveAddresses: addresses.filter((address) => !isChangeAddress(address)),
    changeAddresses: addresses.filter(isChangeAddress),
  };
}

export function isChangeAddress(address: Address): boolean {
  if (typeof address.isChange === "boolean") {
    return address.isChange;
  }

  return parseAddressDerivationPath(address.derivationPath)?.chain === "change";
}
