# Sanctuary CI completion audit

## Scope and identity

- Repository revision: `origin/main` at `a355673249e98c2b3cfff38a7f5643b2968e517b`.
- Exact UTC window: `2026-06-23T13:21:51.701Z` through `2026-08-22T13:21:51.701Z` (60 days, inclusive endpoints).
- Access: Forgejo GET requests only. `audit.mjs` obtains the API token through `git credential fill`; it never writes or prints the credential.
- Captures: 42 raw run pages, 312 PR-file pages, 716 job inventories, and 5,138 available native job logs. Missing/skipped job logs returned HTTP 404 and were not fabricated.
- The 184 MB raw capture remains outside Git. Its 6,213-entry `SHA256SUMS`
  manifest is bound by `RAW-CAPTURE-MANIFEST.sha256`; the four compact tracked
  derivatives are independently bound by `DERIVED-SHA256SUMS`.
- The executable requires an explicit external output directory and rejects output inside the repository. Reproduce this exact window with:

  ```bash
  audit_output="$(mktemp -d /tmp/sanctuary-ci-completion-audit-XXXXXX)"
  node audit.mjs --repo /path/to/sanctuary --output "$audit_output" \
    --revision a355673249e98c2b3cfff38a7f5643b2968e517b \
    --end 2026-08-22T13:21:51.701Z
  ```

  Omit `--end` to make invocation time the new exact window end.

## Workflow population

| Workflow | Total | Success | Failure | Cancelled |
| --- | ---: | ---: | ---: | ---: |
| Test | 1,009 | 690 | 82 | 237 |
| Install | 479 | 384 | 53 | 42 |
| Release candidate | 37 | 21 | 11 | 5 |
| Vectors | 455 | 309 | 48 | 98 |

## Phase 0 cohorts

Path cohorts can overlap. Percentiles use the latest 20 successful path-comparable runs, or every success when fewer exist. “Runner” is the sum of first-to-last timestamps from persisted executed-job logs and is a lower-bound estimate. Queue is workflow `started-created`, because Forgejo exposes no job queue timestamps.

| Cohort | Total (S/F/C) | Sample / 20 | Wall p50/p90 s | Runner p50/p90 s | Queue p50/p90 s |
| --- | ---: | ---: | ---: | ---: | ---: |
| docs-only | 10 (10/0/0) | 10 | 32 / 107 | 11 / 14 | 1 / 56 |
| gateway-only | 1 (1/0/0) | 1 | 921 / 921 | 2,145 / 2,145 | 2 / 2 |
| frontend | 214 (167/7/40) | 20 | 1,378 / 1,973 | 2,366 / 2,616 | 2 / 146 |
| backend-unit-only | 27 (20/1/6) | 20 | 1,057 / 1,533 | 564 / 2,220 | 8 / 177 |
| backend-integration-sensitive | 310 (108/54/148) | 20 | 1,540 / 2,641 | 2,330 / 2,760 | 21 / 182 |
| wallet-safety | 341 (114/54/173) | 20 | 1,526 / 2,897 | 1,350 / 2,793 | 21 / 321 |
| main push | 292 (286/5/1) | 20 | 1,239 / 1,671 | 2,424 / 2,555 | 6 / 8 |
| install | 479 (384/53/42) | 20 | 602 / 1,612 | 98 / 1,128 | 9 / 107 |
| RC | 37 (21/11/5) | 20 | 1,335 / 2,237 | 1,295 / 2,117 | 37 / 486 |

The original 20-run obligation is not met for docs-only (10-run shortfall) or gateway-only (19-run shortfall). Gateway-only requires gateway source/tests and excludes any non-gateway product source; the sole match was PR #646. Samples are path-comparable but not normalized to one workflow topology, so they are trend evidence rather than a controlled before/after benchmark.

## Subtimings and cancellation waste

- No selected log contained a machine-parsable runner-lock notice; lock time is unavailable, not zero.
- Timing-labeled setup/install/build totals were available for 1/1 gateway, 13/20 frontend, 20/20 backend-unit, 20/20 integration, 18/20 wallet, 15/20 main, and 5/20 install samples. They were absent for docs and RC. Sparse install notices include large lane-level install/migration bodies, so `summary.json` retains them as observed lower bounds rather than comparable setup-only percentiles.
- Artifact transfer timing was available for 16/20 frontend, 20/20 backend-unit/integration/wallet, 17/20 main, 19/20 install, and 20/20 RC samples. Exact values are in `summary.json`.
- Observed cancelled-run runner waste: Test 174,543s across 228/237 runs; Install 19,410s across 39/42; RC 1,030s across 4/5; Vectors 35,090s across 91/98. Missing-log runs are explicitly excluded, so these are lower bounds.

## First failure and unique yield

- Test first-failure leaders: backend integration 34, frontend coverage 14 across merged/shard stages, backend unit coverage 10, browser E2E 7. Exact stage counts and all run/job IDs are in `summary.json`.
- Install first failures: extended fixtures 20, baseline upgrade 17, fresh install 10, install unit 4, stack smoke 2.
- Vector first failures: base `verify-vectors` 41, Trezor 4, Jade 1, Ledger 1, regeneration 1.
- Quick-only Test failures: 0. Full-only Test failures: 70. One Test failure was mutation-only by failed-job-name comparison.
- Against a successful Test run at the same commit, 22 vector failures and 45 install failures supplied distinct deep-gate signal. This same-commit comparison does not prove causality and does not normalize event/topology.

## Manual mutation and install attribution

`manual-attribution.json` is the reviewed run-level source of truth. Automated per-job heuristic labels in `summary.json` are retained for reproducibility but are not used as final attribution.

- Mutation: 3 failed runs with a root mutation shard — 2 deterministic initial-test defects and 1 provider authentication failure; zero attributed product, registry/rate-limit, queue, or proven runner failures.
- Install: 53 failed runs — 34 deterministic test/harness defects, 2 product/runtime defects, 4 upgrade-source dependency-drift defects, 6 proven runner/substrate failures, and 7 unresolved from the native root log.
- Several install logs contain CoinGecko HTTP 429 warnings inside container dumps. Manual review found explicit migration/fixture failures instead, so those warnings are not counted as registry/rate-limit root causes.

## Limits and decision boundary

- Cross-browser attribution is unavailable: the CI contract selected Chromium only during this window.
- Native run/job APIs provide no job timestamps, attempt-level first-failure metadata, or artifact transfer duration fields. Log-derived metrics are necessarily estimates.
- Topology changed during the 60 days. The machine report exposes exact run IDs so narrower topology cohorts can be derived without re-fetching metadata.
- This evidence does not support weakening full, mutation, install, vector, or emulator gates. Docs-only and gateway-only sample requirements remain incomplete, and the distinct deep-gate failure counts argue for retaining current execution until a separately controlled decision is made.
