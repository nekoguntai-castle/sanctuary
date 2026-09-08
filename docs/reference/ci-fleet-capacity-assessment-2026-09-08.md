# CI fleet capacity assessment — 2026-09-08

This is a bounded observation, not proof that the shared runner fleet has spare
capacity. It records what the current Forgejo API, run logs, timing notices and
diagnostic artifacts can establish without changing runner infrastructure.

## Decision

Capacity is **inconclusive; policy unchanged**. No workflow serialization,
runner-capacity, timeout, lock or cross-workflow admission policy changes are
justified by this sample. The sample contains zero complete workflow runs whose
queue, lock, daemon host, build, subject, cleanup and upload phases can all be
correlated. Runner-infra deployment therefore remains externally coordinated.

The existing finalization reserves remain configured thresholds rather than
measured fleet guarantees: 10 minutes for jobs of at least 90 minutes, 3 minutes
for jobs up to 25 minutes, 5 minutes otherwise, with the documented shorter-step
exceptions. The partial cleanup observations below do not validate those
thresholds for install, upgrade, vector or emulator lanes.

## Collection boundary

- Capture: `2026-09-08T17:42:48Z`; window:
  `[2026-09-01T17:42:48Z, 2026-09-08T17:42:48Z]`.
- Relevant workflows: `install-test.yml`, `release-candidate.yml`, and
  `verify-vectors.yml`; these own install, upgrade, replay, vector and emulator
  subjects.
- The GET-only Forgejo enumeration crossed the cutoff after 22 explicit 50-row
  pages (1,100 rows). Refetching page 1 returned the same head run, `15165`, and
  the collected pages had unique run IDs. There were 361 terminal relevant runs.
- The inventory below is the newest 20 terminal candidates overall. A true
  latest-20-per-host selection cannot be produced because host attribution is
  incomplete; treating the workflow or job-container hostname as daemon
  identity would invent evidence.
- `report-workflow-durations.sh`, `report-timing-notices.sh`, and
  `aggregate-runner-locks.sh` supplied the available task, timing, and lock
  measurements. Missing lifecycle events and sidecar-less logs remain missing,
  never zero.

## Exact candidate inventory

| Run | Workflow | Result | Started | Commit | Daemon-host evidence |
| ---: | --- | --- | --- | --- | --- |
| 15165 | verify-vectors | success | 2026-09-08 16:59:56Z | `47dd9baf88b96eaefdb6d380715c3b910608dc3d` | unavailable |
| 15162 | install-test | success | 2026-09-08 16:59:43Z | `47dd9baf88b96eaefdb6d380715c3b910608dc3d` | unavailable |
| 15158 | verify-vectors | success | 2026-09-08 15:36:59Z | `6ad7f57981bc1e78795f72710904af78a6f66411` | unavailable |
| 15156 | release-candidate | success | 2026-09-08 15:36:51Z | `6ad7f57981bc1e78795f72710904af78a6f66411` | build job only: `kumo` |
| 15154 | install-test | success | 2026-09-08 15:36:42Z | `6ad7f57981bc1e78795f72710904af78a6f66411` | unavailable |
| 15151 | verify-vectors | success | 2026-09-08 14:13:39Z | `ed2c1d11ead8a8996303f453508d79190e476666` | unavailable |
| 15149 | release-candidate | success | 2026-09-08 14:13:32Z | `ed2c1d11ead8a8996303f453508d79190e476666` | build job only: `kumo` |
| 15147 | install-test | success | 2026-09-08 14:13:22Z | `ed2c1d11ead8a8996303f453508d79190e476666` | unavailable |
| 15144 | verify-vectors | success | 2026-09-08 12:48:29Z | `956af8a7335c2b55a49be0fafcdbabc27808187d` | unavailable |
| 15142 | release-candidate | success | 2026-09-08 12:48:23Z | `956af8a7335c2b55a49be0fafcdbabc27808187d` | build job only: `x300` |
| 15140 | install-test | failure | 2026-09-08 12:48:15Z | `956af8a7335c2b55a49be0fafcdbabc27808187d` | unavailable |
| 15137 | verify-vectors | success | 2026-09-08 11:21:03Z | `591ad7c60c43ec81fbfcc2b7fe0baff53bae6210` | unavailable |
| 15134 | install-test | success | 2026-09-08 11:20:50Z | `591ad7c60c43ec81fbfcc2b7fe0baff53bae6210` | unavailable |
| 15131 | install-test | success | 2026-09-08 10:25:46Z | `8fafeedd54c60bc84dc6a90d2ac15fbd2155d19c` | unavailable |
| 15130 | verify-vectors | success | 2026-09-08 09:57:08Z | `fc4565332685b13b1108940aef58c96cbf27e64b` | unavailable |
| 15128 | release-candidate | success | 2026-09-08 09:56:58Z | `fc4565332685b13b1108940aef58c96cbf27e64b` | build job only: `kumo` |
| 15126 | install-test | success | 2026-09-08 09:56:51Z | `fc4565332685b13b1108940aef58c96cbf27e64b` | unavailable |
| 15123 | verify-vectors | failure | 2026-09-08 08:42:33Z | `d4b013c0fa6d9f6bfe3d9584e1ba2b8be3365812` | unavailable |
| 15121 | release-candidate | success | 2026-09-08 08:42:27Z | `d4b013c0fa6d9f6bfe3d9584e1ba2b8be3365812` | build job only: `kumo` |
| 15119 | install-test | success | 2026-09-08 08:42:17Z | `d4b013c0fa6d9f6bfe3d9584e1ba2b8be3365812` | unavailable |

