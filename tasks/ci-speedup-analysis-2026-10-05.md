# Sanctuary CI speed-up analysis, round 3 (measured)

**Date:** 2026-10-05
**Type:** analysis and plan only. Nothing here has been implemented.
**Predecessor:** `tasks/ci-speedup-analysis-2026-09-29.md`. Since then R1, R2, R3, R5-B and R7
have landed, R4 and R6 were dropped, R8 was applied in runner-infra (kumo and x300 now run at
capacity 3), and #1347 stopped re-running test, docker-build and install-test on push to `main`.
**Quality constraint:** every item below keeps the same tests, thresholds, proofs and blocking
status. Nothing is path-filtered, made non-blocking or retried more.

---

## 1. Summary

1. **verify-vectors is now the only thing that matters for merge latency.** It was the last
   required check to go green on **16 of 17** PR head SHAs since the last round. Median time to
   required-green is **25.7 min** (max 41.4). PRs whose test suite finished in 1–2 min still waited
   21–25 min for it.
2. **Inside verify-vectors, the seven Stryker proofs take about 12.5 of the job's 16.3 min, and
   the three emulator jobs cannot start until the job ends.** R4 showed that concurrency *inside*
   the job gains nothing, because of the job's 8-CPU quota. Moving the proofs into **their own
   job** gives them a separate quota and lets the core vector lane and emulators run beside them.
   Estimate: verify-vectors from about 25 min to about 19 min with one mutation job, or to about
   14–15 min with two.
3. **Queueing is now larger than most test runtimes.** After its dependencies finish, the median
   job waits **1.5 min** for a runner slot (p90 6.4). Backend unit-coverage shards wait a median
   of **8.4 min**, and verify-vectors itself waits 3.4 min. About **two-thirds of fleet slot-time**
   in the window went to other repositories (counting-cats DB coverage, browser shards, unit
   coverage), so most of this contention comes from outside this repo.
4. **The hosts can take a fourth slot.** With 3 jobs running, kumo and x300 sat at load median
   6–7 of 16 cores, CPU PSI60 p90 about 3%, and at least 16 GiB free memory. Raising kumo/x300
   capacity from 3 to 4 is a runner-infra change, not a Sanctuary one.
5. **test.yml becomes the floor after item 2.** Its tail is serialized by a typecheck gate and by
   two ordering-only edges on the integration job, plus a pass-through `Full Lane Ready` hop.
   Removing these should bring test.yml from about 20 min to about 15 min, with no change to what
   runs or what blocks.

---

## 2. Data and window

| Source | Window | Used for |
|---|---|---|
| Forgejo `actions/runs` | 600 runs, 2026-09-27 → 10-05 | Workflow wall-clock before and after 2026-09-30 18:00 HST |
| Job logs (`actions/jobs/<id>/logs`) | 170 successful runs after the cut, 1,346 job logs | Job start/end, `CI timing::` notices, queue time after dependencies were ready |
| Workflow YAML `needs:` graphs (`origin/main` 30e00f2519) | — | Ready time for each job (the latest end among its `needs`) |
| Host snapshots, kumo / x300 / sora | 2026-10-01 → 10-05, about 3,200 per host | Load, PSI and MemAvailable by running-job count, and slot attribution by task ID |
| Branch protection (read-only GET) | — | Which contexts are required |

Caveats:
- The PR sample is small: 17 head SHAs had all three required workflows succeed.
- Slot attribution matches snapshot task IDs against tasks from *successful* Sanctuary runs only.
  Failed and cancelled Sanctuary runs count as "other", so the other-repo share is an upper bound.
  Judging by job names, at most about 3% of the "other" time was Sanctuary's.
- Queue time is measured from log timestamps, not the `actions/tasks` API, so it includes
  container start (about 1–2 s).

---

## 3. Measured state

### 3.1 Required checks and time to green

Required contexts on `main`: `Code Quality Required Checks`, `Full Test Summary`,
`PR Required Checks`, `Verify Bitcoin Vectors / summary`. release-candidate, docker-build,
install-test and architecture are not required.

| Per PR head SHA (n=17) | Median | Max |
|---|---|---|
| All required checks green | **25.7 min** | 41.4 |
| All workflows green | 28.7 min | 41.4 |
| Last required check to finish | verify-vectors 16, test.yml 1 | |

### 3.2 Workflow wall-clock (successful PR runs, created → stopped)

