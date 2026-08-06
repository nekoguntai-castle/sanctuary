# PR #699 — `verify-vectors` failure triage (2026-08-06)

**Verdict: PR #699 did not break anything. It triggered a workflow that has been
broken since the Podman fleet conversion and had not run since.**

This is a #668 regression, in the same class as "the release gate has never run
under the converged fleet" — another workflow that was never exercised after the
substrate changed.

---

## Established by evidence

### 1. The workflow passed before the conversion and fails 100% after

Full run history (18 runs, all `pull_request`-triggered):

```
8179 success   8206 success   8241 success   8274 success   8292 success
8331 success   8355 success   8413 success   ← last success, 2026-08-04
                                               (gap: fleet converted to Podman)
8873 failure   8891 failure   8907 failure   ← all on PR #699
```

The host changed across that gap, visible in the act cache path:

| run | cache path | host |
|---|---|---|
| 8413 (success) | `/data/.cache/act/...` | DIND-era x300 |
| 8907 (failure) | `/home/runner/.cache/act/...` | rootless Podman (uid 1001) |

### 2. #699 only *triggered* the workflow — it did not change its behaviour

`verify-vectors.yml` is path-triggered and lists `scripts/verify-addresses/**`.
PR #699 changes exactly two files under that path (`go.mod`, `go.sum`). Nothing
had touched those paths since 2026-08-04, which is the entire reason for the
8413 → 8873 gap. The first PR to touch them after the conversion was always going
to eat this failure.

### 3. Every failure is the 30-minute job timeout, exact to the second

```
8873  18:48:42 → 19:18:42   = 30:00
8891  19:26:00 → 19:56:00   = 30:00
8907  20:00:25 → 20:30:24   = 30:00
```

`verify-vectors.yml:68` sets `timeout-minutes: 30`. All three logs are 87 lines
and identical in shape. Deterministic, not flake.

The trailing runner error is a *consequence* of the timeout kill, not the cause —
act failing to copy `SUMMARY.md` and `pathcmd.txt` out of the container over
`/run/user/1001/podman/podman.sock` with `context deadline exceeded`.

### 4. The Go change itself is sound

Verified locally at `scripts/verify-addresses/implementations/`:

```
$ GOPROXY=off GOFLAGS=-mod=mod go build -o /tmp/gv-test go-verify.go
BUILD OK (offline)                 # resolves entirely from the module cache

$ go run go-verify.go check
{"available":true,"version":"0.24.2","name":"btcd/btcutil"}
```

`go.sum` carries both the module and `go.mod` hashes for `x/crypto v0.54.0` and
`x/sys v0.47.0`. No missing-hash failure is possible.

### 5. The failure is undiagnosable by construction — this is the real defect

Two mechanisms combine to destroy all evidence:

- **`scripts/ci/run-with-log.sh:206`** ends with `| tee "$LOG_PATH" >/dev/null`.
  Every wrapped step writes to a file and prints **nothing** to the console. That
  is why the log goes silent after the Python toolchain check and never names a
  step.
- **A job-level timeout cancels `if: always()` steps.** The "Upload vector
  diagnostics" step never ran, so `$DIAGNOSTIC_DIR` was never uploaded. Confirmed:
  `GET /actions/runs/{8873,8891,8907}/artifacts` returns `[]` for all three, while
  the successful run 8413 uploaded a 14,393-byte diagnostics artifact.

Net effect: a workflow whose entire diagnostic story lives in an artifact that a
timeout guarantees you will not get.

---

## Root cause — CONFIRMED (this section previously ranked it wrong)

**The hang is a wedged rootless-Podman archive endpoint on the runner.** The
`context deadline exceeded` on `/containers/<id>/archive` over `podman.sock`,
present in every failed run, is the *cause* — not, as this document originally
argued, a consequence of the timeout kill. `runner-infra fix/podman-archive-health`
addresses it.

**The runner lock was the leading suspect here and it was wrong.** It is left on
the record deliberately: the reason a wrong suspect survived three identical
30-minute runs is that no evidence existed to rule it out, which is the actual
defect the follow-up work fixed.

