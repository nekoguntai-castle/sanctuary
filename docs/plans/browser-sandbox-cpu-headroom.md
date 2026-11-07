# Browser Sandbox CPU Headroom

Status: implemented (cap raised to 4 CPUs; awaiting post-merge confirmation runs)
Date: 2026-11-06
Follows: #1460 (verified Chromium sandbox in browser lanes)

## Background

#1460 moved Chromium into an isolated child container created through
`scripts/ci/lib/browser-container-security.mjs`. Its fixed resource set is:

```js
BROWSER_CONTAINER_RESOURCES = { Memory: 4 GiB, NanoCpus: 2_000_000_000, PidsLimit: 512, ShmSize: 512 MiB }
```

So the browser already runs under a 2-CPU quota. The browser-flow groups are
budgeted in `.github/ci-performance-budget.json` at 120 s (warning) and 240 s
(hard). Observed `wallet-lifecycle` durations since the sandbox:

| Run | Context | `wallet-lifecycle` | Result |
|---|---|---|---|
| 22556 | #1460 final head | 190 s | pass |
| 22607 | #1471 | 209 s | pass |
| 22626 (job 280911) | #1473 on x300, beside mutation shard 2 and mutation proofs | 257 s | **hard-budget failure** |

In the failed run every test passed (114 per project). Host snapshot
`1794016325` on x300 shows the browser child `13f9af88` was **CPU-throttled
1,079 times for 77 s in total**. A cgroup is throttled only when it uses its
full quota within a period, so the 2-CPU cap was binding. Host contention
(load 7 → 17, CPU PSI some ~15%) then added to that. The groups had only
30–50 s of headroom under the hard budget on quiet hosts.

## Measurements

Collected from host snapshots for 27 browser jobs (2026-11-05 to 2026-11-07 UTC), hosts kumo, x300 and sora. Groups are `admin-auth` / `wallet-lifecycle` / `wallet-transactions` / `wallet-experience`, in seconds.

| Population | Runs | Group seconds | Notes |
|---|---|---|---|
| Before the sandbox (unsandboxed image) | 22234, 22291, 22305, 22361, 22402, 22408, 22426, 22440, 22465, 22478, 22510, 22517 | 61-86 / 46-68 / 63-76 / 72-101 | Load 5-15, CPU PSI some avg10 up to 20% |
| Sandboxed, 2-CPU cap, green | 22395, 22419, 22455, 22524, 22556, 22565, 22607, 22635 | 180-212 / 190-228 / 149-176 / 127-173 | Lifecycle 2-4x slower than before the sandbox |
| Sandboxed, hard-budget failure | 22626 (x300, job 280911) | 219 / 257 / not reached / not reached | Load1 17.1, PSI 15.6% |

Browser child throttling (children seen at least once; snapshots are 2 minutes apart, so each figure is a lower bound):

| Run | Host | Peak load1 | Throttled periods | Throttled time |
|---|---|---|---|---|
| 22455 | kumo | 15.7 | 313-680 per child | 14.5-52.8 s per child |
| 22607 | kumo | 14.2 | 270-819 per child | 20.5-70.7 s per child |
| 22626 | x300 | 17.1 | 1,067 and 1,079 | 98.2 s and 77.1 s |
| 22635 | sora | 6.7 | 76-703 per child | 8.1-81.2 s per child |

Conclusions:

1. The 2-CPU cap binds on every sandboxed run, quiet or contended. Children seen twice averaged about 1.6 CPUs over about 125 s and were throttled for 20-98 s each, so the quota is too low regardless of contention (the "quiet green runs" test in step 1).
2. The slowdown is a quota effect, not only host contention. Run 22635 on sora had peak load 6.7 and PSI 8%, yet lifecycle took 210 s against 50-59 s before the sandbox.
3. Runner hosts have 16 CPUs and capacity 3, and Render E2E and Browser E2E can each run a browser child on one host, so the worst case is two children. A 4-CPU cap (8 CPUs for two children) leaves half the host to the other jobs.

