# CI reliability follow-up implementation plan

Date: 2026-09-07. Baseline: `8d1d0246437f40e404c5c578d86b908dbf884806`.
User authorized the entire follow-up backlog and lifted the PR hold.
The completed ownership architecture/recovery and its historical resources are
not reopened. No runner-infra writes, blanket serialization, raw cleanup, weakened
proofs, or speculative CI retriggers are authorized by this plan.

## Delivery protocol

Deliver each phase through implement-merge/pr-delivery, protected Forgejo PR,
verified merge ancestry and target-branch CI. Refresh main between phases.
Run cheap owning checks before broader repository-required precommit gates.
Use fake infrastructure first; deployed fleet acceptance needs real evidence.
An assessment may conclude no policy change, but must record evidence and limits.
Do not count unavailable external evidence as a completed acceptance gate.

## Phase 1 — Bounded observation diagnostics

- [x] Preserve command exit status and elapsed time, including inventory pipelines.
- [x] Reject disabled timeout; skip without timeout tooling; bound TERM resistance.
- [x] Consolidate prefix scans and match prefixes literally without duplicate rows.
- [x] Cover failures and absence separately using fake Docker only (13 cases).
- [x] Verify repository-required local gates.
- [x] Deliver the existing branch and verify target-branch CI.

Acceptance: diagnostics remain best-effort and read-only; bounded command failures
cannot be presented as successful empty inventories. Existing daemon identity and
redaction remain available. Timings are not proof of health or cleanup.

## Phase 2 — Subject deadlines and finalization reserve

- [x] Add validated coordinator-owned subject deadlines using existing process
      group termination/quiescence machinery, not timeout around the coordinator.
- [x] Carry one job deadline across sequential install subjects; bound remaining
      lock and subject time while reserving cleanup, verification and upload.
      Capture the budget origin in the first job step, before checkout; initialize
      validated deadline accounting after checkout. Runner startup before the
      first step is outside this boundary. Refuse unaffordable subjects.
- [x] Apply the common budget to replay live/max and image build, remaining short
      install lanes, baseline/extended loops, and emulator proof steps. Shorter
      step limits narrow the inherited deadline and never reset a job budget.
- [x] Reject impossible budgets before expensive startup; correct stale comments.
- [x] Test stuck subject, deadline exhaustion, descendant non-quiescence, signed
      cleanup evidence, invalid/overflow budgets and fake-clock exhaustion.
      A timed-out subject may yield a valid cleaned receipt after proven cleanup;
      the subject/job must still fail. Unknown cleanup or unquiesced descendants
      must never produce a cleaned receipt.
- [x] Prove nested isolation supervision does not terminate the inner cleanup
      coordinator at the workload deadline. Keep the isolation owner alive for
      inner signed cleanup and outer workspace retirement, while preserving the
      existing provider job/step finalization cap. Cover a TERM-resistant inner
      workload and delayed cleanup before accepting this integration.
- [x] Keep each run-built verifier image outside the host reaper's age candidate
      window from Buildx load through its first container reference. Stamp the
      per-run OCI config with a validated current epoch, preserve immutable IID
      execution and exact registered cleanup, and cover the build contract with
      fake Docker before another vector run.
- [x] Deliver and verify.

Acceptance: subject timeout returns failure but leaves a bounded finalization
opportunity. Unquiesced processes never authorize unsafe cleanup. Budget arithmetic
accounts for both install subjects and lock waits, not each in isolation.

Initial reserve policy (existing outer timeouts unchanged): jobs at least 90
minutes reserve 10 minutes; jobs up to 25 minutes reserve 3 minutes; other jobs
reserve 5 minutes. Short subject steps reserve 5 minutes, or 2 minutes for steps
up to 10 minutes. These are finalization opportunities, not measured guarantees
that every cleanup/upload fits. The earliest inherited deadline always wins.
Runner startup before the first executable step is not included. Follow-up fleet
measurements in Phase 4 must not imply those unobserved costs were measured.

## Phase 3 — Durable progress, status and retry discipline

- [x] Extend existing logging with allowlisted redacted lifecycle progress events;
      test container/outer-process loss and state precisely what survives ingestion.
- [x] Add exact-commit multi-workflow status reporting using existing Forgejo API
      helpers. Accept an explicit event-specific manifest of workflow IDs and
      required aggregate job names; paginate with snapshot-consistency checks,
      reject incomplete responses, and distinguish unknown/running from observed
      progress and terminal success. Enumerate every exact-SHA run. For duplicate
      or retriggered workflows, the newest attempt dominates older outcomes.
- [x] Assess provider-supported failed-job retry from authenticated API schema;
      document supported targeted emulator procedure or verified lack of support.
      Preserve immutable input/proof binding and aggregate required checks.
- [x] Document repeated-failure stop rule: new hypothesis plus cheap discriminating
      test and immutable SHA/run/job signature before another expensive attempt;
      mechanically gate repository-owned retries and CI classifier coverage.
      State explicitly that provider UI/API reruns remain procedural controls.
- [ ] Deliver and verify.

