# Bug scrub loop — iteration 17 remediation

Run: `bug-scrub-loop-20260920t1514z-whole-repo`. Locked scope: whole repository, target main. Source: `ef70e322c9df9d6d2ee2245b4e5a99cdffba56b6`. Outer goal remains active; nested implement-merge uses this exact file and `rebuild_policy: defer`. No iteration cap. P3 backlog is outside the blocking fix set.

## Goal and accepted evidence

Deliver all three confirmed P2 findings through two serial protected PRs, verify each actual merge and exact target-push CI, then run another complete whole-repository scrub. Do not claim clean from these fixes or their tests.

1. `admin-settings--non-atomic-concurrent-update`: real Variables full saves1/3 and6/12 individually validate, but independent awaited repository upserts can interleave to persist6/3. Service validation explicitly requires deep>=confirmation. Coordinator reproduced one expected invariant failure using the actual service with mocked repository I/O (`.tmp/iteration17-backend-settings-parent-red.log`). Partial updates also require validation against current transaction state, not a stale pre-read.
2. `local-test-lanes--workspace-relative-paths`: local planner emits server/gateway-prefixed paths; runner changes into that package and forwards them unchanged to Vitest related with passWithNoTests. Actual gateway receipt reports0tests/success versus11passing with normalized path. Protected CI separately uses the canonical normalizer and is not claimed bypassed.
3. `local-test-lanes--missing-critical-mutation-script`: actual local critical_mutation lane invokes nonexistent test:critical-mutation; correct toolchain exits1 before tests. The existing server script is test:mutation:critical:gate. Protected workflow uses separate valid shard scripts.

Iteration17 coverage is complete for all eight required domains at source SHA; risk sampling and exact-blob reuse are explicit in archived reports. Fresh repaired settings regression run310tests/25files passes. Prior iteration16 four P2s remain resolved. Open PR1300/1296 are unrelated and must remain untouched.

## Boundaries and compatibility

No settings schema/migration, public request shape, policy threshold, frontend, credential policy, or unrelated settings-writer refactor. Preserve defaults, operational-key restrictions, AI profile/credential normalization, SMTP encryption, response redaction, and partial-update semantics. Do not expose raw stored credentials to API responses or logs. The new boundary protects admin settings mutations; no claim that unrelated generic writers participate in it.

Use existing Prisma Serializable conflict classifier and ConflictError conventions. A process-local mutex is insufficient across backend instances. No generic transaction/retry framework. Keep functions CCN<=15; split named helpers if needed. Repository currently~330lines; keep production files below500lines and review400+ deliberately.

## Phase 1 — atomic admin settings

Production files: `server/src/repositories/systemSettingRepository.ts`, `server/src/services/adminSettingsService.ts`; existing repository barrel exports should continue to expose namespace without new parallel APIs. Shared `server/src/utils/prismaSerializableConflict.ts` receives the verified raw-driver compatibility amendment below; other callers retain their transaction/exhaustion policies.

- [x] Add failing regression first, preserving the demonstrated full-pair interleaving and testing partial-pair validation. Existing repro is evidence; durable tests must own the corrected behavior.
- [x] Add one repository-owned `updateAtomically` snapshot-callback boundary: Serializable transaction reads the same non-operational settings snapshot as getAll; a synchronous side-effect-free derivation callback returns serialized setting rows; validate every output key with the existing operational guard before writes; upsert all rows inside this transaction; obtain the resulting filtered snapshot inside the transaction; return it only after successful commit.
- [x] Retry the entire read/derive/write transaction at most3times only for shared classifier-recognized P2034, wrapped P2010, or supported raw DriverAdapterError serialization/deadlock conflicts. Recreate transaction and rerun callback each attempt. Exhaustion yields existing ConflictError retry guidance; other errors propagate unchanged. Match repository bounded immediate-retry practice, without custom backoff or local locks.
- [x] Refactor service threshold validation and AI normalization into synchronous helpers consuming the supplied raw snapshot. No global findByKeys/set/getAll may escape the transaction during derivation. Preserve raw credential map internally for normalization; redact only through existing response builder after committed snapshot returns.
- [x] Serialize/encrypt all output rows before writing. Preserve empty/encrypted SMTP handling. Operational input rejection and independent dust validation may remain before admission. Clear SMTP transporter cache once after successful commit, never during failed/retried attempts. No audit/outbound/cache side effects inside the callback.
- [x] Preserve existing GET behavior and API route. Existing ordered full-array AI replacement semantics remain; profiles, active ID, credential map and legacy endpoint/model keys commit coherently. Do not claim separately reproduced credential theft/loss.

