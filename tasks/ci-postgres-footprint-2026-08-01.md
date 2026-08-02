# CI Postgres footprint reduction (#606) — 2026-08-01

## Goal

Cut the number of concurrently-live Postgres containers on the shared runner —
the last surviving mechanism for the recurring "table public.users does not
exist" failure in the backend integration lane.

## Plan

- [x] Establish which lanes actually need a database, rather than migrating them
      all to compose.
  - [x] `quick-backend-tests` — does NOT need Postgres. Runs `vitest related`
        with `--exclude tests/integration/**`; no unit or contract test opens a
        connection.
  - [x] `full-backend-unit-coverage-shards` (matrix x2) — does NOT need
        Postgres. `backend-coverage-shard.sh` passes `tests/unit` positionally.
  - [x] `full-browser-e2e-tests` — DOES need Postgres *and* Redis. Boots the
        real compiled backend; `connectWithRetry()` failure kills the process
        before the `/health` gate. Untouched.
  - [x] Both integration lanes genuinely need it. Untouched.
- [x] Verify empirically, not by reading: ran both coverage shards and the quick
      lane's exact command with `DATABASE_URL` unset.
- [x] Drop `services: postgres` plus the vestigial "Resolve Postgres service
      host" and "Run database migrations" steps from the two unit lanes.
- [x] Update the `needs:` comments describing the shards as "Postgres-heavy".
- [x] Fix the vacuity bug found during verification (below).
- [x] Sweep every `vitest related` site for the same bug.
- [x] Regression test, full `tests/ci` suite (45 files), YAML parse.
- [ ] Adversarial review pass.
- [ ] Commit, open PR, verify green.

## Bug found during verification

`quick-backend-tests` and `quick-gateway-tests` — both **required** PR checks —
have run **zero tests** since 2026-05-04 (355 commits).

`classify-test-changes.sh` emits repo-root-relative paths (`server/src/x.ts`)
while those lanes set `working-directory` to that same workspace, so vitest
resolved `server/server/src/x.ts`, matched nothing, and `--passWithNoTests`
exited 0.

Fixed via `scripts/ci/related-test-args.sh`, which re-roots the paths. Measured
after the fix: backend 0 → 143 files / 4016 tests; gateway 0 → 2 files / 103
tests. Frontend was never affected (runs from the repo root).

## Review

**Postgres containers per run: 6 → 3.** Each survivor has a proven consumer.

The compose migration originally requested was not the right first move. It
would have added per-run container naming, ephemeral port allocation,
lock-held DB lifetimes and teardown-on-cancel — for three containers no test
ever connected to. Deleting them gets half the footprint reduction with none of
that risk. Compose remains available for the three real lanes if halving proves
insufficient.

Two things were ruled out along the way:

- The `cleanup_action_containers` sweep is **not** the cause of #606. `docker
  info` fails in the `Docker Resource Cleanup` job, so the sweep has never run
  on this runner. PR #609 closed a latent hole, not the active one.
- Forgejo **does** expose run logs at
  `GET /api/v1/repos/{owner}/{repo}/actions/runs/{id}/logs` (zip) — better than
  the LAN sink, which only receives failed lanes.

## Next steps

1. Watch whether the integration lane stays green under concurrent runs. This is
   a load reduction, not proof of causation.
2. If it recurs: move the remaining three lanes off `services:` so the DB exists
   only while held under the runner lock — bounding *lifetime*, not just count.
3. Separately: the `Docker Resource Cleanup` job silently no-ops on this runner.
   Give it a Docker endpoint or delete it; it currently advertises cleanup it
   never performs.
