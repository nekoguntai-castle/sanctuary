# Install and release-lane speed-up — design (R5-B)

**Date:** 2026-09-29
**Status:** design only. Nothing here is implemented.
**Parent plan:** `tasks/ci-speedup-analysis-2026-09-29.md`, item R5-B.

The plan scoped R5-B as "cache the old-release image builds with the gha
BuildKit cache". Measuring the lanes first showed that premise is mostly wrong.
Build caching is either already happening or would change what the upgrade test
proves. Two other costs dominate instead. This document replaces the plan's
R5-B text.

---

## 1. Summary

1. **The cleanup coordinator's observation overhead is the largest removable
   cost in the full-stack install lanes.** Cleaning up one upgrade stack takes
   **372–431 s** (four runs), and one release-candidate fresh install takes
   **390–399 s**. In run 19465's cleanup window, the host's Podman socket served
   **12,634 API requests from about 6,286 `docker` CLI invocations**. Each
   invocation opens with `HEAD /_ping`, which averaged 0.5 s. Each of the job's
   four volumes was inspected about 170 times. The actual deletions took about
   **15 s**.
2. **One Dockerfile step costs about 3 minutes on every uncached gateway build.**
   `npm prune --production` in the gateway builder stage took **196 s** of a
   276 s no-cache build. The same step slows `docker-build.yml`'s "Validate
   gateway image" (5.9 min, the slowest image check) and users' own upgrades.
3. **Build caching (the original R5-B) is not the lever.** The old-release
   install build already hits the per-host BuildKit cache (a 36 s compose build).
   The upgrade rebuild is `no_cache=true` by design, because it runs the real
   product upgrade path. Caching it would weaken what the lane proves.
4. **Parallel baselines (R5-A) was dropped.** PRs already run one baseline
   (`PR_UPGRADE_BASELINE_REFS='latest-stable'` in
   `tests/install/utils/classify-install-scope.sh`). Only release, push and
   schedule runs use two.

Expected effect (*estimate*, contingent on phase 1 below): about 5–6 min off
Upgrade Baseline (install-scope PRs, about 19 → 13 min) and off release-candidate
Fresh Install E2E (release-lane PRs), plus about 3 min off every uncached gateway
build.

---

## 2. Evidence

### 2.1 Upgrade Baseline, PR run 19465 (x300), 19.0 min total

| Phase | Time |
|---|---|
| Ensure Existing Installation (old stable, cached build 36 s) | 2.2 min |
| Restart Containers After Upgrade (`no_cache=true` build 276 s) | 6.1 min |
| Verification phases (2FA, smoke, proxy recreate, …) | ~3 min |
| **Inner cleanup (`cleanup_started` → `cleanup_terminal`)** | **6.2 min** |
| Outer isolated-workspace cleanup | 0.5 min |

### 2.2 Cleanup durations by lane (successful runs, 2026-09-29)

| Lane | Cleanup (s) |
|---|---|
| install-test / Upgrade Baseline (runs 19465, 19446, 19422, 19317) | 372, 379, 416+431, 401 |
| release-candidate / Fresh Install E2E (runs 19467, 19448) | 399, 390 |
| verify-vectors / verify-vectors | 102 |
| Install Stack Smoke, replay-image build, live-shape replay | 27–35 |

The cost scales with how many resources a full stack registers: about 20
resources and 29 results per upgrade stack.

### 2.3 Podman API during run 19465's upgrade cleanup (x300 journal, 21:35:06–21:41:18 UTC)

| Request | Count | Summed latency |
|---|---|---|
| `HEAD /_ping` | 6,287 | 3,209 s |
| `GET /containers/json` | 1,899 | 964 s |
| `GET /images/json` | 1,238 | 654 s |
| `GET /images/<id>/json` | 650 | 331 s |
| `GET /containers/<id>/json` | 599 | 321 s |
| `GET /version`, `GET /info` | 260 + 259 | 479 s |
| `GET /volumes/ci-19465-1-upgrade-15_*` (4 volumes) | ~170 each | ~350 s |
| `DELETE /containers/<id>` (the actual work) | 10 | 15 s |

- 12,574 of the 12,634 requests carry `Docker-Client/29.6.2`, meaning the
  coordinator spawns the `docker` CLI.
- The rate holds at about 2,000 requests/min for the whole window and drops as
  cleanup ends.
- Latencies overlap (concurrent CLI processes), so the summed column shows load,
  not wall time.

### 2.4 Gateway no-cache build (same run, upgrade rebuild)