Tests: extend `server/tests/unit/services/adminSettingsService.test.ts` and `server/tests/unit/repositories/systemSettingRepository.test.ts`, splitting focused new test files if that improves readability. Add actual service/database concurrency cases under `server/tests/integration/flows/adminSettingsConcurrency.integration.test.ts`, following existing guarded flow setup. Register the new flow in the explicit `scripts/ci/backend-integration-groups.sh` flow list in the same phase; run its owning classification/inventory contracts.

- [x] Service tests prove derivation uses transaction snapshot, full/partial threshold rules/defaults, AI current credential preservation, redaction and unchanged validation; no escaped global I/O; cache invalidation after success only. Avoid merely asserting method names.
- [x] Repository tests prove one Serializable transaction, operational filtering/write guard, fresh callback replay on both conflict representations, three-attempt exhaustion, nonconflict propagation, and successful snapshot/result. Include empty derived rows and first-setup missing settings.
- [x] Guarded real PostgreSQL tests call actual service/new repository boundary (not copied SQL logic). Full concurrent updates must finish with one valid submitted pair; partial updates from1/12 with concurrent confirmation6 and deep3 must reject an incompatible retried update or leave a valid serial state. Coordinate first read/derivation attempts with a bounded barrier and forward actual I/O; never wait for two same-row writes while holding row locks. Settle all promises/restore spies even on failure.
- [x] Prove rollback with a later real database write failure after an earlier row has been written; no partial commit and no SMTP cache clear. A callback throw before writing is not sufficient rollback evidence. Keep injected failure/test scheduling isolated to the test. No live application database use.

Verification: focused owning units; `./scripts/run-integration-tests.sh tests/integration/flows/adminSettingsConcurrency.integration.test.ts` with receipt-bound isolated database and terminal cleanup; backend production/tests typechecks, full backend suite and literal tests/unit coverage100%; frontend full suite/typechecks required by repo hooks (reuse exact unchanged frontend coverage/build/render receipts only with hashes and disclose reuse); lint/architecture/generated graphs/CCN and foreground hooks. Verify `scripts/ci/backend-integration-groups.sh flows` includes the new file and its inventory contract passes; CI uses this explicit list, not automatic directory discovery. Run fresh broad gates after final production changes; no test-only coverage bypass.

Acceptance: successful admin mutations preserve threshold invariant and coherent derived settings; failed attempts leave no partial writes; actual DB concurrency/rollback and error/retry contracts pass. Commit/push only phase1 production/tests plus exact reviewed plan/progress and expected generated artifacts.

## Phase 2 — local validation lane dispatch

Start from verified phase1 target after serial delivery. Production file `scripts/ci/run-lane.sh`; tests `tests/ci/run-lane.test.sh`; canonical `scripts/ci/related-test-args.sh` and classifier remain reused unchanged unless required edge-case evidence demands reviewed revision.

- [x] Write regressions first for backend/gateway nonempty repo-relative related paths, exact argv boundaries (including spaces), frontend paths with safe positional argument spelling, empty-files/full and coverage modes.
- [x] Normalize package paths using existing related-test-args helper before changing directory/dispatching. Preserve arrays and leading-prefix-only behavior; propagate normalizer failure without silently producing an empty list/full scan. Root frontend path requires no workspace normalization. Apply the reviewed positional-operand amendment below after package normalization for all three related lanes. Preserve all existing exclusions, test tier rules and exit statuses.
- [x] Change critical_mutation dispatch to existing `npm run test:mutation:critical:gate`. Add behavioral stub dispatch/cwd check, verify chosen script exists in actual package metadata, and propagate a failed gate exit. Do not run the expensive full mutation suite merely to prove command lookup.
- [x] Run focused shell contracts for run-lane, related-test-args, plan-test-run and workflow composition; shell syntax/lint/quality contracts. Retain bounded actual-runner Vitest related discovery checks proving affected frontend, gateway and backend sources select owning tests. Do not substitute command-shape assertions alone for path discovery evidence.
- [x] Full/coverage modes and frontend selection remain correct, unrelated lanes retain commands. Existing quality workflow already runs run-lane test; verify exact registration. No protected workflow/branch-protection change.

Acceptance: actual local related lane executes affected workspace tests; critical mutation lane reaches the existing gate and preserves failure status. Deliver as separate protected PR after phase1 target CI is green. Backend/app expensive suites may reuse exact unchanged source/config receipts with verified hashes; run foreground required hooks and changed owning CI contracts.

## Delivery, rollback and final gate

