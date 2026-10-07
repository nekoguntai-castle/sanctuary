# CI speed-up round 3: implementation plan

**Date:** 2026-10-05
**Source:** `tasks/ci-speedup-analysis-2026-10-05.md` (items S1–S9)
**Base:** `origin/main` 30e00f2519
**Goal:** cut median time to required-green from 25.7 min to about 15–17 min, without changing
what runs, what blocks, or any threshold.
**Measurement tools:** `tasks/ci-latency-tools/` (README there). Baseline window:
2026-09-30 18:00 → 2026-10-05 HST.

## 0. Rules for every PR in this plan

- **Merges are serial.** Hold the next branch locally until the previous PR has merged and its
  push-to-`main` runs are green. Rebase only the next PR.
- **Retrigger discipline** (CLAUDE.md) applies to every red run: SHA, failure signature, new
  hypothesis and cheap discriminator before a second attempt.
- **Guard first.** For each removed edge, add the "must not need" assertion to the guard *before*
  editing the workflow, and confirm it fails against the unchanged workflow. This is the repo's
  equivalent of a non-regression test for CI graph changes.
- **Local gates before each commit:**
  - `bash tests/ci/check-workflow-composition.test.sh`;
  - `node --test tests/ci/check-github-action-runtimes.test.mjs tests/ci/subject-budget-workflows.test.mjs`;
  - `node scripts/ci/check-wallet-safety-classifier.mjs`;
  - the full `QUALITY_CI_CLASSIFIER_TESTS` heredoc from `quality.yml`;
  - the CLAUDE.md typecheck and test commands.
  - **When `verify-vectors.yml` changes, also:** `npx vitest run tests/scripts/verifyAddressesGenerated.test.ts tests/scripts/verifyPsbtProvenance.test.ts tests/config/*EmulatorProof*.test.ts tests/config/jadeProtocolHarness.test.ts`.
  - Run `/simplify` before committing, and commit in the foreground (pre-commit AI review).
- **Acceptance is measured, not assumed.** Each PR lists its numbers. Collect at least 5 PR runs
  that between them cover kumo, x300 and sora (sora only where the label allows). Roll back if p90
  regresses or `oom_kill` > 0 appears in the host snapshots for the touched jobs.

---

## PR 1: move the verify-vectors mutation proofs into their own job (S1, phase A)

**Expected saving:** verify-vectors from about 25.5 to about 19 min (the floor on 16 of 17 PRs).

### Changes to `.github/workflows/verify-vectors.yml`

1. Add a job `verify-vectors-mutation`, placed directly after `verify-vectors`:
   - `needs: [determine-verify-scope]`, with the same
     `if: needs.determine-verify-scope.outputs.run_verify_vectors != 'false'`.
   - The same `runs-on: docker-socket` and the same `container.image` (the `sanctuary-ci-go`
     digest), so the Node toolchain stays identical. `setup-node-toolchain` fails closed on image
     drift.
   - `timeout-minutes: 30`. Today's step bounds are 8 + 15 min, plus about 3 min of setup.
   - `env`: `DIAGNOSTIC_DIR: ${{ github.workspace }}/.tmp/ci-diagnostics/verify-vectors-mutation`,
     plus the same `SANCTUARY_CI_RUN_ID_OVERRIDE` and `SANCTUARY_CI_RUN_ATTEMPT_OVERRIDE`.
   - Steps:
     1. "Checkout repository" (pinned `actions/checkout`; a shallow fetch is enough, because the
        proofs need no history).
     2. "Verify Node.js toolchain" (`./.github/actions/setup-node-toolchain`, `install-npm: 'false'`).
     3. "Install server dependencies": copy the existing step unchanged (root `npm ci
        --strict-allow-scripts --ignore-scripts`, shared build, `prisma generate`, under the
        `node-toolchain` lock).
     4. "Prove PSBT account-binding invariants by mutation" and "Prove exact transaction fee
        invariants by mutation": **moved** from `verify-vectors`, with their timeouts (8 and 15)
        and their `check-wallet-safety-mutation-map.mjs` call unchanged. Optionally wrap each
        `npm run test:mutation:*` in `scripts/ci/time-command.sh "<proof name> mutation"` so that
        per-proof `CI timing::` notices exist; today there are none.
     5. "Upload PSBT account-binding mutation reports": moved, with the artifact name and all
        seven paths unchanged.
     6. The breadcrumb, diagnostic summary and diagnostics upload steps, copied with the artifact
        name `ci-diagnostics-verify-vectors-mutation` and the title "Verify Bitcoin Vectors
        (mutation)".
   - No subject budget step: this job starts no daemon subjects. If
     `subject-budget-workflows.test.mjs` or another guard demands one for every `sanctuary-ci-go`
     job, add "Capture job budget origin" and `subject-budget.mjs initialize` in the same shape as
     `verify-vectors`, and add the job to that test's `jobs` map.
