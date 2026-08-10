import { describe, expect, it } from 'vitest';

import { assertExactConsensus } from '../../scripts/verify-addresses/generate-vectors';
import { generateDerivationTestCases } from '../../scripts/verify-addresses/testCases';
import type { AccountKeyEvidence, DerivationEvidence } from '../../scripts/verify-addresses/types';

const testCase = generateDerivationTestCases()[0];
const key: AccountKeyEvidence = {
  seedId: testCase.seedIds[0],
  masterFingerprint: '73c5da0a',
  originPath: testCase.accountPath,
  encoded: 'xpub-evidence',
  versionHex: '0488b21e',
  depth: 3,
  parentFingerprint: '155bca59',
  childNumber: 0x80000000,
  chainCodeHex: '11'.repeat(32),
  publicKeyHex: `02${'22'.repeat(32)}`,
  payloadHex: '00'.repeat(74),
};

function results(): DerivationEvidence[] {
  return [
    { caseId: testCase.id, implementation: 'Bitcoin Core', implementationVersion: '29.0.0', evidenceScope: 'root-private-descriptor-to-output', accountKeys: [], address: 'address', scriptPubKeyHex: '0014' },
    { caseId: testCase.id, implementation: 'bitcoinjs-lib', implementationVersion: '7.0.1', evidenceScope: 'seed-to-account-and-output', accountKeys: [key], address: 'address', scriptPubKeyHex: '0014' },
    { caseId: testCase.id, implementation: 'bip_utils (Python)', implementationVersion: '2.12.1', evidenceScope: 'seed-to-account-and-output', accountKeys: [key], address: 'address', scriptPubKeyHex: '0014' },
    { caseId: testCase.id, implementation: 'btcd/btcutil (Go)', implementationVersion: '0.25.0', evidenceScope: 'seed-to-account-and-output', accountKeys: [key], address: 'address', scriptPubKeyHex: '0014' },
  ];
}

describe('address verifier consensus anti-vacuity', () => {
  it('accepts exact four-way address/script and three-way seed evidence agreement', () => {
    expect(() => assertExactConsensus(testCase, results())).not.toThrow();
  });

  it.each([
    ['missing implementation', (items: DerivationEvidence[]) => items.slice(1)],
    ['duplicate implementation identity', (items: DerivationEvidence[]) => {
      items[3] = { ...items[3], implementation: items[2].implementation };
      return items;
    }],
    ['mislabeled case evidence', (items: DerivationEvidence[]) => {
      items[3] = { ...items[3], caseId: 'other-case' };
      return items;
    }],
    ['address drift', (items: DerivationEvidence[]) => { items[3] = { ...items[3], address: 'other' }; return items; }],
    ['script drift', (items: DerivationEvidence[]) => { items[2] = { ...items[2], scriptPubKeyHex: '0015' }; return items; }],
    ['account metadata drift', (items: DerivationEvidence[]) => {
      items[1] = { ...items[1], accountKeys: [{ ...key, childNumber: 1 }] };
      return items;
    }],
    ['missing seed evidence', (items: DerivationEvidence[]) => { items[2] = { ...items[2], accountKeys: [] }; return items; }],
    ['false Core account evidence', (items: DerivationEvidence[]) => { items[0] = { ...items[0], accountKeys: [key] }; return items; }],
  ] as const)('rejects %s', (_label, mutate) => {
    expect(() => assertExactConsensus(testCase, mutate(results()))).toThrow();
  });
});
