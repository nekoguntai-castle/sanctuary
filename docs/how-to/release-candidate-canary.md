# Release candidate canary

Use this runbook after the exact release-candidate tag has passed its Forgejo
release gates and before creating the stable tag. The canary receipt is a small,
strict, redacted attestation. It is not a support bundle or a substitute for the
underlying private operational evidence.

## Keep the receipt outside Git

Choose an absolute operator-controlled path outside every Sanctuary checkout:

```bash
CANARY_RECEIPT="$HOME/release-receipts/v0.8.69-rc1-canary.json"
CANARY_EVIDENCE="$HOME/release-receipts/v0.8.69-rc1-canary.jsonl"
```

Never put the receipt or raw evidence sidecar, support bundles, logs, screenshots, wallet names, wallet
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
5. Observe the durable live progress event for `preflight`, observe worker
   diagnostics during `address_history`, confirm Redis lock agreement, and
   confirm the terminal active total returns to zero. `preflight` is synchronous
   and can complete between diagnostics samples, so its live progress event is
   the deterministic evidence boundary.
6. Confirm active-stage age and every wallet-sync counter family is exposed.
7. Observe the bounded first candidate batch advance from `1` through at most
   `25` of the positive observed total, or reach an explicit retryable/fatal
   outcome inside its budget and grace. A silent hang fails.
8. Reconcile every wallet to success, retrying, or action required. Record a
   concrete reason for every action-required wallet in the private operational
   evidence, but put only the reconciled reason count in the receipt. Confirm the
   repeated stale wallet is not stranded, then record completion and signoff.

## Receipt and raw-evidence format

Version 0.8.69 requires `sanctuary.release-candidate-canary.v2`. All keys are
required and no additional keys are allowed. The bounded receipt contains only
redacted summaries; write timestamped probe, cgroup, Docker, lifecycle, and UI
events to the private JSONL sidecar and bind its exact bytes into `rawEvidence`.
The validator retains v1 compatibility for older releases, but a v1 receipt
cannot authorize v0.8.69.

```json
{
  "schemaVersion": "sanctuary.release-candidate-canary.v2",
  "releaseCandidate": {
    "tag": "v0.8.69-rc1",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "imageIds": ["sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]
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
    "liveSyncLogObserved": true,
    "preflightObserved": true
  },
  "diagnosticsEvidence": {
    "versionsObserved": [1, 2],
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
    "candidateBatch": { "startCompleted": 1, "endCompleted": 25, "total": 69 },
    "outcome": "advanced",
    "withinBudgetAndGrace": true,
    "silentHang": false
  },
  "remoteEvidence": {
    "probeWindowMs": 600000,
    "postTerminalWindowMs": 300000,
    "endpoints": {
      "live": { "samples": 600, "postTerminalSamples": 300, "failures": 0, "p99Ms": 125, "maxMs": 500 },
      "ready": { "samples": 600, "postTerminalSamples": 300, "failures": 0, "p99Ms": 125, "maxMs": 500 },
      "metricsPrometheus": { "samples": 600, "postTerminalSamples": 300, "failures": 0, "p99Ms": 125, "maxMs": 500 }
    },
    "runtime": {
      "peakBytes": 670466048,
      "memoryLimitBytes": 1073741824,
      "oomKilled": false,
      "restartCount": 0,
      "exitCode": 0,
      "fallbackCount": 0
    },
    "lifecycle": {
      "leaseLockAgreement": true,
      "leasesAndLocksCleared": true,
      "generationsConverged": true,
      "formerlyStaleRepeatConverged": true,
      "uiHealthyThroughoutPostTerminal": true
    },
    "rawEvidence": {
      "sha256": "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "bytes": 1024
    }
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
For v2 receipts, `preflightObserved` comes from the live
`sync_phase_progress` event. The candidate total is the actual positive total
reported by that fleet, capped by the runtime progress contract at 1,000,000;
the first bounded batch starts at 1 and cannot exceed 25 or that total.
Each endpoint needs at least 60 pre-terminal samples plus 300 post-terminal
samples, zero failures, p99 no greater than 250 ms, and maximum latency no
greater than the one-second timeout. The post-terminal window must be at least
five minutes, the overall probe window must include both periods, and the canary
timestamps must cover the claimed probe window.
The runtime and lifecycle summaries are strict acceptance assertions, and the
sidecar SHA-256 and byte length must match the safely opened external file.

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
  --evidence "$CANARY_EVIDENCE" \
  --tag "$ACCEPTED_RC_TAG" \
  --commit "$ACCEPTED_RC_SHA"
```

Only `Release-candidate canary receipt: accepted.` permits stable tagging. Any
schema, identity, evidence, timestamp, fleet reconciliation, path, or signoff
failure stops promotion. Fix a failed candidate through a protected PR and use
the next RC number; never move or delete the failed RC tag.