2. Remove the two "Prove …" steps and the report upload from `verify-vectors`. **Keep** "Install
   server dependencies" there: the address, derivation and PSBT Vitest slices after it need it.
3. Leave the emulator jobs' `needs: [verify-vectors]` unchanged. Correct the Trezor comment,
   which says the vector proof takes "roughly five minutes"; it will be about 4–5 min again.
4. `summary`:
   - add `verify-vectors-mutation` to `needs`, and `VERIFY_VECTORS_MUTATION:
     ${{ needs.verify-vectors-mutation.result }}` to its env, and echo it;
   - require `success` in the all-pass branch, and `skipped` in the documentation-only branch;
   - leave every other line as it is.

### Re-pin (verify-vectors.yml is a verifier source)

- Run `cd scripts/verify-addresses && npm run generate:repeatable`, which uses the Docker-based
  pinned verifier stack, not the app stack. Commit the regenerated files, and expect only
  `"sourceSha256"` to change in `scripts/verify-addresses/output/verified-vectors.ts` and
  `server/tests/fixtures/verified-address-vectors.ts`.
- Fallback: compute it with `calculateSourceSha256()` and edit both lines by hand
  (precedent: a8153ea9af).
- Proof after pushing: `workflow_dispatch` on the branch; "Check for vector changes" prints
  `Vectors unchanged - all implementations agree`.

### Guards (`tests/ci/check-workflow-composition.test.sh`)

- Lines ~1874–1886 (the ordered step list of `verify-vectors`): remove the two "Prove …" entries,
  so that "Install server dependencies" → "Run cross-implementation address verifier" stays in
  order.
- Add an in-order assertion for `verify-vectors-mutation`: "Install server dependencies" → "Prove
  PSBT account-binding …" → "Prove exact transaction fee …" → `check-wallet-safety-mutation-map.mjs`
  → "Upload PSBT account-binding mutation reports".
- Lines ~2826–2830: change the job of the fee-policy `timeout-minutes: 15` assertion to
  `verify-vectors-mutation`.
- New assertions:
  - `summary` needs `verify-vectors-mutation` and checks its result in both branches;
  - `verify-vectors-mutation` does **not** need `verify-vectors` (otherwise the gain disappears);
  - the emulator jobs still `needs: [verify-vectors]` only. The existing loop at ~3166 already
    asserts this; confirm that it does not match the new job.
  - Write these first and confirm that they fail on the unchanged workflow.
- `tests/ci/with-runner-lock.test.sh` enumerates lock users per job (around line 204). Confirm that
  it picks up the new job, which takes the `node-toolchain` lock, and that the 120 s lock budget is
  still below the smallest step timeout in the new job (5 min).

### Also check

- `config/resource-lifecycle-callsites.json`, `scripts/ownership/contracts.mjs`,
  `config/hardware-emulator-source-inventory.json` and `scripts/ci/npm-ci-callsite-policy.json`
  key on the file path, not on line numbers or job names, so no change is expected. Run their
  checkers anyway.
