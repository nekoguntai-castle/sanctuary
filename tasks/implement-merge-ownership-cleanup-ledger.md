# Ownership Cleanup Implement/Merge Ledger

Plan: `tasks/post-v0.8.69-p0-ownership-cleanup-plan.md`
Target branch: `main`
Rebuild policy: `after-plan`
Created by loop: 2026-08-30

| Phase | Task branch | Worktree path | Created by loop | Converted to next phase | Cleanup status | PR | Merge commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR 1 | `codex/implement-merge/ownership-contract-pr1` | `/home/nekoguntai/sanctuary-ownership-contract-pr1` | yes | no | cleaned | [#989](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/989) | `65a3ba81d35e8ace2eeb8dd2a78d7f4a7b21934a` |
| PR 2 | `codex/implement-merge/ownership-manifests-pr2` | `/home/nekoguntai/sanctuary-ownership-manifests-pr2` | yes | no | cleaned | [#990](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/990) | `cdf3de0d7d` |
| PR 3 | `codex/implement-merge/ownership-inventory-dry-run` | `/home/nekoguntai/sanctuary-ownership-inventory-dry-run` | yes | no | cleaned | [#992](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/992) | `60c6dadcf495d9a15366d3698cbd27e675055dbd` |
| PR 4 | `codex/implement-merge/cleanup-execution-receipts` | `/home/nekoguntai/sanctuary-cleanup-execution-receipts` | yes | no | cleaned | [#993](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/993) | `313bf4c61fa586aae476a5d80e005a9b35d14a31` |
| PR 5 | `codex/implement-merge/cleanup-enforcement` | `/home/nekoguntai/sanctuary-cleanup-enforcement` | yes | no | cleaned | [#994](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/994) | `3ce2c78818` |
| PR 6 | `codex/implement-merge/host-artifact-execution` | `/home/nekoguntai/sanctuary-host-artifact-execution` | yes | no | cleaned | [#995](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/995) | `8d518f307c` |

## Execution checklist

- [x] PR 1 — policy, schemas, verifier, and architecture contract (PR #989; exact-head and landed-main CI green)
- [x] PR 2 — deployment/run manifests and producer stamping (PR #990; exact-head and landed-main CI green)
- [x] PR 3 — read-only inventory and signed dry-run (PR #992; exact-head and landed-main CI green)
- [x] PR 4 — exact execution, journal/recovery, and cleanup receipts (PR #993; exact-head and landed-main CI green)
- [x] PR 5 — callsite convergence and real-resource proof
- [x] PR 6 — registered host-artifact execution
- [x] Final owned-resource disposition: one empty stale network removed; four
  obsolete test stacks retained by required fail-closed lost-authority policy;
  one unlabeled stack explicitly excluded
- [x] Rebuild and verify the already-running Sanctuary stack

## Review

- PR 2 successive pre-delivery reviews found fourteen P1/P2 gaps. All were corrected before
  commit: inline-overlay secret bypass, pre-lock database mutation, implicit
  legacy-resource adoption, v0.8.69 streamed-installer locking, shared-image
  retention, registration key/path replacement, checkpoint recovery coverage,
  and cross-run pending resumption.
- PR 2 local verification includes ownership tests, install/offline/backup and
  release suites, interruption/resume shell fixtures, workflow composition,
  docs, typecheck, lint, lizard, duplication, large-file classification, and
  focused replay-controller coverage.
- PR 2 required a landed-main compatibility correction after merge. PR #991
  initialized the strict Compose identity at the legacy entry point; its exact-head
  and landed-main CI both passed before PR 3 resumed.
- PR 3 pre-delivery review closed lock-domain, partial-release, mutation-race,
  Docker observation-drift, and pre-manifest opt-in gaps. Local verification covers
  all ownership tests, installer unit tests, cleanup wrapper regressions, workflow
  composition, syntax, diff hygiene, and complexity limits.
- PR 4 successive implementation reviews closed crash-transition adoption,
  cancellation timing, dynamic authority drift, open-intent recovery, stable-read,
  and private-key permission gaps. Local verification covers the complete ownership,
  frontend, server, typecheck, workflow/static, complexity, and isolated real-Docker
  acceptance gates. Final independent architecture/security and acceptance reviews
  returned `CLEAN`. PR #993 merged as `313bf4c61fa586aae476a5d80e005a9b35d14a31`;
  all exact-head and landed-main checks passed, and the exact loop-owned branch and
  clean worktree were removed only after squash-tree and ancestry verification.
- PR 5 local verification covers 330 ownership cases (327 pass, three opt-in
  real-Docker skips), isolated real-Docker acceptance (3/3), and coordinated
  address-verifier recovery with signed, provider-bound final evidence and no exact
  resource residue. The final registry contains 231 classified identities and zero
  Docker migrations; CI registration is 10/10 and workflow composition is 668/668.
  The complete quality gate passes 8,271/8,271 tests with 100% coverage and green
  audit, gitleaks, Semgrep-baseline, complexity, duplication, and classified-large-
  file gates. Independent exact-tree architecture, security, recovery, and
  acceptance rereviews returned `CLEAN`. Exact-head and landed-main CI remain the
  delivery gates.
- PR 5 merged through #994 as `3ce2c78818`; PR 6 merged through #995 as
  `8d518f307c`. Their exact-head workflows passed, while landed-main Fresh Install
  exposed compatibility boundaries that drove the following serial corrections.
- Landed-main-only Fresh Install exposed three compatibility boundaries that were
  fixed serially through #996-#998: caller authority selection, Docker image-tag
  witnessing, and Podman reference normalization. Each correction passed its
  exact-head workflows; landed-main results after #996 and #997 exposed the next
  boundary. The final #998 main state passed all six workflows, and explicit Fresh
  Install run #14379 then passed subject execution, successful cleanup, and receipt
  verification.
- The first exact-main local rebuild correctly refused an unmanifested legacy
  Grafana volume. PR #999 added manifest/lock/pointer-bound legacy-volume
  verification plus pre/post container-pinning checks. Its focused suites, 414-case
  ownership run, 8,277-test pre-commit gate, and two independent P0-P2 reviews all
  passed; it merged as `e574aaf06a` with identical reviewed and merged trees.
- The malformed intermediate deployment store was quarantined intact and the
  separately reverified empty test network was removed under exact approval. The
  supported legacy migration then activated generation 1, followed by a no-cache
  rebuild from exact `e574aaf06a` that activated generation 2. All 14 containers
  were running, healthchecked services were healthy, and the routed API returned
  HTTP 200. A persisted `JAEGER_UI_PORT=16687` avoided the independently owned
  `counting-cats` listener without mutating that stack.
- Final stale-resource reinspection found four loop-created Fresh Install projects
  with internally consistent obsolete/exact-delete labels (9 containers, 4
  volumes, and 2 networks each). Their original private coordinator roots,
  deployment/run manifests, registrations, keys, approval ledgers, and receipts
  no longer exist. Per the architecture's host/disk-loss boundary, labels and logs
  cannot recreate cleanup authority, so all four were retained and no raw Docker
  deletion was substituted. The unlabeled `ci-local-3469272-1788333412-1-install-upgrade`
  project and every active Sanctuary resource were also left untouched.
- After merge/tree/cleanliness verification, the PR 2, PR 5, PR 6, and correction
  worktrees were removed, together with their seven exact local and remote merged
  branches. The retained `/home/nekoguntai/sanctuary-main` worktree remains the
  active runtime source; unrelated worktrees and branches were not modified.
