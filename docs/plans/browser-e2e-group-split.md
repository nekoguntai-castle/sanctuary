# Browser E2E Group Split

Status: in progress (steps 1, 2 and 4 done; step 3 next, and it now covers `admin-auth`)
Date: 2026-11-07
Follows: #1476 (4-CPU browser child), #1477 (live `CI browser CPU` notice);
step 4 of `docs/plans/browser-sandbox-cpu-headroom.md`

## Background

#1476 raised the sandboxed Chromium child to 4 CPUs, and #1477 made each
group's throttling visible in the live job log. With both in place, the CPU cap
is no longer the bottleneck. A busy host is:

| Run | Host context | `wallet-lifecycle` | Child throttling (all groups) |
|---|---|---|---|
| 22626 (job 280911), before #1476 | x300, beside mutation work | 257 s, **hard-budget failure** | 77 s |
| 22696 (job 281614), #1476 | quiet | 157 s | 0 (last group only) |
| job 281785, #1477 | x300, beside Critical Mutation Gate shards 2 and 3, load ~14 on 16 CPUs, CPU PSI some 7–11% | 221 s, **19 s under budget** | 0 for every group |

Every group is budgeted at 120 s (warning) and 240 s (hard) in
`.github/ci-performance-budget.json`. All four groups now exceed the warning on
every run (136–221 s). `wallet-lifecycle` is the only one that has crossed the
hard budget, and on a co-scheduled host it sits within 10% of it. Raising the
cap again buys nothing, because the child is not being throttled. The budget is
not raised without evidence, per the CPU plan's step 4.

Facts that shape the fix:

- **CI runs Playwright with `workers: 1` and `retries: 2`**
  (`config/tooling/playwright.config.ts`). A group's duration is the sum of its
  test runs, including retries. `wallet-lifecycle` has 57 tests and runs both
  `chromium` and `mobile-chrome` (114 test runs).
- **Groups are deterministic and checked.** `scripts/ci/browser-e2e-groups.sh`
  owns the assignment, `--check` proves every top-level spec is in exactly one
  group, and `tests/ci/browser-e2e-groups.test.sh` pins some of the assignments.
  The groups run one after another inside one job. Browser job fan-out is still
  deferred (`docs/reference/ci-cd-strategy.md`, "Full browser-flow E2E").
- **Splitting a group does not shorten the job.** It lowers each group's
  exposure to its own budget. Each group pays one extra sandboxed browser
  container create/retire and Playwright start, an overhead not yet measured.
- **Per-spec timing exists but is lost.** `scripts/ci/playwright-timing-reporter.cjs`
  writes `playwright-timing.{json,md}` into `test-results/`. Playwright clears
  that directory before each group, so the uploaded artifact holds only the last
  group (`wallet-experience`). The reporter already honours
  `PLAYWRIGHT_TIMING_OUTPUT_DIR`.
- **Retries inflate groups silently.** #1476's run shows
  `node-status-card-responsive.spec.ts` failing once and passing on retry. That
  costs a full extra test run inside its group's budget.

`wallet-lifecycle` spec sizes (test count × 2 projects):

| Spec | Tests | Lines |
|---|---:|---:|
| `create-wallet-flow.spec.ts` | 15 | 887 |
| `import-wallet-flow.spec.ts` | 13 | 629 |
| `user-journeys.spec.ts` | 24 | 411 |
| `wallet-remediation.spec.ts` | 5 | 322 |

## Steps

### 1. Keep per-group spec timing

In `scripts/ci/run-browser-e2e-subject.sh`, set
`PLAYWRIGHT_TIMING_OUTPUT_DIR` per group, e.g.
`.tmp/ci-timing/browser/<group>`. That location is outside `test-results/`, so
Playwright's cleanup can't remove it. Upload that directory on every run, next to
`playwright-results-browser`, with short retention. This is cheap and also helps
diagnose any later budget failure.

Done: each group writes to `.tmp/ci-timing/browser/<group>/`, uploaded as
`playwright-timing-browser` (`if: always()`, 14-day retention).

### 2. Measure

Collect per-spec durations for `wallet-lifecycle` from at least three runs, one
of them co-scheduled with a mutation job. Use the two existing projects. Also
record the fixed per-group overhead: the time from the group's start to its
first test, plus teardown. Record the numbers in this plan.

Done, from the `playwright-timing-browser` artifacts of #1481's three runs
(2026-11-07). Every run shared its host with mutation work, which happens on
every PR because mutation and browser jobs start together. No test retried in
any of them, and the child reported `nr_throttled=0` in every group.