- `docs/reference/ci-cd-strategy.md`: add one line to the verify-vectors description naming the
  new job. The required context `Verify Bitcoin Vectors / summary` is unchanged.

### Acceptance

- ≥5 PR runs, plus the push-to-`main` run after merge:
  - all seven JSON reports uploaded;
  - map check green;
  - each proof's mutant status and `killedBy` set identical to a baseline run on the same tree
    (compare the uploaded reports, as #1344 did against run 19547).
- `reqgreen.py`: verify-vectors median ≤ 20 min, and no p90 regression in test.yml.
- Snapshots: no `oom_kill` and no sustained CPU PSI rise on the hosts that ran two verify-vectors
  jobs at once.
- **Rollback:** revert the PR. The re-pin reverts with it.

---

## PR 2: unblock the test.yml backend tail and remove the pass-through hop (S2 + S4)

**Expected saving:** test.yml from about 20 to about 15 min. After PR 1, test.yml is the floor on
backend PRs.

### Guard first (`scripts/ci/action-runtime-workflow-guards.mjs`, `inspectFalseFullLaneDependencies`)

Add to `forbiddenNeeds`, with a comment like the one on the R2 entries:

```js
// Ordering-only edges kept from the DIND era. Each lane runs in its own job
// container; with 3 jobs per host, MemAvailable stayed >= 16 GiB (2026-10-05 report).
['full-backend-integration-tests', 'full-backend-unit-coverage-shards'],
['full-backend-integration-tests', 'full-browser-e2e-tests'],
// Typecheck is a fail-fast gate; it still blocks via full-backend-unit-coverage.
['full-backend-unit-coverage-shards', 'full-backend-typecheck'],
```

Also add a check that no job in `test.yml` is named `full-lane-ready` or references
`needs.full-lane-ready`. Add fixture cases in `tests/ci/check-github-action-runtimes.test.mjs`,
following `assertBlocksFalseFullLaneDependency`. Confirm the guard fails against today's
`test.yml`.

### Changes to `.github/workflows/test.yml`

1. **S4. Delete the `full-lane-ready` job** (around line 481). In every full lane:
   - replace `needs.full-lane-ready.result == 'success'` with
     `needs.detect-changes.result == 'success'` (about 14 `if:` blocks);
   - drop `full-lane-ready` from every `needs:` list (about 17);
   - in `full-test-summary`, drop `FULL_LANE_READY` and its `require_success "Full Lane Ready"`
     line. `require_success "Detect Changed Files"` already covers it;
   - keep the `always() &&` prefixes, which still govern skipped and failed upstream jobs.
2. **S2:**
   - `full-backend-unit-coverage-shards`: change `needs` to `[detect-changes]` and drop
     `needs.full-backend-typecheck.result == 'success'` from its `if:`;
   - `full-backend-unit-coverage` (the merge job) keeps `full-backend-typecheck` in `needs` and
     `if:`, so a type error still fails the backend lane;
   - `full-backend-integration-tests`: change `needs` to `[detect-changes]`, and rewrite the long
     comment (lines ~744–760) to record that the ordering edges were removed and why, citing the
     report.
3. Leave the `full-backend-tests`, `full-frontend-tests` and `full-critical-mutation`
   aggregators in place (see S5 under "Deferred").

### Guards to update

- `tests/ci/check-workflow-composition.test.sh`, lines ~2630–2640: replace the two
  `full-lane-ready` assertions with "full lanes gate directly on Detect Changed Files" (for
  example `assert_contains` of `needs.detect-changes.result == 'success'` in
  `full-frontend-coverage-merge` and `full-backend-integration-tests`).
- `tests/ci/check-github-action-runtimes.test.mjs`, lines ~545–619 and ~835–888: the fixture
  workflow and its regex mutations use `[detect-changes, full-lane-ready]`. Update the fixture to
  the new shape so the mutation-based negative tests still apply.
- Grep `tests/` and `scripts/` for `Full Lane Ready` and `full-lane-ready` again after editing.
  Expect zero hits outside the new negative guard.

### Risks and checks

- **Integration Postgres OOM:** "table public.users does not exist" mid-run, which was the
  original reason for the edges. sora has capacity 1, so co-residence happens only on kumo and
  x300.
  - Per run, pull the integration job's container from the snapshots: `oom_kill`, memory peak,
    and the host's MemAvailable.
  - Make sure at least 2 of the ≥5 trial runs overlap integration with browser E2E or the coverage
    shards on the same host. Check this from the snapshot task IDs (`snap2.awk`).
- **Red PRs now run backend shards even when typecheck fails:** about 7 slot-minutes, red PRs
  only. Accepted.

### Acceptance

- ≥5 full-lane PR runs: `queue.py` shows `full-backend-unit-coverage-shards` queue median
  ≤ 3 min (from 8.4), and integration is no longer the last job in most runs.
- test.yml PR median ≤ 16 min, and required-green median ≤ 20 min (both PRs combined).
- No `oom_kill`, and no "table public.users does not exist", across the trial runs and the next
  nightly `Test Suite`.

---

## PR 3: split the mutation job in two (S1, phase B) · only if PR 1's numbers support it

**Decision gate:** proceed only if, after PRs 1 and 2, verify-vectors is still the last required
check on most PRs and the mutation job is its longest path.

- Split `verify-vectors-mutation` into:
  - `verify-vectors-mutation-fee`: fee-policy and receive-evidence;
  - `verify-vectors-mutation-binding`: wallet-policy, PSBT browser, PSBT server and both taproot
    proofs.
- Each job uploads its own report artifact. **The upload paths together must equal today's seven
  paths.**
- The map check needs all seven reports. Run it **once**, in a small join job
  `verify-vectors-mutation-map` (`needs` both, checkout, download both artifacts into the original
  paths, `node scripts/ci/check-wallet-safety-mutation-map.mjs`). Using `summary` instead would
  add a checkout there. The join job's result goes into `summary` as well.
- Guards:
  - the map check appears exactly once and only after both proof jobs;
  - the union of the uploaded paths is the seven-path set;
  - neither proof job needs `verify-vectors`.
- Re-pin `sourceSha256` again.
- **Acceptance:** verify-vectors median ≤ 16 min; the same report-equivalence check as PR 1.

---

## PR 4: docker-build edge and Trezor pin (S7 + S8) · investigate first, then change

These two are bundled because both are small and both need a measurement before the edit.

- **S7, `build-backend` → `build-frontend`.**
  - The edge dates from 61c8b84270 (2026-05) and has no comment. The gateway, Prisma, LLM egress
    and Grafana image builds already run concurrently with frontend.
  - **Possible reason:** the kumo `buildx_buildkit_default` container has peaked at 22 GiB, so
    frontend and backend may have been serialized to protect the shared builder's memory.
  - **Discriminator:** from the snapshots, find the buildkit container's peak during image-scope
    PR runs, and check whether the backend build alone approaches it. Drop the edge only if
    frontend+backend peak plus the host's other load stays under MemAvailable with margin.
    Otherwise document the reason in a comment and stop.
  - Guards: the composition test around ~3398–3410 (`build-backend:` blocks).
- **S8, the Trezor x300 pin.**
  - The pin waits for "the fleet archive-health recovery unit". `forgejo-runner-archive-health`
    and `-archive-recover` are installed on kumo and x300.
  - **Discriminator:** confirm with runner-infra that recovery is active and has handled a wedge
    (journal: `journalctl -u forgejo-runner-archive-recover`).
  - Then change `runs-on` to `docker-socket` and update the composition assertion "Trezor proof
    avoids the known wedged Kumo runner" (~3256).
  - verify-vectors.yml changes, so **re-pin `sourceSha256`**. To avoid a third re-pin, consider
    folding S8 into PR 3 (or PR 1 if PR 3 is skipped).
  - **Acceptance:** ≥5 Trezor runs, including ≥2 on kumo, with no archive stall.

---

## runner-infra (not this repo): raise kumo and x300 capacity from 3 to 4 (S3)

- Do this **after** PRs 1–2 have been measured, so the effects stay separable.
- Trial kumo first (31 GiB) for one week, then x300 (27 GiB). sora stays at 1.
- **Go/no-go from snapshots:** at 4 jobs, CPU PSI60 p90 < 10%, memory PSI60 max < 10%,
  MemAvailable min > 6 GiB, no `oom_kill`; and the required-green p90 does not regress.
- This is a runner-infra change, following its own process. Per
  `runner-hosts-accommodate-repos`, do not ask the other repos to change.

---

## Deferred (with reasons)

- **S5, folding the aggregator jobs into `Full Test Summary`:** `action-runtime-workflow-guards.mjs`
  requires `full-frontend-tests` and `full-backend-tests` to exist and to need specific jobs
  (`requireJobNeeds`). The saving (one hop of 0.1–1.8 min, three jobs per PR) does not justify
  rewriting those guards now. Revisit if `queue.py` still shows aggregator hops above 1 min after
  S3.
- **S6, rebalancing the critical-mutation shards (9.5 / 1.2 / 5.4 min):** this pays off only once
  frontend coverage (10.2 min) stops tying for the test.yml floor. Splitting
  `addressDerivation/**` needs per-file mutant counts from the shard JSON reports. Revisit after
  PR 2.
- **S9, consolidating quality.yml's small jobs:** slot pressure only, and not on a required path.
  Revisit after S3.

---

## Sequence and expected effect

| Order | Item | Re-pin? | Required-green median (*estimate*) |
|---|---|---|---|
| — | baseline | — | 25.7 min |
| PR 1 | S1-A | yes | ≈ 20 |
| PR 2 | S2 + S4 | no | ≈ 17 |
| PR 3 | S1-B (gated) | yes | ≈ 15–16 |
| PR 4 | S7, S8 (each gated on its discriminator) | yes if S8 | small; image-scope PRs mostly |
| runner-infra | S3 | — | lower queue p90; measure |

## Decisions (2026-10-05, user)

1. Fold S8 (Trezor un-pin) into PR 1, so there is one re-pin. S8 discriminator done: the
   `forgejo-runner-archive-health` timer runs every 2 min on kumo and x300; probe failures since
   09-25 were single attempts that passed on retry, and `archive-recover` never had to fire.
   PR 4 is now S7 only.
2. PR 3 proceeds automatically if PR 1 + PR 2 meet its decision gate.
3. Draft the runner-infra capacity change (S3) after PR 2 is measured.

## Progress log

### 2026-10-05: PR 1 merged (#1373, 96fb3e359e)
- PR run 20151: all green. All 3,014 mutants matched main run 20140 exactly (status and `killedBy`).
  The dispatch run 20154 printed `Vectors unchanged - all implementations agree`.
- verify-vectors: 20.9 min on the PR (baseline median 25.5); **11.9 min** on the push to main
  (baseline median 23.6).
- The mutation job is now the verify-vectors critical path, at 15.8–16.6 min. fee-policy takes
  8.2 min when it shares a busy host (2/2 runs), against 5.4–6.7 min in the #1344 baseline.
  cgroup: 5.1–5.4 CPUs, 0.2 s throttled, peak 5.2 GiB, `oom_kill` 0. That is host contention, not
  the job's own quota.

### 2026-10-05: PR 2 merged (#1374, 76a0613fa0)
- The first push failed on Large-file classification:
  `tests/ci/check-github-action-runtimes.test.mjs` grew to 1,040 lines, over the 1,000 limit.
  Fixed by folding the edge tests into one table; the file is now exactly 1,000 lines.
  `scripts/quality/check-large-files.mjs` is **not** in the classifier heredoc, so run it locally.
- Integration shared x300 with a backend coverage shard in both runs: MemAvailable 22–23 GiB,
  `oom_kill` 0.
- test.yml run 20164: all real lanes finished by **15.3 min**, and the backend tail by 9.2.
  The last 7 min were queue waits for tiny aggregator jobs: coverage merge 6.3, Full Critical
  Mutation 3.9, PR Required Checks 2.6.
  **S5 (fold the aggregators) is no longer deferred:** it is now the test.yml floor.
- verify-vectors waited 9.3 min for a slot in run 20165, from fleet saturation (S3).

### 2026-10-05: PR 3 merged (#1375, 53c530a464)
- The first PR run (20190) failed: `electrumPool.connections.test.ts` › "contains asynchronous
  connection-loss handler failures" timed out at 10 s in backend coverage shard 2. The test path
  is all mocks, and the container was not throttled. The same shard passes locally (8,510 tests),
  and the test had not failed in about 800 runs. It was retriggered with structured evidence in
  41ca3b5f03. **Unresolved:** the test may hang rarely; watch for a repeat.
- Retrigger run: verify-vectors **13.2 min**, test.yml **12.2 min**. The mutation jobs ended at
  12.5 min on run 20191, so the Jade emulator is now the verify-vectors path.
  All 3,014 mutants matched main run 20182.
  The dispatch run 20201 printed `Vectors unchanged`.
- release-candidate run 20197 was red: the cleanup coordinator refused to delete an RC10 replay
  image it did not own (protected/unlabeled/unregistered, exit 5), while the replay itself passed.
  That is host image state, not this change, and the check is not required.
- Push to main after the merge: verify-vectors **10.8 min** (baseline median 23.6), quality and
  architecture green.
- main Code Quality run 20181 (on 76a0613fa0) was red from an actionlint wedge: exit 124 at the
  150 s cap, against about 2 s locally on the same tree. Re-proven green by 20188/20196/20203.

### Result
| | Before (09-30..10-05 median) | After |
|---|---|---|
| verify-vectors, PR | 25.5 min | 13.2–15.4 min |
| verify-vectors, push to main | 23.6 min | 10.8 min |
| test.yml, PR | 19.9 min | 12.2 min (retrigger run) |
| Required-green | 25.7 min | ≈13–15 min on #1375's runs |

Two PR runs is not the planned ≥5-run sample. Re-measure with `tasks/ci-latency-tools/` once
about 10 PRs have landed.

### 2026-10-05: S3 applied (runner-infra #99, ba2c948)
- Merged, then applied on kumo with `rerender-runner-host.sh --allow-drift`: the only drift was
  the intended `capacity: 3 -> 4`, and no `--allow-busy`. Live config: `capacity: 4`, runner
  declared.
- Lifecycle canary run 20206: all 8 slots green (kumo 4, x300 3, sora 1).
- Watch kumo's snapshots for a week. The revert conditions are in `kumo-podman.env`.

### 2026-10-05: S5 merged (#1376, fb8bfb2b1d)
- Folded Full Backend Tests, Full Frontend Tests and Full Critical Mutation Gate into Full Test
  Summary.
- Equivalence with the old aggregate logic: 1,158 input combinations. The only difference is
  stricter: cancelled shards now fail.
- PR run 20211: test.yml 11.2 min. The summary merged the shards and ran the gate (raw 79.34%,
  minimum 52%), and every lane resolved.

### Pass 2026-10-05 (implement-merge run `ci-round3-remaining-2026-10-05`)
One delivery group, branch `codex/implement-merge/ci-round3-s6-s7`, holding S7 and S6. Both are in
this repository and independent, so nothing requires splitting them.

- **S7 (docker-build `build-backend` → `build-frontend`):** removed.
  - The edge came from 61c8b84270, when docker-build published images with `packages: write`.
    docker-build is now validation-only.
  - Each image job creates its own BuildKit container (`buildx_buildkit_builder-<uuid>`) and has
    its own gha cache scope.
  - Builder memory peaks measured from the snapshots over 8 image runs: frontend 2.8–4.9 GiB,
    backend 3.3–5.6 GiB, so a pair needs about 10.5 GiB. kumo and x300 never had less than
    16 GiB available with 3 jobs running. The 22 GiB `buildx_buildkit_default` belongs to other
    repositories.
  - Today the backend build starts 6–17 min after the frontend one ends.
- **S6 (critical mutation shards): rebalance reverted; protective changes kept.**
  - The estimate (458 / 35 / 297 s → about 265 s each) used run 20211's walls, which were warm
    incremental runs.
  - Measured cold, the new layout took 16.1 / 36.6 / 24.6 min (run 20234) and 15.9 / 26.0 / 16.0
    min (run 20237).
  - Splitting addressDerivation makes two shards run its large test suites. With no evidence of
    a gain, `shards.mjs` is restored to `main`'s version.
  - **Bug found and fixed:** the incremental-cache `restore-keys` ignored the shard layout, so a
    re-partition restored old shard files into the new reports. The merge rejected the collision
    (run 20223) and failed closed. The key and restore prefix now hash `shards.mjs`.
  - **Kept:** the file-level partition check in `check-critical-mutation-config.mjs`, which is
    Stryker-order-aware and has 5 fixture tests.
  - **Future S6:** first collect cold per-file costs, for example from the next nightly, and
    model the dry-run test overlap.
- **S3 follow-up:** the kumo capacity-4 trial was **reverted** (runner-infra #100, bcc3f2526d;
  canary run 20258 green).
  - Memory was fine, but four CPU-heavy jobs drove CPU PSI avg10 to 21–31%, against a p90 of 3%
    at three jobs.
  - Within about four hours, two timing-sensitive gates failed on kumo: an RC replay probe at
    1000.6 ms against 1000 ms (run 20222), and a Playwright browser-flow test (run 20247).
- **S9 (merge quality.yml's small jobs): closed without change.** Quality was the last required
  check on 0 of 17 PRs, finishing around 12.6 min. lint, lizard and jscpd (0.6–1.0 min each)
  share one scope condition, so merging them would save about 2 slot dispatches per PR at the
  cost of rewriting the quality guards. Revisit only if queue measurements point back at quality.

### Remaining
- Re-measure with `tasks/ci-latency-tools/` after about 10 PRs, then decide on x300 → 4.

### 2026-10-06: pass outcome (implement-merge run `ci-round3-remaining-2026-10-05`, status blocked)
- **#1377 (fa145b8ede):** S7 shipped. The image builds now run together and finished within
  about 4–5 min. Also: the shard partition check and the layout-scoped Stryker cache key. The S6
  rebalance was reverted.
  - Cold-cache shard data for a future S6: old layout 35.8 / ~1 (warm) / 17.7 min (run 20264);
    rebalanced layout 16.1 / 36.6 / 24.6 and 15.9 / 26.0 / 16.0 min.
- **#1378 (fd7d7f7adc):** actionlint wedge fix.
  - Three wedges on 2026-10-05; actionlint sat idle with no child process.
  - actionlint now gets an empty stdin; a wedge triggers a SIGQUIT goroutine dump and one
    retry. Lint failures are never retried.
- **runner-infra #100:** kumo back to capacity 3 (see S3 follow-up above).
- **Blocker:** a new **critical** npm advisory on `proxy-addr` fails Dependency audit in any
  full-scope Code Quality run (run 20278), and criticals cannot be waived. Upgrading it needs a
  coordinated dependency PR (see the audit-waivers skill and the supply-chain lock memories).
  Until then, the loop's exact-SHA target-CI gate for #1377 cannot pass, though `main` at
  fd7d7f7adc is green on its push runs.
