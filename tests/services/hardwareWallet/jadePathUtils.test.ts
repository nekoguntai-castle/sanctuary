import { describe, expect, it } from 'vitest';
import { jadePathToArray } from '../../../services/hardwareWallet/adapters/jadePathUtils';

describe('jadePathToArray', () => {
  const HARDENED = 0x80000000;

  it('converts standard rooted apostrophe-hardened paths', () => {
    expect(jadePathToArray("m/84'/0'/0'/0/0")).toEqual([
      HARDENED + 84,
      HARDENED,
      HARDENED,
      0,
      0,
    ]);
  });

  it('converts h-suffixed hardened paths', () => {
    expect(jadePathToArray('m/44h/0h/0h')).toEqual([
      HARDENED + 44,
      HARDENED,
      HARDENED,
    ]);
  });

  it('accepts paths without an m prefix', () => {
    expect(jadePathToArray("84'/0'/0'")).toEqual([
      HARDENED + 84,
      HARDENED,
      HARDENED,
    ]);
  });

  it('converts single path components', () => {
    expect(jadePathToArray('1')).toEqual([1]);
    expect(jadePathToArray("1'")).toEqual([HARDENED + 1]);
  });
});
