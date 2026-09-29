# Sanctuary CI speed-up analysis (measured)

**Date:** 2026-09-29
**Type:** analysis and plan only. Nothing here has been implemented.
**Predecessor:** `reports/ci-speedup-analysis-2026-08-22.md`. That report had no timing data
(§2 "no data exists") and ranked work by inspection. This pass uses the timing
instrumentation that has landed since then (#922/#923) and host snapshots, so every number below
is measured unless marked *estimate*.

## Implementation status

Accepted 2026-09-29. Delivered one PR per item in §8 order, because each change
needs its own before/after timing so a regression is attributable. That is the
recorded reason for not combining them into one PR.

| Item | Status | PR | Merge |
|---|---|---|---|
| R2 — drop the DIND-era Playwright ordering edges | in review | — | — |
| R1 — render E2E workers | pending | — | — |
| R3 — concurrent frontend coverage shards | pending | — | — |
| R4 — concurrent verify-vectors mutation groups | pending | — | — |
| R5-A — parallel upgrade baselines | pending | — | — |
| R5-B — install image cache design | pending (design only) | — | — |
| R6/R7 | optional | — | — |
| R8, §6 | out of scope (runner-infra / deferred decision) | — | — |

The R2 PR also carries an unrelated one-line changelog fix: the v0.8.75 stable
tag was created 2026-09-29, but its heading said 2026-09-25, so
`tests/release/changelog-coverage.test.mjs` failed on `main` for every PR.

---

## 1. Summary

1. **The fleet is not the bottleneck.** Over 6.8 days of 2-minute host snapshots, all 5 runner
   slots (kumo 2, x300 2, sora 1) were busy only **9%** of the time and the fleet was idle **50%**
   of the time. A busy host averaged load **1.4–3.5 on 16 cores**, with CPU PSI p90 around 1% and
   memory PSI at 0. Per-job dispatch waits have a median of about 0.1 min and a p90 of about 3 min.
2. **The critical path is made of single-threaded work running one step at a time on idle
   16-core hosts.** Four items account for most of PR-to-green latency, and every one runs one
   thing at a time by explicit configuration:
   - Render regression E2E: Playwright `workers: 1`, **12.4 min median, 14.6 min max**. It has a
     180 s warning budget, and the suite grew from 44 to 71 tests in the past week.
   - Frontend coverage: two shards **run sequentially in one job**, each with `--maxWorkers=1`,
     taking **13–17 min**.
   - `verify-vectors`: **seven Stryker mutation proofs run one after another**, taking
     **11–14 min** of a 17 min job, on every non-docs PR.
   - Upgrade Baseline: **three 6-minute image builds per baseline**, and two baselines run one
     after the other, for **27 min median and 53 min p90**.
3. **Two DIND-era ordering edges put about 5 min of waiting on the critical path.** Render E2E
   waits for Browser E2E, and Browser E2E waits for the backend coverage shards. Both edges exist
   to stop heavy jobs sharing the old DIND daemon and hitting OOM. DIND is retired, and the
   measured peak memory of these jobs is 2.9–4.2 GiB on hosts with 13–31 GiB.
4. **The push-to-main run repeats the PR run.** All 106 of 106 main pushes in the window had a
   tree byte-identical to one that a PR run had already tested green. Push-to-main runs take
   **29% of all workflow wall-time**, about 106 h in 12 days. Changing this is a policy decision
   (§6), not an obvious win.
5. **Expected result (*estimate*) if items R1–R5 land and hold on all three hosts:** typical
   frontend or backend PRs go from about 25 min to 15 min, install-affecting PRs from about 45 min
   to 25–30 min, and no gate is removed or weakened.

---

## 2. Data sources and window

| Source | Window | What it gave |
|---|---|---|
| Forgejo `actions/runs` | 1,500 runs, 2026-09-17 → 09-29 | Run wall-clock per workflow and event, and tree identity of PR vs main pushes |
| Job logs (`actions/jobs/<id>/logs`) | 322 successful runs (15 PR + 8 push per workflow, most recent) | Per-job start/end, `CI timing::` notices, dispatch gaps |
| Host snapshots `/var/lib/forgejo-runner-health/snapshots` | ≈4,900 per host, about 6.8 days | Slot occupancy, load, CPU/IO/memory PSI, per-job container memory peak |
| Runner config | `/home/runner/runner-config.yml` on each host | capacity: kumo 2, x300 2, sora 1 |

Caveats:
- The Forgejo `actions/tasks` endpoint only exposes *run*-level `run_started_at`. Job timings were
  taken from log timestamps instead.
- Snapshot occupancy includes **other repositories** that share the fleet (Renovate,
  `Build-And-Typecheck`, `Browser-Workflow-*` appear). Sanctuary's own share is lower.
- The sample leans toward recent UI-heavy PRs (the visual-consistency work). Backend-heavy lanes
  (integration, critical mutation) ran in only 3–10 of the sampled runs.

---

## 3. Measured baseline

### 3.1 Workflow wall-clock (successful runs, created → last job end)

| Workflow | PR median / p90 | push-main median / p90 | Runs on |
|---|---|---|---|
| `install-test.yml` | **43.6 / 61.4 min** | 19.4 / 157 min | install-scope PRs (31 of about 160) |
| `verify-vectors.yml` | **24.7 / 32.6** | 21.2 / 23.8 | every non-docs PR (policy) |
| `release-candidate.yml` | **23.8 / 30.5** | 20.6 / 32.2 | release-lane-scope PRs, tags, nightly |
| `test.yml` | **21.8 / 31.1** | 21.9 / 23.4 | every PR (scoped lanes) |
| `quality.yml` | 8.5 / 17.9 | 7.2 / 11.5 | every PR |
| `docker-build.yml` | 4.4 / 17.6 | 3.8 / 10.0 | image-scope PRs |
| `architecture.yml` | 3.3 / 3.9 | 3.5 / 4.1 | every PR |

A typical PR's time to green is therefore the slowest of `verify-vectors` (about 25 min), `test`
(about 22 min) and `release-candidate` (about 24 min when it runs). For an install-scope PR it is
`install-test` (about 44 min).

### 3.2 `test.yml` critical path on a frontend PR (run #19407, representative)

```
0.4  Full Lane Ready
2.5 ─ Full Frontend Coverage Merge ─────────────────────── 19.7   (shard 1 → shard 2, 1 worker each)
2.5 ─ Full Browser E2E ── 7.2
                          7.2 ─ Full Render E2E ────────────── 22.3   (workers: 1)
22.5 PR Required Checks
```

The two branches take nearly the same time, so both have to shrink before wall-clock improves.

### 3.3 Heavy phases (from `CI timing::` notices)

| Phase | Median | Max | Parallelism today |
|---|---|---|---|
| Render regression E2E (71 tests) | 12.4 min | 14.6 | Playwright `workers: process.env.CI ? 1` (`config/tooling/playwright.config.ts:24`) |
| Frontend coverage shard 1 + shard 2 | 6.1 + 6.2 min | 7.7 + 8.6 | sequential steps, `--pool forks --maxWorkers=1 --no-file-parallelism` (`scripts/ci/frontend-coverage-shard.sh:83-85`) |
| verify-vectors mutation proofs (7 Stryker runs) | about 11–14 min | — | two sequential steps (`verify-vectors.yml`, "Prove PSBT account-binding…" + "Prove exact transaction fee…"), each Stryker `concurrency: 4` |
| Upgrade baseline, per baseline | 14.9 min | 21.1 | `Ensure Existing Installation` 6.1 min + `Restart After Upgrade` 5.8 min + `Force Rebuild Gate` 5.8 min, all image builds; latest-stable and n-2 run sequentially |
| Upgrade Extended Fixtures (5 fixtures) | 120 min | — | sequential, about 15 min each (nightly/RC) |
| RC Fresh Install E2E | 8.9 min | 13.1 | — |
| RC Wallet Sync Live Shape Replay | 8.8 min | 8.8 | after 3.5 min replay-image build |
| Install script unit tests | 6.2 min | 6.4 | same script run by **both** `install-test.yml` and `release-candidate.yml` |
| Browser E2E (4 groups) | 1.3+1.1+0.8+0.5 min | — | — |
| Backend unit coverage shards | 2.2 / 2.7 min | 4.0 | 2 jobs |

### 3.4 Fleet headroom

| Host | Cores / RAM | Busy (≥1 job) | At capacity | Load when busy (med / p90) | IO PSI60 p90 |
|---|---|---|---|---|---|
| kumo | 16 / 31 GiB | 37% | 19% | 3.5 / 6.1 | 1.5 |
| x300 | 16 / 27 GiB | 35% | 19% | 2.8 / 5.5 | 8.7 |
| sora | 16 / 13 GiB | 25% | 25% | 1.4 / 3.7 | 3.3 |

Peak job-container memory over the last ≈4 days, top entries: Architecture 6.8 GiB, Critical
Mutation shard 1 6.3 GiB, verify-vectors 5.0 GiB, Full Browser E2E 4.2 GiB, Frontend Coverage
3.5 GiB, Render E2E 2.9 GiB. **sora's 13 GiB is the binding constraint** for any change that
raises per-job memory (R1, R3, R4).

---

## 4. Status of the 2026-08-22 plan

Landed: T1.0 instrumentation (#922, #923), T1.1/T1.2 quick-lane duplicates deleted, T1.5 (#911),
T1.7 (#912), T1.8/T1.9 reporters (#924), T1.10 quality scopes (#927), architecture scoping
(#883), docs-only verify-vectors skip (#1006), dedicated Playwright image (#1231), BuildKit for
install/RC (47cb4a7038).

Tried and rejected: Phase 3b / PR #884, which split frontend coverage into **separate jobs**.
Raw coverage time improved by 230 s, but runner queueing added 220–247 s to the child jobs, so net
gate latency improved by only about 71 s. **This constrains R3: parallelize inside the job, not
across jobs.**

Still open and still relevant: T3.4 (runner lock directory lives under `github.workspace/.tmp`, so
`node-toolchain` / `e2e` locks are per-job no-ops across containers), T3.5 (Browser→Render
edge), T2.10/6.6 (RC and install-test lanes overlap).

---

## 5. Recommendations (ranked by critical-path minutes saved per unit of risk)

Every item keeps the gate exactly as strict as it is now: same tests, same thresholds, same
proofs, still blocking. Each one is a **measure-first** change. Land it behind the existing timing
notices, collect at least 5 runs that between them cover **kumo, x300 and sora**, and roll it back
if the p90 regresses or any worker, OOM or snapshot flake appears.

### R1 — Render regression E2E: `workers: 1` → 3 in CI · saves about 8–9 min on frontend PRs

- **Evidence:** 12.4 min median against a 180 s warning budget that already fires every run. The
  71 tests are independent route renders against a fully mocked API (`fullyParallel: true` is
  already set). The container peaks at 2.9 GiB.
- **Change:** make `workers` configurable (e.g. `SANCTUARY_PLAYWRIGHT_WORKERS`, default 1) and
  set it to 3 on `full-render-e2e-tests` only. Keep browser-flow E2E at 1 until it has its own
  measurement.
- **Risks:** screenshot nondeterminism under CPU contention (5 PNG baselines), and timeouts.
  Retries (`retries: 2`) could hide flakiness, so **count retried tests from the JUnit output as a
  failure signal during the trial**, not just red runs. Check the memory peak on sora.
- **Also:** the suite grew 44→71 tests in a week (visual-consistency passes), at about 12 s per
  test. Separately from workers, look at whether the new contrast/focus contracts can share one
  page load per route rather than one per assertion. That is a test-design change and belongs in
  its own PR.

### R2 — Remove the two DIND-era ordering edges in `test.yml` · saves about 5 min

- **Evidence:** `full-render-e2e-tests` needs `full-browser-e2e-tests` success, and
  `full-browser-e2e-tests` needs `full-backend-unit-coverage-shards`. The comment says the reason
  is keeping heavy lanes off the "shared DIND daemon" to avoid OOM. DIND is retired (Docker was
  removed from x300 on 2026-09-11, and all hosts run rootless Podman). Measured peaks are 4.2 GiB
  (browser) and 2.9 GiB (render), and memory PSI across the fleet was 0.
- **Change:** drop both `needs:` edges. Keep the render job's skip logic keyed on
  `detect-changes` outputs rather than on the browser job's result, which that `if:` currently
  couples to.
- **Risks:** the two Playwright jobs could land on the same host. Each runs in its own container
  with its own port namespace, but confirm that neither binds a host port. The `e2e` lock is
  per-workspace (§4, T3.4), so it would not serialize them anyway. Watch the snapshots for
  co-resident peaks on sora.
- **Note:** R1 and R2 together move the frontend critical path from about 22 min to about 17 min
  (now bounded by coverage), so R3 is needed to realise the full gain.

### R3 — Frontend coverage: run the two shards concurrently *inside* the job · saves about 6–8 min

- **Evidence:** the shards run as sequential steps (6.1 + 6.2 min), each single-worker, on hosts
  whose load averages about 3 of 16. PR #884 showed that splitting into jobs loses the gain to
  queueing, and this approach does not re-queue.
- **Change:** in the merge job, start shard 1 and shard 2 as two background processes with
  separate report directories (already supported by `SANCTUARY_FRONTEND_COVERAGE_REPORTS_DIR`),
  `wait` for both, then merge. Keep `--maxWorkers=1 --no-file-parallelism` per shard, so each
  process's execution contract stays the one #265 stabilised. Only the two processes overlap.
- **Risks:** the #265 worker-crash lesson came from the DIND and memory-starved era, and the
  native-crash retry wrapper now exists (`run_vitest_shard_with_native_retry`). Memory roughly
  doubles (3.5 → about 7 GiB), which fits sora but must be confirmed. Both shards' exit codes
  and native-retry classification must still be enforced; a background `&` that loses an exit
  status is the classic failure here.
- **Follow-up, only after R3 is stable:** try `--maxWorkers=2` per shard as a separate
  experiment.

### R4 — `verify-vectors` mutation proofs: two concurrent groups · saves about 5–7 min on every non-docs PR

- **Evidence:** seven Stryker runs execute in sequence (wallet-policy, PSBT browser, PSBT server,
  taproot-construction, taproot-finalization, then fee-policy, receive-evidence), each at
  `concurrency: 4`, inside a 17 min job. This job sets the PR-to-green floor for nearly every PR.
- **Change:** run the root-workspace group (wallet-policy, PSBT browser) and the server group
  concurrently in one step, keeping per-run log files. Do the same for fee-policy and
  receive-evidence. Total concurrency 8 of 16 cores. Every proof still runs and still blocks, and
  `check-wallet-safety-mutation-map.mjs` still runs after them. Keep `incremental: false`, because
  these are proofs, not caches.
- **Do not:** add a positive path filter. `classify-verify-vectors-scope.sh` and
  `check-wallet-safety-classifier.mjs` forbid it on purpose.
- **Risks:** the 15-min step bound was widened after contended runs reached 91–92%. Running
  concurrently raises contention, so measure the per-proof duration, not just the step total. The
  job peaks at 5.0 GiB, and doubling Stryker processes needs a sora check. Also confirm that no
  two configs share `reports/mutation` temp or sandbox directories.

### R5 — Upgrade Baseline: split baselines into parallel jobs, then cache immutable-tag installs · saves about 12–20 min on install PRs

- **Evidence:** each baseline spends about 18 of its 15–21 min on three image builds. The
  latest-stable and n-2 baselines run sequentially in one job (about 42 min when both run, 53 min
  p90). The "existing installation" images are built from **immutable release tags**
  (`CLAUDE.md`: pushed tags are immutable).
- **Change, step A (low risk):** turn the two baselines into a 2-entry matrix. At 15–21 min per
  entry, the #884 queue penalty of about 4 min is small next to about 15–20 min saved.
- **Change, step B (needs design):** cache the old-release build. `build-runtime-image.sh`
  already uses `--cache-from/--cache-to type=gha`, and BuildKit is now enabled for install/RC
  (47cb4a7038). Extending the same gha cache scope, keyed by release tag and component, to the
  install/upgrade compose builds would turn `Ensure Existing Installation` into mostly cache hits.
  The upgraded-side builds could reuse the same PR-SHA layers. **Constraint:**
  `check-workflows-test-only.sh` bans registry pushes, which is why this must be the gha cache and
  not a registry. Verify that the cache service works from `docker-socket` jobs
  (`check-actions-cache-service.sh`). Keep the `Release-Critical Force Rebuild Gate` as a true
  no-cache rebuild, because that is its purpose.
- **Risks:** the ownership/cleanup machinery (runner-infra reaper, owner labels) must not reclaim
  cached layers mid-run. kumo's `DOCKER_BUILDKIT=0` native builder ignores the gha cache, so
  expect kumo-only regressions (see `kumo-native-builder-root-causes`).

### R6 — Deduplicate `run-install-unit-tests.sh` across install-test and RC · saves 6 runner-min per overlapping PR

- The same script runs in `install-test.yml` ("Install Script Unit Tests") and
  `release-candidate.yml` ("Unit Tests"), at 6.2 min each. This does not affect the critical
  path, but it frees a slot. Keep it in whichever workflow's scope classifier is the superset, and
  prove the superset relation with a classifier test before deleting the other.

### R7 — Parallelize serial shell suites (low priority)

- `quality.yml` "CI classifier tests" (7.3 min, 78 `tests/ci/*.test.sh`) and
  `run-install-unit-tests.sh` (18 suites) loop serially. `xargs -P4` with per-suite logs would
  roughly halve them. These are off the critical path, so do this only if the suites are proven
  independent (no shared `.tmp` paths; the fixture-lifecycle registry in
  `config/resource-lifecycle-callsites.json` must still pass).

### R8 — Runner capacity 2 → 3 on kumo and x300 (runner-infra, after R1–R4)

- CPU headroom is large, but R1, R3 and R4 deliberately *use* more cores per job, so raise
  capacity only after those changes land and are re-measured. This belongs in runner-infra, not
  this repo (`runner-hosts-accommodate-repos`). sora stays at 1 (13 GiB).

---

## 6. Decision needed: the push-to-main duplicate

- **Fact:** 106 of 106 main pushes had a tree identical to a PR run that was already green for the
  same workflow. Squash-merge plus `block_on_outdated_branch: true` guarantees this.
- **Cost:** 29% of workflow wall-time (about 106 h in 12 days), or about 83 runner-minutes per
  merge excluding RC. These runs also compete with the *next* PR in the serial merge queue.
- **Why it isn't free to drop:** (a) the `pr-delivery` gate and the rule to verify post-merge CI
  on the target branch rely on the push run; (b) the push run is a second sample of
  Podman/Playwright nondeterminism; (c) the 08-22 report (§8.18) found that a "skip if PR green"
  lookup must run on `github.token` only, under `check-workflows-test-only.sh`, and would often
  fail closed.
- **Options, in order of conservatism:**
  1. Leave as is.
  2. On `push` to main, run only the cheap *main-state* checks (architecture generated graphs,
     which the `arch-lane-not-pr-required` memory shows can go red only on main, plus quality and
     docker-build summaries). Leave the heavy deterministic lanes (verify-vectors, full test
     lanes) to the PR run and the nightly schedule. This needs a policy change to the post-merge
     verification rule.
  3. A tree-SHA-keyed "already proven" marker via the actions cache. The design risk is that a
     cache entry written by a PR run becomes the evidence for main.
- **Recommendation:** decide this only after R1–R5. Those shorten every run, including push runs,
  so the absolute cost of the duplicate falls by about 40%. If you then want the capacity, option
  2 is the only one that keeps a clear evidence story.

---

## 7. Explicitly not recommended

- Path-filtering `verify-vectors` beyond the docs-only exit. This is forbidden by design (funds
  safety).
- Raising coverage retry counts, lowering the 100% frontend threshold, or marking lanes
  non-blocking.
- Splitting jobs further across the fleet (the #884 lesson). Prefer parallelism inside the job.
- Enabling Stryker `incremental` for the verify-vectors proofs. A cached result is not a proof.
- Dropping the nightly `Test Suite`, `release-candidate` or `install-test` runs. They are the
  unattended flake sample (08-22 §8.16).

---

## 8. Proposed sequencing

Merges are serial, so hold each branch locally until the previous one has landed.

| PR | Items | Why this order | Validation |
|---|---|---|---|
| 1 | R2 (drop the two edges) | Workflow-graph change only, no test behaviour change, easy rollback | 5+ frontend PR runs; snapshot check for co-resident peaks on sora |
| 2 | R1 (render workers 3) | Largest single saving; isolated to one job | Retried-test count = 0 across 5+ runs, all 3 hosts; peak memory |
| 3 | R3 (concurrent coverage shards) | After PR 2, coverage becomes the critical path | Both shard exit codes enforced (write the failing-shard non-regression test first); memory on sora |
| 4 | R4 (concurrent mutation groups) | Affects every PR, and funds-safety sensitive | Per-proof durations; mutation scores identical to baseline; mutation-map check still green |
| 5 | R5-A (parallel baselines) | Install PRs only | 3+ install-scope runs |
| 6 | R5-B design doc, then R6/R7 | R5-B needs cache-service verification first | — |
| — | R8 (runner-infra) and the §6 decision | After re-measuring | Re-run this analysis's snapshot/log scripts |

**Re-measurement:** the scratch scripts used here (run and job-log fetch, `CI timing::`
aggregation, snapshot occupancy and memory extraction) are about 150 lines of Python. Checking
them in under `scripts/ci/` as a read-only `report-ci-latency` tool would make before/after
comparisons for each PR reproducible. That would be a small first PR of its own if wanted.
