import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedDescriptor } from '../../../../src/services/bitcoin/descriptorParser/types';
import type { RawAuditWallet } from '../../../../src/services/walletSafetyAudit/schema';

const mocks = vi.hoisted(() => ({
  parseDescriptorForImport: vi.fn(),
}));

vi.mock('../../../../src/services/bitcoin/descriptorParser', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../src/services/bitcoin/descriptorParser')>(),
  parseDescriptorForImport: mocks.parseDescriptorForImport,
}));

import { inspectDescriptorEvidence } from '../../../../src/services/walletSafetyAudit/descriptorEvidence';

const DEVICE = {
  fingerprint: 'aabbccdd',
  xpub: 'tpub-policy-key',
  derivationPath: "m/48'/1'/0'/2'",
};

function parsed(overrides: Partial<ParsedDescriptor> = {}): ParsedDescriptor {
  return {
    type: 'multi_sig',
    scriptType: 'native_segwit',
    devices: [DEVICE],
    network: 'testnet',
    isChange: false,
    quorum: 1,
    totalSigners: 1,
    ...overrides,
  };
}

function wallet(): RawAuditWallet {
  return {
    id: 'ordered-wallet',
    type: 'multi_sig',
    scriptType: 'native_segwit',
    network: 'testnet3',
    quorum: 1,
    totalSigners: 1,
    descriptor: 'wsh(multi(1,key/0/*))',
    changeDescriptor: 'wsh(multi(1,key/1/*))',
    descriptorPolicyVersion: null,
    descriptorSourceKind: null,
    sourceDescriptor: 'wsh(multi(1,key/0/*))',
    sourceChangeDescriptor: 'wsh(multi(1,key/1/*))',
    sourceDescriptorChecksum: null,
    sourceChangeDescriptorChecksum: null,
    fingerprint: 'aabbccdd',
    canonicalPolicyId: null,
    canonicalPolicyVersion: null,
  };
}

describe('ordered multisig descriptor evidence comparisons', () => {
  beforeEach(() => {
    mocks.parseDescriptorForImport.mockImplementation((value: string) => (
      parsed({ isChange: value.includes('/1/*') })
    ));
  });

  it('accepts exact ordered recovery tokens while retaining unsupported classification', () => {
    expect(inspectDescriptorEvidence(wallet()).findings).toEqual([
      'policy.ordered_multisig_unsupported',
      'signer.xpub_invalid',
    ]);
  });

  it.each([
    ['type', { type: 'single_sig' }],
    ['script type', { scriptType: 'nested_segwit' }],
    ['network', { network: 'mainnet' }],
    ['quorum', { quorum: 2 }],
    ['signer count', { totalSigners: 2 }],
    ['device count', { devices: [DEVICE, { ...DEVICE, fingerprint: 'eeff0011' }] }],
    ['missing indexed device', { devices: Array(1) }],
    ['fingerprint', { devices: [{ ...DEVICE, fingerprint: 'eeff0011' }] }],
    ['xpub', { devices: [{ ...DEVICE, xpub: 'tpub-other-key' }] }],
    ['derivation path', { devices: [{ ...DEVICE, derivationPath: "m/48'/1'/1'/2'" }] }],
  ])('rejects recovery when receive/change %s differs', (_case, changeOverrides) => {
    mocks.parseDescriptorForImport.mockImplementation((value: string) => (
      value.includes('/1/*')
        ? parsed({ isChange: true, ...changeOverrides } as Partial<ParsedDescriptor>)
        : parsed()
    ));

    expect(inspectDescriptorEvidence(wallet()).findings).toContain(
      'descriptor.provenance_unproven',
    );
  });

  it('checks parsed unsupported policy evidence against the persisted wallet identity', () => {
    const input = wallet();
    input.fingerprint = 'deadbeef';

    expect(inspectDescriptorEvidence(input).findings).toContain(
      'descriptor.policy_inconsistent',
    );
  });
});
