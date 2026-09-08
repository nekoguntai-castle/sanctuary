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
- [x] Deliver and verify.

Acceptance: exact immutable SHA and snapshot-consistent paginated workflow
enumeration; required aggregate jobs, not workflow status alone, must be terminal
success. Missing expected workflows/jobs, malformed responses, page instability
and unavailable pages produce unknown/non-success. Reject malformed,
secret-bearing or workflow-command-capable lifecycle annotations and describe
their delivery as best-effort observability, never cleanup or merge authority.
Retry assessment does not authorize unrelated whole-workflow reruns or skipping
aggregate required checks. Stabilize event schema before Phase 4 sampling.

## Phase 4 — Fleet admission, timing and lifecycle convergence

- [x] Correlate daemon/host identity with queue, lock, build, subject, cleanup and
      upload timing using existing aggregators; represent missing samples honestly.
- [x] Assess shared-daemon capacity across install/upgrade/vectors/emulators using
      actual fleet evidence; retain policy unless measurements support a change.
      Any required runner-infra deployment remains externally coordinated.
      Assess the latest seven days, at most twenty complete relevant runs per
      host, and document the exact sample inventory and missing access. Insufficient
      samples mean inconclusive/policy unchanged, not empirical validation passed.
- [x] Audit restart/recreate callsites for unintended builds/pulls/identity changes;
      extend no-build contracts only where intended behavior warrants it.
- [x] Run lifecycle scanner/contract fixtures before expensive E2E; document measured
      distributions and thresholds without inventing timing samples.
- [x] Deliver and verify.

## Phase 5 — Recovery observation and operator diagnostics

- [x] Add composed successful-mutation/postcondition-query-failure regression cases:
      stop later mutations, preserve signed non-success evidence or active journal,
      and recover observationally without repeating deletion.
- [x] Expose optional bounded correlation freshness within existing five-minute
      contract maximum; make review expiry explicit; never accept expired approval.
- [x] Add allowlisted ambiguity category/operation diagnostics without raw secrets
      or resource locators; retain existing fail-closed behavior.
- [x] Deliver and verify.

## Final acceptance

- [x] Map all ten backlog candidates and two recovery follow-ups to evidence above.
- [x] All phase PRs merged with actual ancestry and exact-commit CI verification.
- [x] Sweep only owned branches/worktrees; record any approved-retained leftovers.
- [x] Inspect and rebuild only already-running relevant Sanctuary stack using
      `./start.sh --rebuild`; verify documented health. Preserve unrelated workloads.

## Ownership ledger

| target_branch | task_branch | worktree_path | created_by_loop | converted_to_next_phase | cleanup_status |
| --- | --- | --- | --- | --- | --- |
| main | fix/preflight-command-outcomes | /home/nekoguntai/sanctuary | adopted from this session | no | merged in PR #1043; retained under the one-off destructive-command policy |
| main | codex/implement-merge/ci-subject-deadlines | /home/nekoguntai/sanctuary | yes | no | merged in PR #1044; retained under the one-off destructive-command policy |
| main | codex/implement-merge/ci-progress-status | /home/nekoguntai/sanctuary | yes | no | merged in PR #1045; retained under the one-off destructive-command policy |
| main | codex/implement-merge/fleet-lifecycle-convergence | /home/nekoguntai/sanctuary | yes | no | merged in PR #1046; retained under the one-off destructive-command policy |
| main | codex/implement-merge/recovery-observation-diagnostics | /home/nekoguntai/sanctuary | yes | no | merged in PR #1047; retained under the one-off destructive-command policy |
| main | codex/implement-merge/ci-reliability-closeout | /home/nekoguntai/sanctuary | yes | no | final acceptance evidence; retain under the one-off destructive-command policy after delivery |

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

| Authorized candidate/follow-up | Closing evidence |
| --- | --- |
| Observation latency and daemon/host identity | Phase 1 preserves bounded elapsed/status evidence; Phase 4 correlates the available host and lifecycle samples without inventing missing data. |
| Cross-workflow admission | Phase 4 records that expensive independent workflows may start after a fast failure and retains policy because Forgejo has no safe workflow dependency primitive. |
| Shared subject/finalization budget | Phase 2 carries a validated deadline across sequential subjects and reserves bounded finalization time. |
| Durable progress after controller loss | Phase 3 emits allowlisted lifecycle events and states precisely which ingested evidence survives process or container loss. |
| Emulator retry scope | Phase 3 records the provider-supported limitation and preserves immutable inputs, proofs, and aggregate checks. |
| Exact-commit status | Phase 3 snapshot-consistently enumerates every expected workflow and required aggregate for an immutable SHA. |
| Restart/recreate audit | Phase 4 audits build, pull, and identity-changing callsites and extends no-build contracts only where intended. |
| Per-host timing and capacity | Phase 4 records the bounded seven-day sample, missing queue/build fields, descriptive distributions, and unchanged policy. |
| Observation/query failures | Phase 5 converts post-mutation query failure to signed non-success evidence, stops later mutation, and proves observational recovery does not replay deletion. |
| Repeated expensive failure discipline | Phase 3 requires a new hypothesis, cheap discriminator, and immutable SHA/run/job signature before another repository-owned retry. |
| Correlation freshness follow-up | Phase 5 validates 1,000–300,000 ms before provider callbacks and exposes correlation expiry for review. |
| Approval/refusal diagnostics follow-up | Phase 5 preserves exact-expiry refusal and emits only bounded allowlisted ambiguity category/operation diagnostics. |

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