Acceptance: exact immutable SHA and snapshot-consistent paginated workflow
enumeration; required aggregate jobs, not workflow status alone, must be terminal
success. Missing expected workflows/jobs, malformed responses, page instability
and unavailable pages produce unknown/non-success. Reject malformed,
secret-bearing or workflow-command-capable lifecycle annotations and describe
their delivery as best-effort observability, never cleanup or merge authority.
Retry assessment does not authorize unrelated whole-workflow reruns or skipping
aggregate required checks. Stabilize event schema before Phase 4 sampling.

## Phase 4 — Fleet admission, timing and lifecycle convergence

- [ ] Correlate daemon/host identity with queue, lock, build, subject, cleanup and
      upload timing using existing aggregators; represent missing samples honestly.
- [ ] Assess shared-daemon capacity across install/upgrade/vectors/emulators using
      actual fleet evidence; retain policy unless measurements support a change.
      Any required runner-infra deployment remains externally coordinated.
      Assess the latest seven days, at most twenty complete relevant runs per
      host, and document the exact sample inventory and missing access. Insufficient
      samples mean inconclusive/policy unchanged, not empirical validation passed.
- [ ] Audit restart/recreate callsites for unintended builds/pulls/identity changes;
      extend no-build contracts only where intended behavior warrants it.
- [ ] Run lifecycle scanner/contract fixtures before expensive E2E; document measured
      distributions and thresholds without inventing timing samples.
- [ ] Deliver and verify.

## Phase 5 — Recovery observation and operator diagnostics

- [ ] Add composed successful-mutation/postcondition-query-failure regression cases:
      stop later mutations, preserve signed non-success evidence or active journal,
      and recover observationally without repeating deletion.
- [ ] Expose optional bounded correlation freshness within existing five-minute
      contract maximum; make review expiry explicit; never accept expired approval.
- [ ] Add allowlisted ambiguity category/operation diagnostics without raw secrets
      or resource locators; retain existing fail-closed behavior.
- [ ] Deliver and verify.

## Final acceptance

- [ ] Map all ten backlog candidates and two recovery follow-ups to evidence above.
- [ ] All phase PRs merged with actual ancestry and exact-commit CI verification.
- [ ] Sweep only owned branches/worktrees; record any approved-retained leftovers.
- [ ] Inspect and rebuild only already-running relevant Sanctuary stack using
      `./start.sh --rebuild`; verify documented health. Preserve unrelated workloads.

## Ownership ledger

| target_branch | task_branch | worktree_path | created_by_loop | converted_to_next_phase | cleanup_status |
| --- | --- | --- | --- | --- | --- |
| main | fix/preflight-command-outcomes | /home/nekoguntai/sanctuary | adopted from this session | no | merged/main CI green; retained pending deletion permission and additional replay |
| main | codex/implement-merge/ci-subject-deadlines | /home/nekoguntai/sanctuary | yes | no | implementing locally |

The detached `/home/nekoguntai/sanctuary-main` worktree is unowned and preserved.
Live historical CI stacks/builders are not loop-owned and are not cleanup targets.

## Review/evidence

Initial research confirmed no subject wall-clock deadline in the coordinator,
two independent 1500-second waits in a 90-minute combined install job, existing
post-mutation recovery safeguards, and a 60-second correlation default with a
five-minute maximum. These are implementation starting points, not live CI proof.

Backlog mapping: latency/identity -> 1+4; admission -> 4; budget -> 2;
durable progress -> 3; emulator retries -> 3; exact-commit status -> 3;
restart audit -> 4; per-host timing -> 4; observation failures -> 5;
repeated-failure discipline -> 3; freshness and refusal diagnostics -> 5.
Phase 1 is diagnostic-only, not a new admission gate; Phase 4 explicitly assesses
whether observed failures should prevent expensive subjects from starting.
Independent plan review accepted this structure with corrections above separating
subject failure from legitimate successful cleanup, bounded evidence collection,
and explicit unknown/non-success status semantics.

Delivery preflight: Forgejo 16.0.3 authenticated API is available; required checks
remain Code Quality Required Checks, Full Test Summary, and PR Required Checks.
Live run objects expose `commit_sha`; supplying `limit` without `page` returned
the full listing, while explicit `page=1&limit=5` returned five rows. Use explicit
pagination and validate count/identity in Phase 3. No retry endpoint appears among
the run endpoints in the current Swagger schema; assess other supported routes
before concluding targeted retry is available.

Phase 1 local gates: frontend 8,411 tests passed; backend unit 15,767 passed;
guarded integration 759 passed, 28 skipped, one todo (55 passing/8 skipped files).
Integration coordinator reported subject/cleanup status 0 and cleaned receipt at
`/tmp/sanctuary-cleanup-local.W7zqhz/artifacts`. Frontend all-project and backend
TypeScript checks passed. Preflight 13/13, log wrapper 16/16, classifier, syntax
and staged diff whitespace checks passed. Skipped integration cases remain
skipped by their existing gates, not claimed as executed proof.

