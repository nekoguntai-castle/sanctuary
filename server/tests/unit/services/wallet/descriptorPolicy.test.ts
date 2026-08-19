import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';
import {
  prepareDescriptorPolicy,
  prepareRecoveredLegacyDescriptorPolicy,
} from '../../../../src/services/wallet/descriptorPolicy';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';

const XPUB = bip32.fromSeed(Buffer.alloc(32, 7), bitcoin.networks.bitcoin)
  .derivePath("m/84'/0'/0'")
  .neutered()
  .toBase58();
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

    expect(policy.descriptor).toBe(receive.replaceAll("'", 'h'));
    expect(policy.changeDescriptor).toBe(change.replaceAll("'", 'h'));
    expect(policy.descriptorSourceKind).toBe('imported_multipath');
    expect(policy.sourceDescriptor).toBe(multipath);
    expect(policy.sourceChangeDescriptor).toBeNull();
  });

  it('validates the checksum over BIP389 multipath characters', () => {
    const multipath = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*)`;
    const checksum = computeDescriptorChecksum(multipath);

    expect(prepareDescriptorPolicy({
      receiveDescriptor: `${multipath}#${checksum}`,
      sourceKind: 'imported',
    }).sourceDescriptorChecksum).toBe(checksum);
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
    })).toThrow('differ only by branch');
  });

  it('rejects a descriptor pair with reversed branch roles', () => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: change,
      changeDescriptor: receive,
      sourceKind: 'imported',
    })).toThrow('Receive descriptor must use branch 0');
  });

  it('rejects unsupported ranges alongside the supported receive/change range', () => {
    const unsupported = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*<2;3>)`;
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: unsupported,
      sourceKind: 'imported',
    })).toThrow('must end in /0/*, /1/*, or /<0;1>/*');
  });

  it('rejects multipath syntax in an explicit descriptor pair', () => {
    const multipath = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*)`;
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: multipath,
      changeDescriptor: change,
      sourceKind: 'imported',
    })).toThrow('fixed receive and change branches');
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
    })).toThrow('Unsupported descriptor format');
  });

  it('rejects Taproot multisig policies', () => {
    const taprootReceive = `tr(sortedmulti(1,[aabbccdd/48'/0'/0'/3']${XPUB}/0/*))`;
    const taprootChange = taprootReceive.replace('/0/*)', '/1/*)');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: taprootReceive,
      changeDescriptor: taprootChange,
      sourceKind: 'imported',
    })).toThrow();
  });

  it('rejects the unverified all-zero master-fingerprint sentinel', () => {
    const unverifiedReceive = receive.replace('aabbccdd', '00000000');
    const unverifiedChange = change.replace('aabbccdd', '00000000');

    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: unverifiedReceive,
      changeDescriptor: unverifiedChange,
      sourceKind: 'imported',
    })).toThrow('fingerprint must be nonzero');
  });

  it('rejects ordered multisig before normalization', () => {
    const ordered = `wsh(multi(1,[aabbccdd/48'/0'/0'/2']${XPUB}/0/*))`;
    const orderedChange = ordered.replace('/0/*)', '/1/*)');
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: ordered,
      changeDescriptor: orderedChange,
      sourceKind: 'imported',
    })).toThrow('Unsupported descriptor format');
  });

  it('rejects Taproot script trees until derivation supports their scripts exactly', () => {
    const scriptTree = `tr([aabbccdd/86'/0'/0']${XPUB}/0/*,pk([11223344/86'/0'/0']${XPUB}/0/*))`;
    const scriptTreeChange = scriptTree.replaceAll('/0/*', '/1/*');

    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: scriptTree,
      changeDescriptor: scriptTreeChange,
      sourceKind: 'imported',
    })).toThrow();
  });

  it('rejects surrounding bytes instead of silently trimming provenance', () => {
    expect(() => prepareDescriptorPolicy({
      receiveDescriptor: ` ${receive}`,
      changeDescriptor: change,
      sourceKind: 'imported',
    })).toThrow('exact non-empty descriptor token');
  });

});

describe('recovered legacy descriptor policy', () => {
  // Canonical descriptors render hardened steps as `h` (shared/utils/bitcoin formats
  // descriptor paths that way), unlike address derivation paths which use apostrophes.
  const RECEIVE = receive.replace(/'/g, 'h');
  const CHANGE = change.replace(/'/g, 'h');

  it('derives the change descriptor and records the stored token as its own source', () => {
    const prepared = prepareRecoveredLegacyDescriptorPolicy(RECEIVE);

    expect(prepared).toEqual({
      descriptor: RECEIVE,
      changeDescriptor: CHANGE,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'recovered_legacy',
      // Pinned equal to the descriptor: the CHECK constraint enforces this, so recovery
      // can never introduce descriptor bytes the wallet did not already hold.
      sourceDescriptor: RECEIVE,
      sourceChangeDescriptor: null,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
    });
  });

  it('refuses a validly checksummed descriptor rather than stripping it', () => {
    // A real checksum, so parsing succeeds and the checksum guard is what rejects it.
    // The descriptor column is frozen once a policy is assigned, so a token that would
    // need rewriting can never be reconciled afterwards.
    const checksummed = `${RECEIVE}#${computeDescriptorChecksum(RECEIVE)}`;

    expect(() => prepareRecoveredLegacyDescriptorPolicy(checksummed))
      .toThrow(/checksum/i);
  });

  it('refuses a descriptor that is not already canonical', () => {
    // Apostrophe form is a valid descriptor but not the canonical rendering, and the
    // descriptor column is frozen once a policy is assigned, so it must be blocked
    // rather than silently normalised.
    expect(() => prepareRecoveredLegacyDescriptorPolicy(receive))
      .toThrow(/canonical/i);
  });

  it('refuses an empty or untrimmed token', () => {
    expect(() => prepareRecoveredLegacyDescriptorPolicy(' '))
      .toThrow('exact non-empty descriptor token');
  });

  it('refuses a descriptor that is not a receive branch', () => {
    expect(() => prepareRecoveredLegacyDescriptorPolicy(CHANGE))
      .toThrow(/branch|Invalid/i);
  });
});
