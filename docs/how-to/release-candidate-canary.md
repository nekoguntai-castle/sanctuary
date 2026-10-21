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

## Tooling

The drivers live in `scripts/release/canary/` and run on the deployment host,
not in CI:

| Tool | Mutates? | Use |
| --- | --- | --- |
| `canary-selftest.mjs` | no | Pre-flight. Prints one JSON object covering container discovery, admin token minting, worker diagnostics, status and latency of the worker's `/live`, `/ready` and `/metrics/prometheus`, the worker metrics scrape, fleet truth, the UI and cgroup readability. Run it before opening a canary window. `CANARY_SELFTEST_SAMPLES` adds a bounded sampling mode (see below). |
| `canary-probe.mjs` | yes | The canary itself. Drives the exercise below and writes `evidence.jsonl` plus the receipt into `CANARY_OUT_DIR`. |
| `canary-debug.mjs` | yes | Diagnosis only. POSTs a real sync for the least-recently-synced mainnet wallet and prints the raw responses. Never run it inside a canary window. |

All three read `JWT_SECRET` and `WORKER_DIAGNOSTICS_SECRET` from the runtime env
file at run time and never persist them. They share `lib/canary-runtime.mjs`;
`npm run lint:release-canary` covers them, and
`tests/release/canary-probe-tooling.test.mjs` pins their invariants.

```bash
CANARY_TAG=v0.8.71-rc7 \
CANARY_COMMIT=<40-hex> \
CANARY_OUT_DIR="$HOME/release-receipts/v0.8.71-rc7" \
  node scripts/release/canary/canary-probe.mjs
```

### Worker endpoints and the selftest sampling mode

The probe samples the **worker**, not the backend: the receipt's `live`,
`ready` and `metricsPrometheus` endpoint summaries come from the worker's
`/live`, `/ready` and `/metrics/prometheus`, and so do the counter families,
the active-stage age and the fallback delta (`wallet_sync_fallback_total` is
counted only in the worker). Before arming, the probe tries every worker
container IP and uses the first whose `/live` answers 200; it exits 2 if none
does. The selftest discovers the worker the same way.

Run without knobs, the selftest takes one idle sample and reports status and
latency for the three worker endpoints without gating them. It exits 2 only
when the backend or every worker IP fails `/live`, and 0 otherwise.

To check the receipt's latency gates before a canary, run the bounded,
read-only sampling mode **during a scheduled sync**. It starts no sync itself.

```bash
CANARY_SELFTEST_SAMPLES=300 node scripts/release/canary/canary-selftest.mjs
```

| Knob | Default | Meaning |
| --- | --- | --- |
| `CANARY_SELFTEST_SAMPLES` | unset (single sample) | Endpoint samples to take; capped at 900. A window that the 900 s deadline ends before it takes them all is invalid (exit 3). |
| `CANARY_SELFTEST_INTERVAL_MS` | `1000` | Pause between endpoint samples. |

While it samples, the selftest polls worker diagnostics every 250 ms, as the
probe does during a sync. A window counts only if at least **40 diagnostics
samples** saw an active sync (`activeTotal > 0`). The window runs past the
requested sample count until it sees 40, for at most **900 s**. The result is
in the `sampling` key of the JSON output and is judged against the receipt
gates for each worker endpoint: 0 failures, p99 at most 250 ms and max at most
1000 ms.

| Exit | Meaning |
| --- | --- |
| 0 | Valid window; every endpoint met every gate. |
| 1 | Valid window; an endpoint missed a gate (see `sampling.gates.<endpoint>.missed`). |
| 2 | Bad knob value, or the backend or every worker IP failed `/live`. |
| 3 | Invalid window: fewer than the requested endpoint samples, or fewer than 40 active diagnostics samples, within 900 s (see `sampling.invalidReason`). |

If `sampling.invalidReason` reports fewer endpoint samples than requested,
the samples and interval do not fit in 900 s: lower `CANARY_SELFTEST_SAMPLES`
or `CANARY_SELFTEST_INTERVAL_MS` before you re-run. Re-run an invalid window
once during a sync. If the second window is also
invalid, stop and escalate; do not count it. Do not loosen the gates to make a
window pass. The local result is a lower bound: the real RC canary is the
binding check.

### Wait out the activation gate before starting

A deploy restarts the worker, and the wallet-sync activation gate then blocks
admissions for **two sequential phases** -- the `restart_observed` marker's TTL,
and then the drain horizon that a fresh healthy observation starts over. With
`WALLET_SYNC_MAX_EXECUTION_MS` at 30 minutes that is roughly 62 minutes in
total, during which `POST /sync/network/mainnet` answers `200 success:true` with
`requested:0 merged:0 rejected:<fleet>`. That reads like a hung fleet; it is the
gate failing closed.

`CANARY_ACTIVATION_TIMEOUT_MS` defaults to 90 minutes so a probe started right
after a deploy survives the wait rather than aborting with `fleet admission
never accepted (activation gate)`. Starting the probe about an hour after the
deploy still costs less wall-clock than letting it idle through the gate.

## Canary fleet

Run the canary on the release host's local stack, never on a production
instance. Production instances are not part of the release flow, and the
release must not depend on private wallets being present.

The fleet comes from `scripts/release/canary/fleet-manifest.json`: 12 watch-only
mainnet wallets from the published BIP39 test vectors that the
[demo instance](demo-instance.md) also uses. They cover legacy, nested SegWit,
native SegWit and taproot script types across three keys, all with real
on-chain history, so the canary exercises real Electrum sync. The validator
requires at least 12 wallets, and the fleet alone meets that.

