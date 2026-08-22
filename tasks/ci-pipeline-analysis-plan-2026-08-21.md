# CI pipeline analysis and optimization plan

Date: 2026-08-21 (Pacific/Honolulu)  
Status: implementation in progress via isolated, reviewed pull requests  
Scope: CI workflows, their policy documentation, and CI regression tests; no branch-protection weakening  
Evidence baseline: `origin/main` at `19ee80e59ff59514dd344fb85e3544e799383228`

## Executive verdict

Sanctuary is not overbuilt in the breadth of assurance expected for a
self-hosted Bitcoin wallet. Funds-safety vectors, mutation testing, install and
upgrade proofs, dependency controls, and release evidence all have a defensible
place. It is overbuilt in orchestration: the same pull request can traverse a
quick lane and then a full lane serially, many jobs reinstall an identical
workspace, and policy documents no longer describe what the workflows do.

The highest-value optimization is therefore not to weaken wallet-safety gates.
It is to remove duplicate execution and setup while making every green check
truthful. Correctness gaps should be closed before reducing deep-test frequency.

Recommended current-state policy: because Forgejo merge queue is not the active
merge mechanism, retain exhaustive pre-merge validation, but make the quick lane
a small parallel feedback lane rather than a prerequisite for a second copy of
the same checks. Reconsider quick-PR/full-merge-group tiering only after a real
merge-group rehearsal proves that the full gate reliably protects the merge.

## Evidence and limits

- The supplied directory is a bare-repository working tree whose checked-out
  files are 17 commits behind `origin/main`. The remote `main` ref and local
  `origin/main` both resolve to `19ee80e...`; current-state inspection therefore
  used `git show origin/main:<path>` where the working file differed.
- Static scope is large: eight workflows, about 78 top-level job definitions,
  more than 8,300 workflow lines, 67 checkout callsites, and 91 artifact-upload
  callsites. `test.yml` alone defines 30 jobs and contains 36 textual `npm ci`
  callsites.
- Live Forgejo history since 2026-08-12 is path-mix biased and is useful trend
  evidence rather than a controlled benchmark. Successful `test.yml` PR runs
  had p50 23.08m and p90 38.22m (68 successes, 14 failures, 56 cancellations of
  138 sampled runs); successful main-push runs had p50 21.48m and p90 33.28m.
  Both miss the documented targets of under 8 minutes for ordinary
  frontend/backend PRs and under 15 minutes for main.
- In the same window, successful always-on PR vector runs had p50 17.27m/p90
  22.93m, quality p50 8.45m/p90 14.58m, and Docker p50 8.10m/p90 16.33m.
  Queue and lock wait are included in these wall times; this analysis does not
  label them runner faults.
- Cancellation volume makes wasted runner work a material measurement target,
  while not by itself proving a cancellation defect.
- Existing command budgets measure only selected command bodies. They do not
  budget end-to-end gate time, setup, artifact transfer, queueing, runner-lock
  wait, vector validation, mutation, Docker validation, or install validation
  (`.github/ci-performance-budget.json`).

## Current pipeline shape

| Workflow | Intended role | Current observation |
| --- | --- | --- |
| `test.yml` | PR feedback and full confidence | Quick and full lanes both run on matching PRs; full waits for quick, and `PR Required Checks` waits for `Full Test Summary` (`test.yml:979-1160`). |
| `quality.yml` | Lint, audit, secret, SAST, complexity, duplication, workflow policy | Strong PR coverage, but no `push: main` trigger despite strategy documentation calling it a main-confidence requirement (`quality.yml:20-29`). |
| `verify-vectors.yml` | Funds-safety corpus and hardware proof | Full base proof and Trezor/Ledger/Jade emulator chain runs on every PR and main push without path filtering (`verify-vectors.yml:17-29,421-694`). |
| `install-test.yml` | Install, runtime health, auth, and upgrade assurance | Broad and appropriately path-classified, but overlaps RC implementation and has the longest/highest-risk infrastructure surface. |
| `release-candidate.yml` | Candidate-specific acceptance evidence | Reimplements install/health/auth work, accepts upgrade inputs, yet explicitly delegates/omits the upgrade matrix; approval language can overstate what a manual/called RC run proved (`release-candidate.yml:14-72,206-670`). |
| `docker-build.yml` | Validate five shipped/support images | Good image classifier and Buildx caching, but no job-level timeouts on classifier/image jobs (`docker-build.yml:91-277`). |
| `architecture.yml` | Generated graph, boundary, and docs checks | PR paths are scoped; every main push runs the whole job. TypeScript changes also force docs-site install/typecheck/build (`architecture.yml:3-24,56-220`). |
| `podman-socket-canary.yml` | Runner capability canary | Narrow manual/self-change trigger; not a general performance concern. |

