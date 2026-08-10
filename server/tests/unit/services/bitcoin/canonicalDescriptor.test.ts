import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import bip32 from '../../../../src/services/bitcoin/bip32';
import {
  expandCanonicalMultipathDescriptor,
  parseCanonicalDescriptor,
  parseDescriptorForImport,
  replaceCanonicalDescriptorBranch,
  renderCanonicalDescriptor,
  validateCanonicalDescriptorPair,
} from '../../../../src/services/bitcoin/descriptorParser';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';

const accountXpub = (path: string, seedByte: number, network = bitcoin.networks.testnet): string => (
  bip32.fromSeed(Buffer.alloc(32, seedByte), network).derivePath(path).neutered().toBase58()
);

const key = (
  path: string,
  seedByte: number,
  suffix = '0/*',
  fingerprint = 'aabbccdd',
): string => `[${fingerprint}/${path.slice(2)}]${accountXpub(path, seedByte)}/${suffix}`;

describe('canonical descriptor grammar', () => {
  it.each([
    { wrapper: 'pkh', path: "m/44'/1'/7'" },
    { wrapper: 'sh(wpkh)', path: "m/49'/1'/7'" },
    { wrapper: 'wpkh', path: "m/84'/1'/7'" },
    { wrapper: 'tr', path: "m/86'/1'/7'" },
  ])('parses and structurally renders $wrapper', ({ wrapper, path }) => {
    const descriptor = wrapper === 'sh(wpkh)'
      ? `sh(wpkh(${key(path, 1)}))`
      : `${wrapper}(${key(path, 1)})`;

    const parsed = parseCanonicalDescriptor(descriptor);

    expect(parsed.source).toBe(descriptor);
    expect(parsed.wrapper).toBe(wrapper);
    expect(parsed.keys[0].accountPath).toBe(path);
    expect(parsed.network).toBe('testnet');
    expect(renderCanonicalDescriptor(parsed)).toBe(descriptor.replaceAll("'", 'h'));
  });

  it.each([
    {
      wrapper: 'wsh',
      path: "m/48'/1'/3'/2'",
      render: (expression: string) => `wsh(${expression})`,
    },
    {
      wrapper: 'sh-wsh',
      path: "m/48'/1'/3'/1'",
      render: (expression: string) => `sh(wsh(${expression}))`,
    },
  ])('preserves signer order for $wrapper sorted multisig', ({ path, render }) => {
    const keys = [
      key(path, 2, '0/*', '11111111'),
      key(path, 3, '0/*', '22222222'),
      key(path, 4, '0/*', '33333333'),
    ];
    const descriptor = render(`sortedmulti(2,${keys.join(',')})`);

    const parsed = parseCanonicalDescriptor(descriptor);

    expect(parsed.threshold).toBe(2);
    expect(parsed.keys.map(({ fingerprint }) => fingerprint)).toEqual([
      '11111111',
      '22222222',
      '33333333',
    ]);
    expect(renderCanonicalDescriptor(parsed)).toBe(descriptor.replaceAll("'", 'h'));
  });

  it('expands only the exact BIP389 <0;1>/* policy on every key', () => {
    const path = "m/48'/1'/9'/2'";
    const descriptor = `wsh(sortedmulti(2,${[
      key(path, 5, '<0;1>/*', '11111111'),
      key(path, 6, '<0;1>/*', '22222222'),
      key(path, 7, '<0;1>/*', '33333333'),
    ].join(',')}))`;

    const pair = expandCanonicalMultipathDescriptor(descriptor);
    const parsed = parseCanonicalDescriptor(descriptor);

    expect(pair.receiveDescriptor.match(/\/0\/\*/g)).toHaveLength(3);
    expect(pair.changeDescriptor.match(/\/1\/\*/g)).toHaveLength(3);
    expect(parseDescriptorForImport(pair.receiveDescriptor).isChange).toBe(false);
    expect(parseDescriptorForImport(pair.changeDescriptor).isChange).toBe(true);
    expect(renderCanonicalDescriptor(parsed)).toContain('/<0;1>/*');
  });

  it('does not reinterpret a multipath descriptor as a fixed receive branch', () => {
    const descriptor = `wpkh(${key("m/84'/1'/0'", 5, '<0;1>/*')})`;

    expect(() => replaceCanonicalDescriptorBranch(descriptor, 0, 1))
      .toThrow('Descriptor is not fixed to expected branch 0');
  });

  it('replaces only the expected fixed branch and validates pair roles', () => {
    const receiveDescriptor = `wpkh(${key("m/84'/1'/0'", 6)})`;
    const changeDescriptor = replaceCanonicalDescriptorBranch(receiveDescriptor, 0, 1);

    expect(changeDescriptor).toContain('/1/*');
    expect(validateCanonicalDescriptorPair(receiveDescriptor, changeDescriptor).change.suffix)
      .toEqual({ kind: 'branch', branch: 1 });
    expect(() => validateCanonicalDescriptorPair(receiveDescriptor, receiveDescriptor))
      .toThrow('Change descriptor must use branch 1');
  });

  it('validates a present checksum against the exact source bytes', () => {
    const body = `wpkh(${key("m/84'/1'/0'", 8)})`;
    const source = `${body}#${computeDescriptorChecksum(body)}`;

    expect(parseCanonicalDescriptor(source).checksum).toHaveLength(8);
    expect(() => parseCanonicalDescriptor(source.replace('/84\'/', '/84h/')))
      .toThrow('Invalid descriptor checksum');
  });

  it('rejects empty descriptors and malformed checksum separators', () => {
    expect(() => parseCanonicalDescriptor('')).toThrow('Descriptor is empty');
    expect(() => parseCanonicalDescriptor('wpkh(example)#deadbeef#extra'))
      .toThrow('Invalid descriptor checksum');
  });

  it.each([
    ['ordered multi', (valid: string) => valid.replace('sortedmulti', 'multi')],
    ['legacy multisig', (valid: string) => valid.replace(/^wsh/, 'sh')],
    ['Taproot tree', (valid: string) => `tr(${valid.slice(valid.indexOf('['), -2)},pk(02aa))`],
    ['trailing input', (valid: string) => `${valid}ignored`],
    ['leading whitespace', (valid: string) => ` ${valid}`],
  ])('rejects unsupported or non-EOF %s syntax', (_name, mutate) => {
    const path = "m/48'/1'/0'/2'";
    const valid = `wsh(sortedmulti(2,${key(path, 9)},${key(path, 10, '0/*', '11223344')}))`;
    expect(() => parseCanonicalDescriptor(mutate(valid))).toThrow();
  });

  it.each(['<1;0>/*', '<0;1;2>/*', '<0;1>/7', '0/<0;1>/*', '0/*/7', '0/7']) (
    'rejects unsupported key suffix %s',
    suffix => {
      const descriptor = `wpkh(${key("m/84'/1'/0'", 11, suffix)})`;
      expect(() => parseCanonicalDescriptor(descriptor)).toThrow(
        'Descriptor key paths must end in /0/*, /1/*, or /<0;1>/*',
      );
    },
  );

  it('rejects mixed multisig suffixes and duplicate underlying keys', () => {
    const path = "m/48'/1'/0'/2'";
    const first = key(path, 12, '0/*', '11111111');
    const mixed = key(path, 13, '1/*', '22222222');
    const duplicate = first.replace('11111111', '22222222');

    expect(() => parseCanonicalDescriptor(`wsh(sortedmulti(2,${first},${mixed}))`))
      .toThrow('one identical branch policy');
    expect(() => parseCanonicalDescriptor(`wsh(sortedmulti(2,${first},${duplicate}))`))
      .toThrow('Duplicate multisig underlying extended public key');
  });

  it('rejects duplicate key material reserialized with different BIP32 metadata', () => {
    const path = "m/48'/1'/0'/2'";
    const original = accountXpub(path, 15);
    const reserialized = Buffer.from(bs58check.decode(original));
    reserialized.writeUInt32BE(0x12345678, 5);
    const duplicate = bs58check.encode(reserialized);
    const descriptor = `wsh(sortedmulti(2,${[
      `[11111111/${path.slice(2)}]${original}/0/*`,
      `[22222222/${path.slice(2)}]${duplicate}/0/*`,
    ].join(',')}))`;

    expect(() => parseCanonicalDescriptor(descriptor))
      .toThrow('Duplicate multisig underlying extended public key');
  });

  it('rejects absent/zero origins and structurally contradictory xpub metadata', () => {
    const path = "m/84'/1'/0'";
    const xpub = accountXpub(path, 14);
    expect(() => parseCanonicalDescriptor(`wpkh(${xpub}/0/*)`))
      .toThrow('Invalid descriptor key expression');
    expect(() => parseCanonicalDescriptor(`wpkh([00000000/${path.slice(2)}]${xpub}/0/*)`))
      .toThrow('fingerprint must be nonzero');
    expect(() => parseCanonicalDescriptor(`wpkh([aabbccdd/84'/1'/1']${xpub}/0/*)`))
      .toThrow('child number does not match descriptor origin');
    expect(() => parseCanonicalDescriptor(`wpkh([aabbccdd/84'/1']${xpub}/0/*)`))
      .toThrow('canonical account path');
    expect(() => parseCanonicalDescriptor(`wpkh([aabbccdd/84'/0'/0']${xpub}/0/*)`))
      .toThrow('xpub network does not match derivation path coin type');
  });

  it('rejects malformed extended keys and unsafe multisig thresholds', () => {
    const path = "m/48'/1'/0'/2'";
    expect(() => parseCanonicalDescriptor(
      `wsh(sortedmulti(1,[aabbccdd/${path.slice(2)}]tpub111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111/0/*,[11223344/${path.slice(2)}]${accountXpub(path, 18)}/0/*))`,
    )).toThrow('Invalid extended public key encoding');

    const first = key(path, 19, '0/*', '11111111');
    const second = key(path, 20, '0/*', '22222222');
    expect(() => parseCanonicalDescriptor(`wsh(sortedmulti(3,${first},${second}))`))
      .toThrow('Multisig quorum cannot exceed signer count');
    expect(() => parseCanonicalDescriptor(`wsh(sortedmulti(1,${first}))`))
      .toThrow('Multisig descriptors require at least two signers');
    expect(() => parseCanonicalDescriptor(`wsh(sortedmulti(9007199254740993,${first},${second}))`))
      .toThrow('Multisig quorum cannot exceed signer count');
    expect(() => parseCanonicalDescriptor(`wsh(sortedmulti(,${first},${second}))`))
      .toThrow('Could not extract quorum from multisig descriptor');
  });

  it('rejects mixed network signer sets and fixed-branch render drift', () => {
    const testPath = "m/48'/1'/0'/2'";
    const mainPath = "m/48'/0'/0'/2'";
    const descriptor = `wsh(sortedmulti(1,${[
      key(testPath, 21, '0/*', '11111111'),
      `[22222222/${mainPath.slice(2)}]${accountXpub(mainPath, 22, bitcoin.networks.bitcoin)}/0/*`,
    ].join(',')}))`;
    expect(() => parseCanonicalDescriptor(descriptor))
      .toThrow('All descriptor keys must use the same network family');

    const fixed = parseCanonicalDescriptor(`wpkh(${key("m/84'/1'/0'", 23)})`);
    expect(() => renderCanonicalDescriptor(fixed, 1))
      .toThrow('Cannot render a fixed-branch descriptor as a different branch');
  });
});
