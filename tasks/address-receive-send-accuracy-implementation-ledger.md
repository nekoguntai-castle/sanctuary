# Address Receive/Send Accuracy Implementation Ledger

Plan: `tasks/address-receive-send-accuracy-plan-2026-08-12.md`
Target branch: `main`
Rebuild policy: `after-plan`

## Cleanup Ownership

| Phase | Task branch | Worktree | Created by loop | Converted | Cleanup status |
| --- | --- | --- | --- | --- | --- |
| PR 0 | `codex/implement-merge/address-safety-pr0` | `/home/nekoguntai/sanctuary-address-safety-pr0` | yes | no | merged and cleaned |
| PR 1 | `codex/implement-merge/address-safety-pr1` | `/home/nekoguntai/sanctuary-address-safety-pr1` | yes | no | merged and cleaned |
| PR 2 | `codex/implement-merge/address-safety-pr2` | `/home/nekoguntai/sanctuary-address-safety-pr2` | yes | no | merged and cleaned |
| PR 3 | `codex/implement-merge/address-safety-pr3` | `/home/nekoguntai/sanctuary-address-safety-pr3` | yes | no | merged and cleaned |
| PR 4 | `codex/implement-merge/address-safety-pr4` | `/home/nekoguntai/sanctuary-address-safety-pr4` | yes | no | merged and cleaned |
| PR 5 | `codex/implement-merge/address-safety-pr5` | `/home/nekoguntai/sanctuary-address-safety-pr5` | yes | no | PR #816 merged and cleaned |
| PR 6 | `codex/implement-merge/address-safety-pr6` | `/home/nekoguntai/sanctuary-address-safety-pr6` | yes | no | delivery pending |

All pre-existing worktrees and branches are outside this loop's ownership and
must remain untouched.

## Phase Checklist

- [x] PR 0: emergency signer-manifest containment
- [x] PR 1: script-aware send amounts and fee invariants
- [x] PR 2: derivation-coordinate ambiguity removal
- [x] PR 3: complete pinned primary-source corpora
- [x] PR 4: generated signer inventory and adapter fallback closure
- [x] PR 5: receive-ingestion authentication
- [ ] PR 6: physical-proof release gating and row-by-row enablement
- [ ] Verify all target-branch CI and ancestry
- [ ] Rebuild and health-check the already-running Sanctuary stack

## Review

PR 0 is implemented and locally verified. Delivery and target-branch CI are
pending.

Local verification:

- Full frontend suite: 7,585 passed.
- Full backend suite: 13,317 passed; 605 skipped integration tests; one existing
  todo.
- App, test, script, and server-test TypeScript compilation: passed.
- Wallet-safety classifier and contract tests: passed.
- Repeatable four-implementation address verifier: passed twice.
- Checked-in PSBT verifier: 5 Core-backed unsigned and 6 Core-accepted signed
  vectors passed.
- Critical mutation shard: 2,128 mutants evaluated with no timeouts; mutations
  at the new sign, finalize, and broadcast enforcement gates were killed.

PR 5 receive ingestion now authenticates raw transaction bytes, txid, vout,
amount, and canonical script ownership before persistence. Remote history and
UTXO responses are discovery hints; missing, malformed, inconsistent, or
script-irrelevant evidence makes the sync retryable without omission-based UTXO
deletion. An independent security review found and closed a legacy structured
previous-output fallback plus a dropped-script ownership classification path.

PR 5 verification:

- Full frontend suite: 7,689 passed with literal 100% coverage.
- Full backend suite: 13,814 passed; 605 skipped integration tests; one existing
  todo; literal 100% statements, branches, functions, and lines.
- Repeatable four-implementation address verifier: 480 exact cases passed after
  deterministic provenance regeneration.
- Checked-in PSBT verifier: 5 Core-backed unsigned and 6 Core-accepted signed
  vectors passed.
- Receive-evidence mutation shard: 65 mutants, 100% score, no survivors.

PR 6 keeps all 16 supported physical proof rows disabled and explicitly records
the 6 unsupported rows. The release gate validates and cryptographically replays
the complete fixture set at current runner time, requires exact
vendor/model/policy/capability linkage, rejects ambiguous evidence IDs, binds the
full evidence envelope to distinct capture/reviewer receipts, and requires an
externally protected trust-root digest. No physical evidence was fabricated.

PR 6 verification:

- Full frontend suite: 7,690 passed with literal 100% coverage.
- Full backend suite: 13,815 passed; 605 skipped integration tests; one existing
  todo; literal 100% statements, branches, functions, and lines.
- Focused compatibility, workflow composition, inventory, provenance, and
  signed-PSBT suites passed.
- App, test, script, and server-test TypeScript compilation, complexity, and
  diff checks passed.