## What is overbuilt

### 1. Two PR tiers execute serially

The repository strategy still describes a quick PR gate and a full main gate
(`docs/reference/ci-cd-strategy.md:137-165`). The workflow has required full PR
execution since May: `full-lane-ready` depends on every quick job, full component
jobs then run, and `PR Required Checks` requires `Full Test Summary`
(`test.yml:979-1218`). This repeats typechecks, related/full tests, mutation, and
browser/render preparation on the critical path.

This is the strongest confirmed source of overbuilding. Do not simply restore
the stale document: decide which pre-merge contract Forgejo can actually enforce.
For the current no-merge-queue operating model, keep the full pre-merge gate and
remove its dependency on quick jobs. Retain only fast checks that deliver useful
earlier feedback and do not substantially duplicate full work.

The quick lane also contains avoidable cross-domain ordering: quick frontend
waits for critical mutation; mutation waits for backend integration; integration
waits for backend tests/typecheck. Browser waits for frontend and render waits
for browser (`test.yml:165-179,395-501,793-897`). Remove those `needs` edges
unless they exchange data or own a proven shared-resource exclusion; the final
aggregate should propagate independent failures.

### 2. Identical setup is paid repeatedly

- Three full frontend typecheck matrix children each checkout and install the
  workspace (`test.yml:1681-1742`), although the quick job already demonstrates
  that the three commands can run in one workspace.
- Quick browser, quick render, full browser, and full render independently
  install Node dependencies, restore/install Chromium, and build the frontend
  (`test.yml:793-936,2211-2540`). Render is also serialized behind browser.
- Backend setup is repeated across quick typecheck/tests/integration/mutation and
  full typecheck/two coverage shards/integration/mutation.
- Verbose diagnostic artifacts are commonly uploaded on success. Diagnostics
  are valuable on failure, but 91 upload callsites make success-path transfer
  overhead worth measuring.

Consolidation should start with frontend typechecks because it is low risk. Build
artifact sharing for browser jobs is only a pilot candidate: previous repository
evidence found setup and test runtime comparable, so artifact transfer may not
win without measurement.

### 3. Deep safety validation frequency is broader than documented

`verify-vectors.yml` intentionally has no path filters and runs three hardware
emulators after its base vector/mutation proof on every proposed and landed
change. The strategy calls vector verification scheduled deep validation. The
workflow takes precedence for safety today, but the policy divergence needs an
explicit decision.

Do not path-filter the whole workflow. First measure which sub-gates catch which
defects. A likely target is an always-emitted summary with a fast fail-closed
corpus/manifest/safety proof on every PR, while hardware emulator proofs remain
pre-merge for wallet/signing/hardware changes and run nightly plus RC for all
other changes. This must be justified by failure-yield evidence before adoption.

### 4. Workflow complexity has dead and divergent abstractions

The local `test-plan-load` composite says it replaces a legacy 19-output
classifier, but no workflow calls it; `test.yml` still carries the legacy output
surface. Install and RC workflows independently encode similar install, health,
and auth flows. These are maintenance-efficiency problems that make later speed
work riskier.