Phase 2 integration review found a P1 nested-supervisor ordering gap before PR:
sharing the workload deadline with the outer isolation coordinator can terminate
the inner cleanup owner during finalization. Delivery remains gated on a nested
regression and corrected lifecycle-only outer supervision. Single-coordinator
19-test suite and 17 arithmetic/supervisor/writer tests pass; these do not prove
nested cleanup ordering. Full frontend gate is running; no Phase 2 PR is open.

Subsequent local gates: frontend 8,410/8,411 passed, with the sole failure being
the expected source-bound address receipt drift after workflow edits. Canonical
`generate:repeatable` regenerated both identical address fixture files through the
pinned four-implementation verifier; coordinator subject/cleanup statuses were 0,
state cleaned, evidence at
`/var/tmp/sanctuary-phase2.QGmAKW/sanctuary-cleanup-local.JNfLKV/artifacts`.
The full 12-case provenance file then passed. Backend unit 15,767/15,767,
frontend/backend TypeScript, server lint, 33 arithmetic/workflow tests and 18
lock/facade boundary tests passed. These results precede the final nested and
unknown-supervision safety fixes; owning suites must be rerun after integration.

Final Phase 2 ownership gate: 504 passed, three existing gated skips, both shell
ownership bridges passed. Updated the lifecycle inventory for the extracted
canonical supervisor and the exact test-owned cleanup fixtures; the scanner and
contract gate pass (400 lifecycle identities). Nested regression passes all five
cases, including ordinary isolation retaining its deadline and explicit nested
drivers preserving inner signed cleanup before outer retirement. Guarded
integration again passed 759 tests (28 existing skips/one todo), subject/cleanup
status 0 and cleaned receipt at
`/var/tmp/sanctuary-phase2.QGmAKW/sanctuary-cleanup-local.E1v4nG/artifacts`.
Independent bounded final review found no additional P0–P2 blockers. Final full
frontend rerun passed all 8,411 tests in 626 files. Local gates are green;
protected PR delivery is not yet complete.

Phase 2 delivery completed in PR #1044. Exact reviewed head
`fc4565332685b13b1108940aef58c96cbf27e64b` passed all seven PR workflows,
including both required Test Suite aggregates, Install acceptance, Release
Candidate live/maximum replay with verified cleanup, and the complete vector and
emulator workflow. Forgejo squash-merged it as
`591ad7c60c43ec81fbfcc2b7fe0baff53bae6210`; the fetched commit is `origin/main`,
is an ancestor of it, and has the reviewed head's exact tree. All six workflows
selected for that exact main-push commit passed, including Fresh Install E2E,
Install Script E2E, and a second complete vector/emulator run. The verifier
reaper-window correction was independently reviewed with no P0–P2 blocker; its
canonical regenerated provenance passed 24 focused tests and both exact-head CI
runs. Retained delivery branches were not deleted without one-off approval.

Pre-commit review requested an additional unbudgeted nested-isolation compatibility
case. It now proves the deadline remains absent and ordinary signed workspace
cleanup succeeds; no production behavior changed for this follow-up.

Phase 3 pre-delivery evidence: lifecycle and exact-commit reporting tests pass
18/18, the log wrapper passes 18/18, workflow composition passes 716/716, and
the ownership scanner/contract covers 401 lifecycle identities. Repository retry
classifier suites, syntax, lint, lizard, and whitespace gates pass. Full frontend
tests pass 8,411/8,411; backend passes 15,866 with 57 existing gated skips and one
todo. Frontend app/test/all-project typechecks and backend TypeScript pass. Two
live read-only reporter checks returned exact success for merged main workflow
runs 15132–15137 and for Test Suite run 15083 attempt 2. Independent review found
and the implementation fixed bounded live-sink backpressure; no other P0–P2
finding remained. The superseded vector failure in run 15123 at SHA `d4b013c...`
was deterministic stale generated evidence; corrected head run 15130 and merged
main run 15137 both passed the complete vector/emulator aggregate.

The first Phase 3 exact-head attempt at `956af8a7335c2b55a49be0fafcdbabc27808187d`
exposed two bounded defects before delivery. Install run 15140 job 190231 lost
its registered target image after container removal because Buildx had reused an
old image creation timestamp and the host age reaper selected the newly dangling
image. The real-Docker fixture now stamps and verifies both run-built images with
a current `SOURCE_DATE_EPOCH`, backed by a focused source contract. Quality run
15141 job 190249 also identified `validateManifest` as a tenth lizard warning;
validation was decomposed without changing its fail-closed contract and the
nine-warning baseline passes locally. Vectors run 15144 was waiting, not failed,
when these corrections were prepared. Corrected exact-head CI remains required.

The corrected exact-head attempt confirmed both primary fixes: lizard passed and
Install run 15147 job 190307 passed the real-Docker ownership acceptance. Quality
run 15148 job 190324 then exposed a separate deterministic contract error: the
new retry-discipline test required the intentionally ignored, untracked local
`CLAUDE.md` symlink. The contract now refuses untracked documentation inputs and
checks the tracked contributor guide only. The image-age regression is also
explicitly invoked by the CI-classifier job rather than relying on local-only
execution. Another exact-head attempt remains required after active jobs settle.
