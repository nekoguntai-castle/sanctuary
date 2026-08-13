import { createHash } from 'node:crypto';

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalize(record[key])}`
    )).join(',')}}`;
  }
  throw new Error('Remediation evidence contains a non-JSON value');
}

export function canonicalRemediationJson(value: unknown): string {
  return canonicalize(value);
}

export function remediationDigest(value: unknown): string {
  return createHash('sha256').update(canonicalRemediationJson(value)).digest('hex');
}

export function remediationProposalId(digest: string): string {
  return `wallet-remediation-v1:${digest}`;
}

export function remediationProofDigest(
  document: object & { proofDigest?: string },
): string {
  const {
    proofDigest: _proofDigest,
    attemptId: _attemptId,
    proposalId: _proposalId,
    proposalDigest: _proposalDigest,
    createdAt: _createdAt,
    state: _state,
    appliedAt: _appliedAt,
    backout: _backout,
    ...proofDocument
  } = document as Record<string, unknown>;
  return remediationDigest(proofDocument);
}