Recent history makes install/upgrade truthfulness a priority rather than a
generic speed exercise. Since 2026-08-12, install push runs had p50 13.23m/p90
51.82m with 11 failures among 41 pushes. Failed leaves concentrate in Upgrade
Extended Fixtures (11), Upgrade Extended (10), and Upgrade Baseline (3), with
recent deterministic product/harness failures involving database constraints,
Grafana migration terminal state, timing collection, and stale audit evidence.
Do not mask this with broader retries; strengthen failure propagation and reduce
duplicated harness ownership.

## Confirmed gaps

### Resolved in Phase 1e — Redis integration tests are registered but skipped

Four worker integration specs select `describe.skip` unless `REDIS_URL` exists:

- `deadLetterQueue.integration.test.ts`
- `jobProcessorLockLoss.integration.test.ts`
- `notificationDispatcherRetention.integration.test.ts`
- `recurringSchedules.integration.test.ts`

All were assigned to the supposedly complete `ops-workers` group
(`scripts/ci/backend-integration-groups.sh:75-85`), but before Phase 1e the full
backend integration job provisioned only Postgres and never set `REDIS_URL`.
Group completeness proved registration, not execution.
Phase 1e adds the digest-pinned Redis service to the existing full backend
integration lane and sets a strict CI requirement consumed by one shared suite
helper. Each service health check installs a job-unique password. The resolver
prefers the runner-published endpoint, but Forgejo v13 can omit that mapping; in
that case it enumerates concrete alias IPs and accepts exactly one candidate
that authenticates with this job's password. Local runs without Redis may still
skip explicitly; CI fails during collection when the required URL is absent or
the enforcement value is invalid. The same resolver also replaces the browser
lane's unauthenticated alias lookup.

### P1 — “Full Browser E2E” excludes auth-dependent browser tests

The full browser job sets `SKIP_AUTH_TESTS=true` (`test.yml:2436-2440`), which
skips the auth specs and an authenticated wallet spec. Seed deterministic users
and run them, or rename the lane and add a separate authenticated browser gate.
Until then, its name overstates coverage.

### P1 — Quality has no landed-main backstop

`quality.yml` runs on PR, merge group, schedule, and manual dispatch, but not on
push to `main` (`quality.yml:20-29`). That conflicts with the documented main
confidence contract and leaves an emergency/admin direct push without immediate
quality validation. Add a path-aware or full main trigger while retaining the
weekly drift scan.

### P1 — RC approval and upgrade evidence can diverge

RC validation accepts upgrade-related inputs and advertises broad evidence, but
does not itself run the canonical upgrade matrix. Tag pushes usually trigger
`install-test.yml` separately; manual and `workflow_call` RC executions do not
inherently prove that sibling workflow passed. Reuse a canonical callable
install/upgrade workflow or make RC approval consume and validate immutable
install-test evidence for the same commit/ref.

The duplication is observable on current tags: the latest sampled RC commit ran
both Install Tests (failed after about 30 minutes) and Release Candidate
Validation (passed after about 21.5 minutes). A green RC summary must not coexist
with failed canonical install evidence for the same candidate without clearly
blocking approval.

### P2 — Package and browser coverage contracts are incomplete or misleading

- LLM egress proxy production source is not linted by the root lint scripts.
- Gateway full tests enforce coverage but not an explicit package build/typecheck
  in `test.yml`; Docker validation is conditional and is not a globally required
  check.
- The local `test:coverage:full` command omits the LLM proxy even though CI has a
  proxy coverage lane.
- Playwright config defines Firefox, WebKit, and mobile projects, while CI always
  forces Chromium. Either state Chromium as the supported CI contract or add a
  nightly/RC cross-browser lane after measuring cost.
- Render regression permits a 1% whole-image pixel difference, known to miss
  material layout changes. Add structural assertions or tighter region-specific
  thresholds rather than treating a green snapshot as strong layout proof.

### P2 — Capacity and governance gaps

- Add explicit job timeouts to every Docker validation job.
- Extend performance budgets to end-to-end workflow wall time, runner time,
  setup, lock wait, and artifact transfer, with warning-only rollout first.
