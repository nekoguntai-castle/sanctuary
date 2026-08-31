# Ownership Cleanup Implement/Merge Ledger

Plan: `tasks/post-v0.8.69-p0-ownership-cleanup-plan.md`
Target branch: `main`
Rebuild policy: `after-plan`
Created by loop: 2026-08-30

| Phase | Task branch | Worktree path | Created by loop | Converted to next phase | Cleanup status | PR | Merge commit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PR 1 | `codex/implement-merge/ownership-contract-pr1` | `/home/nekoguntai/sanctuary-ownership-contract-pr1` | yes | no | cleaned | [#989](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/989) | `65a3ba81d35e8ace2eeb8dd2a78d7f4a7b21934a` |
| PR 2 | `codex/implement-merge/ownership-manifests-pr2` | `/home/nekoguntai/sanctuary-ownership-manifests-pr2` | yes | no | active | pending | pending |
| PR 3 | pending | pending | yes | no | pending | pending | pending |
| PR 4 | pending | pending | yes | no | pending | pending | pending |
| PR 5 | pending | pending | yes | no | pending | pending | pending |
| PR 6 | pending | pending | yes | no | pending | pending | pending |

## Execution checklist

- [x] PR 1 — policy, schemas, verifier, and architecture contract (PR #989; exact-head and landed-main CI green)
- [ ] PR 2 — deployment/run manifests and producer stamping
- [ ] PR 3 — read-only inventory and signed dry-run
- [ ] PR 4 — exact execution, journal/recovery, and cleanup receipts
- [ ] PR 5 — callsite convergence and real-resource proof
- [ ] PR 6 — registered host-artifact execution
- [ ] Final owned-resource sweep
- [ ] Rebuild and verify the already-running Sanctuary stack

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