| Run (job) | Host context | `wallet-lifecycle` group | of which tests |
|---|---|---:|---:|
| 22812 (282758) | sora, Critical Mutation Gate shard 3 + `mutation-proofs-fee`, load 14.2, CPU PSI some 11% | **255 s, hard-budget failure** | 244 s |
| 22833 (283029) | x300, shard 1 + `mutation-proofs-binding`, load 14.2, CPU PSI some 8.6% | 220 s | 210 s |
| 22845 (283170) | sora, shard 3, load 9.2, CPU PSI some 2.3% | 214 s | 206 s |

The group's fixed overhead (sandbox create, Playwright start, report,
teardown) is the difference: **8–11 s**.

`wallet-lifecycle` per spec, both projects (s):

| Spec | 22812 | 22833 | 22845 |
|---|---:|---:|---:|
| `user-journeys.spec.ts` | 92 | 79 | 73 |
| `create-wallet-flow.spec.ts` | 80 | 70 | 75 |
| `import-wallet-flow.spec.ts` | 48 | 41 | 39 |
| `wallet-remediation.spec.ts` | 23 | 20 | 18 |
| create + import | **128** | **111** | **115** |
| journeys + remediation | **115** | **99** | **92** |

The other groups (group time, s):

| Group | 22812 | 22833 | 22845 |
|---|---:|---:|---:|
| `admin-auth` | 180 | 200 | 193 |
| `wallet-transactions` | not run | 162 | 159 |
| `wallet-experience` | not run | 140 | 148 |

(22812 stopped after `wallet-lifecycle` failed.) `admin-auth` is 180–200 s on
every run, so it is within 25% of its 240 s hard budget and is split too, under
the rule in step 3. Its specs (s):

| Spec | 22812 | 22833 | 22845 |
|---|---:|---:|---:|
| `admin-operations.spec.ts` | 63 | 73 | 70 |
| `accessibility.spec.ts` | 58 | 67 | 68 |
| `auth.spec.ts` | 44 | 43 | 38 |
| `admin-drafts-smoke.spec.ts` | 7 | 8 | 8 |

### 3. Split `wallet-lifecycle` by measured duration

Split it into two groups of roughly equal measured time. The test counts point
to `create-wallet-flow` + `import-wallet-flow` (28 tests) and
`user-journeys` + `wallet-remediation` (29 tests), but the measurements from
step 2 decide. Name the groups by what they cover (for example
`wallet-create-import` and `wallet-journeys`), and in the same change:

- update `browser-e2e-groups.sh` (group constants, `list_groups`,
  `list_group_specs`);
- give each new label its own entry in `.github/ci-performance-budget.json` at
  the same 120 s / 240 s, and remove the old `wallet-lifecycle` entry. A label
  with no entry is reported as `unbudgeted` and silently loses its hard limit;
- update `tests/ci/browser-e2e-groups.test.sh`, which asserts that
  `wallet-lifecycle` exists and that `user-journeys.spec.ts` belongs to it;
- run `scripts/ci/browser-e2e-groups.sh --check`, the `check-workflow-composition`
  suite and `report-timing-notices`.

Splitting the other groups is out of scope unless step 2 puts one of them
within 25% of the hard budget on a co-scheduled host.

Step 2 did this for `admin-auth`. The measured split is `admin-operations` +
`admin-drafts-smoke` (70–81 s) against `auth` + `accessibility` (102–110 s).
Each half then sits well under the 180 s acceptance line, with the 8–11 s group
overhead on top. `wallet-transactions` (159–162 s) and `wallet-experience`
(140–148 s) stay as they are.

### 4. Track the retried spec separately

File the `node-status-card-responsive` retry as its own issue with the trace
from the retry artifact. A flaky test belongs in a test fix, not a group split.

Done: #1479 fixed the `node-status-card-responsive` overflow retry (and a
`send` redirect retry) directly, so no separate issue was filed.

## Not doing

- **Raising the CPU cap.** The child reports zero throttling, so more CPU
  would not help.
- **Raising the budget.** That hides host contention. Revisit only if a split
  group still exceeds 75% of its hard budget on quiet hosts.
- **`workers: 2`.** It would need the cap headroom to stay unused on busy
  hosts, it doubles concurrent fixture load against one seeded account, and
  it does nothing for host contention.
- **Browser job fan-out.** That stays deferred by `ci-cd-strategy.md`.

## Acceptance criteria

- Per-group `playwright-timing.json` is uploaded on every Browser E2E run.
- Step 2 measurements are recorded in this plan.
- On at least three green runs, including one co-scheduled with a mutation
  job, every browser-flow group finishes at least 60 s under its hard budget.
- `browser-e2e-groups.sh --check` passes, every group label has a budget
  entry, and the CI lane tests are updated. Required PR checks are green.

## Delivery

One PR for steps 1–3 once the step 2 data is in. Step 1 may land first on its
own, since it only adds evidence.
