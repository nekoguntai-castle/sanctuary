import { describe, expect, it } from 'vitest';
import {
  expandCanonicalMultipathDescriptor,
  parseCanonicalDescriptor,
  renderCanonicalDescriptor,
  validateCanonicalDescriptorPair,
} from '../../../../src/services/bitcoin/descriptorParser/canonicalDescriptor';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';
import {
  VERIFIED_MULTISIG_VECTORS,
  VERIFIED_SINGLESIG_VECTORS,
} from '../../../fixtures/verified-address-vectors';

const fingerprints = ['11111111', '22222222', '33333333', '44444444', '55555555'];

const multisigBody = (
  scriptType: 'p2sh_p2wsh' | 'p2wsh',
  suffixes: readonly string[],
): string => {
  const vector = VERIFIED_MULTISIG_VECTORS.find(candidate => (
    candidate.scriptType === scriptType && candidate.totalKeys === 3
  ));
  if (!vector) throw new Error(`Missing ${scriptType} semantic vector`);
  const script = scriptType === 'p2sh_p2wsh' ? 1 : 2;
  const keys = vector.xpubs.map((xpub, index) => (
    `[${fingerprints[index]}/48h/1h/0h/${script}h]${xpub}/${suffixes[index]}`
  ));
  const inner = `sortedmulti(2,${keys.join(',')})`;
  return scriptType === 'p2wsh' ? `wsh(${inner})` : `sh(wsh(${inner}))`;
};

describe('canonical descriptor BIP389 and checksum semantics', () => {
  it.each(['p2sh_p2wsh', 'p2wsh'] as const)(
    'expands an exact %s <0;1>/* policy structurally for every signer',
    (scriptType) => {
      const source = multisigBody(scriptType, ['<0;1>/*', '<0;1>/*', '<0;1>/*']);
      const parsed = parseCanonicalDescriptor(source);
      const expanded = expandCanonicalMultipathDescriptor(source);

      expect(parsed.suffix).toEqual({ kind: 'multipath' });
      expect(expanded.receiveDescriptor.match(/\/0\/\*/g)).toHaveLength(3);
      expect(expanded.changeDescriptor.match(/\/1\/\*/g)).toHaveLength(3);
      expect(expanded.receiveDescriptor).not.toContain('<0;1>');
      expect(expanded.changeDescriptor).not.toContain('<0;1>');
      expect(renderCanonicalDescriptor(parsed)).toContain('/<0;1>/*');
    },
  );

  it.each([
    ['reversed tuple', ['<1;0>/*', '<1;0>/*', '<1;0>/*']],
    ['three-way tuple', ['<0;1;2>/*', '<0;1;2>/*', '<0;1;2>/*']],
    ['tuple without wildcard', ['<0;1>', '<0;1>', '<0;1>']],
    ['mixed tuple and branch', ['<0;1>/*', '0/*', '<0;1>/*']],
  ] as const)('rejects %s instead of approximating BIP389', (_label, suffixes) => {
    expect(() => parseCanonicalDescriptor(multisigBody('p2wsh', suffixes))).toThrow();
  });

  it('validates the checksum against the exact source bytes before path normalization', () => {
    const body = multisigBody('p2wsh', ['<0;1>/*', '<0;1>/*', '<0;1>/*']);
    const source = `${body}#${computeDescriptorChecksum(body)}`;
    const parsed = parseCanonicalDescriptor(source);

    expect(parsed.source).toBe(source);
    expect(parsed.body).toBe(body);
    expect(parsed.checksum).toBe(computeDescriptorChecksum(body));
    expect(renderCanonicalDescriptor(parsed)).toContain('/48h/1h/0h/2h]');
  });

  it('rejects a checksum copied from a byte-different normalized descriptor', () => {
    const body = multisigBody('p2wsh', ['<0;1>/*', '<0;1>/*', '<0;1>/*']);
    const normalized = body.replaceAll('h', "'");
    const mismatched = `${body}#${computeDescriptorChecksum(normalized)}`;

    expect(() => parseCanonicalDescriptor(mismatched)).toThrow('Invalid descriptor checksum');
  });

  describe('explicit receive/change pair identity', () => {
    const receive = () => multisigBody('p2wsh', ['0/*', '0/*', '0/*']);
    const change = () => multisigBody('p2wsh', ['1/*', '1/*', '1/*']);

    it('accepts a pair whose complete ordered policy differs only by branch', () => {
      const pair = validateCanonicalDescriptorPair(receive(), change());

      expect(pair.receive.suffix).toEqual({ kind: 'branch', branch: 0 });
      expect(pair.change.suffix).toEqual({ kind: 'branch', branch: 1 });
    });

    it.each([
      ['same branch', (value: string) => value.replaceAll('/1/*', '/0/*')],
      ['quorum', (value: string) => value.replace('sortedmulti(2,', 'sortedmulti(1,')],
      ['fingerprint', (value: string) => value.replace('11111111', 'aaaaaaaa')],
      ['account path', (value: string) => value.replace('48h/1h/0h/2h', '48h/1h/7h/2h')],
      ['signer count', (value: string) => value.replace(/,\[33333333[^,]+(?=\)\)$)/, '')],
      ['xpub identity', (value: string) => {
        const threeKey = VERIFIED_MULTISIG_VECTORS.find(candidate => (
          candidate.scriptType === 'p2wsh' && candidate.totalKeys === 3
        ))!;
        const fiveKey = VERIFIED_MULTISIG_VECTORS.find(candidate => (
          candidate.scriptType === 'p2wsh' && candidate.totalKeys === 5
        ))!;
        return value.replace(threeKey.xpubs[0], fiveKey.xpubs[3]);
      }],
      ['ordered signer identity', (value: string) => {
        const first = value.indexOf('[11111111');
        const separator = value.indexOf(',[22222222', first);
        const end = value.indexOf(',[33333333', separator);
        const firstKey = value.slice(first, separator);
        const secondKey = value.slice(separator + 1, end);
        return `${value.slice(0, first)}${secondKey},${firstKey}${value.slice(end)}`;
      }],
    ] as const)('rejects pair drift in %s', (_label, mutateChange) => {
      expect(() => validateCanonicalDescriptorPair(receive(), mutateChange(change()))).toThrow();
    });

    it('rejects an explicit pair containing a multipath side', () => {
      const multipath = multisigBody('p2wsh', ['<0;1>/*', '<0;1>/*', '<0;1>/*']);

      expect(() => validateCanonicalDescriptorPair(multipath, change())).toThrow(
        'Explicit descriptor pair must use fixed receive and change branches',
      );
    });

    it('rejects wrapper drift between otherwise valid multisig policies', () => {
      const nestedChange = multisigBody('p2sh_p2wsh', ['1/*', '1/*', '1/*']);

      expect(() => validateCanonicalDescriptorPair(receive(), nestedChange)).toThrow();
    });

    it('rejects network drift between otherwise valid single-sig policies', () => {
      const descriptor = (network: 'mainnet' | 'testnet', branch: 0 | 1): string => {
        const vector = VERIFIED_SINGLESIG_VECTORS.find(candidate => (
          candidate.scriptType === 'native_segwit'
          && candidate.network === network
          && candidate.index === 0
          && candidate.change === Boolean(branch)
        ))!;
        const path = vector.path.slice(2);
        return `wpkh([aabbccdd/${path}]${vector.xpub}/${branch}/*)`;
      };

      expect(() => validateCanonicalDescriptorPair(
        descriptor('mainnet', 0),
        descriptor('testnet', 1),
      )).toThrow();
    });
  });
});