- [ ] Complete recursive review of this exact file until a full pass has no verified actionable comments. Record review count and pin reviewed plan commit before production edits; immutable plan revision accompanies both phase PRs.
- [ ] Parent reserves owned branches before creation, refreshes target/open PRs and revalidates evidence. Preserve unrelated five primary untracked files and all unrelated worktrees/PRs.
- [ ] Independent adversarial/reuse/simplification review after each implementation, then parent final diff/test checks and foreground commit hooks. Address verified hook feedback before push; no bypass.
- [ ] For each phase: all required PR workflows/reviews green; protected head-pinned squash merge with delete_branch_after_merge=false; actual merge object/main ancestry/tested-tree equality; all exact merge-triggered target-push workflows success before resolving findings and incrementing immutable attempt records.
- [ ] Settle phase sessions/agents and refresh source before next phase. Cleanup remains an exact one-off destructive-approval closeout obligation; no deletions until proven owned/merged and specifically approved. Archive ignored evidence outside owned worktree first.
- [ ] No intermediate deployment. After both phases, fresh complete whole-repository scrub at current main; additional P0/P1/P2 requires a new reviewed plan. Only clean pass plus verified owned cleanup and final originally-running-stack deployment can complete outer goal.

Rollback is a protected revert PR per phase. No database migration to reverse; reverting atomicity restores the known race and cannot repair already accepted settings. Exhausted transient conflicts now return retryable conflict instead of risking mixed state. Existing invalid settings are not silently repaired; normal valid updates may replace them under existing validation. Final deployment remains crash-safe outer-loop operation through ./start.sh --rebuild only on the originally running relevant stack, with build identity/health/readiness proof.

## Review and verification record

- [x] Recursive plan review converged for amended implementation revision.
- [x] Phase1 delivered and exact target CI verified.
- [ ] Phase2 delivered and exact target CI verified.
- [ ] Delivery evidence returned to outer loop; next full scrub completed.

Review record: two recursive rounds with coordinator and independent backend/lifecycle source review. The sole accepted correction explicitly registers the new flow in backend-integration-groups.sh. Final whole-file rereads found no remaining actionable comments (substantive reviewed blob2fa873e623b70a4198723c68ac10d0b2cb432420). Rejected expansions: generic retries, process-local serialization, global settings-writer conversion, speculative credential-loss findings and migrations. Registration gates are `bash scripts/ci/backend-integration-groups.sh --check` and `bash tests/ci/backend-integration-groups.test.sh`; git diff --check passed. This paragraph/checkbox records review without changing implementation requirements.

## Verified classifier compatibility amendment

Actual isolated PostgreSQL verification passed full-pair concurrency and postwrite rollback, but partial conflict arrived at commit as raw DriverAdapterError with cause.kind TransactionWriteConflict and originalCode40001, bypassing the helper. A cheap discriminator using the installed adapter error class confirms false classification. Installed adapter-pg maps40001 and40P01 to that conflict kind. Preserve old reviewed ed056ac0e7 and pin a new reviewed revision before modifying this additional production file. This amendment completes phase1 retry acceptance; do not relax the failed test.

- [x] Tests first in new `server/tests/unit/utils/prismaSerializableConflict.test.ts`: raw serialization40001 and deadlock40P01 accepted; existing P2034/wrappedP2010 preserved. Negative cases: ordinary errors, message/SQLSTATE-only objects, malformed/null cause, wrong name/kind/code, unrelated adapter errors. Retain actual installed-class red evidence.
- [x] Add tight raw recognition in `server/src/utils/prismaSerializableConflict.ts`: Error instance, exact DriverAdapterError name, non-null object cause, exact TransactionWriteConflict kind, and originalCode40001 or40P01. No message matching, broad retry, new production dependency or change to existing wrapped-error compatibility.
- [x] Extend repository atomic tests to replay a fresh snapshot after raw error. Review and run owning units for all shared callers: userRepository, groupRepository, networkHeaderTransaction, userAdminUpdate, walletRemediation service and transferService, plus settings. Keep their transaction/side-effect/exhaustion policies unchanged. Full backend literal-unit100%coverage remains required.
- [x] Rerun the same guarded3-case PostgreSQL flow after classifier/retry units pass and old cleanup is terminal. Preserve exact identities, failure signature, new hypothesis and cheap discriminator in `.tmp/iteration17-settingsatomic-retry-evidence.md`; failed run cleanup is cleaned/success with0retained resources. This was deterministic classifier incompatibility, not an infrastructure failure.

Phase2 and final whole-repository/cleanup/deployment requirements remain unchanged. All3findings are still blocking, attempts0. Durable plan status retains implementing history while stageplanning records amendment review; no implementation of the expansion until a new reviewed pin exists.

Amendment review: coordinator and two independent whole-plan source-backed passes found no actionable comments at substantive blobe154f337dfcd8cae9d0bb4b626f6fb350bd891fe. Narrow error identity/SQLSTATE guards, shared-caller scope, negative tests and unchanged database acceptance verified. Pin this revision before expansion edits; prior review history remains intact.

## Phase1 local implementation progress