- Inventory success-path diagnostics and retain mandatory proof/coverage
  artifacts while making verbose troubleshooting logs failure-only where the
  provider reliably evaluates failure conditions.
- Evaluate scheduled or RC container OS-package vulnerability scanning. SBOM and
  npm advisory controls exist, but no dedicated image CVE scanner was found.
  This is an evaluation item, not an automatic new required PR gate.

## Implementation plan

### Phase 0 — Lock the contract and baseline it

- [x] Update the CI strategy to describe the actual desired pre-merge contract.
- [ ] Record 20 comparable successful runs per cohort: docs-only, gateway-only,
      frontend, backend unit-only, backend integration-sensitive, wallet-safety,
      main push, install, and RC.
- [ ] Capture wall p50/p90, summed runner time, queue time, runner-lock wait,
      setup/install/build time, artifact time, cancellation waste, first-failure
      stage, and failures uniquely caught by quick/full/vector/deep gates.
- [x] Add a workflow-level performance report artifact/summary using existing
      timing notices; warning-only initially.
- [ ] Decision gate: unless a real Forgejo merge-group rehearsal proves full
      pre-merge enforcement, retain full validation on PRs.

Acceptance: cohorts are not blended; queue/rate-limit/test failures are named
precisely; measurement itself does not become a required failure point.

### Phase 1 — Make green checks truthful

- [x] Provision Redis for the worker integration group and assert that the four
      Redis suites execute rather than skip.
- [ ] Seed auth E2E users and remove `SKIP_AUTH_TESTS`, or split/rename the gate
      so its contract is exact.
- [x] Add `quality.yml` push-to-main coverage, classify the exact landed range,
      and fail closed when range evidence is unavailable.
- [ ] Make RC approval consume canonical same-commit install/upgrade evidence,
      then remove stale inputs and claims.
- [x] Add LLM proxy lint, explicit gateway build/typecheck, and local/CI coverage
      parity.
- [x] Add Docker job timeouts.
- [x] Make online installs explicitly fetch missing digest-pinned external
      runtime images before no-build startup; preserve pull-free offline mode.
- [x] Make upgrade fixtures distinguish legacy source schemas from already
      migrated latest-stable schemas while retaining historical migration proof.

Acceptance: deliberate skip counts are enumerated; unexpected skips fail;
required aggregate contexts remain stable and fail closed; direct main pushes
receive immediate quality validation.

### Phase 2 — Remove PR critical-path duplication

- [x] Decouple full-lane readiness from completion of every quick job so quick
      feedback and exhaustive validation can start concurrently.
- [x] Remove cross-domain quick-lane `needs` edges that exchange no artifact or
      state; make the aggregate, not an unrelated leaf, own failure propagation.
- [x] Compare each quick job with its full counterpart and retain only checks
      that provide materially earlier, distinct signal.
- [x] Collapse the three frontend typecheck matrix jobs into one checkout/install
      with three separately timed steps and equivalent failure diagnostics.
- [x] Avoid repeating mutation in quick and full lanes for the same PR; keep the
      strongest pre-merge result and a fast manifest/config sanity check.
- [x] Preserve path-aware full lanes and stable aggregate branch-protection names.

Acceptance: ordinary frontend/backend PR p50 is below 8 minutes or improves by
at least 30% without a regression in escaped-to-main failures; total runner time
falls; no required context can succeed when its selected test set is empty.

### Phase 3 — Consolidate setup and artifact work

- [x] Evaluate one shared frontend build artifact for browser/render jobs; reject
      it while their build-time API URLs differ and each measured build costs
      only 4-6 seconds.
- [x] Consolidate quick browser/render preparation or remove those quick jobs if
      Phase 2 proves they add no unique signal.
- [x] Evaluate standardized root npm download caching; do not add it while exact
      warm hits leave clean `npm ci` at the existing 16-20 second range.
- [ ] Upload verbose diagnostics on failure only where reliable; Phase 3c owns
      the Test workflow, while remaining workflows still require an evidence
      inventory. Always retain coverage, mutation, release, and other required
      evidence.