Phase 3 delivery completed in PR #1045. Exact reviewed head
`6ad7f57981bc1e78795f72710904af78a6f66411` passed runs 15152–15158. Forgejo
squash-merged it as `47dd9baf88b96eaefdb6d380715c3b910608dc3d` with the reviewed head's exact
tree and parent `591ad7c60c43ec81fbfcc2b7fe0baff53bae6210`. Exact landed-main runs
15160–15165 all passed.

Phase 4 fleet evidence and lifecycle audit are recorded in
`docs/reference/ci-fleet-capacity-assessment-2026-09-08.md`. The seven-day
enumeration covered 1,100 API rows and 361 terminal relevant runs, but the newest
20 candidates yielded zero complete host-attributed workflows. Five replay-image
build jobs provided partial daemon/lock/coordinator/cleanup/upload correlation;
isolated build and subject timing remained unavailable. Capacity and
admission policy therefore remain unchanged; five warranted no-build/operator
lifecycle gaps are covered by focused contracts.

Phase 4 final local verification passed on the reviewed tree: resource ownership
validated 398 lifecycle identities; both lifecycle scanner suites passed 39/39;
frontend TypeScript passed all three configurations and Vitest passed 8,414 tests
across 626 files; backend TypeScript and 15,767 unit tests across 684 files passed;
install contracts passed 134/134 and 95/95; workflow composition passed 716/716;
and frontend lint, shell syntax, diff checks, and the repository lizard gate
passed. The first broad frontend attempt used the exhausted default `/tmp` and
failed to transform 102 files after 7,712 passing tests; the unchanged tree then
passed completely with the established external `TMPDIR`. Independent lifecycle
review reported no P0-P2 findings.

Phase 4 delivery completed in PR #1046. Exact reviewed head
`74a2ac38127f54c625c9ced46ca3880c3060052d` passed all seven PR workflows,
including Release Candidate maximum-shape replay and every vector emulator.
Forgejo squash-merged it as `2d6b008aa3aaddab2e7bb9418f91e0b187c2a6ec`;
the fetched commit is `origin/main`, has parent
`47dd9baf88b96eaefdb6d380715c3b910608dc3d`, and has the reviewed head's exact
tree. Exact landed-main runs 15174–15179 all passed.

Phase 5 local verification: the composed execution regression performs one
successful mutation, converts the failed postcondition query to signed ambiguous
evidence, refuses the later action, and proves terminal recovery performs no
second mutation. Provider freshness accepts only 1,000–300,000 milliseconds,
defaults to 60,000, rejects invalid input before any provider callback, exposes
both correlation and approval expiry, and retains exact-expiry approval refusal.
All four recovery observation stages expose only bounded allowlisted category
and operation names; tests prove raw locators, stderr, and unrecognized strings
are omitted. Focused recovery passed 129 tests, the broader ownership suite
passed 509 tests with three existing gated Docker skips, and the 398-identity
ownership contract passed. Both independent corrected-diff reviews found no
P0-P2 issue.

Full local gates passed: frontend TypeScript in all three configurations and
8,414 tests across 626 files; backend TypeScript and 15,866 tests across 691
passing files, with 57 existing skipped files and one todo; frontend lint,
lizard, documentation links, and diff whitespace. An initial backend run was
incorrectly overlapped with the frontend suite despite the recorded capacity
lesson and produced four unrelated timing/backpressure failures. The prescribed
259-test serial discriminator passed, then the unchanged backend tree passed in
isolation; no retry claim relies on the overlapped run.

Phase 5 delivery completed in PR #1047. Exact reviewed head
`6bc5683614ea28127a1ebd12c1e5d098f96033a6` passed all seven PR workflows
(runs 15180–15186), including the three protected aggregates, Install upgrade
baseline, Release Candidate live/maximum replay, and all vector emulators.
Forgejo squash-merged it as
`15ce9cd9662c06a45430a5072367b7c05d87d536`; the fetched commit is
`origin/main`, has sole parent
`2d6b008aa3aaddab2e7bb9418f91e0b187c2a6ec`, and has the reviewed head's exact
tree. All six exact landed-main workflows (15187–15192) passed.

The final owned-resource sweep found the five merged task branches listed in the
ledger locally and on `origin`, plus the current closeout branch, all sharing the
single `/home/nekoguntai/sanctuary` worktree. They are retained because the repo
requires an exact one-off approval for destructive local or remote branch
deletion; no broad cleanup authority was inferred. The detached
`/home/nekoguntai/sanctuary-main` deployment worktree and historical CI/test
containers are not loop-owned and were preserved.

The active `sanctuary` Compose project was already running from the ownership-
bound detached deployment worktree. An attempted rebuild from the task worktree
failed closed before container mutation because its project directory did not
match the deployment identity. The clean deployment worktree was advanced to
exact verified main `15ce9cd9662c06a45430a5072367b7c05d87d536`, then
`./start.sh --rebuild` completed successfully. Deployment generation 6 is active;
frontend, backend, worker, gateway, and LLM egress proxy all carry that revision;
all long-running project services are running and every health-checked service is
healthy, both one-shot migrations exited zero, and
`https://localhost:8443/api/v1/health` reported healthy database,
Redis, Electrum, websocket, sync, queue, startup, cache-invalidation, circuit-
breaker, memory, and disk components. Unrelated workloads were not rebuilt.
