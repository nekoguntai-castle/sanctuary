import { describe, expect, it } from 'vitest';
import { getAddressBalanceLabel } from '../../../../../components/WalletDetail/tabs/AddressesTab/addressDisplay';
import { isChangeAddress, splitAddresses } from '../../../../../components/WalletDetail/tabs/AddressesTab/addressModel';
import type { Address } from '../../../../../types';

function address(overrides: Partial<Address>): Address {
  return {
    id: 'addr',
    address: 'bc1qaddress0000000000000000000000000000000000',
    derivationPath: "m/84'/0'/0'/0/0",
    index: 0,
    used: false,
    balance: 0,
    labels: [],
    ...overrides,
  } as Address;
}

describe('AddressesTab address helpers', () => {
  it('lets explicit isChange values override derivation-path parsing', () => {
    const explicitChange = address({
      id: 'explicit-change',
      isChange: true,
      derivationPath: "m/84'/0'/0'/0/9",
    });
    const explicitReceive = address({
      id: 'explicit-receive',
      isChange: false,
      derivationPath: "m/84'/0'/0'/1/9",
    });

    expect(isChangeAddress(explicitChange)).toBe(true);
    expect(isChangeAddress(explicitReceive)).toBe(false);

    const groups = splitAddresses([explicitChange, explicitReceive]);
    expect(groups.changeAddresses).toEqual([explicitChange]);
    expect(groups.receiveAddresses).toEqual([explicitReceive]);
  });

  it('classifies receive, change, and short derivation paths from the BIP change segment', () => {
    expect(isChangeAddress(address({ derivationPath: "m/84'/0'/0'/0/1" }))).toBe(false);
    expect(isChangeAddress(address({ derivationPath: "m/84'/0'/0'/1/1" }))).toBe(true);
    expect(isChangeAddress(address({ derivationPath: 'm' }))).toBe(false);
  });

  it('formats positive balances, used-zero balances, and unused fallbacks', () => {
    const format = (sats: number) => `${sats} sats`;

    expect(getAddressBalanceLabel(address({ balance: 125, used: false }), format)).toBe('125 sats');
    expect(getAddressBalanceLabel(address({ balance: 0, used: true }), format)).toBe('0 sats');
    expect(getAddressBalanceLabel(address({ balance: 0, used: false }), format)).toBe('-');
    expect(getAddressBalanceLabel(address({ balance: -1, used: false }), format)).toBe('-');
  });
});