Decision: `NanoCpus` becomes 4,000,000,000. It stays one fixed constant checked by `validateResources`, with no per-call override and no `CpuShares`.

## Goal

Keep browser-flow groups well under their hard budget on a busy host without
weakening the sandbox or the budget gate.

Non-goals: relaxing seccomp, user, network or rootfs restrictions; raising the
hard budget as the first fix; changing runner capacity.

## Work

### 1. Measure before changing

For the four groups (`admin-auth`, `wallet-lifecycle`, `wallet-transactions`,
`wallet-experience`), collect:

- duration from the last 10 green runs before #1460 and every run since;
- the browser child's `cpu_usec`, `throttled` and `throttled_usec` from the host
  snapshot for the same jobs, quiet and contended.

The throttling on green runs decides the fix. If quiet green runs also show
material throttling, the cap is too low regardless of contention.

### 2. Right-size the quota

- Make `NanoCpus` a reviewed value chosen from the measurements (4 CPUs, done). The job's own CPU quota and the runner's capacity bound it, so a higher
  cap only helps if the job has CPU to give.
- Keep it a single fixed constant validated by `validateResources`. Do not
  allow a per-call override.
- Consider `CpuShares` (relative weight) alongside the cap so the browser keeps
  its share against co-scheduled mutation jobs without taking the whole host.
  Add it to the allowed resource keys only with a test.
- Update `tests/ci/run-sandboxed-playwright.test.ts` and any payload snapshot
  tests that pin the resource set.

### 3. Publish the throttling evidence (done)

Implemented through the engine stats API (`GET /containers/<id>/stats?stream=false&one-shot=true`, `cpu_stats.throttling_data`), read just before retirement, bounded to 3 s and best-effort. The report gets `cpuThrottling` (`usage_usec`, `nr_throttled`, `throttled_usec`, or `null` with `cpuThrottlingReason`) and one `::notice title=CI browser CPU::` line is printed.

Original text:

Have `run-sandboxed-playwright.mjs` read the child's `cpu.stat` (or the
engine's stats) at teardown and print `throttled_usec` beside the existing
`CI timing` notice. That way the next budget failure shows directly whether the
cap or the host was the bottleneck, without a host snapshot.

### 4. Only then revisit the budget

If the groups still sit within about 25% of the hard budget on quiet hosts after
step 2, split the longest group or record an explicit budget change with the
measurements. Don't raise the budget without that evidence.

## Acceptance criteria

- Measurements from step 1 recorded in this plan.
- On at least three green runs, including one co-scheduled with a mutation
  job, `wallet-lifecycle` finishes at least 60 s under its hard budget and the
  browser child's throttled time is under 5 s.
- The resource set stays fixed and validated, and sandbox proof (namespace,
  seccomp, renderer evidence) still passes.
- CI lane tests updated. Required PR checks green.

## Acceptance status

The acceptance runs (three green runs, one co-scheduled with a mutation job) can only be observed after merge. The new `CI browser CPU` notice and report field give the throttled time for each.

Run 1 (#1476's own PR run 22696, job 281614, head cc8e5677b): green. The groups took 157 s (admin-auth), 157 s (wallet-lifecycle, 83 s under its 240 s budget), 142 s (wallet-transactions) and 136 s (wallet-experience). The one report left in `playwright-results-browser` (wallet-experience) records `usage_usec=237096124 nr_throttled=0 throttled_usec=0`, so the 4-CPU cap did not bind.

That run showed a gap: `run-with-log.sh` forwards only allowlisted annotations to the live job log, so the `CI browser CPU` notice reached only `browser-flow-e2e.log`, which is uploaded only on failure. Playwright also clears `test-results/` before each group, so only the last group's report survives. `forward-live-annotations.mjs` now forwards the notice in its two fixed shapes, so every group's figure appears beside its `CI timing` line.

## Delivery

One PR. Coordinate with the #1460 author: the browser sandbox lane is theirs.
