import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  classifyHardwareWalletVendor,
  getHardwareWalletCapabilityRow,
  type HardwareWalletCapability,
} from '../../shared/constants/hardwareWalletCapabilities';

interface SourceInventory {
  path: string;
  declaration?: RegExp;
  registrations?: RegExp;
  excluded: readonly string[];
}

const SOURCE_INVENTORIES: readonly SourceInventory[] = [
  {
    path: 'src/services/hardwareWallet/types.ts',
    declaration: /export type DeviceType\s*=([\s\S]*?);/,
    excluded: ['unknown'],
  },
  {
    path: 'src/services/hardwareWallet/runtime.ts',
    registrations: /registerAdapterLoader\(\s*'([^']+)'/g,
    excluded: [],
  },
  {
    path: 'src/components/ImportWallet/importHelpers.ts',
    declaration: /export type HardwareDeviceType\s*=([\s\S]*?);/,
    excluded: [],
  },
];

function declaredSignerIdentities(inventory: SourceInventory): string[] {
  const source = readFileSync(resolve(inventory.path), 'utf8');
  if (inventory.registrations) {
    return [...source.matchAll(inventory.registrations)].map((match) => match[1]);
  }
  const declaration = source.match(inventory.declaration!)?.[1];
  if (!declaration) throw new Error(`Signer inventory declaration is missing: ${inventory.path}`);
  return [...declaration.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('hardware-wallet implementation inventory', () => {
  it.each(SOURCE_INVENTORIES)(
    'classifies every independently declared signer in $path',
    (inventory) => {
      const identities = declaredSignerIdentities(inventory)
        .filter((identity) => !inventory.excluded.includes(identity));
      expect(identities).not.toEqual([]);
      for (const identity of identities) {
        expect(classifyHardwareWalletVendor({ type: identity })).not.toBeNull();
      }
    },
  );

  it('classifies exact string and structured catalog identities', () => {
    expect(classifyHardwareWalletVendor({ model: 'Ledger Nano X' })).toBe('ledger');
    expect(classifyHardwareWalletVendor({ model: { slug: 'trezor-safe-5' } })).toBe('trezor');
    expect(classifyHardwareWalletVendor({ model: { name: 'Blockstream Jade Plus' } })).toBe('jade');
    expect(getHardwareWalletCapabilityRow(
      { model: { name: 'Ledger Nano X' } },
      'sign',
    )?.id).toBe('ledger.ledger-nano-x.sign');
    expect(getHardwareWalletCapabilityRow(
      { type: 'trezor', model: { slug: 'trezor-safe-5' } },
      'sign',
    )?.id).toBe('trezor.trezor-safe-5.sign');
    expect(getHardwareWalletCapabilityRow(
      { type: 'jade', model: { name: 'Blockstream Jade Plus' } },
      'display',
    )?.id).toBe('jade.blockstream-jade-plus.display');
  });

  it('fails closed for missing, conflicting, and unmapped capability identities', () => {
    expect(classifyHardwareWalletVendor({})).toBeNull();
    expect(classifyHardwareWalletVendor({ type: 'ledger', model: 'Trezor Safe 5' })).toBeNull();
    expect(classifyHardwareWalletVendor({
      type: 'Trezor Safe 3',
      model: 'Trezor Safe 5',
    })).toBeNull();
    expect(classifyHardwareWalletVendor({ type: 'ledger', model: 'Ledger future model' })).toBe('ledger');
    expect(getHardwareWalletCapabilityRow(
      { type: 'ledger', model: 'Ledger future model' },
      'sign',
    )?.id).toBe('ledger.ledger-unresolved.sign');
    expect(getHardwareWalletCapabilityRow({ type: 'unknown' }, 'sign')).toBeNull();
    expect(
      getHardwareWalletCapabilityRow(
        { type: 'ledger' },
        'future-capability' as HardwareWalletCapability,
      ),
    ).toBeNull();
  });
});
