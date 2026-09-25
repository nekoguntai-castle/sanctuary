# Visual consistency implementation — 2026-09-25

Status: Implementing; user invoked implement-merge after the audit.
Source: reports/visual-consistency-2026-09-25/report.md, HEAD 0744eed45a.

## Scope and contract

Implement VC-01 selected settings contrast, VC-02 bounded wallet settings tabs,
VC-03 mobile device identity/account layout, VC-04 native relationship links.
Preserve destination IDs, current default destination tab, desktop hierarchy,
useTabsA11y behavior, specialized account selectors, compact typography and
empty/error/disabled behavior. No broader redesign, theme-wide token migration,
new back controls, status styling change, or origin-state restoration.

## Phase 1 — Lock regression contract

- [x] Add browser assertions before fixes for Sanctuary light/dark, desktop,
  390px and 320px: enabled selected settings text >=4.5:1; local tab overflow;
  device main width; relationship Tab/Enter journeys.
- [x] Add native-link component regressions before relationship changes.
- [x] Confirm baseline failures match each accepted finding.

Owners: tests/e2e visual-consistency spec plus existing fixture harness;
nearest DevicesSettings/DetailsTab component tests.
Acceptance: failures reproduce actual problems on current source.
Backout: tests only; leave existing baselines intact.

## Phase 2 — Bounded repairs

- [x] VC-01: named selected-tab recipe for Settings and NotificationsSection,
  respecting inverted semantic palette and preserving keyboard/panel state.
- [x] VC-02: bounded local SettingsSubTabs scroll container, discoverable overflow,
  focused/selected tab visibility; main content must not pan horizontally.
- [x] VC-03: stack device identity/action layout at narrow widths; let account
  children use width and wrap safely; preserve desktop layout.
- [x] VC-04: native Link ownership for wallet device row and associated-wallet
  card; preserve list semantics, hit area, and visible focus.

Acceptance: Phase 1 regressions pass; contrast >=4.5 for measured labels;
main scrollWidth <= clientWidth (+1px rounding) for inspected device/settings
routes at 320/390; local tab scrolling remains usable through final tab;
Tab/Enter and direct-entry fallback retain correct record IDs. Long device
labels and multiple accounts must not introduce whole-page overflow.
Focused gates: nearest unit suites, browser matrix and relevant existing
render contracts; inspect before/after captures. Broader gates: frontend unit
suite, coverage, app/tests/all typechecks, app lint, build, exact lizard command;
backend tests/typecheck per CLAUDE with repository isolation guards.
Backout: each owner/test group can be reverted independently; no data changes.

## Phase 3 — Delivery and closeout

- [x] Independent adversarial/simplification review, address verified comments.
- [x] Run required local gates; resolve baseline environment problems without
  weakening checks or mutating live app data.
- [ ] Deliver through pr-delivery; wait for exact PR checks and reviews.
- [ ] Protected merge; verify merge object/tree/ancestry and target-main CI.
- [ ] Re-check existing running stack ownership and documented rebuild lifecycle;
  rebuild relevant already-running local services and verify health if safe.
- [ ] Record cleanup ownership and final review.

Delivery slice: one PR for this related audit remediation and its shared rendered
acceptance matrix. These are implementation phases within one bounded UI
correction, not unrelated repository work. No independently pushed phase PRs.
No static drift scanner: source spelling alone did not prove broad defects.

## Resource ledger

- target_branch: main
- task_branch: codex/implement-merge/visual-consistency-20260925
- worktree_path: /home/nekoguntai/sanctuary
- created_by_loop: task branch only; original checkout retained
- converted_to_next_phase: false
- cleanup_status: pending verified merge/main CI; unrelated worktrees preserved
- rebuild_policy: after-plan; existing Sanctuary stack belongs to sanctuary-main
  deployment revisions, inspect lifecycle before mutation.

## Review

Pending implementation and verification. Audit baseline catch-all typecheck
reported nested bitcoinjs-lib Psbt identity mismatch; recheck and repair local
installation if necessary, not a product/API change by default.

### Local evidence

- Baseline four dark/390 browser contracts failed for the accepted causes.
- Native-link component regressions failed before fixes and pass afterward.
- All 30 browser acceptance cases pass (Sanctuary light/dark, 1440/390/320),
  including long labels, multiple accounts, editing, Tab/Enter and direct entry.
- All 44 existing render-regression tests pass without baseline edits.
- Before/after captures retained under reports/visual-consistency-2026-09-25 and
  reports/visual-fixes-20260925. Selected dark settings contrast 2.332 → 9.339.
- All app/test/all typechecks, backend typecheck, app lint, exact lizard command
  and diff checks passed. Nested verification npm ci aligned stale local
  bitcoinjs-lib 7.0.1 to declared 7.0.2; no lockfile/product dependency changes.
- Backend suite: 16,489 passed, 767 integration skips, one todo; database env
  omitted and no live storage was touched.
- Independent reviewer found no actionable defects; manual simplify/edge-case
  review retained small existing owners and no speculative scanner.
- Full frontend suite passed with 100% statements, branches, functions and lines.

### Delivery prerequisite

The pre-commit UI prompt had unescaped double quotes and executed `not` instead
of invoking its reviewer. Added a regression to the existing registered hook
suite, observed failure, then corrected only the prompt quoting. This is a
necessary delivery prerequisite, not a gate bypass. Full frontend suite and
coverage already passed; hook-specific regression/syntax checks cover this edit.
