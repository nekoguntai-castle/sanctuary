---
thread: grade-loop-remediation-plan
threadTitle: Grade-Loop Remediation
artifactKey: grade-loop-lizard-tsx-gate
type: plan
format: markdown
title: "Grade-Loop Pass 2: Gate .tsx in the Lizard Complexity Check"
status: approved
summary: "Make the repo lizard gate scan .tsx (lizard's typescript language excludes it) and re-baseline the warning count from 9 to the measured 86."
tags:
  - grade-loop
  - audit
  - maintainability
  - ci
metadata:
  workStatus: complete
  disposition: remediation
---

# Grade-Loop Pass 2: Gate `.tsx` in the Lizard Complexity Check

**Source grade report**: `docs/plans/codebase-health-assessment.md`, post-closeout check.
**Date**: 2026-09-10. **Commit**: `8b89b70b` (`origin/main`, after #1059).
**Score**: 88/100 (B, High confidence).
**Pass 1**: `docs/plans/grade-loop-remediation-plan.md` (#1059).

**Selected finding**: Fastest Improvement 2, from Top Risk 2 and Divergent Paths
(the "Complexity measurement" row, rationalize). The maintainer deferred D1 and
chose this pass.

`scripts/quality.sh` `run_lizard` passes `-l javascript -l typescript`. In
lizard 1.21.2, `.tsx` is its own language (`tsx`), so directory scans skip every
`.tsx` file. The CI lizard lane (`quality.yml` → `scripts/quality/lizard-only.sh`)
therefore gates 9 warnings, while real complexity in production React
components is never seen: `TransactionList` CCN 49, `WalletRemediationPanel` 38,
`SupportPackageCard` 37, and `Tooltip` 33.

Measured on a clean `git archive HEAD` tree with the gate's exact flags
(`-w -C 15 -T nloc=200` plus its `-x` excludes):

| Scope | Warnings |
| --- | ---: |
| `-l javascript -l typescript` (today) | 9 |
| `-l tsx` alone | 77 |
| `-l javascript -l typescript -l tsx` | **86** |

Of the 86, 15 are in `src/`, 64 in `tests/` (mostly long test callbacks over 200
NLOC), 6 in `server/`, and 1 in `scripts/`. There are no tracked `.jsx` files.

## Objective

The lizard gate scans `.tsx` alongside `.ts` and `.js`, with a tight
warning-count baseline equal to the measured CI-scope count (86). All copies of
the baseline, and the language set, are pinned by a regression test so they
cannot drift apart.

**Acceptance**:

- `bash scripts/quality/lizard-only.sh`, using the pinned lizard, passes at 86
  and **fails at 85**, which proves the baseline is tight.
- `tests/ci/quality-lizard-bootstrap.test.sh` asserts `-l tsx` and that the
  baseline is consistent everywhere.
- The test fails before the change.

## Non-Goals

- No complexity refactors (D3 hotspots) and no ESLint complexity ratchet (D3).
- No change to `-C 15`, `-T nloc=200`, the `-x` excludes, or the lizard version.
- No per-function baseline file. The gate stays count-based like today; a
  fingerprinted baseline is part of the D3 ratchet design.
- No `verify-vectors.yml` or `sourceManifest.ts` edit, no lockfile change, no
  version bump.

## Changes

1. `scripts/quality.sh`: add `-l tsx` in `run_lizard`, and change the default
   `LIZARD_WARNING_BASELINE` from 9 to 86.
2. `scripts/quality/lizard-only.sh`: originally, change its default from 9 to 86.
   After adversarial review, the redundant default was **removed** instead,
   since it repeated `scripts/quality.sh`'s. The baseline now lives in two
   places, the workflow env and the `quality.sh` default, and the test pins
   them equal.
3. `.github/workflows/quality.yml`:
   - change the workflow env `LIZARD_WARNING_BASELINE` from `'9'` to `'86'`;
   - correct the stale header comment ("lizard enforces a zero-warning
     baseline") to describe the measured, non-increasing warning-count baseline.
4. `docs/reference/ci-cd-strategy.md`:
   - change the baseline from 9 to 86;
   - state that the gate scans `.js`, `.ts`, and `.tsx` (lizard's `typescript`
     language excludes `.tsx`);
   - keep the "lower it when the count drops" rule.

## Phases

### Phase 1: Non-regression test first (must fail before the change)

Extend `tests/ci/quality-lizard-bootstrap.test.sh`. It already runs the real
`lizard-only.sh` against a stub lizard that records its argv in
`LIZARD_ARGS_LOG`. Add these assertions:

- The captured args contain `-l` followed by each of `javascript`, `typescript`,
  and `tsx`. Parse argv pairs; don't just grep for the word.
- The captured `-i` value equals the `LIZARD_WARNING_BASELINE` in
  `.github/workflows/quality.yml`. Run `lizard-only.sh` with
  `LIZARD_WARNING_BASELINE` unset, so the script default is what gets exercised.
- The defaults in `scripts/quality.sh` and `scripts/quality/lizard-only.sh` both
  equal the `quality.yml` value.

Before the change, the `tsx` assertion fails. The equality assertions pass at 9,
and they're there to prevent future drift.

### Phase 2: Implement Changes 1–4

### Phase 3: Verification

- `bash tests/ci/quality-lizard-bootstrap.test.sh` (fails before, passes after)
- Real gate:
  - `LIZARD_BIN="$(command -v lizard)" bash scripts/quality/lizard-only.sh`
    exits 0 and reports 86 warnings;
  - the same with `LIZARD_WARNING_BASELINE=85` exits non-zero (tight bound);
  - the local lizard is the pinned 1.21.2.
- CI classifier-job tests that touch this change:
  - `tests/ci/check-workflow-composition.test.sh` (it pins the `quality.yml`
    lizard job shape);
  - `tests/ci/classify-quality-scope.test.sh` (lizard-only scope routing);
  - `tests/ci/actionlint-shellcheck.test.sh` (workflow and shell lint);
  - `tests/ci/ci-registration-completeness.test.sh` (workflow/test registration);
  - `tests/ci/quality-audit.test.sh` (the `scripts/quality.sh` harness).

  Also run `actionlint .github/workflows/quality.yml` if it's installed. The
  other ~55 classifier-job tests cover unrelated scripts and are left to CI.
- `npm run lint`, `npm run typecheck:all` (sanity check; no TS change is expected)
- `git diff --check`

## Compatibility And Rollback

- CI effect: the lizard lane now also scans about 1,000 `.tsx` files, which
  takes seconds. The gate stays green at exactly 86; any new `.tsx`, `.ts`, or
  `.js` warning fails it.
- Risk: the CI checkout could see a different `.tsx` set than the clean archive.
  It shouldn't, since the lane runs on a fresh checkout and generated outputs are
  excluded. If the first CI run reports a count other than 86, stop and inspect;
  never raise the baseline blindly.
- Rollback: revert the squash commit.

## Acceptance Criteria

- [x] The Phase 1 test fails before the change, on the `-l tsx` assertion, and passes after.
- [x] The gate passes at 86 and fails at 85 locally with the pinned lizard 1.21.2.
- [x] `quality.yml`, `quality.sh`, and `ci-cd-strategy.md` agree on 86. The stale "zero-warning" header comment and the "baseline is 9" step comment are both corrected.
- [x] The workflow-composition and quality-scope tests pass; `git diff --check` is clean.
- [ ] The CI lizard lane on the PR is green (pending delivery).

## Implementation Status

- Phase 1: the extended `tests/ci/quality-lizard-bootstrap.test.sh` failed before
  the change with "expected lizard to scan exactly javascript, typescript and
  tsx; got: javascript typescript", and passes after.
- Phase 2: Changes 1–4 applied: `-l tsx`, baseline 86 in the workflow env and `scripts/quality.sh` default (the redundant `lizard-only.sh` copy removed after review), the
  stale "zero-warning" comment corrected, and the docs updated.
- Phase 3, all green:
  - the real gate with lizard 1.21.2 reports 86 warnings and **exits 0 at 86
    but 1 at 85**;
  - `check-workflow-composition`, `classify-quality-scope`,
    `actionlint-shellcheck`, `ci-registration-completeness`, and
    `quality-audit` tests pass;
  - `npm run lint` and `npm run typecheck:all` pass;
  - `git diff --check` is clean.
  - `actionlint` isn't installed locally, so it's left to CI's workflow policy
    guards.

## Deferred

- D1/D6, from pass 1: the `uint8array-tools` 0.0.10 soak, and the non-canonical
  framing reaching the quadratic parser.
- D3: ESLint complexity ratchet (62 production functions) and hotspot reduction.
- D4: dynamic-import frontend tests.
- The flaky `transactions-http-routes` backpressure timing test. It flaked once
  under load and passed 8/8 in isolation. Watch it, and open an issue if it
  recurs in CI.
