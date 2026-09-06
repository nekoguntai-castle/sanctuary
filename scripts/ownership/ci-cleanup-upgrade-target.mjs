import { existsSync } from 'node:fs';
import path from 'node:path';
import { canonicalJson, canonicalSha256, parseStrictJson } from './canonical-json.mjs';
import { readExternalFile, writeExternalFileAtomic } from './safe-file.mjs';

// A CI lane that upgrades from an ownership-aware source release prepares its
// coordinator with the checkout at the source commit, so the authority binds
// that commit, and declares the one candidate commit the checkout may move to
// (issue #1028). The declaration lives beside the coordinator state rather
// than inside it: the source release's own deployment session validates the
// state file against its exact field list, so the state schema must stay what
// released code expects.
const COMMIT = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const FIELDS = ['upgradeTargetVersion', 'authorityCoreDigest', 'commit', 'policyDigest'];

export function upgradeTargetPath(runtimeDirectory) {
  return path.join(path.resolve(runtimeDirectory), 'coordinator-upgrade-target.json');
}

/** The commit and ownership-contract digest a revision is bound to. */
export function authorityBinding(authority) {
  return Object.freeze({ commit: authority.checkoutCommit, policyDigest: authority.policyDigest });
}

export function boundTo(binding, revision) {
  return binding !== null && revision.commit === binding.commit
    && revision.policyDigest === binding.policyDigest;
}

export function writeUpgradeTarget({ runtimeDirectory, checkoutRoot, authorityCoreDigest, target }) {
  const record = {
    upgradeTargetVersion: 1, authorityCoreDigest,
    commit: target.commit, policyDigest: target.policyDigest,
  };
  writeExternalFileAtomic(upgradeTargetPath(runtimeDirectory), canonicalJson(record), { checkoutRoot });
  return Object.freeze(record);
}

/** The declared candidate for this coordinator state, or null when undeclared. */
export function readUpgradeTarget(state, checkoutRoot) {
  const filePath = upgradeTargetPath(state.authority.runtimeDirectory);
  if (!existsSync(filePath)) return null;
  const bytes = readExternalFile(filePath, { checkoutRoot, maxBytes: 4 * 1024 });
  const record = parseStrictJson(bytes);
  if (!canonicalJson(record).equals(bytes)
      || Object.keys(record).sort().join('\0') !== [...FIELDS].sort().join('\0')
      || record.upgradeTargetVersion !== 1
      || !COMMIT.test(record.commit ?? '') || !DIGEST.test(record.policyDigest ?? '')) {
    throw new Error('cleanup coordinator upgrade target is invalid');
  }
  if (record.authorityCoreDigest !== state.authorityCoreDigest
      || record.commit === state.authority.checkoutCommit
      || state.authority.authorityMode !== 'deployment_managed_by_subject') {
    throw new Error('cleanup coordinator upgrade target does not match its authority');
  }
  return Object.freeze({ commit: record.commit, policyDigest: record.policyDigest });
}

export function upgradeTargetDigest(runtimeDirectory, checkoutRoot) {
  const filePath = upgradeTargetPath(runtimeDirectory);
  return existsSync(filePath)
    ? canonicalSha256(parseStrictJson(readExternalFile(filePath, { checkoutRoot, maxBytes: 4 * 1024 })))
    : null;
}