- [x] Split architecture graph/boundary checks from docs-site validation, and
      apply equivalent path filters to main pushes.

Acceptance: main full-gate p50 is below 15 minutes or improves by at least 20%;
cache-hit and artifact-transfer time are visible; no stale workspace state is
trusted as test evidence.

### Phase 4 — Rationalize workflow ownership

- [ ] Extract canonical callable install/health/auth/upgrade building blocks and
      reuse them from install and RC workflows.
- [ ] Finish migration to the structured test-plan composite or remove it and its
      dead contract; keep one classifier source of truth with composition tests.
- [ ] Reconcile workflow comments, CI strategy, release gates, and actual trigger
      semantics in the same change.
- [ ] Add contract tests for required-context presence, selected-test counts,
      cross-workflow same-commit evidence, and skip policy.

Acceptance: one owner per classifier and install/release proof; manual, PR, main,
schedule, and tag paths have executable contract tests.

### Phase 5 — Re-tier deep safety checks only with yield evidence

- [ ] Attribute 30-60 days of vector, emulator, mutation, cross-browser, and
      install failures to product defect, deterministic test defect, dependency
      drift, registry/rate limit, queueing, or proven runner fault.
      The exact 60-day vector/emulator audit is complete and supports shadow
      measurement only; mutation, cross-browser, and install attribution remain.
- [ ] If evidence supports it, keep fast wallet-safety invariants on every PR and
      move unaffected hardware emulators to nightly/RC, while forcing them for
      wallet/signing/hardware-sensitive changes.
      Before any re-tiering, Phase 5a gives all three proof runners one canonical
      hashed-source inventory. Phase 5b adds an independent 90-day shadow report
      using PR merge-base semantics and exact push/merge-group ranges. Every
      fallback and unknown provider predicts all vendors, while the classifier
      exposes no outputs and remains absent from every emulator and summary
      dependency. Execution cannot change until at least 30 calendar days,
      30 noncancelled PR reports, one weekly run, >=99% report availability,
      zero observed false negatives, and the documented wall/runner savings
      thresholds are all satisfied. The observer reuses the existing base Vector
      checkout/toolchain rather than adding a runner claimant; both report steps
      are bounded and nonblocking, and the slice rolls back if base-job p95 grows
      by more than 10 seconds.
- [ ] Decide whether 100% statement/branch/function/line coverage remains global
      or becomes 100% on funds/auth boundaries plus a non-decreasing ratchet
      elsewhere. Do not lower thresholds without mutation and escaped-defect data.
- [ ] Decide the supported browser contract; add nightly Firefox/WebKit only if
      the product claims support and the failures are actionable.
- [ ] Evaluate scheduled/RC image CVE scanning against noise, runtime package
      inventory, and operator remediation cost.

Acceptance: no safety gate moves later solely to improve duration; each move has
a named earlier invariant, later backstop, path-classifier test, and rollback
criterion.

## Explicit non-recommendations

- Do not remove wallet-safety proofs, mutation testing, install/upgrade tests, or
  100% coverage merely because the workflow is large.
- Do not add more shards until p90 command timing proves test runtime—not setup,
  queueing, or runner-lock wait—is the long pole.
- Do not reduce proven runner capacity as the default response to contention.
- Do not call every failed or delayed job runner instability.
- Do not add a container scanner, additional browsers, or another cache layer as
  an always-required PR gate without measuring signal and cost.
- Do not weaken branch protection to make the pipeline appear faster.

## Verification plan for implementation

Each phase should include workflow composition/classifier tests, `actionlint`,
shell tests under `tests/ci`, and at least one controlled PR plus landed-main
rehearsal. Release/install ownership changes additionally require an RC-tag or
manual same-commit evidence rehearsal. Compare the same path cohort before and
after; report wall time and runner time separately, and verify the exact required
status contexts before merging.

## Next step

Approve Phase 0 and Phase 1 as one plan-review cycle. Phase 2 should be a separate
implementation change after the contract decision is recorded; Phases 3-5 are
evidence-gated and should not be bundled into the correctness work.
