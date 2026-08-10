import { describe, expect, it } from 'vitest';
import { prepareDescriptorPolicy } from '../../../../src/services/wallet/descriptorPolicy';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';

const XPUB = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
const receive = `wpkh([aabbccdd/84'/0'/0']${XPUB}/0/*)`;
const change = `wpkh([aabbccdd/84'/0'/0']${XPUB}/1/*)`;

describe('prepareDescriptorPolicy', () => {
  it('preserves an exact imported pair and canonical branch descriptors', () => {
    expect(prepareDescriptorPolicy({
      receiveDescriptor: receive,
      changeDescriptor: change,
      sourceKind: 'imported',
    })).toEqual({
      descriptor: receive,
      changeDescriptor: change,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'imported_pair',
      sourceDescriptor: receive,
      sourceChangeDescriptor: change,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
    });
  });

  it('preserves exact supplied checksums while runtime descriptors omit them', () => {
    const receiveChecksum = computeDescriptorChecksum(receive);
    const changeChecksum = computeDescriptorChecksum(change);
    const sourceReceive = `${receive}#${receiveChecksum}`;
    const sourceChange = `${change}#${changeChecksum}`;

    const policy = prepareDescriptorPolicy({
      receiveDescriptor: sourceReceive,
      changeDescriptor: sourceChange,
      sourceKind: 'imported',
    });

    expect(policy.descriptor).toBe(receive);
    expect(policy.changeDescriptor).toBe(change);
    expect(policy.sourceDescriptor).toBe(sourceReceive);
    expect(policy.sourceChangeDescriptor).toBe(sourceChange);
    expect(policy.sourceDescriptorChecksum).toBe(receiveChecksum);
    expect(policy.sourceChangeDescriptorChecksum).toBe(changeChecksum);
  });

  it('expands only the supported BIP389 receive/change range', () => {
    const multipath = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*)`;
    const policy = prepareDescriptorPolicy({
      receiveDescriptor: multipath,
      sourceKind: 'imported',
    });

    expect(policy.descriptor).toBe(receive);
    expect(policy.changeDescriptor).toBe(change);
    expect(policy.descriptorSourceKind).toBe('imported_multipath');
    expect(policy.sourceDescriptor).toBe(multipath);
    expect(policy.sourceChangeDescriptor).toBeNull();
  });

  it('validates the checksum over BIP389 multipath characters', () => {
    const multipath = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*)`;
    expect(computeDescriptorChecksum(multipath)).toBe('zxdtqh60');

    expect(prepareDescriptorPolicy({
      receiveDescriptor: `${multipath}#zxdtqh60`,
      sourceKind: 'imported',
    }).sourceDescriptorChecksum).toBe('zxdtqh60');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: `${multipath}#aaaaaaaa`,
      sourceKind: 'imported',
    })).toThrow('Invalid descriptor checksum');
  });

  it.each([
    ['a receive-only descriptor', receive],
    ['a reversed range', `wpkh([aabbccdd/84'/0'/0']${XPUB}/<1;0>/*)`],
    ['an expanded range', `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1;2>/*)`],
  ])('rejects %s', (_label, descriptor) => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: descriptor,
      sourceKind: 'imported',
    })).toThrow();
  });

  it('rejects mismatched receive/change wallets', () => {
    const otherChange = change.replace('aabbccdd', '11223344');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: receive,
      changeDescriptor: otherChange,
      sourceKind: 'imported',
    })).toThrow('same wallet policy');
  });

  it('rejects a descriptor pair with reversed branch roles', () => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: change,
      changeDescriptor: receive,
      sourceKind: 'imported',
    })).toThrow('receive branch 0 and change branch 1');
  });

  it('rejects unsupported ranges alongside the supported receive/change range', () => {
    const unsupported = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*<2;3>)`;
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: unsupported,
      sourceKind: 'imported',
    })).toThrow('Only BIP389 <0;1>/* multipath descriptors are supported');
  });

  it('rejects multipath syntax in an explicit descriptor pair', () => {
    const multipath = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*)`;
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: multipath,
      changeDescriptor: change,
      sourceKind: 'imported',
    })).toThrow('Explicit descriptor pairs cannot contain multipath ranges');
  });

  it('requires generated policies to provide an explicit change descriptor', () => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: receive,
      sourceKind: 'generated_pair',
    })).toThrow('Generated wallet policy requires receive and change descriptors');
  });

  it('rejects legacy multisig policies', () => {
    const legacyReceive = `sh(sortedmulti(1,[aabbccdd/45'/0']${XPUB}/0/*))`;
    const legacyChange = legacyReceive.replace('/0/*)', '/1/*)');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: legacyReceive,
      changeDescriptor: legacyChange,
      sourceKind: 'imported',
    })).toThrow('Legacy multisig descriptors are not supported');
  });

  it('rejects Taproot multisig policies', () => {
    const taprootReceive = `tr(sortedmulti(1,[aabbccdd/48'/0'/0'/3']${XPUB}/0/*))`;
    const taprootChange = taprootReceive.replace('/0/*)', '/1/*)');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: taprootReceive,
      changeDescriptor: taprootChange,
      sourceKind: 'imported',
    })).toThrow('Taproot script-tree descriptors are not supported');
  });

  it('rejects the unverified all-zero master-fingerprint sentinel', () => {
    const unverifiedReceive = receive.replace('aabbccdd', '00000000');
    const unverifiedChange = change.replace('aabbccdd', '00000000');

    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: unverifiedReceive,
      changeDescriptor: unverifiedChange,
      sourceKind: 'imported',
    })).toThrow('nonzero BIP32 master fingerprint');
  });

  it('rejects ordered multisig before normalization', () => {
    const ordered = `wsh(multi(1,[aabbccdd/48'/0'/0'/2']${XPUB}/0/*))`;
    const orderedChange = ordered.replace('/0/*)', '/1/*)');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: ordered,
      changeDescriptor: orderedChange,
      sourceKind: 'imported',
    })).toThrow('Ordered multi');
  });

  it('rejects Taproot script trees until derivation supports their scripts exactly', () => {
    const scriptTree = `tr([aabbccdd/86'/0'/0']${XPUB}/0/*,pk([11223344/86'/0'/0']${XPUB}/0/*))`;
    const scriptTreeChange = scriptTree.replaceAll('/0/*', '/1/*');

    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: scriptTree,
      changeDescriptor: scriptTreeChange,
      sourceKind: 'imported',
    })).toThrow('Taproot script-tree');
  });

  it('rejects surrounding bytes instead of silently trimming provenance', () => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: ` ${receive}`,
      changeDescriptor: change,
      sourceKind: 'imported',
    })).toThrow('exact non-empty descriptor token');
  });
});
