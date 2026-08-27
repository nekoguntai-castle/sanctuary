# Release candidate canary

Use this runbook after the exact release-candidate tag has passed its Forgejo
release gates and before creating the stable tag. The canary receipt is a small,
strict, redacted attestation. It is not a support bundle or a substitute for the
underlying private operational evidence.

## Keep the receipt outside Git

Choose an absolute operator-controlled path outside every Sanctuary checkout:

```bash
CANARY_RECEIPT="$HOME/release-receipts/v0.8.69-rc1-canary.json"
```

Never put the receipt, support bundles, logs, screenshots, wallet names, wallet
IDs, addresses, transaction IDs, endpoints, credentials, or operator names in
the repository. Use a short pseudonymous role identifier such as
`release-operator-01` for signoff. The validator rejects unknown fields and
symlinked, relative, oversized, or in-checkout receipt paths.

## Exercise the exact candidate

1. Confirm the deployed tag and full commit SHA match the accepted RC.
2. On the affected instance with at least 12 wallets, record the redacted fleet
   total before the exercise.
3. Run one complete all-wallet sync and one repeat sync of a previously stale
   wallet.
4. Observe phase names, live stage time, known address/candidate/batch counts,
   and live Sync Log rows.
5. Observe worker diagnostics during `preflight` and `address_history`, confirm
   Redis lock agreement, and confirm the terminal active total returns to zero.
6. Confirm active-stage age and every wallet-sync counter family is exposed.
7. Observe a candidate batch in the `1-25/100` range advance or reach an explicit
   retryable/fatal outcome inside its budget and grace. A silent hang fails.
8. Reconcile every wallet to success, retrying, or action required. Record a
   concrete reason for every action-required wallet in the private operational
   evidence, but put only the reconciled reason count in the receipt. Confirm the
   repeated stale wallet is not stranded, then record completion and signoff.

## Receipt format

The only accepted schema is `sanctuary.release-candidate-canary.v1`. All keys are
required and no additional keys are allowed.

```json
{
  "schemaVersion": "sanctuary.release-candidate-canary.v1",
  "releaseCandidate": {
    "tag": "v0.8.69-rc1",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  },
  "canaryWindow": {
    "startedAt": "2026-08-27T09:00:00.000Z",
    "completedAt": "2026-08-27T10:00:00.000Z"
  },
  "fleet": {
    "total": 12,
    "outcomes": { "success": 10, "retrying": 1, "actionRequired": 1 },
    "actionRequiredWithExplicitReason": 1,
    "previouslyStaleRepeat": { "outcome": "success", "stranded": false }
  },
  "progressEvidence": {
    "phaseObserved": true,
    "liveElapsedObserved": true,
    "knownCountsObserved": {
      "addresses": true,
      "candidates": true,
      "batches": true
    },
    "liveSyncLogObserved": true
  },
  "diagnosticsEvidence": {
    "versionsObserved": [1, 2],
    "preflightActiveObserved": true,
    "addressHistoryActiveObserved": true,
    "redisLockAgreementObserved": true,
    "terminalActiveTotal": 0
  },
  "metricEvidence": {
    "activeStageAgeObserved": true,
    "counterFamiliesObserved": [
      "abort_grace_exhausted",
      "budget_expiry",
      "candidates",
      "cleanup",
      "fallback",
      "lock_loss",
      "terminal"
    ]
  },
  "boundedErrorEvidence": {
    "candidateBatch": { "startCompleted": 1, "endCompleted": 25, "total": 100 },
    "outcome": "advanced",
    "withinBudgetAndGrace": true,
    "silentHang": false
  },
  "signoff": {
    "decision": "accepted",
    "signedAt": "2026-08-27T10:30:00.000Z",
    "operatorId": "release-operator-01"
  }
}
```

`previouslyStaleRepeat.outcome` is one of `success`, `retrying`, or
`action_required`. `boundedErrorEvidence.outcome` is `advanced`, `retryable`, or
`fatal`. Diagnostics version 2 and the complete fixed counter-family set are
mandatory. Fleet outcome counts must equal `fleet.total`.
`actionRequiredWithExplicitReason` must exactly equal the action-required
outcome count; free-form reasons remain only in the private evidence.

## Validate before stable tagging

Freshly fetch the refs and derive the identity from the accepted RC tag. The
release command must separately prove that this commit is on `origin/main`.

```bash
git fetch origin --tags --prune
ACCEPTED_RC_TAG=v0.8.69-rc1
ACCEPTED_RC_SHA="$(git rev-list -n1 "$ACCEPTED_RC_TAG")"
git merge-base --is-ancestor "$ACCEPTED_RC_SHA" origin/main

node scripts/release/verify-release-candidate-canary.mjs \
  --repo "$(pwd)" \
  --receipt "$CANARY_RECEIPT" \
  --tag "$ACCEPTED_RC_TAG" \
  --commit "$ACCEPTED_RC_SHA"
```

Only `Release-candidate canary receipt: accepted.` permits stable tagging. Any
schema, identity, evidence, timestamp, fleet reconciliation, path, or signoff
failure stops promotion. Fix a failed candidate through a protected PR and use
the next RC number; never move or delete the failed RC tag.
