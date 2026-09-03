# Lost-authority stale-stack cleanup — completion report (2026-09-03)

## Outcome

All four obsolete Fresh Install stacks (`ci-99604` through `ci-99607-1-fresh-install`)
were removed by the signed operator lost-authority recovery path, with one signed
`cleaned` receipt per stack and a signed closeout over exactly those four pairs.
Nothing outside the approved scope was mutated.

| Stack | Scope digest | Approval digest | Receipt digest | Receipt state |
|---|---|---|---|---|
| ci-99604-1-fresh-install | `292ea2c655b0…` | `e9eb166972a5…` | `c1ed1757c3ac…` | cleaned |
| ci-99605-1-fresh-install | `97f8ad2d69a5…` | `877af761d1f4…` | `cd5c0484ae13…` | cleaned |
| ci-99606-1-fresh-install | `55c68f29a735…` | `18f6de0ae8f2…` | `bcf9e4f09500…` | cleaned |
| ci-99607-1-fresh-install | `b0b9162e45f7…` | `b3515522f3f3…` | `a6f1f9f84754…` | cleaned |

- Closeout digest `c8d574919acec7bf…`, state `closed`, 4 pairs, exclusion sentinel
  before/after digests bound.
- Each stack: 9 containers, 2 networks, 4 volumes; 24 ordered actions
  (9 stop, 9 container remove, 2 network remove, 4 volume remove).
- Residue after closeout: 0/0/0 for every approved project by both Compose and
  Sanctuary label selectors.
- Exclusions unchanged: `sanctuary` 16/3/9, `ci-local-3469272-1788333412-1-install-upgrade` 9/2/4.
  Sentinel digest `7abbbaf714cf…` identical across attempts 2, 3, and 4.
- OCI images (199) and BuildKit builders retained; never targets.
- All evidence under
  `~/.local/state/sanctuary/operator-recovery-lost-authority-20260903-attempt4`
  is owner-only (`0700`/`0600`). Attempts 1–3 preserved unchanged.

## Source and CI

- Ran from clean detached `/home/nekoguntai/sanctuary-main` at
  `38822b972b41496200af9ec2efaa8a85253f97c3` (PR #1004 squash merge).
- Exact-head CI for PR #1004 (`3bad8a56da`): runs 14502–14507 all success.
- Landed-main CI for `38822b97`: runs 14508–14513 all success.
- Attempt 4 keys/trust valid `12:38Z`–`21:00Z` 2026-09-03.

## What blocked the earlier attempts and how each was resolved

1. **Attempt 3 refusal `recovery observation is incomplete or ambiguous`.**
   Root cause was host-side: `/etc/docker/plugins/archetype-ovs.spec` pointed at a
   socket with no listener, so every `docker volume ls` waited out the daemon's
   plugin dial timeout (constant 15.02 s; inspects 10 ms). A closed-set observation
   issues dozens of volume lists, giving ~10 min prepares and only a 15 s margin
   under the 30 s command timeout; one contention spike tripped it. Two full
   instrumented read-only observations (927 commands, 0 failures) confirmed
   stability; the operator moved the spec to
   `/root/archetype-ovs.spec.disabled-20260903`, after which `volume ls` takes 18 ms.
2. **Attempt 3 approval expired unused** (session idle two hours after a successful
   `prepare`). Documented stop condition; attempt 3 preserved, attempt 4 provisioned.
3. **Attempt 4 `provider correlation evidence expired`.** The correlation artifact is
   fresh for only 60 s (hard-wired; the request schema is exact and cannot raise it).
   Resolved by chaining `prepare` → automated review gate → `execute` in one script.
4. **Attempt 4 `operator recovery target changed after approval`** (same refusal as
   attempt 2). Real bug: the signed scope sorts resources by class/identity/locator
   while the observer sorts by class/locator; for volumes (name vs digest) the order
   diverges and the order-sensitive hash comparison always refused. Fixed in PR #1004
   with a non-regression test that fails on `main` with the exact message.

## Resources retired (after ancestry, tree, and clean-worktree proof)

- Remote and local branches: `codex/lost-authority-stale-cleanup` (#1001),
  `codex/install-script-runtime-authority-fix` (#1002),
  `codex/operator-recovery-freshness-order-fix` (#1003),
  `codex/implement-merge/operator-recovery-scope-order` (#1004).
- Worktrees: `sanctuary-lost-authority-cleanup`,
  `sanctuary-install-script-runtime-authority-fix`, `sanctuary-recovery-scope-order`.
- Each branch tree was byte-identical to its squash merge commit's tree, and every
  merge commit is an ancestor of `origin/main`.

## Post-plan rebuild

The running `sanctuary` stack (previously built from `34eb8909`) was rebuilt with
`./start.sh --rebuild` from clean `sanctuary-main` at `38822b97` because the plan
landed a `package-lock.json` change (`fast-uri` advisory). Result: exit 0, all 14
long-running services healthy, migrate and Grafana-migration one-shots exited 0,
counts still 16/3/9, backend label `io.sanctuary.created-by-commit=38822b97…`.
Data volumes were preserved (the rebuild path never runs `down -v`).

## Follow-ups (not done here)

- The 60 s correlation freshness makes interactive `prepare`/`execute` impractical;
  consider letting the request set `freshnessMs` up to the 5 min contract maximum,
  or having the CLI run prepare and execute as one command.
- The generic `recovery observation is incomplete or ambiguous` message hides the
  ambiguity category; surfacing `category`/`operation` in the refusal would have
  saved a diagnosis cycle.
- `tasks/pr-1002-cleanup-agent-handoff.md` and the two untracked plan files in this
  checkout were left as found.