`#99 [gateway builder 13/13] RUN npm prune --production --omit=optional
--include-workspace-root --ignore-scripts` took `DONE 196.2s`. Every other
step in the 276 s build took ≤ 25 s.

---

## 3. Design

### Phase 1 — Instrument the cleanup coordinator (prerequisite, no behaviour change)

Locate the loop before changing it. The coordinator is about 40 modules under
`scripts/ownership/`, and the journal shows *what* is called, not *who* calls it.

- Add an opt-in counter: the engine invocation path (`cleanup-supervisor.mjs`
  and `cleanup-docker-executor.mjs` spawn sites) records each `docker` / `podman`
  argv and its duration to a JSONL file under the existing cleanup artifact
  directory. Gate it on `SANCTUARY_CLEANUP_TRACE=1`, set only in install-test
  and release-candidate.
- Summarise per phase (plan, pre-action observation, mutation, post-action
  verification, receipt) into the cleanup evidence artifact.
- **Acceptance:** one Upgrade Baseline run attributes ≥ 90% of cleanup wall time
  to named call sites.
- **Constraint:** every new spawn or file-write site must be classified in
  `config/resource-lifecycle-callsites.json`. Run
  `node scripts/ownership/check-lifecycle-callsites.mjs` with the new files
  `git add`-ed (the checker ignores untracked files).

### Phase 2 — Remove redundant observation (behaviour-preserving)

The candidates below are hypotheses until phase 1 confirms them. Every one must
keep the exactness guarantees: identity checked before each mutation,
absence verified after, signed receipts unchanged in content.

1. **One inventory snapshot per decision point, not per action.** Take the
   container, image, volume and network listings once per phase, then re-check
   only the exact identity being mutated (`inspect <id>`), not the whole
   inventory.
2. **Memoise daemon identity** (`/version`, `/info`) per coordinator session.
   The endpoint is already bound by `--host`/`--url` (`engineGlobalArgs`), so it
   cannot change mid-session.
3. **Batch inspections:** `docker inspect id1 id2 …` or
   `docker volume inspect v1 v2 …` in one CLI call instead of one call per
   resource.
4. **Bounded backoff instead of tight polling** for absence verification (the
   supervisor polls at 10 ms after a kill; the Docker-side waits need the same
   review).
5. **Alternative:** talk to the socket over HTTP with keep-alive instead of
   spawning the CLI, which removes the per-invocation `_ping`. This is a bigger
   change to trusted code, so choose it only if 1–4 are insufficient.

- **Acceptance:** Upgrade Baseline inner cleanup ≤ 60 s. Receipts still verify
  (`verify-cleanup-receipt`). `npm run test:ownership` and the ownership
  contract checks pass. Refusal and ambiguity behaviour is unchanged, proven by
  existing fault-injection tests plus a non-regression test that counts engine
  invocations for a fixed fixture inventory, so the regression cannot silently
  return.
- **Risk:** this is the trusted cleanup path that protects shared runner hosts
  (see `reaper-run-id-name-heuristic-incident`). Every change needs its own
  review, and must be rolled out to Upgrade Baseline first, then Fresh Install
  E2E.

### Phase 3 — Gateway production-dependency stage

- Replace `npm prune --production …` in the gateway builder with a dedicated
  production-deps stage (`npm ci --workspace gateway --include-workspace-root
  --omit=dev --ignore-scripts`). The backend image already uses this shape
  (`backend application-deps` stage).
- **Acceptance:**
  - `docker-build.yml` "Validate gateway image" passes.
  - The runtime `node_modules` set is identical, proven by diffing
    `npm ls --omit=dev --all --json` between the old and new images in the PR.
  - The uncached gateway build drops by ≥ 2 min.
- **Risk:** this is a product image, so it needs the image-contract checks,
  `check:supply-chain-locks`, and install-script policy. It also shortens users'
  real upgrades, which is why it's worth doing but also why it must be a PR of
  its own.

### Not doing

- **gha/BuildKit cache for the upgrade rebuild.** The rebuild is `no_cache` by
  design (it is the product upgrade path). A cached upgrade test would stop
  proving what users run.
- **R5-A parallel baselines.** They give no PR benefit (one baseline on PRs) and
  add compose-project, port and receipt collision risk on the shared per-host
  Podman socket.

---

## 4. Sequencing

1. Phase 1 (instrumentation) → one measured run on each host.
2. Phase 2 changes, one at a time, Upgrade Baseline first.
3. Phase 3 at any point; it is independent of 1–2.
4. Re-measure with the same journal query (`journalctl --since/--until` on the
   runner host from the job's "Name:" line) and the lifecycle-notice timestamps.
