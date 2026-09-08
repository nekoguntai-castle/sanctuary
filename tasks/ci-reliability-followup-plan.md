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
- [ ] Deliver the existing branch and verify target-branch CI.

Acceptance: diagnostics remain best-effort and read-only; bounded command failures
cannot be presented as successful empty inventories. Existing daemon identity and
redaction remain available. Timings are not proof of health or cleanup.

## Phase 2 — Subject deadlines and finalization reserve

- [ ] Add validated coordinator-owned subject deadlines using existing process
      group termination/quiescence machinery, not timeout around the coordinator.
- [ ] Carry one job deadline across sequential install subjects; bound remaining
      lock and subject time while reserving cleanup, verification and upload.
      Initialize at the first checkout-dependent setup step of the combined
      fresh/install-script job; include subsequent setup and both waits. Record
      checkout time outside this boundary. Refuse to start an unaffordable subject.
- [ ] Reject impossible budgets before expensive startup; correct stale comments.
- [ ] Test stuck subject, deadline exhaustion, descendant non-quiescence, signed
      cleanup evidence, invalid/overflow budgets and fake-clock exhaustion.
      A timed-out subject may yield a valid cleaned receipt after proven cleanup;
      the subject/job must still fail. Unknown cleanup or unquiesced descendants
      must never produce a cleaned receipt.
- [ ] Deliver and verify.

Acceptance: subject timeout returns failure but leaves a bounded finalization
opportunity. Unquiesced processes never authorize unsafe cleanup. Budget arithmetic
accounts for both install subjects and lock waits, not each in isolation.

## Phase 3 — Durable progress, status and retry discipline

- [ ] Extend existing logging with allowlisted redacted lifecycle progress events;
      test container/outer-process loss and state precisely what survives ingestion.
- [ ] Add exact-commit multi-workflow status reporting using existing Forgejo API
      helpers; paginate, reject incomplete responses, distinguish unknown/running
      from observed progress and terminal success.
- [ ] Assess provider-supported failed-job retry from authenticated API schema;
      document supported targeted emulator procedure or verified lack of support.
      Preserve immutable input/proof binding and aggregate required checks.
- [ ] Document repeated-failure stop rule: new hypothesis plus cheap discriminating
      test before another expensive attempt; integrate owning classifier gates.
- [ ] Deliver and verify.

Acceptance: exact immutable SHA and complete paginated workflow enumeration;
missing expected workflows, malformed responses and unavailable pages produce
unknown/non-success. Reject malformed/secret-bearing lifecycle annotations.
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
| main | fix/preflight-command-outcomes | /home/nekoguntai/sanctuary | adopted from this session | no | pending merge/CI |

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