Atomic settings and classifier amendment are implemented against reviewed revision87daeefc69b91c9b8176666170b1fb05fb98e5b8. Focused237tests/11files, production/test types, actual installed-class classifier discriminator, all3unchanged guarded PostgreSQL concurrency/rollback cases, integration manifest contract, lint/architecture/complexity and independent final review pass. Guarded database cleanup is terminal cleaned/success with0retained/refused/ambiguous resources. Full backend726files/16569tests pass (66files/773tests skipped,1todo); database claims rely on the separate guarded run. Literal tests/unit coverage passes:719files/16473tests,100%41129statements/23211branches/8758functions/38307lines. The first coverage run exposed one unchanged generic lookup previously covered incidentally; three direct selected/empty/failure lookup tests closed that gap, with a focused100%discriminator and final test typecheck. No production change or threshold waiver was required. No delivery or resolved finding is claimed. Frontend source/config/dependency and original receipt identities are unchanged: prior full frontend coverage/types/build/144browser checks are reused, not rerun.

## Phase1 delivery closeout

PR1316 head8a4f4f67b26fdaaf77694aa3f4fd8e9ab6caeb0f merged as3652f1ee7ae6116c3b687f51da2b571e2ec8fb43. Actual commit/main ancestry and exact tested-tree equality verified. All six PR workflows19162–19167 and five exact merge-push workflows19168–19172 passed on their first attempts; release validation is an additional PR check triggered by the CI manifest and does not run on ordinary main pushes. Reviewed implementation pin remains87daeefc69b91c9b8176666170b1fb05fb98e5b8; implementation/progress0cf19468fa plus comment-only8a4f4f67b2 do not replace that pin. Settings finding resolved, attempt1. Cleanup remains prepared for exact authorized closeout; deployment deferred.

Phase2 begins from that verified target. Runner/helper/tests/package metadata are unchanged from the original reviewed source; only unrelated PR1300/1296 remain open. The owned iteration17-lanes branch was reserved before creation. Two runner P2s remain blocking until their own verified delivery and a fresh whole-repository scrub remains required.

## Verified related-operand amendment

The planned workspace normalization and mutation dispatch changes pass shell contracts, but actual normalized gateway/backend runner invocations still select zero tests. Installed Vitest CAC separates every operand after standalone `--` into `options["--"]`; `runRelated` consumes positional filters only. Empty related filters intentionally select no tests and `--passWithNoTests` exits successfully. The exact normalized gateway source selects11tests when invoked without that separator. Independent parser/source inspection confirms frontend shares this cause. This extends the existing stable false-green finding, not a separate finding or a delivered failed attempt.

- [x] Add tests first for related argv containing no standalone separator, preserving each quoted path including spaces and nested workspace names. After workspace normalization, prefix only operands starting `-` with `./` so they cannot become Vitest options. Apply the same safe spelling to frontend operands without stripping any frontend prefix; verify dash-leading operands for each lane.
- [x] Remove the standalone `--` only from `vitest related` dispatch in `scripts/ci/run-lane.sh`. Keep array boundaries, canonical workspace helper, existing full/coverage commands, exclusions, tier behavior and subprocess exit propagation. Do not change Vitest, dependencies, protected workflows or the shared normalizer. A small named helper may prepare safe positional operands.
- [x] Retain the original zero-selection receipts and compare bounded actual runner runs for one known related source per frontend/backend/gateway lane. Each must execute nonzero owning tests successfully; shell stub assertions alone cannot qualify. Confirm the installed parser resolves `./-file.ts` as the same filesystem identity and does not parse it as an option. Run the four owning shell contracts plus syntax/lint after final edits.

Pin a new converged reviewed plan revision before this additional executable change. Prior reviewed pins and phase1 delivery provenance remain immutable. The settings finding is already resolved by PR1316; the two runner findings remain blocking. Final whole-repository scrub, exact owned cleanup and final deployment gates remain unchanged.

Related-operand amendment review: coordinator and two independent whole-plan source-backed passes converged at substantive blobd39e74081f3071025618dd78c54d1a7514f4e510. No actionable comments remain. Installed parser/filter/resolver and unchanged target3652f1ee7a verified; no unrelated open PR overlaps. Review count advances to4 for the next immutable implementation pin.

## Phase2 local verification

Implemented under reviewed pine58e842e03b71875623327fdc1c5af3536671468. Both initial and amended tests-first failures are retained. Four owning shell contracts, syntax, ShellCheck0.10.0, pinned lizard gate and independent adversarial review pass. Actual run-lane commands execute gateway11tests/1file, backend17tests/2files and frontend364tests/27files. Installed Vitest parser also confirms safe dash/space operands and empty related selection with the old separator. One overly broad backend related selection was interrupted and excluded; the bounded replacement passed. Exact unchanged application inputs and949non-shell test files substantiate reused broad backend/frontend receipts; no fresh full application/mutation run is claimed. Protected delivery and exact target CI remain pending.
