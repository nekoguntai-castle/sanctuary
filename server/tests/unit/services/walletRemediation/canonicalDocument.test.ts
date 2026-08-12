import { describe, expect, it } from 'vitest';
import {
  canonicalRemediationJson,
  remediationDigest,
  remediationProposalId,
} from '../../../../src/services/walletRemediation/canonicalDocument';

describe('canonical remediation document', () => {
  it('sorts object keys while preserving array order', () => {
    expect(canonicalRemediationJson({ z: 1, a: { d: 2, c: [3, 1] } }))
      .toBe('{"a":{"c":[3,1],"d":2},"z":1}');
    expect(remediationDigest({ b: 2, a: 1 })).toBe(remediationDigest({ a: 1, b: 2 }));
  });

  it('rejects non-JSON evidence and binds proposal ID to the digest', () => {
    expect(() => canonicalRemediationJson(undefined)).toThrow('non-JSON');
    const digest = remediationDigest({ walletId: 'wallet-1' });
    expect(remediationProposalId(digest)).toBe(`wallet-remediation-v1:${digest}`);
  });
});