```bash
npm run canary:fleet:seed     # idempotent; creates the demo login if needed and waits for each sync
npm run canary:fleet:status   # fleet and mainnet wallet counts
npm run canary:fleet:reset    # removes only the fleet wallets
```

The fleet is seeded once and stays: it lives in the stack's database, which
redeploys (`./start.sh --rebuild`) keep, so later releases reuse it. Before each
canary, confirm it with `canary-selftest.mjs`; its `fleetReadiness` must be
`ready: true`. You do not need to fix a short fleet by hand: when the fleet has
fewer than 12 mainnet wallets, the probe runs `canary-fleet.mjs seed` itself
before choosing its admin and before arming, so seeding never enters the
evidence. Set `CANARY_SEED_FLEET=0` to turn that off. Seeding only adds missing
test-vector wallets and waits for their first sync, so expect a few extra
minutes on that run. If the fleet is still short afterwards, or the canary
admin cannot see every mainnet wallet, the probe refuses to start.

`npm run demo:reset` keeps the shared test-vector devices while fleet wallets
exist, and `demo:reset --purge` refuses until `npm run canary:fleet:reset` has
removed the fleet, because purging the demo login would delete it. The fleet uses the demo login and
coexists with the demo wallets. The probe and selftest act as the administrator
who can access the most mainnet wallets, so an operator admin with no wallets
never becomes the canary's caller. `tests/scripts/canaryFleetManifest.test.ts`
re-derives every descriptor from its test-vector seed.

## Exercise the exact candidate

1. Rebuild the stack from a clean checkout of the RC commit before running the
   canary. The probe enforces the match: before seeding or arming it reads the
   `org.opencontainers.image.revision` label of each running backend, worker,
   frontend, gateway and llm-egress-proxy image and refuses (exit 2) unless every
   one equals `CANARY_COMMIT`. At attestation it reads them again and writes no
   receipt if a revision differs or an image changed during the run.
2. On the release host's stack, seeded with the [canary fleet](#canary-fleet)
   (at least 12 wallets), record the redacted fleet total before the exercise.
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
7. If candidate work exists, observe the bounded first candidate batch advance
   from `1` through at most `25` of the positive observed total, or reach an
   explicit retryable/fatal outcome inside its budget and grace. If current
   wallets have no candidate work, observe durable transaction reconciliation
   complete without a candidate stage or batch. A silent hang fails either path.
8. Reconcile every wallet to success, retrying, or action required. Record a
   concrete reason for every action-required wallet in the private operational
   evidence, but put only the reconciled reason count in the receipt. Confirm the
   repeated stale wallet is not stranded, then record completion and signoff.

## Receipt and raw-evidence format

Version 0.8.78 and later (compared in numeric version order, so v0.9.0 and
v1.0.0 are included) require `sanctuary.release-candidate-canary.v3`. It is v2
plus `releaseCandidate.images`: exactly one `{ service, imageId, revision }`
entry for each of backend, worker, frontend, gateway and llm-egress-proxy, read
from the running containers at attestation. Every `revision` must equal the
expected `--commit`, and `imageIds` must be the set of the entries' image IDs.
Versions 0.8.69 to 0.8.77 require at least v2, and older releases also accept
v1, so the published receipts of those releases keep verifying. All keys are
required and no additional keys are allowed. The bounded receipt contains only
redacted summaries; write timestamped probe, cgroup, Docker, lifecycle, and UI
events to the private JSONL sidecar and bind its exact bytes into `rawEvidence`.

```json
{
  "schemaVersion": "sanctuary.release-candidate-canary.v3",
  "releaseCandidate": {
    "tag": "v0.8.78-rc1",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "imageIds": [
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
    ],
    "images": [
      { "service": "backend", "imageId": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "revision": "0123456789abcdef0123456789abcdef01234567" },
      { "service": "worker", "imageId": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "revision": "0123456789abcdef0123456789abcdef01234567" },
      { "service": "frontend", "imageId": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", "revision": "0123456789abcdef0123456789abcdef01234567" },
      { "service": "gateway", "imageId": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", "revision": "0123456789abcdef0123456789abcdef01234567" },
      { "service": "llm-egress-proxy", "imageId": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "revision": "0123456789abcdef0123456789abcdef01234567" }
    ]
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
    "noCandidateWorkObserved": false,
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
`action_required`. Candidate-batch `boundedErrorEvidence.outcome` is `advanced`,
`retryable`, or `fatal`; the null/no-candidate variant exclusively uses
`not_applicable`. Diagnostics version 2 and the complete fixed counter-family
set are mandatory. Fleet outcome counts must equal `fleet.total`.
`actionRequiredWithExplicitReason` must exactly equal the action-required
outcome count; free-form reasons remain only in the private evidence.
For v2 and v3 receipts, `preflightObserved` comes from the live
`sync_phase_progress` event. The candidate total is the actual positive total
reported by that fleet, capped by the runtime progress contract at 1,000,000;
the first bounded batch starts at 1 and cannot exceed 25 or that total.
When every exercised wallet is already current, `candidateBatch` may be `null`
only with `outcome: "not_applicable"` and `noCandidateWorkObserved: true`, based
on durable transaction-reconciliation completion with no candidate stage or
batch. In that branch the candidate and batch counts are known zero, so their
known-count assertions remain true. A populated candidate batch requires
`noCandidateWorkObserved: false`.
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
