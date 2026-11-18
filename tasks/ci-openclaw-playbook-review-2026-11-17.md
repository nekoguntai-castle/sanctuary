# CI review against the OpenClaw playbook

**Date:** 2026-11-17
**Type:** analysis only. Nothing here has been implemented.
**Input:** the OpenClaw CI playbook (Vincent Koc, "Making CI faster and 95% cheaper").
**Predecessor:** `reports/ci-speedup-analysis-2026-10-05.md` (round 3).

## 1. Summary

Most of the playbook is already in place here: path classification with job-level `if` gates,
no heavy lanes on push to `main` (#1347), cancellation of superseded PR runs, local hooks, and
measurement tooling. The remaining waste is concentrated in **mutation testing, which is about
40% of all runner-minutes**, and in work that repeats a result already proved.

| # | Finding | Runner-min/week now | Estimated saving | Needs a policy decision |
|---|---|---|---|---|
| R1 | The PR mutation gate runs on every "full scan" trigger, not only on mutation inputs | 1,138 (15.8%) | 300–600 | No |
| R2 | verify-vectors re-runs on push to `main` on a tree its PR already proved | 742 (10.3%) | about 700 | Yes (funds-safety evidence rule) |
| R3 | verify-vectors runs in full on PRs that touch no wallet-safety path | 1,046 (14.5%) | 300–600 | Yes (no-path-filter rule) |
| R4 | The nightly mutation run repeats on nights when `main` did not change | 722 (10.0%) | 270–320 | No |
| R5 | Half of all jobs last under a minute, and each one waits for a runner slot | 324 (4.5%) | queue time, not minutes | No |
| R6 | The daily browser-toolchain freshness check has never run on schedule | 0 | none (a defect) | No |

Do not add the savings together. R2 and R3 overlap, and the estimates use one week's traffic.

Recommended order: R6 (defect), R1, R4, R5, then R2 and R3 if you accept the policy change.

## 2. Data and window

| Source | Window | Used for |
|---|---|---|
| Forgejo `actions/runs` | 1,500 runs, 2026-10-21 to 11-17 | Runs by workflow, event and outcome |
| Forgejo `actions/tasks` | 5,987 jobs, 2026-11-04 to 11-17 (12.4 days) | Runner-minutes per job (`run_started_at` to `updated_at`) |
| `git log origin/main` | 61 commits in the same 12.4 days | Which lanes each merged change forced |
| Workflow YAML and classifiers at `b37c531d4` | — | Trigger and gate logic |

Last 7 days: 252 runs, 1,779 jobs, 7,187 runner-minutes. All calls were GET-only.

Limits of this review:

- I did not measure queue time or time to required-green this round. Wall-clock effects below
  are inferred from the round-3 measurements, not re-measured.
- Skipped jobs create no task record, so job counts are for jobs that started.
- I did not audit cache hit rates, or which tests are redundant.

## 3. Where the runner-minutes go (last 7 days)

| Workflow and event | Jobs | Runner-min | Share |
|---|---|---|---|
| test.yml, pull_request | 358 | 2,197 | 30.6% |
| test.yml, schedule | 119 | 1,165 | 16.2% |
| verify-vectors.yml, pull_request | 244 | 1,046 | 14.5% |
| verify-vectors.yml, push | 181 | 742 | 10.3% |
| install-test.yml, push (tags) | 20 | 301 | 4.2% |
| quality.yml, pull_request | 257 | 248 | 3.5% |
| release-candidate.yml, pull_request | 59 | 239 | 3.3% |
| release-candidate.yml, schedule | 56 | 223 | 3.1% |
| docker-build.yml, pull_request | 112 | 222 | 3.1% |
| install-test.yml, pull_request | 38 | 190 | 2.6% |
| quality.yml, push | 195 | 184 | 2.6% |
| everything else | 140 | 430 | 6.0% |

Mutation jobs alone:

| Job | Event | Runner-min | Share |
|---|---|---|---|
| Full Critical Mutation Gate (3 shards) | pull_request | 1,138 | 15.8% |
| Full Critical Mutation Gate (3 shards) | schedule | 722 | 10.0% |
| Wallet-safety mutation proofs (fee + binding) | pull_request | 588 | 8.2% |
| Wallet-safety mutation proofs (fee + binding) | push | 399 | 5.5% |
| **Total** | | **2,847** | **39.6%** |

Cancelled jobs cost 1.7% of runner-minutes over 7 days and 4.5% over 12.4 days. Failed jobs cost
0.4% and 3.4%.

## 4. Findings

### R1. Separate the mutation gate from the generic full-scan flag

`full-critical-mutation-shards` runs when `critical_mutation_changed` **or** `full_scan` is true
(`.github/workflows/test.yml:1295`). `full_scan` is set by any root or package `package.json`,
anything under `config/tooling/`, `test.yml`, and the test-lane infrastructure files
(`scripts/ci/classify-files-lib.sh:615`).

Of the 61 commits merged in the window, 26 ran the mutation gate:

| Reason | Commits |
|---|---|
| A critical mutation file changed | 5 |
| Full scan only: release version bump (only the `"version"` line changed) | 8 |
| Full scan only: `config/tooling/eslint.config.js` | 3 |
| Full scan only: `.github/ci-performance-budget.json` | 3 |
| Full scan only: `scripts/ci/**` and one ownership script | 6 |
| Full scan only: real dependency change | 2 |

So 21 of 26 runs came from the full-scan flag, and at least 14 of them (version bumps, ESLint
config, performance budget) changed nothing that Stryker mutates or loads. Each run costs about
47 runner-minutes. The shard median was 28.6 minutes last week, so it is also the test.yml tail
on those PRs.

Proposal: give the mutation lane its own input set (`mutation_full_scan`): the critical files it
already lists, `server/` dependency changes, the Stryker and Vitest configs, `test.yml`, and the
scripts the mutation job calls. An unknown file still widens to the full run. Add a classifier
test, as the strategy doc requires for any trigger change.

Open choice: release-prep PRs are 8 of the 14. Keeping them exhaustive is defensible as a
release gate. With them kept, the saving is about 300 runner-minutes a week; without, about 600.

### R2. Stop re-proving the same tree on push to `main` in verify-vectors

For 40 of the last 40 merged PRs, the tree of the commit on `main` is identical to the tree of
the PR head. Squash merge with `block_on_outdated_branch: true` guarantees this. It is the same
argument that removed test, docker-build and install-test from push in #1347.

verify-vectors still runs all eight jobs on each push: 742 runner-minutes a week, on
`docker-socket` slots that the next PR in the serial merge queue is waiting for.

Proposal: keep the push trigger, and extend `determine-verify-scope` to prove tree identity. It
finds the merged PR, compares `HEAD^{tree}` with the PR head tree, and checks that the PR head
has a green `Verify Bitcoin Vectors / summary`. When all three hold, the proof jobs skip and the
summary records which run proved the tree. Anything else fails closed to the full run: a direct
push, a hotfix, a mismatch, or an API error.

This changes the "funds-safety evidence for every landed commit" rule that
`scripts/ci/check-wallet-safety-classifier.mjs` enforces, so it is your decision. The evidence
would still exist for every landed tree; it would be referenced, not regenerated.

The same argument applies to `quality.yml` on push (184 runner-minutes a week). I would leave
`architecture.yml` alone: it is not a required PR check, so its push run is the real signal.

### R3. verify-vectors runs in full on PRs that touch no wallet-safety path

The only early exit is documentation-only changes. Of the 61 merged commits:

| Change | Commits |
|---|---|
| Documentation only (skipped) | 4 |
| Touches a path in `config/wallet-safety-critical-paths.json` | 21 |
| Touches none of the 172 listed paths | 36 |

Of those 36, 17 changed CI or package files that would reasonably stay in scope. The other 18
(30% of merges) changed neither. Each still paid about 37 runner-minutes and waited about 21
minutes for the last required check.

The workflow forbids positive path filters on purpose: a filter can miss a new funds boundary.
The playbook's answer is a derived negative proof, which this repo already uses for the browser
and render lanes (`tests/ci/browserSmokeInputsClassified.test.ts`). Skip only when every changed
file is provably outside the import closure of the verifier, the proofs and the emulator
harnesses, and outside the CI control plane and lockfiles. A test fails if a reachable file is
unclassified.

This is a larger design change and a deliberate policy reversal, so I list it as an option, not
a recommendation. My path matching against the inventory was approximate; re-check the 18 before
relying on the number.

### R4. Skip the nightly mutation run when its inputs did not change

The nightly `test.yml` run costs 1,165 runner-minutes a week, and 722 of that is the three
mutation shards. In the last 27 days, 10 nights had no commit to `main`, and 12 had none
touching `server/` or `shared/`.

Stryker on an unchanged tree with pinned dependencies gives the same result. Proposal: on
schedule, skip the mutation shards when `main` has no `server/`, `shared/` or lockfile change
since the last green scheduled mutation run, and keep one unconditional weekly run. Estimated
saving: 270–320 runner-minutes a week.

Keep the rest of the nightly as it is. The install, browser and release-candidate lanes depend
on outside state (registries, images, "latest-stable"), and they have caught time-bomb failures
that an unchanged tree would not predict.

### R5. Pack the sub-minute jobs

871 of 1,779 jobs last week ran for under a minute. They used only 324 runner-minutes, but each
one asks for a runner slot, and round 3 measured a median slot wait of 1.5 minutes (p90 6.4).

`quality.yml` is the clearest case. A PR run starts about 10 jobs:

| Job | Median |
|---|---|
| CI classifier tests | 272 s |
| Lint | 67 s |
| SAST (Semgrep) | 52 s |
| Duplication (jscpd) | 46 s |
| Cyclomatic complexity (lizard) | 43 s |
| Secret scan (gitleaks) | 41 s |
| Lifecycle callsite registry | 37 s |
| Determine Quality Scope | 17 s |
| Large-file classification | 14 s |
| Code Quality Required Checks | 7 s |

Its median PR wall time was 11.5 minutes last week (17.7 over 27 days), against about 8
runner-minutes of work with a 4.5-minute longest job. That gap is probably queueing, though I
did not measure it this round.

Proposal: run the six short scanners as separately timed steps in one job, after one checkout.
That removes about five slot requests per run, roughly 250 a week. Check first that the tools
can share one image. Other candidates: fold `Wallet-safety mutation map` into the verify-vectors
summary, and the info and summary relays in release-candidate.

### R6. The daily freshness check has never run on schedule (defect)

`.github/workflows/browser-toolchain-freshness.yml:15` gates its only job on
`github.ref == format('refs/heads/{0}', github.event.repository.default_branch)`. All 13
scheduled runs since 2026-11-04 report the job as `skipped`. The one manual dispatch succeeded.

Likely cause, not verified: Forgejo's schedule payload is `{"action":"schedule"}`, so
`github.event.repository.default_branch` is empty and the comparison is always false. Comparing
against `'refs/heads/main'`, or dropping the condition, should fix it. Per the repo rule, write
the failing check first (a workflow-composition test) and then fix.

## 5. Playbook checklist

| Item | State | Note |
|---|---|---|
| No duplicate push + PR runs | Mostly done | verify-vectors and quality still repeat on push (R2) |
| Cancel superseded PR runs | Done | All PR workflows; cancelled cost 1.7–4.5%, so an admission delay is not worth adding |
| Skip early with job-level `if` | Done | Classifier jobs in test, quality, verify-vectors, install, docker-build, architecture |
| Unknown changes widen | Done | But the widening is broader than needed for mutation (R1) |
| Every cron has an owner and is read | Gap | Freshness cron never runs (R6); nightly mutation repeats (R4) |
| Heavy scanners off every push | Done | Semgrep is 52 s per PR; full quality run is weekly |
| `workflow_dispatch` defaults cheap | Minor gap | `test.yml` dispatch is always the full scan (about 51 min); 4 runs in 27 days |
| Local hooks | Done | Pre-commit runs tests and cached AI review; no AI review in CI |
| Caches verified | Not audited | |
| Shards packed | Partly | 3 mutation shards and 2 backend shards are measured; small jobs are not packed (R5) |
| Runner size | Not applicable | Fixed self-hosted fleet |
| Baseline and after measurement | Done | `tasks/ci-latency-tools/`, `scripts/ci/report-workflow-*.sh` |

Ideas from the guide that I checked and would not pursue now:

- **Deleting tests.** Test code is 657k lines against 363k lines of source (1.8 to 1), with no
  line budget. The 100% coverage thresholds make deletion expensive to prove safe. A budget
  that only reports growth would be cheap; I did not look for redundant tests.
- **Vitest `isolate: false`.** No config sets it. Frontend coverage takes about 10 minutes and
  the backend unit shards about 4.5 each, so there may be a gain, but shared state between test
  files is a real risk. Measure locally before deciding.
- **Blobless checkouts.** `fetch-depth: 0` appears 19 times and no job uses a blob filter. The
  repository is about 72 MB, so the gain is small.
- **Render E2E.** It took a median of 20 minutes last week with a mocked API and three workers.
  The timing notices would show whether that is setup or spec time. Not analysed here.

## 6. How to measure after a change

Use the 7 days to 2026-11-17 as the baseline: 252 runs, 1,779 jobs, 7,187 runner-minutes.
Re-run the task aggregation for 7 days after each change, and report runner-minutes by workflow
and event next to the number of merged PRs, since traffic changes the totals. For R1, R2 and R5,
also re-run `tasks/ci-latency-tools/reqgreen.py` to confirm that time to required-green did not
get worse.

## 7. Implemented on 2026-11-17 (R6 and R1)

**R6.** The freshness job now gates on `github.ref == 'refs/heads/main'`. The cause was
confirmed from the run records: the schedule payload is `{"action":"schedule"}` with no
`repository` object, while the manual dispatch payload has one.
`tests/ci/browser-toolchain-freshness.test.sh` now rejects any guard built from
`github.event.repository`.

**R1.** The classifier emits `critical_mutation_required`, decided over the whole diff. The
mutation shards and `Full Test Summary` use it in place of `full_scan`. A full-scan trigger
skips the gate only when `is_mutation_irrelevant_full_scan_trigger_file` names it; a drift guard
in `tests/ci/classify-test-changes.test.sh` fails if the mutation jobs can reach a listed file.

The measured effect is smaller than the estimate in section 4. Replaying the new rule over the
same 61 merges, the gate runs for 22 instead of 26. The four that now skip are the three ESLint
config changes and one browser-sandbox script change. The exclusion list was kept conservative:

| Still runs the gate | Merges | Why it stayed |
|---|---|---|
| Release version bumps | 8 | Manifests and lockfiles are gate inputs; telling a version-only bump apart needs a content check |
| `.github/ci-performance-budget.json` | 3 | `time-command.sh` reads the mutation shard budgets from it |
| Other `scripts/ci/**` changes | 4 | Shared helpers the mutation job runs, or not proved unreachable |

At about 47 runner-minutes a run, the saving is roughly 100 runner-minutes a week at this
traffic, not 300–600. The two remaining levers are a version-only check for release bumps and a
per-entry check for the budget file. Both need a decision, because both read file content, not
only paths.

## 8. Second pass: the Zo additions (2026-11-17)

The playbook gained two lessons (find the job everyone waits on; give agents a CI budget) and
some tagged lines (faster tools, cache overhead, measured parallelism). This section checks each
against measurements. Nothing in this section is implemented.

**Correction to section 2.** 2,133 of the 6,000 task records, all from 2026-11-04 to 11-07, have
an `updated_at` about a day after the job ended. I had counted those as zero minutes, so the
12.4-day totals are too low and should not be used. The 7-day figures (2026-11-10 to 11-17) do
not include those records and stand.

### 8.1 Critical path (lesson 8): applies, and is the best item in either pass

Over the last 7 days, 19 PR head SHAs had all three required workflows green.

| Measure | Median | p90 |
|---|---|---|
| Time to required-green | 21.8 min | 46.3 min |
| `test.yml` wall | 19.0 min | 46.3 min |
| `verify-vectors.yml` wall | 21.3 min | 33.3 min |
| `quality.yml` wall | 11.5 min | 29.6 min |

The job that finished last was `Wallet-safety mutation proofs (fee)` on 8 of 19 and a
`Full Critical Mutation Gate` shard on 8 of 19. So the critical path is mutation both ways.

The long jobs start late, because they queue behind the same PR's short jobs:

| Wait | Median | p90 |
|---|---|---|
| verify-vectors: scope job end to fee proof start | 254 s | 867 s |
| test.yml: detect job end to first mutation shard start | 281 s | 479 s |
| quality.yml: scope job end to first job start | 239 s | 749 s |
| Any workflow: run created to its scope job start | 2–5 s | about 300 s |

When the fee proof finally started, a median of 15 jobs from the same PR had started ahead of
it, and all 8 running Sanctuary jobs belonged to that PR. A PR opens five workflows. Their scope
jobs start at once, and then about 25 jobs become ready together for a fleet that runs about 8.
The 13-minute fee proof gets no priority over a 14-second scanner.

Three ways to act on it, in order of value:

- **C1. Start the long verify-vectors jobs without waiting for the scope job.** The fee proof,
  binding proof and core vector job each `needs: [determine-verify-scope]`. They ran on 57 of 61
  merges, so the scope job rarely saves a runner. If each job ran the classifier as its first
  step and exited early on documentation-only changes, the jobs would be ready at run creation,
  when slots are usually free (2 s median wait). Estimate: about 4 minutes off the
  verify-vectors median, more at p90. Cost: three short runner allocations on docs-only PRs
  (4 of 61). `verify-vectors.yml` is provenance-pinned, so the vectors must be regenerated with
  the change.
- **C2. Cut the number of short jobs a PR starts** (R5 in section 4). This now has a measured
  reason: those jobs are what the critical path waits behind.
- **C3. Rebalance the mutation shards.** Last week shard 2 took a median 39.2 minutes and shards
  1 and 3 took 28.5 and 28.6. The shard file lists are hand-assigned in
  `server/scripts/mutation/shards.mjs`. An even split of the 95 minutes of work is about
  32 minutes, so moving one or two files from shard 2 should save about 7 minutes on PRs that
  run the gate, with no extra runner. The Stryker profile configs pin mutate ranges, so check
  each canary is still present and killed after the move.

I did not test whether Forgejo hands out ready jobs in a fixed order. If it does, ordering alone
might help; treat that as unknown.

### 8.2 Faster tools (lesson 5): does not apply

Step timings from sampled job logs of one full-scan PR run (23792):

| Step | Time | Note |
|---|---|---|
| Frontend app, test and catch-all typechecks | 1 s, 3 s, 2 s | Whole job 32–42 s, of which install is 15–20 s |
| Server test typecheck | 10 s | Whole job 117 s, of which install was 74 s on a cache miss |
| Lint job | 67 s median, including setup | Not on the critical path |
| Frontend install | 15–25 s | |
| Workspace install | 44–74 s on a cache miss, skipped on a hit | |

The typechecks and lint are already far below the mutation and browser lanes, and none of them
is on the critical path. Oxlint, Oxfmt and the native TypeScript compiler would save seconds on
jobs nobody waits for, and each swap risks losing rules or checked files. `bun install` would
bypass the npm lockfile, the install-script policy and the supply-chain locks that the
funds-critical packages depend on. I would not trial any of the four here.

### 8.3 Cache overhead (lesson 6): one thing worth a look

In run 23792 the workspace `node_modules` cache missed in several jobs that started together
(backend typecheck 74 s of install, backend coverage shard 56 s, build check 60 s, browser 44 s),
while the mutation shard that started later hit it. Each early job paid the full install in
parallel. That is expected on a PR that changes a manifest, and I sampled only one run. To judge
it properly, compare cache-hit and cache-miss install times across about 20 runs with
`scripts/ci/report-timing-notices.sh`.

### 8.4 Measured parallelism (lesson 7): one experiment

`Full Render E2E Tests` spent 1,104 of its 1,154 seconds in the Playwright run. It is the
`test.yml` tail on frontend PRs that do not run the mutation gate (about 20 minutes, against
10–12 for frontend coverage). The job's own CPU notice reads `usage_usec=3087037075
nr_throttled=0`: about 2.8 CPUs used on average, under a 4-CPU limit, with no throttling, on
three workers. A fourth worker is a cheap trial. Record the wall time and the throttling counter
before and after; if throttling appears, revert.

The frontend coverage shards ran 631 s and 735 s side by side in one job. That is balanced
enough to leave alone.

### 8.5 What each test needs to prove (lesson 8): not assessed

The render lane is the obvious candidate, since it re-renders many routes against a mocked API.
Deciding whether its cases repeat one assertion needs a read of the spec and the per-spec timing
file, which I did not do.

### 8.6 Agent CI budget and experiment log (lesson 9): partly in place

- A time budget exists: `.github/ci-performance-budget.json` holds warn and hard seconds per
  timed step, and `time-command.sh` enforces it.
- The strategy doc already requires a classifier test for any new expensive trigger.
- There is no experiment log. Results are spread over five `tasks/ci-speedup-*.md` files and
  this one, and dropped experiments are easy to repeat. Known ones: concurrency inside the
  verify-vectors job (dropped, the 8-CPU job quota was already the limit), a fourth runner slot
  on kumo (reverted for CPU contention), frontend coverage as separate matrix jobs (lost to
  queueing, PR #884), and browser matrix jobs (failed before checkout).
- There is no rule that a new check must state the failure it catches, what already covers it,
  and the seconds it adds.

A `docs/reference/ci-experiments.md` seeded from those files, plus a three-question rule in
`CLAUDE.md`, would be an afternoon's work and would have saved part of this review.

### 8.7 Order

C3 (rebalance shards) and the fourth render worker are small and reversible. C1 is the largest
gain for most PRs but touches the provenance-pinned workflow. C2 and the experiment log follow.

## 9. Results of the two follow-up experiments (2026-11-17, PR #1521)

### 9.1 Fourth render worker: no gain, reverted

| Run | Workers | Playwright time | Browser child CPU | Throttled |
|---|---|---|---|---|
| 23792 | 3 | 1,104 s | 3,087 CPU-s | 0 |
| 23944 (PR #1520, same day) | 3 | 1,032 s | 2,662 CPU-s | 0 |
| 23957 (PR #1521) | 4 | 1,076 s | 3,415 CPU-s | 0 |

The fourth worker used more CPU and saved no time. Worker count is not the limit in CI, even
though three workers finish the same suite in about 5 minutes locally. The change was reverted
before merge. What does limit it is not known; candidates are the preview server, serial
sections in the spec, and the Playwright runner outside the browser child. Each is one sample,
so differences under about 10% mean nothing.

### 9.2 Mutation shards: cannot be rebalanced by moving files

Section 8.1 proposed moving files out of shard 2. That does not work. Per-file test executions
from the merged report of run 23792:

| File | Test executions | Share of the gate |
|---|---|---|
| `addressDerivation/xpubConversion.ts` | 261,232 | 44.9% |
| `addressDerivation/descriptorDerivation.ts` | 120,571 | 20.7% |
| `signingIntent/schema.ts` | 40,742 | 7.0% |
| All 23 others | 159,404 | 27.4% |

Shard 2 is `xpubConversion.ts` plus three files worth 0.5%. Inside that file, 38 surviving
mutants ran 209,821 tests (about 5,500 each), against 51,411 for the 51 killed ones. A surviving
mutant runs every covering test, and the address vector suites cover this module thousands of
times. Across the whole gate, 644 survivors ran 317,160 tests and 3,357 killed mutants ran
264,789.

So the cost is in survivors, not in how files are split. New boundary tests
(`server/tests/unit/services/bitcoin/addressDerivation.xpubConversion-boundaries.test.ts`) kill
the eleven that were real gaps: nine private-key prefixes that no test named, the missing
private-key refusal in `convertXpubToFormat`, and the `Ypub` version bytes.

| Measure | Run 23792 | Run 23957 (with the tests) |
|---|---|---|
| `xpubConversion.ts` survivors | 38 | 29 |
| `xpubConversion.ts` test executions | 261,232 | 206,452 |
| Whole-gate test executions | 581,949 | 534,761 |
| Shard 2 duration | 35 min 4 s (40 min 57 s in run 23944) | 24 min 35 s |
| Slowest shard | shard 2, 35 min | shard 3, 36 min 32 s |

Two cautions. Shard times vary a lot by host: shard 3 took 25, 41 and 36 minutes across these
three runs with no change to it, so the shard 2 drop is partly noise and the gate's wall time
did not improve in this run. And the survivor count is not exactly 38 minus 11, because a few
mutants move between "timeout" and "survived" from run to run.

The 29 remaining survivors still cost 158,542 executions, 30% of the gate. By reading the code
they are equivalent mutants: the `prefix` field of `XPUB_VERSIONS` is never read,
`targetPrefix` is only compared, the `xpub` and `tpub` rows are identity conversions, and the
early-return guards at lines 88, 120 and 125 return what the fall-through path would also
return. Removing them needs a change to that funds-critical source file (and with it the
mutation-map line pins and the Stryker range pins), which is a separate decision.

### 9.3 The remaining survivors: removed (2026-11-17)

The 29 survivors left after 9.2 were checked one by one against a single rule: remove what
nothing depends on, keep and test what does something no other code covers.

| Survivors | What they were | Outcome |
|---|---|---|
| `prefix` and `targetPrefix` string literals, `xpub`/`tpub` table rows | A field never read, a field only compared with the key's own prefix, and two identity conversions | Removed. A standard key has no table entry and passes through as before. |
| Early return for a key already in the target format (`convertXpubToFormat`) | Leaves the key's exact version bytes alone; re-encoding would rewrite an off-canonical version to the canonical one | Kept, now tested with an off-canonical `Zpub`. |
| Unknown target format guard | Returns the key to an untyped caller instead of throwing | Kept, now tested, and tightened to own keys so `'constructor'` behaves like any other unknown format. |
| No-table-entry guard (`convertToStandardXpub`) | Pass-through for standard and unknown prefixes | Kept, now tested. |

These guards could not be killed before because each function wrapped decode, concat and encode
in one catch-all that returned the input, so removing a guard produced the same result by a
different route. The two functions now share one helper whose `try` covers only the base58check
decode.

Evidence: old and new source agree on 3,367,749 differential comparisons (160,369 inputs,
including short payloads, non-strings and inherited-key target formats); a Stryker run on the
file alone reports 49 mutants, 49 killed, none surviving, at about 61 tests per mutant, where
run 23957 had 95 mutants, 29 surviving, at about 2,170 tests per mutant.

Measured in CI (run 24000, PR #1522): shard 2 took 2 min 48 s, against 24 min 35 s in run 23957
and 35-41 minutes before #1521. The whole gate ran 379,818 test executions, against 581,949 in
run 23792.

### 9.4 Rebalancing the shards by wall time (2026-11-17)

With shard 2 at under 3 minutes, moving files became worthwhile. Test executions turned out to
be the wrong measure for it: in run 24000 shard 3 ran about 151,000 test executions and took
27 min 32 s, while shard 1 ran about 217,000 and took 21 min 53 s. Shard 3 has about seven times
as many mutants, and its tests are slower. CI logs carry no per-file timing, so four slices were
timed with Stryker on one host, start-up included:

| Slice | Mutants | Time |
|---|---|---|
| `descriptorDerivation.ts` alone | 225 | 753 s |
| `signingIntent/**` | 1,780 | 710 s |
| Broadcast, signing-intent repository, auth, access control | 1,528 | 494 s |
| The rest of address derivation (without `xpubConversion.ts`) | 222 | 313 s |
| PSBT validation, evidence contracts, `xpubConversion.ts` (CI, run 24000) | about 250 | 168 s |

The two largest slices cannot be split further without splitting a file or a directory, and
each is close to the sum of the other three less their shared start-up. The new layout is
therefore: shard 1 `descriptorDerivation.ts`, shard 3 `signingIntent/**`, shard 2 everything
else. The same 31 source files are mutated, each in exactly one shard.

The new shard 2 took 810 s as a whole on the same host, against 753 s and 710 s for the other
two, so the three are within about 15% of each other locally. CI times will differ by host.

`descriptorDerivation.ts` is now the floor for the gate. Its 12 surviving mutants run about
720 tests per mutant on average, so it is the next place to look, in the same way as
`xpubConversion.ts`.
