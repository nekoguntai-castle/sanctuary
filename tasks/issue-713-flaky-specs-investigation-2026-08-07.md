# #713 item 1: the two "genuinely flaky" specs do not reproduce

**Date:** 2026-08-07
**Scope:** item 1 only. Items 2 and 3 were delivered by #722 (`40ece9fd`).

## Conclusion

`authIntentConcurrency.integration.test.ts` and `transfers.integration.test.ts`
show **no flakiness** at the reported rate, locally or in CI. The evidence
points at the reported "1 in 5 locally" having been an artifact of two harness
bugs that have since been fixed, rather than races inside the specs.

Recommend closing #713. Do **not** rewrite either spec chasing a race that the
evidence says is not there.

## Evidence

### Local — 57 runs, 0 failures

Against the isolated test database (`postgresql://test:test@localhost:55433/
sanctuary_test`, its own compose project, never the dev stack):

| what | runs | failures |
|---|---|---|
| `authIntentConcurrency` alone | 25 | 0 |
| `transfers` alone | 25 | 0 |
| full `tests/integration` (613 tests) | 7 | 0 |

If either spec failed 1-in-5 as reported, 25 consecutive passes has probability
`0.8^25 ≈ 0.4%`. The reported rate is excluded with high confidence.

### CI — 8 consecutive first-attempt passes

#722 added a first-attempt marker, which is what makes this observable at all.
Runs 9156, 9159, 9166, 9173, 9179, 9182, 9184, 9190 each show:

```
first-attempt result: pass
```

with exactly **one** `backend-integration-attempt-*.log` and no
`passed only on attempt N` warning. So these are genuine first-attempt greens,
not retried greens — the specific blindness #713 was filed about.

This matters because the local machine is fast and uncontended; the CI runners
are neither. The CI sample covers the contended case.

## Why the original observation was probably real but misattributed

#713 inherited from #612 the claim that these specs failed "independently of
the CI Postgres-alias bug." That claim appears never to have been verified, and
two separate harness defects have since been fixed, either of which produces
exactly this symptom:

1. **#714 — container-name collision.** `docker/compose/test.yml` pinned
   `container_name` on every service, so two concurrent local runs (two
   worktrees, or a test run beside a debugging session) attached to or
   destroyed each other's database. From `scripts/run-integration-tests.sh`:

   > Unlike a bound port, a fixed container name fails silently: you get a
   > confusing test failure rather than a name-in-use error, which reads as
   > flakiness and sends you looking in the wrong place.

   That is a precise description of #713's symptom, and it was a *local-only*
   defect — matching the report of "1 in 5 **locally**."

2. **Alias rotation** (`ff05e575`, #612) — Docker DNS returning several
   containers for the `postgres` alias and rotating per connection.

Both are fixed. Nothing else changed in either spec: neither has been touched
since 2026-07-31.

## Caveats

- Absence of reproduction is not proof of absence. This excludes a ~1-in-5
  flake; it does not exclude a much rarer one (say 1-in-100), which would need
  a far larger sample to detect and would not justify the retry that #722
  removed.
- Locally, 14 tests across 5 worker specs skip because `REDIS_URL` is unset
  (`describeIfRedis`) — the test compose has no Redis service. Both specs under
  investigation are in `flows/` and need no Redis, so this does not affect the
  result, but a full local run is **not** equivalent to CI.
- One methodological note worth recording: the first attempt at this
  measurement reported 15/15 passes that were actually `4 skipped` each. vitest
  exits 0 when everything is skipped, so a loop checking only the exit code
  scores a suite that never ran as perfect. The harness used here treats
  "skipped" as a failure for that reason.
