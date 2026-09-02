import { canonicalSha256 } from './canonical-json.mjs';
import {
  inspectCleanupEntry, inspectCleanupProcess, removeCleanupEntry, removeCleanupWorktree,
  stopCleanupProcess,
} from './cleanup-safe-helper.mjs';
import { verifyCleanupHostAuthority } from './cleanup-host-authority.mjs';

function mutationFromState(result) {
  if (['removed', 'exited', 'absent'].includes(result.state)) return { outcome: 'success' };
  if (result.state === 'timeout') return { outcome: 'timeout' };
  if (result.state === 'unsupported') return { outcome: 'not_started', refusalClass: 'unsupported' };
  if (result.state === 'identity_changed') return { outcome: 'not_started', refusalClass: 'identity_changed' };
  if (result.state === 'refused') return { outcome: 'not_started', refusalClass: 'permission_denied' };
  return { outcome: 'unknown' };
}

function postcondition(registration, state) {
  return canonicalSha256({
    policy: 'sanctuary.cleanup-host-postcondition.v1',
    registrationId: registration.registrationId,
    resourceClass: registration.resourceClass,
    immutableIdentity: registration.immutableIdentity,
    state,
  });
}

function reconciliation(registration, result) {
  if (['absent', 'exited', 'removed'].includes(result.state)) return {
    state: 'absent', postconditionDigest: postcondition(registration, 'absent'), failureClass: 'none',
  };
  if (result.state === 'identity_changed') return {
    state: 'refused', postconditionDigest: null, failureClass: 'identity_changed',
  };
  if (result.state === 'unsupported') return {
    state: 'refused', postconditionDigest: null, failureClass: 'unsupported',
  };
  if (result.state === 'current') return {
    state: 'refused', postconditionDigest: null, failureClass: 'postcondition_failed',
  };
  return { state: 'ambiguous', postconditionDigest: null, failureClass: 'query_failed' };
}

function helper(authority) {
  const verified = verifyCleanupHostAuthority(authority);
  if (!verified?.available) throw Object.assign(new Error('host helper unavailable'), { code: 'ENOSYS' });
  return verified;
}

function invocationOptions(authority) {
  return { expectedHelperDigest: authority.helperDigest };
}

function mutateProcess(authority, registration) {
  return stopCleanupProcess(
    authority.helperPath, registration.executionAuthority, invocationOptions(authority),
  );
}

function mutatePath(authority, registration, intentCheckpointDigest) {
  const remove = registration.resourceClass === 'git_worktree'
    ? removeCleanupWorktree : removeCleanupEntry;
  return remove(
    authority.helperPath, registration.executionAuthority, intentCheckpointDigest,
    invocationOptions(authority),
  );
}

function inspect(authority, registration) {
  return registration.resourceClass === 'collector_process'
    ? inspectCleanupProcess(
      authority.helperPath, registration.executionAuthority, invocationOptions(authority),
    )
    : inspectCleanupEntry(
      authority.helperPath, registration.executionAuthority, invocationOptions(authority),
    );
}

/** Exact host operations; the caller owns the signed intent and registration fence. */
export function createCleanupHostOperations({ helperAuthority }) {
  return Object.freeze({
    mutate: async ({ registration, intentCheckpointDigest, signal }) => {
      if (signal?.aborted) return { outcome: 'cancelled' };
      try {
        const authority = helper(helperAuthority);
        const result = registration.resourceClass === 'collector_process'
          ? mutateProcess(authority, registration)
          : mutatePath(authority, registration, intentCheckpointDigest);
        return mutationFromState(result);
      } catch (error) {
        if (signal?.aborted) return { outcome: 'cancelled' };
        return error?.code === 'ENOSYS'
          ? { outcome: 'not_started', refusalClass: 'unsupported' } : { outcome: 'unknown' };
      }
    },
    reconcile: async ({ registration, mutationOutcome, intentCheckpointDigest }) => {
      try {
        const authority = helper(helperAuthority);
        if (mutationOutcome === 'unknown'
            && ['git_worktree', 'temporary_artifact'].includes(registration.resourceClass)) {
          return reconciliation(
            registration, mutatePath(authority, registration, intentCheckpointDigest),
          );
        }
        return reconciliation(registration, inspect(authority, registration));
      } catch (error) {
        return {
          state: error?.code === 'ENOSYS' ? 'refused' : 'ambiguous',
          postconditionDigest: null,
          failureClass: error?.code === 'ENOSYS' ? 'unsupported' : 'query_failed',
        };
      }
    },
  });
}