| Workflow | Before 09-30 (med / p90) | After (med / p90) | Note |
|---|---|---|---|
| verify-vectors | 24.1 / 31.0 | **25.5 / 33.5** | unchanged; now the floor |
| test.yml | 17.9 / 33.5 | 19.9 / 29.6 | p90 improved; median held by queueing |
| release-candidate | 27.4 / 30.2 | 28.6 / 39.5 | not required |
| quality | 8.6 / 18.1 | 12.6 / 20.4 | queueing, see §3.4 |
| docker-build | 4.5 / 16.0 | **14.8 / 24.5** | `build-backend` waits for `build-frontend`, then queues |
| install-test | 37.7 / 45.6 | 18.4 / 40.5 (n=4) | R5-B landed; sample too small |

### 3.3 verify-vectors critical path (median)

```
0.0  scope job (≈0.1)
     queue 3.4
3.5  verify-vectors ──────────────── 16.3 min ────────────────── 21.1
       ├ checkout, toolchain, Jade protocol harness   ≈0.5
       ├ install server deps                          ≈0.5–1
       ├ 7 Stryker proofs (two steps)                 ≈12.5   ← R4: CPU-quota bound
       └ address verifier, derivation tests, live PSBT ≈3
21.6 emulators (jade 3.8 ‖ trezor 2.3 ‖ ledger 1.6) ── 25.3
25.5 summary
```

The emulator jobs `need: [verify-vectors]` so that the 3.3 GiB emulator image does not unpack
while "the Bitcoin Core vector lane" churns the rootless daemon. The daemon work is in the last
≈3 min of the job, not in the Stryker phase. The workflow comment still describes the job as a
"roughly five-minute vector proof", which was true before the mutation proofs moved in.