What the diagnostics now show (runs 8953 and 8965, after #703 landed):

| step | result |
|---|---|
| Wait for Docker | exit 0, ~1 s — the daemon API is fine |
| Install server dependencies | exit 0, ~13 s |
| **Run cross-implementation address verifier** | **killed at its 8-minute step budget, no sidecar** |

Reproduced identically on both runs, to the second. The failure is `npm run
verify:repeatable`, which starts bitcoind via compose and reaches it over a
published port — the same rootless-Podman surface as the archive endpoint.

Ruled out along the way, with evidence:

- **`wait-for-docker.sh`** — bounded at 120 s and reports success in the recovered
  logs. `docker-build.yml` and `quality.yml` also call it on bare `ubuntu-22.04`
  and pass.
- **Podman short-name image resolution** — `install-test.yml` pulls
  `redis:7-alpine` and `postgres:16-alpine` and passes.
- **The runner lock** — `with-runner-lock.sh` now reports contention explicitly,
  and no such message appears.

## Recommended sequence

**Make it diagnosable before trying to fix it.** Guessing at suspect 1 vs 2 costs
30 minutes per attempt and produces no evidence either way.

1. **Set `SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS` well below the job timeout** (say
   600) in `verify-vectors.yml`'s `env:`. If suspect 1 is right, the job now fails
   in 10 minutes with an explicit lock-timeout error instead of a silent kill.
   This is a one-line change that is correct regardless — a lock wait longer than
   the job timeout can never do anything but destroy evidence.
2. **Lower `timeout-minutes` to ~20** so a hang leaves headroom, and/or add a
   `continue-on-error` step that cats `$DIAGNOSTIC_DIR/*.log` to the console
   before the upload, so evidence survives a cancel.
3. Re-run and read the actual failing step.
4. Fix the real cause, then address suspects 3 and 4 regardless — both are latent
   breakages on the Podman substrate.

### On merging #699

`verify-vectors` is red, and per the branch-protection invariants in `CLAUDE.md`
the answer is to fix the failing check, not bypass it — no admin merge, no
relaxing the gate. Since the failure is pre-existing and unrelated to the diff,
the cleanest path is a small separate PR that lands the diagnosability fix (step
1–2 above) on `main` first, then rebase #699 onto it.

This changes the "land #699, ~zero risk" recommendation in
`docs/plans/open-issue-closeout-2026-08-06.md` — the *change* is still zero-risk,
but it is blocked behind a substrate fix, so it is no longer the cheapest win on
the board.

---

## Side finding — uncommitted `go.ts` change in the working tree

`scripts/verify-addresses/implementations/go.ts` is modified and **uncommitted**.
It is not part of PR #699. It appeared during this session (mtime 11:00), so it is
presumably from a concurrent session:

```diff
     const proc = spawn('go', ['run', GO_SCRIPT, ...args], {
       stdio: ['pipe', 'pipe', 'pipe'],
+      // go.mod sits beside go-verify.go, not at the repo root. Without an
+      // explicit cwd this inherits the caller's directory (verify-addresses/),
+      // where Go finds no module, cannot resolve btcd, and exits non-zero. The
+      // generator reads that as "btcd/btcutil UNAVAILABLE", drops Go from the
+      // panel, and still prints "All vectors verified successfully" -- five-way
+      // agreement silently degraded to four-way.
+      cwd: __dirname,
```

**This matters for how much #699's CI signal is worth.** If that comment is
accurate, then on `main` today the Go implementation exits non-zero, is dropped
from the comparison panel, and the verifier still reports success — so the
cross-check has been four-way, not five-way, and a `golang.org/x/crypto` bump is
not actually exercised by CI at all. The PR's byte-identical derivation evidence
was gathered locally, which is why it held.

Worth landing on its own merits, with a test that fails when an implementation
drops out of the panel rather than silently reporting success.

Also still untracked and **not gitignored**:
`scripts/verify-addresses/implementations/verify-addresses`, a 5.9 MB compiled Go
binary (it disappeared and reappeared during this session as builds ran).

---

## Note for `CLAUDE.md` / memory

CI logs **are** retrievable, contradicting the current note that Forgejo has no
logs API:

```
GET /api/v1/repos/{owner}/{repo}/actions/runs/{run_id}/logs   → 200, zip of per-job logs
GET /api/v1/repos/{owner}/{repo}/actions/artifacts            → 200, all artifacts
GET /api/v1/repos/{owner}/{repo}/actions/runs/{run_id}/artifacts → 200
```

`/actions/runs/{id}/jobs/{job}/logs` and `/actions/jobs/{id}/logs` are still 404 —
it is the **run-scoped** endpoint that works. The zip contains
`<job-name>-<job-id>-attempt-N.log` per job. Note the captured logs are partial:
`⭐ Run Main <step>` markers for middle steps are missing from both successful and
failed runs, so the endpoint gives you the head and tail of a job, not every step.