## Correlated partial samples

Only the replay-image build job printed a Docker `info` server `Name:` that can
identify its daemon host. Its diagnostic artifact also retained canonical
status sidecars for lock aggregation. Queue duration is unavailable because the
provider exposes task start but not job eligibility/queued-at. Subject duration
is unavailable because the live annotation stream omitted `subject_terminal`;
subtracting another stage would conceal that missing event.

The timing notice wraps the whole coordinator, including cleanup and supporting
work; it is not an isolated build timer. Build duration therefore remains
unavailable and is not derived by subtracting other partial stages.

| Run/job | Host | Queue | Lock wait / hold | Build | Subject | Cleanup | Replay-image upload | Coordinator total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 15156 / 190409 | kumo | n/a | 0s / 336s | n/a | n/a | 40.531s | 12.896s | 337s |
| 15149 / 190333 | kumo | n/a | 0s / 267s | n/a | n/a | 44.223s | 12.092s | 267s |
| 15142 / 190257 | x300 | n/a | 0s / 426s | n/a | n/a | 35.786s | 9.956s | 427s |
| 15128 / 190101 | kumo | n/a | 0s / 335s | n/a | n/a | n/a | 10.316s | 336s |
| 15121 / 190025 | kumo | n/a | 0s / 381s | n/a | n/a | n/a | 10.583s | 380s |

Nearest-rank distributions are descriptive only. For `kumo` (`n=4`), coordinator
total p50/p90 are 336s/380s, lock-hold p50/p90 are 335s/381s, and upload p50/p90 are
10.583s/12.896s. For `x300` (`n=1`), the respective observations are 427s,
426s, and 9.956s. All five known lock waits are 0s. Cleanup has only three
observations across both hosts (35.786–44.223s), so no per-host percentile is
reported. The vector run 15165 diagnostic set had 25 lock invocations with zero
known wait, 976s across 21 known holds, and four incomplete holds; those jobs
did not expose daemon identity, so they are not merged into either host cohort.

## Admission observation

At commit `ed2c1d11ead8a8996303f453508d79190e476666`, Quality run 15148 exposed its
deterministic missing-tracked-document error at `2026-09-08T14:20:25.257Z`.
Release run 15149 had already admitted replay-image build at 14:18:11Z and fresh
install at 14:20:17Z, but admitted live replay at 14:38:07Z and maximum replay at
14:48:48Z after the fast failure was observable.

This proves that independent workflows can consume later expensive subjects
after a required fast workflow has failed. It does not yet prove a safe
repository-owned cross-workflow gate: Forgejo exposes no workflow dependency
primitive, the exact-commit reporter is intentionally diagnostic, and a polling
gate must define eligibility, missing-run, retrigger, and deadlock semantics.
Phase 4 therefore records the evidence and retains current admission policy.
The repeated-failure discipline remains the safe boundary for superseding a
failed head; a future gate requires a separate reviewed plan and complete
provider contract rather than an improvised fail-open check.

## Lifecycle convergence audit

The audit found five bounded identity-drift categories and no basis for a blanket
`--no-build` or `--pull never` policy:

- fresh-install E2E explicitly builds before `compose up`; its start now uses
  `--no-build`, preventing Podman from committing an unregistered replacement;
- runtime-secret migration restart guidance, in both the script and operator
  guide, uses `--no-build` because migration does not request an image rebuild;
- the Monitoring banner routes operators through the canonical
  `./start.sh --with-monitoring` lifecycle owner;
- the three README/template sequences that explicitly build before starting now
  use `up -d --no-build`;
- log-level, port-only and PostgreSQL-password recovery restarts preserve the
  already-built image identities with `--no-build`.

Existing setup/start, upgrade replacement, first-start, explicit `--build`, and
pinned-pull paths retain their current behavior. Contract tests cover only the
corrected intent boundaries. Lifecycle scanner and fake/static contract suites
must pass before any full Docker E2E for this phase.