R4 (#1344) measured the Stryker phase: sequential runs already use about 5.3 of the job's 8 CPUs,
and fee-policy alone takes 5.4–6.7 min. The other six proofs total about 5 min. Running them
concurrently inside the job hit the 8-CPU cgroup cap (351 s throttled) and saved nothing.

### 3.4 Queueing (start minus the latest `needs` end, PR runs, n=750 jobs)

| Job | Queue med | p90 | On a required path? |
|---|---|---|---|
| test `full-backend-unit-coverage-shards` | **8.4** | 10.2 | yes, the backend tail |
| test `full-build-check` | 8.0 | 12.7 | yes, via summary (0.8 min job) |
| docker-build `build-backend` | 7.0 | 11.6 | no |
| RC `wallet-sync-live-shape` | 6.0 | 8.0 | no |
| test `full-browser-e2e-tests` / `full-render-e2e-tests` | 5.7 / 6.0 | 8.5 / 8.9 | yes |
| quality small jobs (lint, gitleaks, jscpd, lizard, …) | 2–4 | 4–8 | aggregator is required |
| verify-vectors `verify-vectors` | **3.4** | 5.4 | **yes, the floor** |
| test `full-lane-ready` (a pass-through job) | 0.4 | 5.5 | yes, in front of every full lane |
| **All jobs** | **1.5** | **6.4** | |

A median PR fires **34 jobs** (max 56) for about **79 slot-minutes**, and 13 of those jobs run
for under 30 s. Each job, however short, needs a slot and a dispatch cycle.

### 3.5 test.yml tail (three recent full-lane PR runs)

```
run 20084:  Lane Ready 2.5 → typechecks 4.8–5.6 → [backend shards wait to 14.0] 14.0–17.7
            → unit merge 19.2 → integration 19.4–23.3 → Backend Tests 23.5 → Summary 24.1 → PR Required 25.9
            Frontend Coverage Merge 5.0–15.2, Critical Mutation shard 1 5.6–17.0, Browser 7.2–13.9, Render 8.2–15.2
```

- `full-backend-unit-coverage-shards` needs `full-backend-typecheck` (a fail-fast gate) and so
  becomes ready later than every other full lane. By then the slots are taken.
- `full-backend-integration-tests` needs the shards **and** `full-browser-e2e-tests`. The
  workflow comment says this is "purely ORDERING to keep the two heavy Node lanes off the runner
  concurrently", a guard against the DIND-era Postgres OOM. It makes integration (3.5 min) the
  last real job in every sampled run.
- Critical mutation shards are unbalanced: shard 1 (addressDerivation) takes 9.5 min, shard 2
  takes 1.2 min and shard 3 takes 5.4 min.
- Frontend coverage shards now run concurrently (R3): 8.2 and 9.4 min, job 10.2 min.

### 3.6 Host headroom (snapshots, 2026-10-01 → 10-05)

| Host | Capacity | Busy | At capacity | Load med / p90 at capacity | CPU PSI60 p90 / max | MemAvailable min at capacity |
|---|---|---|---|---|---|---|
| kumo (16c / 31 GiB) | 3 | 21% | 9% | 6.6 / 10.8 | 3.0 / 28.9 | 18.8 GiB |
| x300 (16c / 27 GiB) | 3 | 22% | 10% | 5.7 / 9.2 | 2.9 / 12.7 | 16.3 GiB |
| sora (16c / 13 GiB) | 1 | 16% | 16% | 1.6 / 3.5 | 0.5 / 9.5 | 7.3 GiB |

Fleet slot-time: about 4,700 slot-minutes "other" against 2,300 matched to Sanctuary. The largest
consumers were counting-cats `DB-Coverage`, `Previous-Stable-Migration-Upgrade`, its unit-coverage
and browser-workflow shards, and `Build-And-Typecheck`.

---

## 4. Recommendations (ranked by required-green minutes saved per unit of risk)

Every item is measure-first, as before. Use the existing `CI timing::` notices, collect at least 5
runs that between them cover kumo, x300 and sora, check snapshots for `oom_kill` and throttling,
and roll back if p90 regresses.

### S1. Move the verify-vectors mutation proofs into their own job · saves about 6 min, then about 11 min

- **Why it differs from R4:** R4 ran the proofs concurrently inside one 8-CPU cgroup. A separate
  job has its own 8-CPU quota, and it lets the core vector lane (about 4.5 min) and then the
  emulators run beside the proofs instead of after them.
- **Phase A:** create a new job `verify-vectors-mutation` with the same image, `needs:
  [determine-verify-scope]` and the same `if:`. Move both "Prove …" steps, the report upload and
  `check-wallet-safety-mutation-map.mjs` into it, unchanged. `summary` must `need` it and fail on
  any result other than `success` (or `skipped` when scope says skip, as for `verify-vectors`).
  The emulator jobs keep `needs: [verify-vectors]`, so the daemon-churn ordering is kept.
  - New path ≈ queue + max(mutation ≈1.5 setup + 12.5, core ≈4.5 + queue + Jade 3.8).
    *Estimate:* verify-vectors goes from about 25.5 to about 19 min.
  - The job does not need the Docker socket. It can use `ubuntu-22.04`, which every host
    carries anyway.
- **Phase B (only after A is measured):** split the proofs into two jobs. One runs fee-policy
  and receive-evidence (about 6–7.5 min); the other runs wallet-policy, the two PSBT proofs and
  both taproot proofs (about 5 min). Move the map check to run once after both, either in
  `summary` (it needs a checkout and both report artifacts) or in a small join job. *Estimate:*
  about 14–15 min.
- **Must also change:**
  - `verify-vectors.yml` is a verifier source, so re-pin `sourceSha256` in both vector files
    (procedure in `tasks/ci-speedup-handoff-2026-09-29.md` §1).
  - Update the step-order and timeout assertions in `tests/ci/check-workflow-composition.test.sh`.
  - Fix the stale "roughly five-minute vector proof" comment.
- **Cost:** one extra job per non-docs PR in phase A (two in phase B), about 1.5 slot-minutes of
  setup each, and one extra queue wait on a parallel path. The #884 lesson was that a split loses
  its gain when queueing exceeds the saving. Here the saving (≥6 min) is well above the p90 queue
  for verify-vectors (5.4 min), and the new job waits in parallel, not in series.
- **Does not change:** the proofs themselves, `incremental: false`, `disableBail`, thresholds,
  the classifier scope, or the push-to-main run (#1347 kept it on purpose).

### S2. Unblock the test.yml backend tail · saves about 4–8 min when test.yml is the floor

- Remove `full-backend-typecheck` from the `needs` of `full-backend-unit-coverage-shards`. The
  typecheck still blocks through `full-backend-unit-coverage` and `full-backend-tests`. The cost
  is that a PR with a type error also runs its shards (about 7 slot-minutes, red PRs only).
- Remove the ordering-only edges `full-backend-unit-coverage-shards` and `full-browser-e2e-tests`
  from `full-backend-integration-tests`. Its `always()`-guarded `if:` already ignores their
  results.
- **Evidence it is safe now:** the OOM that caused the edges happened when DIND shared one daemon.
  With 3 jobs on a host, MemAvailable never fell below 16 GiB, and memory PSI60 peaked at 7.4%.
  R2 removed the same kind of edge between the Browser and Render jobs with no regression.
- **Risk to watch:** the integration job's `services: postgres` being OOM-killed. That would show
  as "table public.users does not exist" and as `oom_kill` in the snapshots. Write the trial PR
  so that this failure is easy to spot.
- *Estimate:* test.yml goes from about 20 min to about 15 min. After S1, test.yml is within 2 min
  of verify-vectors in 3 of the 17 sampled SHAs, so without S2 most of S1's gain is lost on
  backend PRs.

### S3. Raise kumo and x300 capacity from 3 to 4 (runner-infra) · reduces every queue wait

- At 3 jobs the hosts are at 35–40% of their cores, and two-thirds of slot-time belongs to other
  repos. Per the `runner-hosts-accommodate-repos` rule, the fix is host capacity, not changes to
  the other repos.
- **Risk:** each job has an 8-CPU quota, so 4 × 8 = 32 nominal CPUs on 16 cores. Co-resident
  Stryker and coverage jobs would contend. The memory worst case of 4 heavy jobs at 4–7 GiB each
  is tight on x300 (27 GiB). Trial on kumo first, and use the snapshots' PSI and `oom_kill`
  counters as the go/no-go check. sora stays at 1.
- Do S1 and S2 first, so their measurements are not mixed with a capacity change.

### S4. Remove the `Full Lane Ready` pass-through hop · saves 0.4 min median, up to 5.5 min p90

- The job only echoes `Detect Changed Files: success`. Every full lane can check
  `needs.detect-changes.result == 'success'` directly, which removes one dispatch cycle from
  every full-lane path. Check the composition guards and `pr-required-checks` for references.

### S5. Fold the non-required aggregator jobs into `Full Test Summary` · 3 fewer jobs per PR and one fewer tail hop

- `full-backend-tests`, `full-frontend-tests` and `full-critical-mutation` are not required
  contexts. Their result checks can run as steps inside `full-test-summary`, which `needs` the
  leaf jobs directly. The required contexts `Full Test Summary` and `PR Required Checks` are
  unchanged. Measured cost of each aggregator hop today: 0.1–1.8 min.
- Do this in the same PR as S2 and S4. All three edit the test.yml graph and the same guards.

### S6. Rebalance the critical-mutation shards · saves up to about 4 min, only once test.yml's other lanes are shorter

- Shards take 9.5, 1.2 and 5.4 min. Splitting `addressDerivation/**` between shards 1 and 2,
  using the mutant counts from the shard JSON reports, should bring the longest shard to about
  5.5 min. This pays off only once frontend coverage (10.2 min) is no longer tied for the floor.
  Until then it is a slot-time saving only.

### S7. docker-build: remove the unexplained `build-backend` → `build-frontend` edge · not required, about 7–10 min on image PRs

- The edge dates from 2026-05 (61c8b84270) and has no comment. `build-backend` then queues a
  median of 7 min, and the workflow median rose from 4.5 to 14.8 min. First confirm that the
  backend image does not use the frontend build output, and that the two buildx builds do not
  share a builder name.

### S8. Un-pin the Trezor emulator from x300 · small

- The pin is meant to last "until the fleet archive-health recovery unit is deployed".
  `forgejo-runner-archive-health` and `-archive-recover` are now installed on kumo and x300.
  Moving the job to plain `docker-socket` removes a single-host queue (p90 4.3 min). Confirm with
  runner-infra that the recovery is active, not just installed.

### S9. Consolidate quality.yml's small jobs · slot pressure only

- Eleven jobs start at t=0 on every PR and take slots just as the critical-path jobs need them.
  Merging the sub-minute ones (lockfile peer resolution, gitleaks, large-file classification,
  workflow policy guards) into one job removes about 4 dispatches per PR. The required context is
  the aggregator, so it is unaffected.

---

## 5. Not recommended

- Removing the release-candidate serialization (`wallet-sync-maximum-shapes` after
  `wallet-sync-live-shape`). That gate has latency thresholds, and a co-located run already failed
  its p99 probe (286 ms against 250 ms, noted on #1344).
- Concurrency inside CPU-quota-bound jobs (the R4 lesson), Stryker `incremental` for the proofs,
  or dropping `disableBail`. The map check needs the complete `killedBy` set (#844).
- Dropping the verify-vectors push-to-main run. #1347 kept it on purpose, because the classifier
  requires funds-safety evidence for every landed commit. S1 shortens it anyway.
- Positive path filters on verify-vectors, lower coverage thresholds, or non-blocking lanes.

---

## 6. Expected result (*estimate*)

| Change set | Required-green median |
|---|---|
| Today | 25.7 min |
| S1-A | about 20 min (test.yml becomes the floor on backend PRs) |
| S1-A + S2 + S4 + S5 | about 17 min |
| + S1-B | about 15–16 min |
| + S3 | queue p90 should fall below the current 6.4 min; measure, don't assume |

---

## 7. Sequencing (merges are serial)

| PR | Items | Validation |
|---|---|---|
| 1 | S1-A + `sourceSha256` re-pin | 5+ PR runs: all 7 reports uploaded, map check green, mutation results identical to the baseline, `workflow_dispatch` prints "Vectors unchanged" |
| 2 | S2 + S4 + S5 (test.yml graph) | 5+ full-lane runs on all 3 hosts; `oom_kill` = 0 for integration Postgres; composition guards updated |
| 3 | S1-B, only if PR 1's numbers support it | Per-proof durations; the map check runs once, after both jobs |
| 4 | S7 + S8 | 3+ image-scope runs, 5+ verify-vectors runs placed on kumo |
| runner-infra | S3 | Re-run this analysis's snapshot extraction for a week |
| later | S6, S9 | — |

The scratch scripts behind this report (run and job-log fetch, `needs`-aware queue computation,
snapshot load/PSI and task attribution) are about 200 lines of Python and awk. The existing
`scripts/ci/report-*.sh` tools cannot run outside a CI job: `create-registered-staging.sh`
refuses without the coordinated runtime. A read-only `--local` mode would make before/after
comparisons for the PRs above repeatable.

---

## 9. Re-measurement after round 3 (2026-10-06)

Window: 2026-10-05 13:57 to 2026-10-06 08:16 HST. 9 PRs had all required workflows succeed:
#1373–#1379 and #1381 (#1380 is an issue, not a PR). Tools: `tasks/ci-latency-tools/`.

| Measure | Before (09-30..10-05) | After |
|---|---|---|
| Required-green, PR median | 25.7 min | **28.1 min** (max 42.8) |
| verify-vectors wall, push to main | 23.6 min | **10.4 min** |
| verify-vectors wall, PR | 25.5 min | 24.9 min |
| verify-vectors jobs / slot-min per run (PR) | 6 / 24.3 | 9 / 29.9 |
| Job queue wait after dependencies (all jobs) | med 1.5, p90 6.4 min | **med 2.3, p90 11.3 min** |
| verify-vectors start / mutation-fee queue | 3.4 / – min | 8.5 / 9.5 min |

**Reading:**
- **Less work on the critical path.** Push runs, which have little contention, show it: verify-vectors is 2.3 times faster. When a slot is free, test.yml's lanes finish by about 11–13 min.
- **No PR-time gain.** At PR time every workflow of a PR fires together on 7 slots that another repository also uses (about 2/3 of fleet slot-time). The extra jobs from the split queue, so wall-clock time does not improve. This is the #884 lesson: splitting into more jobs pays only when slots are idle.
- **The window is not representative.**
  - Almost every PR changed workflows or dependencies, which triggers every workflow at full scope.
  - Several runs had cold Stryker caches; the cache key changed in #1377.
  - Lifecycle canaries held the whole fleet twice.
  - The kumo 4-slot trial was running for about 4 hours, plus manual dispatches.

**Next:**
- Re-measure on about 10 organic PRs (application changes, warm caches, no fleet experiments) before changing more.
- If PR-time verify-vectors is still about 25 min, fold the mutation-map join back into `summary`, or rejoin the two mutation jobs. The extra jobs cost about 2–5 slot-min per run and add a queue hop.
- The binding constraint is fleet slots under shared load. A fourth slot per host failed on CPU (S3), so the remaining levers are more hardware or fewer jobs per PR, not more parallelism.
