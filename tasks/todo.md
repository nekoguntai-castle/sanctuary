# Next Task: Lizard UI Batch 30 - QR Scanner Panel

Status: in progress

Goal: reduce the current `QrScannerPanel` lizard finding by splitting QR mode toggle rendering, camera idle/active/error states, animated-QR progress rendering, file upload/parsing states, and success rendering while preserving camera/file mode callbacks, secure-origin warning copy, scanner props and callbacks, stop-camera behavior, progress and positioning copy, file upload behavior, parsing state, fingerprint fallback copy, and the public `QrScannerPanel` import path.

## Lizard UI Batch 30 Checklist

- [x] Start from updated `main` after Batch 29 PR and post-merge full lane are green.
- [x] Confirm `QrScannerPanel` is a current top JSX target at 33 CCN.
- [x] Split QrScannerPanel render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [ ] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [ ] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 30 Review

Plan:

- Keep `components/ConnectDevice/QrScannerPanel.tsx` as the public `QrScannerPanel` export and move scanner-specific view pieces under `components/ConnectDevice/QrScannerPanel/`.
- Extract mode toggle styling, camera idle/error/active rendering, progress overlay copy, file upload idle/parsing rendering, and success/fingerprint display into small components so the root component becomes branch orchestration only.
- Preserve `tests/components/ConnectDevice/QrScannerPanel.test.tsx`; add focused assertions only if extraction exposes untested behavior around scanner callback props, inactive scanned states, progress boundary values, or file input attributes.
- Verify focused lizard against `components/ConnectDevice/QrScannerPanel.tsx`, the extracted helper directory, and the focused test before running the broader guardrails.

Verification so far:

- PR #28 merged as `a7ff5c5e`; the post-merge `main` backstop passed release `24677999452`, dev image build `24677999451`, install tests `24677999449`, and test suite `24677999722`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.
- Fresh focused lizard measurement from `main` (`a7ff5c5e`) reports `components/ConnectDevice/QrScannerPanel.tsx:30` `QrScannerPanel` at 33 CCN.
- Reduced `components/ConnectDevice/QrScannerPanel.tsx` to a 57-line public shell and moved camera idle/active/error rendering, animated QR progress rendering, file upload/parsing rendering, mode toggle rendering, and success rendering under `components/ConnectDevice/QrScannerPanel/`.
- Preserved camera/file mode callbacks, secure-origin warning copy, scanner callback props and constraints, stop-camera behavior, progress and positioning copy, file upload behavior, parsing state, fingerprint fallback copy, and the public `QrScannerPanel` import path.
- Added focused assertions for secure-origin warning absence, completed animated QR progress hiding transient copy, and non-empty fingerprint success copy.
- `npx vitest run tests/components/ConnectDevice/QrScannerPanel.test.tsx` passed: 1 file, 8 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ConnectDevice/QrScannerPanel.tsx components/ConnectDevice/QrScannerPanel tests/components/ConnectDevice/QrScannerPanel.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run typecheck:tests`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 400 files, 5,580 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 63 warnings, average CCN 1.3, max CCN 33; `QrScannerPanel` is no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` completed: 2.02% duplication, 276 clones, 5,288 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and full working-tree gitleaks passed.

Edge case and self-review notes:

- Null/empty success copy remains guarded: empty fingerprint renders `Not provided`, while populated fingerprints render unchanged.
- Progress boundaries remain explicit: `0` shows the positioning hint, `1..99` shows animated QR progress, and `100` hides both transient progress and positioning copy.
- Camera and file boundaries remain preserved: secure origins omit the HTTPS warning, insecure origins show it, camera error retry reactivates the camera, stop camera still calls `onStopCamera`, and file upload keeps the `.json,.txt` accept list and existing change callback.

# Previous Task: Lizard UI Batch 29 - Agent Wallet Dashboard

Status: complete

Goal: reduce the current `AgentWalletDashboard` lizard finding by splitting dashboard state/model derivation, loading/error shell rendering, summary tiles, row header/actions, wallet links, and detail panels while preserving dashboard load/retry behavior, row ordering, totals, spend-ready eligibility, status badges, pause/unpause/revoke behavior, confirm gating, active-key filtering, empty states, wallet links, metadata labels, formatting fallbacks, and the public `AgentWalletDashboard` import path.

## Lizard UI Batch 29 Checklist

- [x] Start from updated `main` after Batch 28 PR and post-merge full lane are green.
- [x] Confirm `AgentWalletDashboard` is tied as a current top JSX target at 33 CCN.
- [x] Split AgentWalletDashboard render/status branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 29 Review

Plan:

- Keep `components/AgentWalletDashboard/index.tsx` as the public `AgentWalletDashboard` export and move dashboard controller/model helpers plus row/detail render pieces under `components/AgentWalletDashboard/`.
- Extract row state derivation, active-key filtering, spend-ready checks, total aggregation, row ordering, status badge rendering, and dashboard shell states into focused helpers so the row component no longer owns every branch.
- Preserve `tests/components/AgentWalletDashboard.test.tsx` first; add focused branch tests only if extraction exposes missing behavior around invalid balances, invalid dates, revoked/expired keys, unknown metadata labels, empty sections, or cancelled revocation.
- Verify focused lizard against `components/AgentWalletDashboard/index.tsx`, the extracted helper directory, and the focused test before running the broader guardrails.

Verification so far:

- PR #27 merged as `4f68be9a`; the post-merge `main` backstop passed release `24675976724`, dev image build `24675976716`, install tests `24675976681`, and test suite `24675976713`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.
- Fresh focused lizard measurement from `main` (`4f68be9a`) reports `components/AgentWalletDashboard/index.tsx:326` anonymous row render at 33 CCN.
- Reduced `components/AgentWalletDashboard/index.tsx` to an 8-line public shell and moved loading/error/dashboard rendering, row rendering, row actions, row metrics/links, detail panels, status badges, controller state, and pure dashboard model helpers under `components/AgentWalletDashboard/`.
- Preserved dashboard load/retry behavior, row ordering by attention then name, total aggregation, spend-ready eligibility, active-key filtering, pause/unpause/revoke behavior, confirmation gating, action error display, wallet links, status badges, metadata labels, no-cap/off/fallback copy, empty detail states, and the public `AgentWalletDashboard` import path.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx tests/components/AgentWalletDashboard/agentWalletDashboardModel.test.ts` passed: 2 files, 12 tests.
- `npm run typecheck:tests` passed after tightening the dashboard model test helper to omit `agent` before layering partial agent overrides; this fixes PR #28's first `Quick Frontend Tests` failure.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AgentWalletDashboard tests/components/AgentWalletDashboard.test.tsx tests/components/AgentWalletDashboard/agentWalletDashboardModel.test.ts` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- `npm run test:coverage` passed: 400 files, 5,578 tests, 100% statements/branches/functions/lines.
- Broad lizard now reports 64 warnings, average CCN 1.3, max CCN 33; `AgentWalletDashboard` is no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npx --yes jscpd@4 .` completed: 2.02% duplication, 276 clones, 5,283 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, and full working-tree gitleaks passed.
- PR #28 checks passed after follow-up commit `31847425`: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #28 merged as `a7ff5c5e`; the post-merge `main` backstop passed release `24677999452`, dev image build `24677999451`, install tests `24677999449`, and test suite `24677999722`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/undefined optional inputs remain guarded: absent wallet names fall back to wallet IDs, absent wallet types render `Wallet`, absent funding drafts render `Never`, empty draft/spend/alert/key sections render their empty copy, and absent API keys filter to an empty active-key list.
- Numeric/date boundaries remain explicit: malformed sats display their raw value where appropriate, malformed operational balances count as zero in totals and not spend-ready, zero balances are not spend-ready, expired/revoked keys are inactive, invalid expiry dates are inactive, and invalid timestamps render `Unknown`.
- Action boundaries remain preserved: cancelled key revocation does not call the API, successful status/key actions reload data, failed actions show the extracted error copy, and revoked agents cannot be paused.
- Metadata fallbacks remain preserved for known labels and unknown underscore-delimited labels across spend details and alert history.

# Previous Task: Lizard UI Batch 28 - UTXO Row

Status: complete

Goal: reduce the current `UTXORow` lizard finding by splitting row state modeling, selection control rendering, amount/privacy/dust rendering, explorer links, labels/locked badges, freeze action, and age/transaction detail rendering while preserving row status priority, checkbox visibility and optional callback behavior, dust detection/spend-cost copy, privacy detail callback behavior, explorer link targets, freeze callback behavior, age/confirmation display, locked draft fallback copy, and public `UTXORow` import path.

## Lizard UI Batch 28 Checklist

- [x] Start from updated `main` after Batch 27 PR and post-merge full lane are green.
- [x] Confirm `UTXORow` is tied as a current top JSX target at 33 CCN.
- [x] Split UTXORow render/status branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 28 Review

Plan:

- Keep `components/UTXOList/UTXORow.tsx` as the public `UTXORow` export and move row state/class derivation plus focused render pieces under `components/UTXOList/UTXORow/`.
- Extract visual-state priority into a model helper so frozen, locked, dust, selected, and default row styling remain table-driven and easier to verify.
- Preserve `tests/components/UTXOList/UTXORow.test.tsx` first; add focused branch tests for selection callback absence, selected styling, privacy-without-data, dust spend-cost copy, and frozen-over-locked priority.
- Verify focused lizard against `components/UTXOList/UTXORow.tsx`, the extracted helper directory, and the focused test before running the broader guardrails.

Verification so far:

- PR #26 merged as `bdf96786`; the post-merge `main` backstop passed release `24666055251`, dev image build `24666055262`, install tests `24666055259`, and test suite `24666055256`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh focused target selection from Batch 27 shows `components/UTXOList/UTXORow.tsx:39` at 33 CCN.
- Reduced `components/UTXOList/UTXORow.tsx` to a 64-line public shell and moved row status/class modeling, selection control rendering, amount/privacy/dust rendering, address link rendering, label/locked draft badges, freeze button behavior, and age/transaction details under `components/UTXOList/UTXORow/`.
- Preserved frozen/locked/dust/selected/default visual priority, checkbox visibility when no selection callback is provided, dust spend-cost title copy, privacy detail callback behavior, address and transaction explorer targets, freeze callback behavior, age/confirmation display, locked draft fallback copy, and the public `UTXORow` import path.
- `npx vitest run tests/components/UTXOList/UTXORow.test.tsx` passed: 1 file, 20 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UTXOList/UTXORow.tsx components/UTXOList/UTXORow tests/components/UTXOList/UTXORow.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- Broad lizard now reports 65 warnings, average CCN 1.4, max CCN 33; `UTXORow` is no longer in the warning list.
- CI-scope lizard passed with the expected 9 server warnings.
- `npm run test:coverage` passed: 399 files, 5,571 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `node scripts/quality/check-large-files.mjs`, `git diff --check`, grade-history JSONL parsing, and full working-tree gitleaks passed.
- PR #27 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #27 merged as `4f68be9a`; the post-merge `main` backstop passed release `24675976724`, dev image build `24675976716`, install tests `24675976681`, and test suite `24675976713`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Null/undefined optional inputs remain guarded: absent `onToggleSelect` leaves a visible no-op checkbox, absent privacy info renders no badge, absent UTXO label renders no label badge, and absent draft label still renders `Pending Draft`.
- Status boundary priority remains frozen over locked, locked over dust, dust over selected, selected over default.
- Dust boundary behavior still uses the existing `isDustUtxo`/`getSpendCost` helpers and only shows dust copy when the UTXO is neither frozen nor draft-locked.
- Event boundary behavior still stops propagation for address links, transaction links, privacy badge wrapper, and freeze actions.

# Previous Task: Lizard UI Batch 27 - AI Label Suggestion

Status: complete

Goal: reduce the current `AILabelSuggestion` lizard finding by splitting AI suggestion controller state, API error message mapping, suggest button rendering, suggestion result rendering, and error alert rendering while preserving transaction-id request payloads, loading/reset behavior, all user-facing error copy, accept/dismiss behavior, className passthrough, callback behavior, and public `AILabelSuggestion` import path.

## Lizard UI Batch 27 Checklist

- [x] Start from updated `main` after Batch 26 PR and post-merge full lane are green.
- [x] Confirm `AILabelSuggestion` is the current top JSX target at 35 CCN.
- [x] Split AILabelSuggestion controller/render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 27 Review

Plan:

- Keep `components/AILabelSuggestion.tsx` as the public `AILabelSuggestion` export and move controller state, error mapping, button/result/error renderers, and shared prop types under `components/AILabelSuggestion/`.
- Extract API error message selection into a pure helper so the async handler no longer owns every branch.
- Preserve `tests/components/AILabelSuggestion.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/AILabelSuggestion.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #25 merged as `3aa542db`; the post-merge `main` backstop passed release `24664782827`, dev image build `24664782838`, install tests `24664782835`, and test suite `24664782837`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.
- Fresh focused target selection from Batch 26 shows broad lizard at 67 warnings, average CCN 1.4, max CCN 35; `AILabelSuggestion` is the next top JSX target.
- Reduced `components/AILabelSuggestion.tsx` to a 48-line public shell and moved async suggestion state, transaction-id request handling, accepted-suggestion callback logic, error-message mapping, suggest button rendering, suggestion card rendering, error card rendering, and shared prop types under `components/AILabelSuggestion/`.
- Preserved transaction-id request payloads, loading/reset behavior, all user-facing error copy, accept/dismiss behavior, error dismiss behavior, className passthrough, optional accept callback behavior, transaction-change state persistence, and the public `AILabelSuggestion` import path.
- `npx vitest run tests/components/AILabelSuggestion.test.tsx` passed: 1 file, 29 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AILabelSuggestion.tsx components/AILabelSuggestion tests/components/AILabelSuggestion.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- Broad lizard now reports 66 warnings, average CCN 1.4, max CCN 33; `AILabelSuggestion` is no longer in the warning list.
- `npm run test:coverage` passed: 399 files, 5,568 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `git diff --check`, grade-history updates, `node scripts/quality/check-large-files.mjs`, and the CI-scope lizard baseline passed.
- PR #26 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #26 merged as `bdf96786`; the post-merge `main` backstop passed release `24666055251`, dev image build `24666055262`, install tests `24666055259`, and test suite `24666055256`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Unknown and non-`Error` API failures still map to the generic message, while 503/not-enabled, 429/rate-limit, timeout, and lowercase network/fetch failures keep their specific copy.
- Rapid repeated clicks still produce one API call because loading disables the suggest button.
- Accepting with a callback still calls `onSuggestionAccepted` and clears the suggestion; accepting without a callback still leaves the suggestion visible.
- Dismiss paths independently clear suggestions and errors, making the suggest button visible again after either state is dismissed.
- Transaction prop changes still preserve the current suggestion until the user dismisses or requests again, matching the existing behavior.

# Previous Task: Lizard UI Batch 26 - Login Form

Status: complete

Goal: reduce the current `LoginForm` lizard finding by splitting login form header, credential field rendering, form actions, footer status copy, and card tilt wiring while preserving login/register copy, email reveal, password hint reveal, disabled boot submit behavior, loading labels, registration toggle visibility, API status copy, error alert, field callbacks, submit/toggle callbacks, card tilt behavior, and public `LoginForm` import path.

## Lizard UI Batch 26 Checklist

- [x] Start from updated `main` after Batch 25 PR and post-merge full lane are green.
- [x] Confirm `LoginForm` is tied as the current top UI target at 35 CCN.
- [x] Split LoginForm render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 26 Review

Plan:

- Keep `components/Login/LoginForm.tsx` as the public `LoginForm` export and move header, fields, actions, footer, shared props, and visual tilt hook under `components/Login/LoginForm/`.
- Extract submit label, mode subtitle, registration toggle visibility, API status display, and footer copy into small helpers so the render layer no longer owns every branch.
- Preserve `tests/components/Login/LoginForm.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/Login/LoginForm.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #24 merged as `b1f24a73`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`b1f24a73`) reports `components/Login/LoginForm.tsx:77` anonymous render function at 35 CCN, tied with `components/AILabelSuggestion.tsx`.
- Reduced `components/Login/LoginForm.tsx` to a 63-line public shell and moved header, credential fields, actions, footer status/copy, shared prop types, and visual tilt behavior under `components/Login/LoginForm/`.
- Preserved login/register copy, email reveal, password hint reveal, disabled boot submit behavior, loading labels, registration toggle visibility, API status copy, error alert, field callbacks, submit/toggle callbacks, card tilt behavior, and the public `LoginForm` import path.
- Added a focused assertion that boot loading disables the submit button without changing the login label.
- `npx vitest run tests/components/Login/LoginForm.test.tsx tests/components/Login.test.tsx tests/components/ui/Button.test.tsx` passed: 3 files, 47 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Login/LoginForm.tsx components/Login/LoginForm tests/components/Login/LoginForm.test.tsx` passed with no focused warnings.
- `npm run typecheck:app`, `npm run lint:app`, and `npm run lint` passed.
- Broad lizard now reports 67 warnings, average CCN 1.4, max CCN 35; `LoginForm` is no longer in the warning list and `AILabelSuggestion` is the next top JSX target.
- `npm run test:coverage` passed: 399 files, 5,568 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `git diff --check`, grade-history updates, `node scripts/quality/check-large-files.mjs`, and the CI-scope lizard baseline passed.
- PR #25 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #25 merged as `3aa542db`; the post-merge `main` backstop passed release `24664782827`, dev image build `24664782838`, install tests `24664782835`, and test suite `24664782837`, including full backend, full frontend, full gateway, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty/null error state still renders no visible alert while non-empty errors render through `ErrorAlert`.
- Login and registration modes still cover both static and loading submit labels, hidden and visible email fields, hidden and visible password hints, and disabled boot-submit state.
- Registration-disabled login mode still hides the toggle, while registration mode still exposes the sign-in toggle even when new registrations are disabled.
- API status rendering is now table-driven for the three allowed statuses and the focused tests cover `checking`, `connected`, and `error`.
- Card tilt still guards null refs before reading layout or mutating transforms, and the visual-only hook remains coverage-ignored.

# Previous Task: Lizard UI Batch 25 - App Routes

Status: complete

Goal: reduce the current `AppRoutes` lizard finding by splitting authenticated-shell state, default-password modal behavior, animated background rendering, route/redirect rendering, notification container wiring, and theme toggle derivation while preserving unauthenticated login gating, `useWebSocketQueryInvalidation` execution, default-password modal trigger, password-change refresh/reload behavior, dark-mode fallback, animated-background pattern/opacity behavior, route manifest rendering, redirect behavior, notification dismissal, and public `App` export.

## Lizard UI Batch 25 Checklist

- [x] Start from updated `main` after Batch 24 PR and post-merge full lane are green.
- [x] Confirm `AppRoutes` is the current top UI target at 37 CCN.
- [x] Split AppRoutes controller/render branches into focused helpers while preserving callbacks and visible behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 25 Review

Plan:

- Keep `App.tsx` as the public `App` export and move authenticated shell rendering plus controller state under a small `src/app/AppRoutes/` helper set.
- Extract app preference derivation, password-change handling, animated background rendering, route list rendering, and notification container wiring into focused functions/components.
- Preserve `tests/App.branches.test.tsx` and `tests/src/app/appRoutes.test.ts` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `App.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #23 merged as `eda556b8`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`eda556b8`) reports `App.tsx:20` `AppRoutes` at 37 CCN.
- Split `App.tsx` to a 15-line public router/provider shell and moved authenticated app state, preference derivation, password-change refresh/reload handling, animated background selection, route/redirect rendering, and notification wiring under `src/app/AppRoutes/`.
- Preserved default-password modal behavior, unauthenticated login gating, `useWebSocketQueryInvalidation` execution, dark-mode/background fallbacks, animated-background opacity handling, route manifest redirects, notification dismissal, and the public `App` export.
- `npx vitest run tests/App.branches.test.tsx tests/src/app/appRoutes.test.ts` passed: 2 files, 9 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w App.tsx src/app/AppRoutes` passed with no focused warnings.
- `npm run typecheck:app` and `npm run lint:app` passed.
- Broad lizard now reports 68 warnings, average CCN 1.4, max CCN 35; `AppRoutes` is no longer in the warning list.
- `npm run test:coverage` passed: 399 files, 5,567 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` completed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- PR #24 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, Quick Test Hygiene, lizard, jscpd, gitleaks, lint, and Docker builds. `Full Test Summary` was skipped as intended on PR.
- PR #24 merged as `b1f24a73`; the post-merge `main` backstop passed release `24663495601`, dev image build `24663495592`, install tests `24663495579`, and test suite `24663495589`, including full backend, full gateway, full frontend, full build, full E2E, and full test summary jobs.

Edge case and self-review notes:

- Empty/unauthenticated user state still returns `Login` before rendering the authenticated shell.
- Missing preferences still derive `false` dark mode, `minimal` background pattern, and `50` opacity through the existing defaults.
- Password-change refresh failures remain caught and logged before closing the modal and reloading the document.
- Animated backgrounds render only for animated background patterns; non-animated patterns return no background component.
- Route and redirect rendering still comes from the existing app route manifest, avoiding manual path drift.

# Previous Task: Lizard UI Batch 24 - Wallet Telegram Settings

Status: complete

Goal: reduce the current `WalletTelegramSettings` lizard finding by splitting wallet Telegram settings loading/saving state, Telegram availability warnings, wallet enable toggle, notification checkbox list, shell/header rendering, and shared settings model while preserving default settings, fetch-error fallback behavior, Telegram configured/global-enabled gating, optimistic save payloads, save-error revert behavior, API error copy, generic error copy, success timeout behavior, disabled controls while saving, visible copy, and public `WalletTelegramSettings` import path.

## Lizard UI Batch 24 Checklist

- [x] Start from updated `main` after Batch 23 PR and post-merge full lane are green.
- [x] Confirm `WalletTelegramSettings` is tied as the current top UI target at 37 CCN.
- [x] Split WalletTelegramSettings controller/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 24 Review

Plan:

- Keep `components/WalletDetail/WalletTelegramSettings.tsx` as the public shell and move controller logic, availability notices, setting toggles, and shared model helpers under `components/WalletDetail/WalletTelegramSettings/`.
- Extract default settings, Telegram availability derivation, toggle labels, and save-error message mapping into small helpers so the render layer no longer owns every branch.
- Preserve `tests/components/WalletDetail/WalletTelegramSettings.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/WalletDetail/WalletTelegramSettings.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #22 merged as `c58e4073`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`c58e4073`) reports `components/WalletDetail/WalletTelegramSettings.tsx:22` `WalletTelegramSettings` at 37 CCN, tied with `AppRoutes`.

Changes:

- Reduced `components/WalletDetail/WalletTelegramSettings.tsx` from the 37-CCN wallet Telegram renderer/controller to a 12-line public shell.
- Split default settings, Telegram availability derivation, save-error mapping, async controller state, availability warning cards, wallet enable toggle, notification checkbox list, loading card, and shell/header rendering under `components/WalletDetail/WalletTelegramSettings/`.
- Added a focused unmount branch test for pending settings loads so the safer async guard keeps 100% branch coverage.
- Preserved default settings, fetch-error fallback behavior, Telegram configured/global-enabled gating, optimistic save payloads, save-error revert behavior, API error copy, generic error copy, success timeout behavior, disabled controls while saving, visible copy, and public `WalletTelegramSettings` import path.
- Updated quality tracking: `WalletTelegramSettings` drops out of the current lizard warning list; broad lizard warning count is now 69 and max CCN remains 37 with `AppRoutes` as the top UI target.

Verification so far:

- `npx vitest run tests/components/WalletDetail/WalletTelegramSettings.test.tsx` passed: 1 file, 7 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletTelegramSettings.tsx components/WalletDetail/WalletTelegramSettings` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 69; `WalletTelegramSettings` has no remaining lizard warnings and max CCN is now 37.
- `npm run test:coverage` passed: 399 files, 5,567 tests, 100% statements/branches/functions/lines.
- `npx --yes jscpd@4 .` passed: 2.03% duplication, 276 clones, 5,283 duplicated lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and staged gitleaks passed.
- PR #23 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #23 merged as `eda556b8`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: absent user, absent preferences, absent Telegram settings, missing bot token, missing chat ID, fetch failures, null save errors, and hidden notification rows while wallet notifications are disabled remain guarded.
- Boundary values: Telegram configured versus globally disabled versus available states, enabled versus disabled wallet toggle, every notification key, repeated success timeout replacement, pending-load unmount, and saving-disabled controls remain covered by the focused tests.
- System boundaries: `useUser`, `walletsApi.getWalletTelegramSettings`, `walletsApi.updateWalletTelegramSettings`, `ApiError`, `Toggle`, and the public `WalletTelegramSettings` import path keep the same contracts.
- Async/race behavior: pending load completion after unmount no longer sets state, success timeout is cleared on unmount, and save handling still optimistically updates then reverts on failure.

# Previous Task: Lizard UI Batch 23 - UTXO Garden

Status: complete

Goal: reduce the current `UTXOGarden` lizard finding by splitting UTXO garden item modeling, status/style selection, dot rendering, and legend rendering while preserving age color buckets, size scaling, frozen/locked/dust priority, title text, click guards, privacy legend visibility, format callbacks, and public `UTXOGarden` import path.

## Lizard UI Batch 23 Checklist

- [x] Start from updated `main` after Batch 22 PR and post-merge full lane are green.
- [x] Confirm `UTXOGarden` is the current top UI target at 39 CCN.
- [x] Split UTXOGarden item model/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 23 Review

Plan:

- Keep `components/UTXOList/UTXOGarden.tsx` as the public shell and move dot modeling/rendering plus legend rows under `components/UTXOList/UTXOGarden/`.
- Extract age color, size, status label, disabled state, visual pattern style, and click eligibility into small helpers with the same frozen/locked/dust precedence as the current component.
- Preserve `tests/components/UTXOList/UTXOGarden.test.tsx` and the existing `UTXOList.branches` coverage first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/UTXOList/UTXOGarden.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #21 merged as `67eff884`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`67eff884`) reports `components/UTXOList/UTXOGarden.tsx:48` anonymous render function at 39 CCN, ahead of `WalletTelegramSettings` and `AppRoutes`.

Changes:

- Reduced `components/UTXOList/UTXOGarden.tsx` from the 39-CCN garden renderer to a 38-line public shell.
- Split UTXO dot model creation, status/style selection, dot rendering, legend rendering, and shared props under `components/UTXOList/UTXOGarden/`.
- Preserved age color buckets, size scaling, frozen/locked/dust priority, title text, click guards, privacy legend visibility, format callbacks, and public `UTXOGarden` import path.
- Updated quality tracking: `UTXOGarden` drops out of the current lizard warning list; broad lizard warning count is now 70 and max CCN drops to 37 with `WalletTelegramSettings` and `AppRoutes` as the top UI targets.

Verification so far:

- `npx vitest run tests/components/UTXOList/UTXOGarden.test.tsx tests/components/UTXOList.branches.test.tsx` passed: 2 files, 15 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UTXOList/UTXOGarden.tsx components/UTXOList/UTXOGarden` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 70; `UTXOGarden` has no remaining lizard warnings and max CCN is now 37.
- `npm run test:coverage` passed: 399 files, 5,566 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #22 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #22 merged as `c58e4073`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: empty UTXO arrays, absent `date`, absent labels, absent locked draft labels, absent `onToggleSelect`, false `showPrivacy`, and default no-status labels remain guarded on the same paths as before.
- Boundary values: fresh/month/year/ancient age buckets, minimum size fallback when there are no UTXOs, selected versus unselected dots, frozen versus locked versus dust precedence, dust spend cost copy, and disabled click guards remain preserved.
- System boundaries: `UTXO`, `calculateUTXOAge`, `isDustUtxo`, `getSpendCost`, format callbacks, and the public `UTXOGarden` import path keep the same contracts.
- Async/race behavior: this extraction is render/model-only; there are no async effects or timers in the garden path.

# Previous Task: Lizard UI Batch 22 - Variables

Status: complete

Goal: reduce the current `Variables` lizard finding by splitting system-settings loading/saving state, numeric threshold field rendering, advanced warning/info copy, save feedback, and threshold validation while preserving default fallbacks, input coercion, validation copy, save payload shape, success timeout cleanup, load-error fallback behavior, visible copy, and public `Variables` import path.

## Lizard UI Batch 22 Checklist

- [x] Start from updated `main` after Batch 21 PR and post-merge full lane are green.
- [x] Confirm `Variables` is tied as the current top UI target at 39 CCN.
- [x] Split Variables controller/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 22 Review

Plan:

- Keep `components/Variables.tsx` as the public shell and move threshold inputs, warning/info panels, save feedback, and controller helpers under `components/Variables/`.
- Extract settings defaults/coercion and validation into small pure helpers so the render layer does not own every branch.
- Preserve `tests/components/Variables.test.tsx` first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/Variables.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #20 merged as `546e9255`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`546e9255`) reports `components/Variables.tsx:6` `Variables` at 39 CCN, tied with `UTXOGarden` and ahead of `WalletTelegramSettings`/`AppRoutes`.

Changes:

- Reduced `components/Variables.tsx` from the 39-CCN variables renderer/controller to a 12-line public shell.
- Split settings defaults/coercion/validation, controller state, threshold inputs, warning/info copy, threshold card rendering, and save feedback under `components/Variables/`.
- Preserved default fallbacks, input coercion, validation copy, save payload shape, save success timeout cleanup, load-error fallback behavior, visible copy, and public `Variables` import path.
- Updated quality tracking: `Variables` drops out of the current lizard warning list; broad lizard warning count is now 71 and max CCN remains 39 with `UTXOGarden` as the top UI target.

Verification so far:

- `npx vitest run tests/components/Variables.test.tsx` passed: 1 file, 27 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Variables.tsx components/Variables` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 71; `Variables` has no remaining lizard warnings and max CCN remains 39.
- `npm run test:coverage` passed: 399 files, 5,566 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #21 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #21 merged as `67eff884`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: null/undefined settings values, empty numeric input strings, load failures, save failures, null validation error, and false save success remain guarded on the same paths as before.
- Boundary values: confirmation threshold `0`, dust threshold negative values, empty dust fallback to 546, deep-confirmation empty fallback to 1, deep confirmation below confirmation, and the valid save path remain covered by the existing Variables tests.
- System boundaries: `adminApi.getSystemSettings`, `adminApi.updateSystemSettings`, `useLoadingState`, numeric inputs, and the public `Variables` import path keep the same contracts.
- Async/race behavior: success timeout replacement and unmount cleanup remain preserved; load and save timing still flows through `useLoadingState`.

# Previous Task: Lizard UI Batch 21 - Restore Panel

Status: complete

Goal: reduce the current `RestorePanel` lizard finding by splitting warning/upload states, uploaded backup details, validation status, success/error alerts, and confirmation modal rendering while preserving file selection, clear upload, validation states, warning/error/success copy, restore button disabled behavior, confirmation text normalization, cancel/reset behavior, and public `RestorePanel` import path.

## Lizard UI Batch 21 Checklist

- [x] Start from updated `main` after Batch 20 PR and post-merge full lane are green.
- [x] Confirm `RestorePanel` is the current top UI target at 39 CCN.
- [x] Split RestorePanel upload, details, validation, alerts, and confirmation-modal helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 21 Review

Plan:

- Keep `components/BackupRestore/RestorePanel.tsx` as the public shell and move section-level rendering into `components/BackupRestore/RestorePanel/` helpers.
- Extract file upload/selected-file display, backup metadata details, validation status/warnings, restore success/error alerts, and confirmation modal into focused components.
- Preserve the existing `BackupRestore` tests first; add focused branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/BackupRestore/RestorePanel.tsx` and the extracted helper directory before running the broader guardrails.

Verification so far:

- PR #19 merged as `f172a2a1`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh focused lizard measurement from `main` (`f172a2a1`) reports `components/BackupRestore/RestorePanel.tsx:54` `RestorePanel` at 39 CCN.

Changes:

- Reduced `components/BackupRestore/RestorePanel.tsx` from the 39-CCN restore renderer to a 72-line public shell.
- Split file upload, selected backup summary, metadata grid, validation status, restore action button, status alerts, and confirmation modal under `components/BackupRestore/RestorePanel/`.
- Preserved file selection, clear upload, validation states, warning/error/success copy, restore button disabled behavior, confirmation text normalization, cancel/reset behavior, and public `RestorePanel` import path.
- Updated quality tracking: `RestorePanel` drops out of the current lizard warning list; broad lizard warning count is now 72 and max CCN remains 39 with `Variables` and `UTXOGarden` as the top UI targets.

Verification so far:

- `npx vitest run tests/components/BackupRestore.test.tsx tests/components/BackupRestore/useBackupHandlers.branches.test.tsx tests/components/BackupRestore/RestorePanel.branches.test.tsx` passed: 3 files, 33 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/BackupRestore/RestorePanel.tsx components/BackupRestore/RestorePanel` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 72; `RestorePanel` has no remaining lizard warnings and max CCN remains 39.
- `npm run test:coverage` passed: 399 files, 5,566 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #20 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #20 merged as `546e9255`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: absent upload, uploaded backup without `meta`, null validation result, empty warnings/issues, null restore error, false restore success, closed confirmation modal, and null file input ref remain guarded on the same paths as before.
- Boundary values: valid versus invalid validation results, zero-warning versus warning validation results, validating versus idle state, restoring versus idle button copy, exact `RESTORE` confirmation, and cancel/reset behavior remain preserved.
- System boundaries: `SanctuaryBackup`, `ValidationResult`, file input events, `Button`, lucide icons, and the public `RestorePanel` import path keep the same contracts.
- Async/race behavior: this extraction is render-only; restore, validation, upload, and reload timing remain owned by the existing backup handler layer.

# Previous Task: Lizard UI Batch 20 - Price Chart

Status: complete

Goal: reduce the current `ChartTooltip`/`PriceChart` lizard finding by splitting tooltip rendering, animated price behavior, timeframe controls, and chart body rendering while preserving total-balance display, timeframe callbacks, chart-ready gating, tooltip active/inactive states, price placeholder, up/down animation indicators, animation cleanup, visible copy, and the public `PriceChart`/`AnimatedPrice` exports.

## Lizard UI Batch 20 Checklist

- [x] Start from updated `main` after Batch 19 PR and post-merge full lane are green.
- [x] Confirm `ChartTooltip`/`PriceChart` is the current top UI target at 41 CCN.
- [x] Split PriceChart tooltip, animated price, timeframe controls, and chart body helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 20 Review

Plan:

- Keep `components/Dashboard/PriceChart.tsx` as the public export surface for `PriceChart` and `AnimatedPrice`.
- Move chart tooltip rendering, timeframe controls, chart body wiring, and animated price behavior into focused helpers under `components/Dashboard/PriceChart/`.
- Preserve the existing `tests/components/Dashboard/PriceChart.test.tsx` expectations first, then add branch tests only if extraction exposes missing behavior.
- Verify focused lizard against `components/Dashboard/PriceChart.tsx` and the extracted helper directory before running the broader guardrails.

Baseline and PR-loop notes:

- PR #18 merged as `c0397865`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- The Batch 19 PR check behavior matched the new PR flow: `PR Required Checks` and `Code Quality Required Checks` passed, and `Full Test Summary` appeared as skipped/success on the PR.
- Fresh focused lizard measurement from `main` (`c0397865`) reports `components/Dashboard/PriceChart.tsx:7` `ChartTooltip` at 41 CCN.
- Baseline `npx vitest run tests/components/Dashboard/PriceChart.test.tsx` passed: 1 file, 9 tests.

Changes:

- Reduced `components/Dashboard/PriceChart.tsx` from the 41-CCN chart module to a 37-line public shell.
- Split `AnimatedPrice`, chart tooltip rendering, chart body wiring, timeframe controls, animated-price helpers, and shared types under `components/Dashboard/PriceChart/`.
- Preserved total-balance display, timeframe callbacks, chart-ready gating, tooltip active/inactive states, price placeholder, up/down animation indicators, animation cleanup, visible copy, and the public `PriceChart`/`AnimatedPrice` exports.
- Updated quality tracking: `PriceChart` drops out of the current lizard warning list; broad lizard warning count is now 73 and max CCN is now 39 with `RestorePanel`, `Variables`, and `UTXOGarden` as the top UI targets.

Verification so far:

- `npx vitest run tests/components/Dashboard/PriceChart.test.tsx` passed: 1 file, 9 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Dashboard/PriceChart.tsx components/Dashboard/PriceChart` passed with no warnings.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- Full broad lizard warning count is now 73; `PriceChart` has no remaining lizard warnings and max CCN is now 39.
- `npm run test:coverage` passed: 398 files, 5,565 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, tracked-tree gitleaks, and `npx --yes jscpd@4 .` passed.
- PR #19 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #19 merged as `f172a2a1`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.

Edge case and self-review:

- Null/undefined and empty inputs: inactive tooltip, empty tooltip payload, absent tooltip label, `chartReady=false`, empty chart data, `value=null`, and initial null-to-number price transitions remain guarded on the same paths as before.
- Boundary values: selected versus unselected timeframe buttons, upward versus downward versus unchanged price direction, animation completion, animation id `0`, and unmount cleanup remain covered by the existing `PriceChart`/`AnimatedPrice` tests.
- System boundaries: `Amount`, Recharts `ResponsiveContainer`/`AreaChart`/`Tooltip`, `Timeframe`, and the public `PriceChart`/`AnimatedPrice` exports keep the same contracts.
- Async/race behavior: animation frame cleanup still cancels truthy request IDs on effect cleanup, preserves the existing no-cancel behavior for request id `0`, and updates the previous price only after the animation completes.

# Previous Task: Lizard UI Batch 19 - Sidebar Content

Status: complete

Goal: reduce the current `SidebarContent` lizard finding by splitting primary navigation, wallet section rendering, device section rendering, system/admin rendering, footer/profile utilities, and small mapping helpers while preserving capability filtering, admin visibility, wallet/device alphabetical sorting, multisig/single-sig icon colors, wallet sync status dots, notification badges, empty states, theme toggle, logout, notification bell, block height indicator, version click behavior, and public `SidebarContent` import path.

## Lizard UI Batch 19 Checklist

- [x] Start from updated `main` after Batch 18 PR and post-merge full lane are green.
- [x] Confirm `SidebarContent` is tied as the current top UI target at 41 CCN.
- [x] Split SidebarContent section/render branches into focused helpers while preserving callbacks and visible copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 19 Review

Plan:

- Keep `components/Layout/SidebarContent.tsx` as the public shell and move section-level rendering into `components/Layout/SidebarContent/` helpers.
- Extract wallet rendering into deterministic helper functions for sorted wallets, wallet type/icon color, notification badge count, and sync status.
- Extract device rendering into deterministic helper functions for sorted devices and notification badge count.
- Extract system/admin/footer rendering so capability checks and user/admin gates stay explicit but no single component owns all branches.
- Preserve the current tests first, then add focused coverage only if extraction introduces new branch surfaces.

Changes:

- Reduced `components/Layout/SidebarContent.tsx` from the 41-CCN sidebar renderer to a 94-line public shell.
- Split header, primary navigation, wallet section, device section, system/admin section, footer utilities, and item mapping helpers under `components/Layout/SidebarContent/`.
- Preserved capability filtering, admin visibility, wallet/device alphabetical sorting, multisig/single-sig icon colors, wallet sync status dots, notification badges, empty states, theme toggle, logout, notification bell, block height indicator, version click behavior, and public `SidebarContent` import path.
- Updated quality tracking: `SidebarContent` drops out of the current lizard warning list; broad lizard warning count is now 74 and max CCN remains 41 with `ChartTooltip` as the top UI target.

Verification so far:

- PR #17 merged as `b8b2d104`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-18 focused lizard measurement from `main` (`b8b2d104`) reports `SidebarContent` and `ChartTooltip` tied at 41 CCN, with `SidebarContent` first in the measured target set.
- `npx vitest run tests/components/Layout/SidebarContent.branches.test.tsx tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx` passed: 3 files, 53 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Layout/SidebarContent.tsx components/Layout/SidebarContent` passed with no warnings.
- Full broad lizard warning count is now 74; `SidebarContent` has no remaining lizard warnings and max CCN remains 41.
- `npm run test:coverage` passed: 398 files, 5,565 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- PR #18 checks passed: `PR Required Checks`, `Code Quality Required Checks`, Quick Frontend, Quick E2E, lizard, jscpd, gitleaks, lint, and Docker builds.
- PR #18 merged as `c0397865`; the post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install tests, release, and dev image builds.
- The scheduled Test Suite that started immediately before the merge was manually canceled after GitHub had already marked several jobs for cancellation in favor of the higher-priority push run; this released the `main` test concurrency group so the post-merge push backstop could run.

Edge case and self-review:

- Null/undefined and empty inputs: no user, empty username, no wallets, no devices, hidden capability-gated sections, non-admin user, collapsed sections, and absent optional capabilities remain guarded on the same paths as before.
- Boundary values: wallet/device alphabetical sorting, wallet multisig versus single-sig styling, sync status precedence, wallet/device notification badge counts, admin expansion, settings visibility, dark versus light theme icon/title, and version click handling remain preserved.
- System boundaries: `appRoutes`, capability checks, `NavItem`, `SubNavItem`, `EmptyState`, `NotificationBell`, `BlockHeightIndicator`, `getWalletIcon`, and `getDeviceIcon` keep the same contracts.

# Previous Task: Lizard UI Batch 18 - Layout Shell

Status: complete

Goal: reduce the current `Layout` lizard finding by splitting route expansion state, version modal state, draft notification polling, Electrum connection polling, sidebar layout surfaces, mobile header/menu rendering, default-password banner rendering, and modal wiring while preserving sidebar props, wallet/device/admin expansion behavior, draft notifications, connection-error notifications, version copy/loading behavior, clipboard feedback, mobile menu behavior, visible copy, and public `Layout` exports.

## Lizard UI Batch 18 Checklist

- [x] Start from updated `main` after Batch 17 PR and post-merge full lane are green.
- [x] Confirm `Layout` is one of the current top UI targets at 41 CCN.
- [x] Split Layout controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 18 Review

Changes:

- Reduced `components/Layout/Layout.tsx` from the 41-CCN page shell to a 32-line public shell.
- Moved route expansion state, version modal state, clipboard feedback, draft notification polling, Electrum connection polling, and sidebar data loading into `components/Layout/useLayoutController.ts`.
- Split desktop sidebar framing, mobile header/menu overlay, default-password banner, main content frame, and AboutModal wiring into `components/Layout/LayoutShell.tsx`.
- Preserved sidebar props, wallet/device/admin expansion behavior, draft notifications, connection-error notifications, version copy/loading behavior, clipboard feedback, mobile menu behavior, visible copy, and public `Layout` exports.
- Cleared the clipboard feedback timeout on repeated copy attempts and controller unmount so delayed feedback cannot update after teardown.
- Updated the health assessment and grade history: `Layout` drops out of the current lizard warning list; broad lizard warning count is now 75 and max CCN remains 41 with `SidebarContent` and `ChartTooltip` tied as the top component targets.
- PR #17 merged as `b8b2d104`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- PR #16 merged as `ffb9e982`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-17 focused lizard measurement from `main` (`ffb9e982`) reports `Layout`, `SidebarContent`, and `ChartTooltip` tied at 41 CCN, with `Layout` first in the measured target set.
- `npx vitest run tests/components/Layout.test.tsx tests/components/Layout.branches.test.tsx` passed: 2 files, 45 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Layout/Layout.tsx components/Layout/LayoutShell.tsx components/Layout/useLayoutController.ts` passed with no warnings.
- Full broad lizard warning count is now 75; `Layout` has no remaining lizard warnings and max CCN remains 41.
- `npm run test:coverage` passed: 398 files, 5,565 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks and gitleaks tracked-tree scan passed.
- Pre-commit static reviewers and pre-commit frontend tests passed.
- PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed.

Edge case and self-review:

- Null/undefined and empty inputs: no user, no wallets, absent version info, absent copied address, closed mobile menu, and falsey default-password flags remain guarded on the same paths as before.
- Boundary values: wallet/detail route expansion versus list routes, device/detail route expansion versus list routes, admin route expansion, singular versus plural draft titles, connected versus disconnected Electrum status, and first versus repeated version clicks remain preserved.
- System boundaries: `useUser`, `useWallets`, `useDevices`, `useAppNotifications`, `useAppCapabilities`, `adminApi.checkVersion`, `bitcoinApi.getStatus`, `getDrafts`, `SidebarContent`, and `AboutModal` keep the same contracts.
- Async/race behavior: version loading still clears in `finally`, clipboard feedback still clears after 2000ms with timeout cleanup on repeated copies and unmount, draft fetch failures still continue to other wallets, connection checks still run immediately and every 60 seconds, and interval cleanup still happens on effect teardown.

# Previous Task: Lizard UI Batch 17 - AI Query Input

Status: complete

Goal: reduce the current `AIQueryInput` lizard finding by splitting natural-language query state, submit/error handling, result formatting, example dropdown rendering, result display, and error display while preserving query trimming, loading state, examples focus/blur behavior, clear behavior, result callback behavior, error copy, visible copy, and public default/named exports.

## Lizard UI Batch 17 Checklist

- [x] Start from updated `main` after Batch 16 PR and post-merge full lane are green.
- [x] Confirm `AIQueryInput` is the current top UI target at 43 CCN.
- [x] Split AIQueryInput controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 17 Review

Changes:

- Reduced `components/AIQueryInput.tsx` from the 43-CCN query component to a 44-line public shell.
- Moved query state, submit handling, API error classification, result state, clear behavior, and error dismissal into `components/AIQueryInput/useAIQueryInputController.ts`.
- Split example rendering, input controls, result display, and error display into focused helpers under `components/AIQueryInput/`.
- Preserved query trimming, loading state, examples focus/blur behavior, clear behavior, result callback behavior, error copy, visible copy, and public default/named exports.
- Updated the health assessment and grade history: `AIQueryInput` drops out of the current lizard warning list; broad lizard warning count is now 76 and max CCN is now 41 with `Layout`, `SidebarContent`, and `ChartTooltip` tied as the top component targets.
- PR #16 merged as `ffb9e982`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- PR #15 merged as `785aa53a`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-16 focused lizard measurement from `main` (`785aa53a`) reports `AIQueryInput` at 43 CCN.
- `npx vitest run tests/components/AIQueryInput.test.tsx` passed: 1 file, 41 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AIQueryInput.tsx components/AIQueryInput` passed with no warnings.
- Full broad lizard warning count is now 76; `AIQueryInput` has no remaining lizard warnings and max CCN is now 41.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks and gitleaks tracked-tree scan passed.
- Pre-commit static reviewers and pre-commit frontend tests passed.
- PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed; the first Quick E2E attempt failed only because `npm ci` hit `ECONNRESET` during setup, and the rerun passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty query, whitespace-only query, absent result, absent error, absent optional callback, and no selected example remain guarded on the same paths as before.
- Boundary values: trimmed query submission, disabled submit while loading or blank, focus/blur example timing, query clear resetting result/error, and result fields with absent or empty filter/sort/limit/aggregation remain preserved.
- System boundaries: `aiApi.executeNaturalQuery`, `NaturalQueryResult`, lucide icons, logger behavior, and the public `AIQueryInput` default/named exports keep the same contracts.
- Async/race behavior: loading still clears in `finally`, failed requests still clear result and set classified error copy, successful requests still set result before invoking `onQueryResult`, and examples still hide through the existing 200ms blur timeout.

# Previous Task: Lizard UI Batch 16 - Users and Groups

Status: complete

Goal: reduce the current `UsersGroups` lizard finding by splitting admin API/loading state, user CRUD handlers, group CRUD handlers, modal state, and page rendering while preserving user/group loading, create/update/delete behavior, confirmation prompts, error handling, modal open/close behavior, visible copy, and the public `UsersGroups` export.

## Lizard UI Batch 16 Checklist

- [x] Start from updated `main` after Batch 15 PR and post-merge full lane are green.
- [x] Confirm `UsersGroups` is the current top UI target at 43 CCN.
- [x] Split UsersGroups controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 16 Review

Changes:

- Reduced `components/UsersGroups/UsersGroups.tsx` from the 43-CCN page component to a 13-line public shell.
- Moved admin user/group loading, create/update/delete handlers, confirmation prompts, API error handling, modal state, and group draft state into `components/UsersGroups/useUsersGroupsController.ts`.
- Moved loaded page rendering and existing panel/modal wiring into `components/UsersGroups/UsersGroupsLoadedView.tsx`.
- Preserved user/group loading, create/update/delete behavior, confirmation prompts, error handling, modal open/close behavior, visible copy, and the public `UsersGroups` export.
- Updated the health assessment and grade history: `UsersGroups` drops out of the current lizard warning list; broad lizard warning count remains measured at 77 and max CCN remains 43 with `AIQueryInput` now the top component target.
- PR #15 merged as `785aa53a`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- PR #14 merged as `f76cfa87`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.
- Fresh post-Batch-15 focused lizard measurement from `main` (`f76cfa87`) reports `UsersGroups` at 43 CCN.
- `npx vitest run tests/components/UsersGroups.test.tsx tests/components/UsersGroups.branches.test.tsx tests/components/UsersGroups/CreateUserModal.test.tsx tests/components/UsersGroups/EditUserModal.branches.test.tsx tests/components/UsersGroups/GroupPanel.branches.test.tsx tests/components/UsersGroups/EditGroupModal.branches.test.tsx` passed: 6 files, 43 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/UsersGroups` passed with no warnings.
- Full broad lizard warning count remains 77; `UsersGroups` has no remaining lizard warnings and `AIQueryInput` is now the top component target at 43 CCN.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, pre-commit frontend tests, PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty users/groups, absent editing user/group, no selected modal record, whitespace-only create-user fields, whitespace-only group names, missing user email, and empty group member lists remain guarded on the same paths as before.
- Boundary values: no-change user update payloads, email clear-to-undefined, admin toggle changes, optional password updates, selected versus unselected group members, confirmation cancel, and failed create/update branches remain preserved.
- System boundaries: `adminApi.getUsers`, `getGroups`, `createUser`, `updateUser`, `deleteUser`, `createGroup`, `updateGroup`, `deleteGroup`, `useLoadingState`, `useErrorHandler`, existing panels, and existing modals keep the same contracts.
- Async/race behavior: load/create/update loading flags still flow through `useLoadingState`, failed create/update operations keep modals open, successful mutations reload data, and delete failures still log and call the shared error handler.

# Previous Task: Lizard UI Batch 15 - Chat Tab

Status: complete

Goal: reduce the current `ChatTab` lizard finding by splitting chat API/controller state, conversation list rendering, message panel rendering, and input composer behavior without changing conversation load/create/delete behavior, selected-conversation semantics, message load/clear behavior, optimistic send/rollback behavior, Enter-to-send behavior, scroll-to-bottom behavior, visible copy, or public `ChatTab` exports.

## Lizard UI Batch 15 Checklist

- [x] Start from updated `main` after Batch 14 PR and post-merge full lane are green.
- [x] Confirm `ChatTab` is the current top UI target at 45 CCN.
- [x] Split ChatTab controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 15 Review

Changes:

- Reduced `components/Intelligence/tabs/ChatTab.tsx` from the 45-CCN tab component to a 38-line public shell.
- Moved conversation loading, selected-conversation state, message loading/clearing, optimistic send/rollback, Enter-to-send handling, scroll refs, focus refs, and API error logging into `components/Intelligence/tabs/useChatTabController.ts`.
- Split conversation list rendering, message pane rendering, and input composer rendering into focused helpers under `components/Intelligence/tabs/`.
- Preserved conversation load/create/delete behavior, selected-conversation semantics, message load/clear behavior, optimistic send/rollback behavior, Enter-to-send behavior, scroll-to-bottom behavior, visible copy, and the public `ChatTab` export.
- PR #14 merged as `f76cfa87`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- Fresh post-Batch-14 TSX-aware lizard measurement from `main` (`72783376`) reports `ChatTab` as the top current target at 45 CCN with 78 warnings remaining.
- `npx vitest run tests/components/Intelligence.tabs.test.tsx tests/components/Intelligence.test.tsx tests/components/IntelligenceTabs/chatTab.contracts.tsx` passed: 2 direct test files, 85 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Intelligence/tabs/ChatTab.tsx components/Intelligence/tabs/ChatConversationList.tsx components/Intelligence/tabs/ChatInputComposer.tsx components/Intelligence/tabs/ChatMessagePane.tsx components/Intelligence/tabs/useChatTabController.ts` passed with no warnings.
- Full TSX-aware lizard warning count is now 77; max CCN is now 43 with `UsersGroups` and `AIQueryInput` as the next top component targets.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, pre-commit frontend tests, PR required checks, PR code-quality checks, PR quick checks, and post-merge full-lane checks passed.

Edge case and self-review:

- Null/undefined and empty inputs: no conversations, missing conversation title, no selected conversation, empty message lists, whitespace-only input, and API failure paths remain guarded on the same paths as before.
- Boundary values: Enter versus Shift+Enter, selected versus unselected conversation deletion, disabled send while empty/sending, and temporary-message replacement/removal remain preserved.
- System boundaries: `intelligenceApi.getConversations`, `getConversationMessages`, `createConversation`, `deleteConversation`, `sendChatMessage`, `ChatMessage`, lucide icons, logger behavior, and text-area refs keep the same contracts.
- Async/race behavior: load flags still clear in `finally`, selection clearing still resets messages, send still gates on `sending`, failed sends still remove only the temp message and restore input, and scroll-to-bottom still runs after message updates.

# Previous Task: Lizard UI Batch 14 - Wallet Detail

Status: complete

Goal: reduce the current `WalletDetail` lizard finding by splitting the route/page state shell, hook orchestration, loaded wallet view, tab prop assembly, and modal prop assembly without changing wallet data loading, sync/repair behavior, transaction filtering, sharing flows, label editing, UTXO actions, modal behavior, tab routing, WebSocket updates, visible copy, or public `WalletDetail` exports.

## Lizard UI Batch 14 Checklist

- [x] Start from updated `main` after Batch 13 PR and post-merge full lane are green.
- [x] Confirm `WalletDetail` is the current top UI target at 47 CCN.
- [x] Split WalletDetail controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 14 Review

Changes:

- Reduced `components/WalletDetail/WalletDetail.tsx` from the 47-CCN page component to a 28-line public shell.
- Moved route params, navigation, location state, user/app notification context, data hooks, sync/repair hooks, transaction filtering, AI filtering, sharing hooks, label editing, UTXO actions, wallet mutation state, tab state, WebSocket hooks, log hooks, address actions, draft notifications, and modal state into `components/WalletDetail/useWalletDetailController.ts`.
- Moved loaded wallet rendering plus tab and modal prop assembly into `components/WalletDetail/WalletDetailLoadedView.tsx` with focused prop-builder helpers.
- Preserved wallet data loading, sync/repair behavior, transaction filtering, sharing flows, label editing, UTXO actions, modal behavior, tab routing, WebSocket updates, visible copy, and the public `WalletDetail` export.
- Updated the health assessment and grade history: TSX-aware lizard warnings moved from 79 to 78, max CCN moved from 47 to 45, and `WalletDetail` dropped out of the current top lizard target list.
- PR #13 merged as `72783376`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- Fresh post-Batch-13 TSX-aware lizard measurement from `main` (`898c2f36`) reports `WalletDetail` as the top current target at 47 CCN.
- `npx vitest run tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx tests/components/WalletDetail tests/components/WalletDetailWrapper` passed: 41 files, 505 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletDetail.tsx components/WalletDetail/WalletDetailLoadedView.tsx components/WalletDetail/useWalletDetailController.ts` passed with no warnings.
- Full TSX-aware lizard warning count is now 78; top remaining component targets are `ChatTab`, `UsersGroups`, `AIQueryInput`, and `SidebarContent`.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.
- Staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, and pre-commit frontend tests passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing route wallet ID, absent wallet, loading state, error state, missing wallet network, missing descriptor, empty UTXO stats, absent bitcoin status, and absent modal wallet ID remain guarded on the same paths as before.
- Boundary values: viewer/editor/owner tab visibility, single-sig versus multisig draft type, empty-string descriptor fallback, stats-tab first-load behavior, and `canEdit=false` transaction controls remain preserved.
- System boundaries: existing hooks remain the only integration points for wallet API loading, sync/repair, sharing, labels, UTXOs, wallet mutation, WebSocket updates, logs, and draft notifications.
- Async/race behavior: stats loading still only starts when the stats tab opens and no UTXO stats are loaded/loading, refresh callbacks still call `fetchData(true)`, and modal delete/transfer flows still delegate through the existing modal-state hook.
- Diff review: changes are scoped to WalletDetail extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 13 - Monitoring

Status: complete

Goal: reduce the current `Monitoring` lizard finding by splitting service loading/controller state, header/refresh controls, disabled-stack and error banners, service grid props, about copy, and URL-modal wiring without changing monitoring API calls, Grafana config fallback behavior, anonymous-access toggling, refresh behavior, hostname fallback, URL edit/save semantics, visible copy, or public `Monitoring` exports.

## Lizard UI Batch 13 Checklist

- [x] Start from updated `main` after Batch 12 PR and post-merge full lane are green.
- [x] Confirm `Monitoring` is the current top UI target at 49 CCN.
- [x] Split Monitoring controller/render branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 13 Review

Changes:

- Reduced `components/Monitoring/Monitoring.tsx` from the 49-CCN page component to a 58-line public shell.
- Moved service loading, Grafana config fallback, anonymous-access toggling, credential lookup, URL edit/save state, refresh state, and hostname fallback into `components/Monitoring/useMonitoringController.ts`.
- Split the loading state, header/refresh button, disabled-stack banner, error banner, services grid, and about section into focused helpers under `components/Monitoring/`.
- Preserved monitoring API calls, Grafana config non-fatal fallback behavior, anonymous-access update semantics, refresh behavior, hostname fallback, URL edit/save/null behavior, visible copy, and the public default/named `Monitoring` exports.
- Updated the health assessment and grade history: full lizard warnings moved from 81 to 80, max CCN moved from 49 to 47, and `Monitoring` dropped out of the current top lizard target list.
- PR #12 merged as `898c2f36`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- `npx vitest run tests/components/Monitoring.test.tsx tests/components/Monitoring.branches.test.tsx tests/components/Monitoring/ServiceCard.branches.test.tsx` passed: 3 files, 44 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Monitoring/Monitoring.tsx components/Monitoring tests/components/Monitoring.test.tsx tests/components/Monitoring.branches.test.tsx tests/components/Monitoring/ServiceCard.branches.test.tsx` passed with no warnings.
- Full TSX-aware lizard warning count is now 80; top remaining component targets are `WalletDetail`, `ChatTab`, `UsersGroups`, and `AIQueryInput`.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, `npx --yes jscpd@4 .`, staged diff checks, gitleaks tracked-tree scan, pre-commit static reviewers, and pre-commit frontend tests passed.

Edge case and self-review:

- Null/undefined and empty inputs: no data, absent Grafana config, absent edit service, empty edit URL, null result from loading helpers, and missing service credentials remain guarded.
- Boundary values: enabled/disabled monitoring stack state, Grafana versus non-Grafana service IDs, custom/default URL state, and empty-string-to-null URL save behavior remain covered.
- System boundaries: `adminApi.getMonitoringServices`, `adminApi.getGrafanaConfig`, `adminApi.updateGrafanaConfig`, `adminApi.updateMonitoringServiceUrl`, `useLoadingState`, `ServiceCard`, and `EditUrlModal` keep the same contracts and module boundaries.
- Async/race behavior: refresh state still clears after `runLoad`, Grafana config lookup remains non-fatal, save still reloads services before closing the modal, and failed anonymous toggle still avoids local state update.
- Diff review: changes are scoped to Monitoring extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 12 - Network Sync Actions

Status: complete

Goal: reduce the current `NetworkSyncActions` lizard finding by splitting async sync/resync state, compact/full button surfaces, the shared resync confirmation dialog, result messaging, and style helpers without changing sync/resync API calls, disabled states, dialog copy, compact/full behavior, timer behavior, success/error messages, callback behavior, or the public `NetworkSyncActions` export.

## Lizard UI Batch 12 Checklist

- [x] Start from updated `main` after Batch 11 PR and post-merge full lane are green.
- [x] Confirm `NetworkSyncActions` is the current top UI target at 49 CCN.
- [x] Split NetworkSyncActions render/action branches into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Parallel Batch Policy

- Code prep can overlap with a previous PR's CI only when the next target has a disjoint code ownership area.
- Integration stays serialized: each branch rebases from updated `main`, updates shared docs/history/task tracking once, then opens its own PR.
- Shared files such as `tasks/todo.md`, `docs/plans/codebase-health-assessment.md`, and `docs/plans/grade-history/sanctuary_.jsonl` are updated only in the branch currently being integrated to avoid churn and conflicts.

## Lizard UI Batch 12 Review

Changes:

- Reduced `components/NetworkSyncActions.tsx` from the 49-CCN render/action component to a 41-line public shell.
- Moved sync/resync API state, success/error result creation, disabled state, timer behavior, and dialog toggles into `components/NetworkSyncActions/useNetworkSyncActions.ts`.
- Split compact buttons, full buttons, result rendering, resync confirmation dialog, shared types, and style-state helpers under `components/NetworkSyncActions/`.
- Preserved sync/resync API calls, `onSyncStarted` behavior, success/error copy, compact titles, disabled/loading states, dialog copy, cancel/X behavior, result clearing timers, and the public default/named `NetworkSyncActions` exports.
- Updated the health assessment and grade history: full lizard warnings moved from 82 to 81, max CCN remains 49, and `NetworkSyncActions` dropped out of the current top lizard target list.
- PR #11 merged as `0328ea68`; the post-merge `main` backstop passed the full test summary, full E2E, full build, full frontend, full backend, full gateway, install summary, release check, and dev image build checks.

Verification so far:

- `npx vitest run tests/components/NetworkSyncActions.test.tsx tests/components/NetworkSyncActions.branches.test.tsx` passed: 2 files, 27 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NetworkSyncActions.tsx components/NetworkSyncActions tests/components/NetworkSyncActions.test.tsx tests/components/NetworkSyncActions.branches.test.tsx` passed with no warnings.
- Full TSX-aware lizard warning count is now 81; top remaining component targets are `Monitoring`, `WalletDetail`, `ChatTab`, and `UsersGroups`.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, full lint, CI-scope lizard baseline, and `npx --yes jscpd@4 .` passed.

Edge case and self-review:

- Null/undefined and empty inputs: `onSyncStarted` remains optional, `result` can be null, and `walletCount=0` still disables both buttons.
- Boundary values: `queued=1` and non-1 pluralization, `walletCount=1` dialog copy, `walletCount=0`, and compact/full modes remain covered by existing tests.
- System boundaries: `syncApi.syncNetworkWallets`, `syncApi.resyncNetworkWallets`, `extractErrorMessage`, lucide icons, timers, and callback contracts are isolated in the same behavioral paths as before.
- Async/race behavior: sync and resync loading flags still clear in `finally`, result timers still use the original 5s/8s windows, and resync still closes the confirmation dialog before starting the API call.
- Diff review: changes are scoped to NetworkSyncActions extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 11 - Device Details Form

Status: complete

Goal: reduce the current `DeviceDetailsForm` lizard finding by splitting the selected-device form shell, placeholder state, identity fields, parsed-account selector, single-account fields, save/status messaging, and QR import details without changing manual entry behavior, USB/QR/scanned read-only behavior, account selection, save-button gating, warnings/errors, QR details toggle behavior, visible copy, or the public `DeviceDetailsForm` export.

## Lizard UI Batch 11 Checklist

- [x] Start from updated `main` after the first PR-flow validation and docs PR.
- [x] Confirm `DeviceDetailsForm` is the current top UI target at 51 CCN.
- [x] Split DeviceDetailsForm render sections into focused helpers while preserving callbacks and copy.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Open a PR and validate `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [x] Merge after required checks pass, then wait for the post-merge `main` backstop.

## Lizard UI Batch 11 Review

Changes:

- Reduced `components/ConnectDevice/DeviceDetailsForm.tsx` to an 86-line form shell and moved placeholder, identity fields, parsed-account selection, single-account fields, QR import details, and save/status messaging into focused helpers under `components/ConnectDevice/DeviceDetailsForm/`.
- Preserved manual entry callbacks, USB/QR scanned read-only behavior, account selection toggles, save-button gating, QR details toggle behavior, warning/error copy, helper text, and the public `DeviceDetailsForm` export.
- Updated the health assessment and grade history: full lizard warnings moved from 83 to 82, max CCN moved from 51 to 49, and `DeviceDetailsForm` dropped out of the current top lizard target list.
- PR #10 merged as `8f38de4d`; the post-merge `main` backstop passed the full test summary and supporting full-lane checks.

Verification so far:

- `npx vitest run tests/components/ConnectDevice/DeviceDetailsForm.test.tsx tests/components/ConnectDevice/DeviceDetailsForm.branches.test.tsx` passed: 2 files, 8 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ConnectDevice/DeviceDetailsForm.tsx components/ConnectDevice/DeviceDetailsForm` passed with no warnings.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and the local Code Quality subset passed. The Code Quality subset covered lint, gitleaks, CI-scope lizard baseline, jscpd, and large-file classification.

Edge case and self-review:

- Null/undefined and empty inputs: no selected model, no connection method, empty xpub/fingerprint, no parsed accounts, no selected parsed accounts, missing QR fields, and absent QR details remain covered by the same render branches.
- Boundary values: selected-account count at 0 and nonzero, parsed-account count at 0 and nonzero, scanned/non-manual read-only state, and save-button disabled/enabled transitions remain covered.
- System boundaries: `Input`, `Button`, lucide icons, `onFormDataChange`, `onToggleAccount`, `onToggleQrDetails`, and `onSave` keep the same contracts and are only passed through extracted components.
- Async/race behavior: no new async state or effects were introduced; all extracted helpers are pure render components.
- Diff review: changes are scoped to DeviceDetailsForm extraction, health-report notes, trend metadata, and this task record.

# Previous Task: CI/CD Optimization and PR/Merge Workflow Plan

Status: implemented and first PR validated; merge-queue ready, but GitHub does not currently allow enforcement on this user-owned repository

Goal: optimize GitHub CI/CD so day-to-day commits get fast, relevant feedback without weakening the merge/release safety net. Evaluate whether the current pipeline runs too much on each commit, and decide whether moving from direct commits on `main` to PR-and-merge should be part of the maturity plan.

## Current Judgment

We are running the right *kinds* of tests for a wallet/security-sensitive repo, but too much of the expensive validation is attached to direct pushes on `main`.

The existing `.github/workflows/test.yml` already has the right idea structurally: PRs use a changed-files quick lane, while non-PR events use a full lane. The problem is workflow practice, not only workflow YAML: recent history shows commits landing directly on `main`, so every source-touching commit pays the full post-merge cost immediately.

Recommendation: switch normal development to PR-and-merge, protect `main`, and treat the current full suite as a merge/main confidence gate. Keep expensive Docker install, full E2E, mutation, perf, ops, and vector validation off the default per-commit path except when path filters or release gates make them relevant.

## Evidence From Audit

- Current branch is `main`, and recent history shows direct pushes such as `Refactor QR signing modal complexity`, `Refactor device detail complexity`, and `Fix admin agent service date-boundary test`.
- Recent GitHub runs show four workflows on source-touching pushes to `main`: `Test Suite`, `Build Dev Images`, `Install Tests`, and `Release`. `Install Tests` and `Release` often finish quickly because they skip/no-op; `Test Suite` is the real cost.
- A successful recent `Test Suite` push run, `24643866168`, took about 13m37s wall time. Long poles were `Full Frontend Tests` at about 6m15s and `Full E2E Tests` at about 7m17s. `Full Backend Tests` took about 4m43s. `Full Gateway Tests` was about 15s.
- A failed recent direct-push `Test Suite` run, `24642824339`, failed in `Full Backend Tests` after the commit was already on `main`. That is exactly the failure mode PR gating should prevent.
- Test inventory is large enough to justify tiering: 844 test/spec files total, including 398 root frontend/shared tests, 383 backend unit tests, 28 backend integration tests, 20 gateway tests, and 14 Playwright specs.
- None of the inspected workflows currently define `concurrency`, so superseded pushes/PR updates can keep consuming CI minutes.
- `docker-build.yml` runs on every PR to `main` without PR path filters, even though its push path filter is narrower. That is likely waste for docs/test-only/backend-only changes that do not affect image build surfaces.
- `release.yml` runs a push-to-main `Release Check` no-op purely as a status check. That is cheap, but it should be documented or replaced by a clearer required-check aggregator.
- Release validation intentionally duplicates some install validation: `release.yml` waits for `Install Tests`, then calls `release-candidate.yml`. That is acceptable for releases, but it should not influence normal commit gating.

## Target Development Model

- Use short-lived feature branches for all non-emergency work.
- Open PRs into `main`; require CI before merge.
- Disable direct pushes to `main` for humans through GitHub branch protection or repository rulesets.
- Allow only automation/release workflows to write to `main`, and only when explicitly needed.
- Prefer squash merge or rebase merge so `main` stays linear and each merged change has one clear CI result.
- Prefer GitHub merge queue as the long-term model. Current blocker: `nekoguntai/sanctuary` is a public repository owned by a paid personal user account. GitHub Pro/personal billing still leaves the repository owner type as `User`, and GitHub merge queue is currently available for public organization-owned repositories or private organization-owned repositories on Enterprise Cloud. The workflows are merge-queue ready, but enforcement must wait until the repository is under an eligible organization or GitHub expands availability.

## Proposed CI Tiers

### Tier 0 - Local Developer Loop

Use focused local commands before pushing:

- Frontend/UI changes: `npm run typecheck:app`, `npm run typecheck:tests`, focused `npx vitest run ...`, then `npm run test:coverage` only before PR readiness when coverage-affecting.
- Backend changes: `cd server && npm run typecheck:tests`, focused `npx vitest run ...`, targeted integration only when DB/API flow behavior changes.
- Gateway changes: `cd gateway && npm run test:run` or focused gateway tests.
- Docker/install changes: focused `tests/install/*` script locally when practical; otherwise rely on PR install gate.

### Tier 1 - Required PR Quick Gate

Target: fast enough for repeated PR updates; broad enough to block obvious regressions before merge.

- Always run secret scan and lint policy checks.
- Run changed-file detection once and route to relevant quick jobs.
- Frontend changes: strict app/test typecheck plus `vitest related`.
- Backend changes: server test typecheck plus related non-integration Vitest tests; keep the two-file backend integration smoke for backend changes.
- Gateway changes: related gateway tests.
- E2E/frontend surface changes: keep Chromium smoke/render subset, not full multi-browser E2E.
- Critical Bitcoin/auth paths: keep `test:mutation:critical:gate` only for those paths.
- Docker/install paths: run install workflow via existing path filters.
- Docker image build: run on PR only when Docker/image-impacting paths change.

Implementation detail: create a single always-running required status, for example `PR Required Checks`, that depends on conditional quick jobs and fails if any non-skipped required child job fails. This avoids brittle branch protection on path-conditional job names.

### Tier 2 - Merge/Main Confidence Gate

Target: full confidence once per merge, not once per local-sized direct commit.

- Full frontend coverage with 100% thresholds.
- Full backend unit coverage plus backend integration suite.
- Full gateway coverage.
- Full build check.
- Chromium Playwright E2E on the merge/main path.
- Critical mutation gate when critical paths changed.
- Build dev images on `main` only after merge and only for image-impacting paths.

If GitHub merge queue becomes available, keep the existing `merge_group` triggers and run this tier on the merge-group SHA. Then reduce push-to-main `Test Suite` to a backstop/summary where safe, because the merge queue already validated the exact merge candidate.

Until merge queue is enforceable, keep the push-to-main full lane as the backstop, but direct human pushes to `main` must be blocked so it only runs after reviewed PR merges.

### Tier 3 - Nightly/Weekly Deep Validation

Target: catch expensive, flaky, environment-sensitive, or low-probability regressions without blocking every PR update.

- Full Playwright matrix across Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari.
- Full or broader Stryker mutation testing.
- Bitcoin vector verification and regeneration checks.
- Docker install/upgrade full suite when not release-blocking.
- Ops smoke proofs and perf benchmarks.
- Duplication and complexity trend reporting can stay blocking on PR while the lizard cleanup project is active; revisit after the warning count reaches the target baseline.

### Tier 4 - Release Gate

Target: validate installation, upgrade, image publishing, and release-note automation with deliberate redundancy.

- Keep release candidate validation separate from routine merge validation.
- Run full install and upgrade tests before stable release promotion.
- Keep multi-arch Docker builds and manifest creation release-only.
- Keep release workflow waiting for install validation, but consider de-duplicating install checks later by making one release-candidate workflow the source of truth.

## Workflow Changes To Implement

- Add `concurrency` to all workflows:
  - PR group: workflow name plus PR number.
  - Push group: workflow name plus ref.
  - `cancel-in-progress: true` for PRs and branch pushes.
  - Avoid canceling release/tag workflows unless explicitly safe.
- Add `merge_group` triggers to `test.yml`, `quality.yml`, and any workflow selected as a required merge-queue check.
- Add PR path filters to `docker-build.yml` to match its push intent.
- Add or document a required-check aggregator so branch protection does not depend on conditional/skipped job names.
- Decide whether `release.yml` needs the push-to-main no-op status. If yes, rename/comment it as a branch-protection compatibility check. If no, remove the push-to-main branch trigger.
- Reduce duplicate build work in `test.yml`:
  - `full-build-check` builds frontend/backend.
  - `full-e2e-tests` also builds frontend/backend.
  - Keep both only if they catch distinct failure modes; otherwise make E2E consume the build path or make build check the single build gate.
- Keep `install-test.yml` path-gated; add concurrency and retain release tag behavior.
- Keep `verify-vectors.yml` path-gated for PRs and scheduled weekly.
- Add documentation in `docs/reference/release-gates.md` or a new `docs/reference/ci-cd-strategy.md` explaining which checks are PR-required, merge-required, nightly, and release-only.

## Branch Protection / Repository Rules

- Require PR before merging into `main`.
- Require the stable aggregate checks `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- Expect `Full Test Summary` to appear as skipped/success on PRs; the full lane is a merge/main backstop.
- Keep install/docker/vector checks path-gated instead of globally required so docs-only and unrelated PRs do not wait on absent workflows. Include each workflow file in its own path filter so workflow edits still validate their target workflow.
- Require branch to be up to date before merging if merge queue is not enabled.
- Enable merge queue as soon as the repository is under an eligible GitHub organization or GitHub expands merge queue support to personal repositories.
- Restrict direct pushes to `main`; allow GitHub Actions bot only where release automation needs it.
- Require linear history via squash or rebase merge.
- Keep emergency hotfix escape hatch documented: temporary admin bypass plus follow-up PR, not routine direct commit.

## First PR Validation Checklist

- [x] Confirm `PR Required Checks` runs on the pull request and fails only when a quick-lane child fails.
- [x] Confirm `Code Quality Required Checks` runs on the pull request and reflects lint, gitleaks, lizard, and jscpd.
- [x] Confirm `Full Test Summary` is present on the pull request as skipped/success, so branch protection does not wait on the full lane.
- [x] Confirm docs-only or workflow-only PRs do not wait on absent Docker, install, or vector checks.
- [x] After merge, confirm the push-to-`main` full lane runs as the merge confidence backstop.

Observed result: PR #8, `ci-pr-flow-aggregates`, passed the required PR checks and merged as `72bdce96`. The post-merge `main` backstop passed `Full Test Summary`, full backend, full frontend, full gateway, full E2E, full build, install summary, release check, and dev image build.

## Lizard Remediation PR Loop

- [ ] Start each batch from updated `main` on a short-lived branch.
- [ ] Refactor the next highest-value complexity target with focused tests and local lizard verification.
- [ ] Update `docs/plans/codebase-health-assessment.md`, grade history, and this task log with the new warning count and verification evidence.
- [ ] Open a PR and wait for `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`.
- [ ] Merge only after required checks pass, then wait for the post-merge full lane on `main`.
- [ ] Rebase or recreate the next batch branch from the updated `main`.

## Measurement Plan

- Baseline current wall time from recent runs:
  - `Test Suite` push: about 13-14 minutes when full path runs.
  - `Build Dev Images` push: about 1 minute.
  - `Install Tests` skip/no-op on non-install changes: about 10-15 seconds.
  - `Release` push-to-main no-op: about 5-7 seconds.
- Track p50/p90 for PR quick gate, merge gate, and nightly jobs separately.
- Target PR quick gate:
  - Non-E2E frontend/backend PRs: under 8 minutes p50.
  - Gateway-only PRs: under 3 minutes p50.
  - Docker/install PRs can be slower but should be path-limited.
- Target merge/main gate: under 15 minutes p50 while retaining full confidence.
- Track canceled runs after adding concurrency; expected outcome is fewer wasted runs on force-push/rebase cycles.
- Track escaped defects: if a category starts failing only on main after PRs pass, promote the missing check from merge/nightly into the PR quick gate.

## Implementation Checklist

- [x] Audit workflow triggers, jobs, path filters, caches, artifacts, and missing concurrency.
- [x] Map test scripts into unit, integration, e2e, install, ops, perf, mutation, vector, and release tiers.
- [x] Pull recent GitHub run data to estimate real current cost.
- [x] Evaluate PR-and-merge versus direct commits to `main`.
- [x] Review this plan before changing workflow files.
- [x] Implement workflow concurrency and safe PR path-filter improvements first.
- [x] Add PR required-check aggregator.
- [x] Configure branch protection/repository rules for PR-only `main`.
- [x] Set the blocking Code Quality lizard gate to the current CI-scope warning baseline so the first PR is not deadlocked while the broader lizard backlog is still being reduced.
- [x] Decide whether to enable merge queue now or after one PR-only trial period.
- [x] Attempt merge queue enablement through the GitHub repository rulesets API.
- [x] Confirm GitHub rejects `merge_queue` enforcement for the current user-owned repository.
- [x] Tune post-merge aggregate behavior so full E2E is included in the full-lane summary.
- [x] Document CI tiering and emergency hotfix process.
- [x] Open the CI/branch-protection changes through the new PR flow.
- [x] Validate the first PR run required-check behavior.
- [ ] Re-measure CI after 10-20 PRs and adjust gates based on failures and wall time.

## Edge Case Audit For CI Design

- Empty or docs-only PRs: should not run full test suites; should still get a cheap required aggregate result.
- Path-filtered jobs: skipped jobs must not leave required checks pending.
- Forked PRs: secret-dependent jobs must not assume write permissions or private tokens.
- Release/tag workflows: concurrency must not cancel a publishing run unexpectedly.
- Merge commits: changed-file detection must compare the correct base for PRs, pushes, and merge queue events.
- Critical-path files: Bitcoin/auth/security changes should promote to stronger gates automatically.
- Generated files and workflow-only changes: changes to workflow/test config should force relevant CI validation even if app source did not change.
- Failed quick lane followed by force-push: older run should cancel cleanly and not block the latest commit.

## Review

Implemented so far:

- Added `merge_group` support to `test.yml` and `quality.yml` so merge queue can validate the same required workflow surfaces.
- Added workflow concurrency to `test.yml`, `quality.yml`, `docker-build.yml`, `install-test.yml`, and `verify-vectors.yml`, with release/tag install runs protected from cancellation.
- Added `PR Required Checks` in `test.yml` as a stable required-check target for path-conditional quick jobs.
- Added `Code Quality Required Checks` in `quality.yml` as a stable aggregate target for lint, gitleaks, lizard, and jscpd.
- Set the Code Quality lizard gate to the current measured CI-scope baseline of 9 warnings. The broader lizard cleanup tracker remains separate and currently has 83 warnings to keep reducing batch by batch.
- Updated `Full Test Summary` to wait for `Full E2E Tests` and to fail when any required full-lane job fails. Critical mutation remains allowed to skip when no critical path changed.
- Added PR path filters to `docker-build.yml` and expanded the image-impacting path set for both PR and push triggers.
- Added `docs/reference/ci-cd-strategy.md` and linked it from `docs/reference/release-gates.md`.
- Configured GitHub branch protection for `main`: PRs required, required checks are `PR Required Checks`, `Full Test Summary`, and `Code Quality Required Checks`, strict up-to-date checks enabled, admin enforcement enabled, linear history required, force pushes/deletions disabled, and conversation resolution required.

Remaining follow-up:

- Lower the blocking `LIZARD_WARNING_BASELINE` whenever the CI-scope lizard warning count drops below 9.
- Merge queue is desired now, but cannot currently be enforced on this paid personal user-owned public repository. The GitHub rulesets API rejected the `merge_queue` rule with HTTP 422, `Invalid rule 'merge_queue'`. Move the repository under an eligible organization, then enable a repository-level queue for `main` using squash merge, build concurrency `3`, group size `1`, all-green entries, 60-minute status timeout, and the existing required checks.
- Re-measure CI after 10-20 PRs and tune gates based on escaped defects, queue time, and cancellation data.
- Watch docs-only, workflow-only, Docker, install, and vector path filters for absent-check surprises so unrelated PRs do not get stuck.

The elegant version is not "run fewer tests"; it is "run each test at the cheapest point where it provides useful information." The current suite is appropriate for merge confidence, but not ideal as the default loop for direct commits. Moving to PR-and-merge lets us keep the existing high bar while shifting most repeated feedback to the quick lane that already exists.

# Previous Task: Lizard UI Batch 10 - QR Signing Modal

Status: complete

Goal: reduce the current `QRSigningModal` lizard finding by splitting QR scan parsing, signed-PSBT file import parsing, modal state/callback control, display-step rendering, scan-step rendering, scanner progress/error UI, and upload fallback helpers without changing modal open/close behavior, raw base64 PSBT scans, UR decoding progress/errors, camera retry behavior, binary/base64/hex file upload behavior, or the public default/named exports.

## Lizard UI Batch 10 Checklist

- [x] Confirm pushed DeviceDetail CI status and clean local baseline.
- [x] Inspect current top lizard targets and QRSigningModal test coverage.
- [x] Split QRSigningModal scan/upload/render helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 10 Review

Changes:

- Reduced `components/qr/QRSigningModal.tsx` to an 86-line modal shell and moved display-step rendering, scan-step rendering, scanner progress/error UI, upload fallback UI, QR scan parsing, signed-PSBT file import parsing, and modal state/callback control into focused helpers under `components/qr/QRSigningModal/`.
- Preserved modal open/close behavior, backdrop and close-button reset behavior, raw base64 PSBT scan handling, UR decoder progress/error handling, camera retry behavior, binary/base64/hex PSBT file imports, hidden input reset, user-facing copy, and default/named exports.
- Kept the extracted FileReader assumptions aligned with the pre-extraction implementation so the 100% coverage gate did not require synthetic defensive branches.
- Updated the health assessment and grade history: full lizard warnings moved from 84 to 83, and `QRSigningModal` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/qr/QRSigningModal.test.tsx tests/hooks/useQrSigning.test.tsx tests/components/send/QrSigning.test.tsx tests/components/qr/AnimatedQRCode.test.tsx` passed: 4 files, 58 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed after branch simplification: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/qr/QRSigningModal.tsx components/qr/QRSigningModal tests/components/qr/QRSigningModal.test.tsx tests/hooks/useQrSigning.test.tsx tests/components/send/QrSigning.test.tsx` passed with no warnings.
- Full lizard warning count is now 83; top remaining component targets are `DeviceDetailsForm`, `NetworkSyncActions`, `Monitoring`, and `WalletDetail`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: closed modal, empty scan payloads, no file selected, camera non-Error payloads, invalid QR payloads, invalid uploaded content, and FileReader read failures remain covered.
- Boundary values: scan progress at partial percentages, complete UR decode, decoder errors, raw base64 PSBT scans, binary PSBT magic bytes, base64 text PSBT, hex text PSBT, and hidden file-input reset remain covered.
- System boundaries: `@yudiel/react-qr-scanner`, `AnimatedQRCode`, UR decoder utilities, FileReader, `onSignedPsbt`, `onClose`, and public `QRSigningModal` imports remain on the same contracts.
- Async/race behavior: no new external async state model was introduced; scan processing, file import callbacks, close/reset, and retry flows still resolve through the same modal state transitions.
- Diff review: changes are scoped to QRSigningModal extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 9 - Device Detail

Status: complete

Goal: reduce the current `DeviceDetail` lizard finding by splitting page states, header/edit controls, registered-account rendering, add-account controls, tab navigation, tab content, and transfer modal helpers without changing data loading, edit/save/cancel behavior, owner/viewer badges, shared-by display, account cards, add-derivation flow, tab switching, transfer modal behavior, or public exports.

## Lizard UI Batch 9 Checklist

- [x] Confirm pushed AddressesTab and CI-fix commits have green CI and clean local baseline.
- [x] Inspect current top lizard targets and DeviceDetail test coverage.
- [x] Split DeviceDetail render helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 9 Review

Changes:

- Reduced `components/DeviceDetail/DeviceDetail.tsx` to a 114-line orchestration module and moved loading/not-found states, header/edit controls, registered-account rendering, add-account controls, tab navigation/content routing, and transfer-modal wiring into focused helpers under `components/DeviceDetail/DeviceDetail/`.
- Preserved the existing layout and visible copy for the overview card, owner/viewer badge, shared-by indicator, device-type editor, account cards, legacy derivation/xpub fallback, Add Derivation Path flow, details/access tabs, and ownership-transfer modal.
- Kept data loading and mutations on the existing `useDeviceData` controller and preserved the public `components/DeviceDetail` export.
- Updated the health assessment and grade history: full lizard warnings moved from 85 to 84, max CCN moved from 53 to 51, and `DeviceDetail` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/DeviceDetailPage.test.tsx tests/components/DeviceDetail.test.ts tests/components/DeviceDetail/tabs/DetailsTab.branches.test.tsx tests/components/DeviceDetail/AccountList.test.tsx` passed: 4 files, 76 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DeviceDetail/DeviceDetail.tsx components/DeviceDetail/DeviceDetail tests/components/DeviceDetailPage.test.tsx tests/components/DeviceDetail.test.ts` passed with no warnings.
- Full lizard warning count is now 84; top remaining component targets are `QRSigningModal`, `DeviceDetailsForm`, `NetworkSyncActions`, and `Monitoring`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: loading and not-found states, missing username, null share info, empty groups/search results, absent account arrays, legacy derivation/xpub fallback, and optional `sharedBy` rendering remain covered.
- Boundary values: owner versus viewer badges, single versus plural account counts, empty account count fallback, single-sig versus multisig badges, recommended account badge, tab switching, and modal open/close paths remain covered.
- System boundaries: `useDeviceData` callback wiring, `AddAccountFlow`, `DetailsTab`, `AccessTab`, `TransferOwnershipModal`, route navigation, and public import paths remain unchanged.
- Async/race behavior: no new async state model was introduced; save/cancel, add-account close/update, sharing, group, transfer, and search flows still run through the same controller callbacks.
- Diff review: self-review caught and fixed the extracted account-section slot so it remains aligned inside the original header flex column; changes are scoped to DeviceDetail extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 8 - Addresses Tab

Status: complete

Goal: reduce the current `AddressesTab` lizard finding by splitting address grouping, summary cards, empty state, sub-tabs, table rows, label editing, and footer helpers without changing receive/change classification, copy/QR/explorer actions, label edit/save/cancel behavior, generated-address controls, or public exports.

## Lizard UI Batch 8 Checklist

- [x] Confirm pushed NetworkConnectionCard CI status and clean local baseline.
- [x] Inspect current top lizard targets and AddressesTab test coverage.
- [x] Split AddressesTab grouping/view helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 8 Review

Changes:

- Reduced `components/WalletDetail/tabs/AddressesTab.tsx` to an 87-line orchestration module and moved address grouping, summary cards, empty state, sub-tab controls, address table, row cells, label editing, actions, and footer rendering into focused helpers under `components/WalletDetail/tabs/AddressesTab/`.
- Preserved receive/change classification semantics, including explicit `isChange` precedence, derivation-path fallback, short-path receive fallback, copy/QR/explorer actions, edit/save/cancel label behavior, generated-address controls, and public `AddressesTab` exports.
- Added direct helper coverage for receive/change partitioning and balance display fallbacks, and restored the BIP derivation-path contract comment on the extracted model helper.
- Updated the health assessment and grade history: full lizard warnings moved from 86 to 85, and `AddressesTab` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/WalletDetail/tabs/AddressesTab.test.tsx tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts` passed: 2 files, 16 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 398 files, 5,564 tests, 100% statements/branches/functions/lines.
- CI follow-up: fixed `server/tests/unit/services/adminAgentService.test.ts` to use a relative future `expiresAt`; `npx vitest run tests/unit/services/adminAgentService.test.ts`, `npm run typecheck:server:tests`, and escalated `npm run test:backend:coverage` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/tabs/AddressesTab.tsx components/WalletDetail/tabs/AddressesTab tests/components/WalletDetail/tabs/AddressesTab.test.tsx tests/components/WalletDetail/tabs/AddressesTab/addressModel.test.ts` passed with no warnings.
- Full lizard warning count is now 85; top remaining component targets are `DeviceDetail`, `QRSigningModal`, `DeviceDetailsForm`, and `NetworkSyncActions`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty address arrays, empty selected receive/change tabs, missing labels, missing explorer network, absent summary/footer data, and read-only label states remain covered.
- Boundary values: explicit `isChange` values, short derivation paths, change-path fallback, copied-state rendering, all-loaded footer state, and loading generate controls remain covered.
- System boundaries: `AddressesTab` props, label callbacks, QR modal callback, copy hook usage, explorer URL construction, generated-address callback, visible copy, and public import path remain unchanged.
- Async/race behavior: no new async state model was introduced; copy, label save, and generate actions still run through the existing callback props/hooks.
- Diff review: changes are scoped to AddressesTab extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 7 - Network Connection Card

Status: complete

Goal: reduce the current `NetworkConnectionCard` lizard finding by splitting connection-mode rendering and server-action controller logic without changing singleton/pool mode selection, preset loading, add/update/delete/toggle/reorder behavior, connection testing, advanced pool settings, pool stats lookup, or public exports.

## Lizard UI Batch 7 Checklist

- [x] Confirm pushed TransactionList CI status and clean local baseline.
- [x] Inspect current top lizard targets and NetworkConnectionCard test coverage.
- [x] Split NetworkConnectionCard mode selector and controller helpers while preserving visible copy and callbacks.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 7 Review

Changes:

- Reduced `components/NetworkConnectionCard/NetworkConnectionCard.tsx` to an 82-line orchestration module and moved connection-mode rendering into `ConnectionModeSelector`.
- Moved singleton/pool config derivation, server action state, add/update/delete/toggle/reorder handlers, test status handling, preset loading, and pool stats lookup into `useNetworkConnectionCardController`.
- Reduced `components/NetworkConnectionCard/ServerForm.tsx` to a 53-line wrapper and moved input fields, port parsing, SSL toggle, preset buttons, and submit button state into focused modules under `components/NetworkConnectionCard/ServerForm/`.
- Updated the health assessment and grade history: full lizard warnings moved from 88 to 86, and `NetworkConnectionCard` plus `ServerForm` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/NetworkConnectionCard.test.tsx tests/components/NetworkConnectionCard/NetworkConnectionCard.branches.test.tsx tests/components/NetworkConnectionCard/SingletonConfig.branches.test.tsx tests/components/NetworkConnectionCard/PoolConfig.branches.test.tsx tests/components/NetworkConnectionCard/ServerRow.branches.test.tsx tests/components/NetworkConnectionCard/ServerForm.branches.test.tsx tests/components/NetworkConnectionCard/HealthHistoryBlocks.test.tsx tests/components/NetworkConnectionCard/networkConfigHelpers.test.ts` passed: 8 files, 55 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 397 files, 5,561 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NetworkConnectionCard/NetworkConnectionCard.tsx components/NetworkConnectionCard/NetworkConnectionCard components/NetworkConnectionCard/ServerForm.tsx components/NetworkConnectionCard/ServerForm components/NetworkConnectionCard/SingletonConfig.tsx components/NetworkConnectionCard/PoolConfig.tsx components/NetworkConnectionCard/ServerRow.tsx components/NetworkConnectionCard/networkConfigHelpers.ts` passed with no warnings.
- Full lizard warning count is now 86; top remaining component targets are `AddressesTab`, `DeviceDetail`, `QRSigningModal`, and `DeviceDetailsForm`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent pool stats, missing server stats, add/update guards for blank label or host, no editing server ID, and empty server forms are covered.
- Boundary values: first-server move up, last-server move down, missing server ID, middle-server reorder, failed/successful singleton tests, failed/successful server tests, and invalid port fallback remain covered.
- System boundaries: `NetworkConnectionCard`, `ServerForm`, `SingletonConfig`, and `PoolConfig` public imports remain unchanged; admin API payloads, node-config field names, server priority updates, callback props, and visible button copy remain unchanged.
- Async/race behavior: no new async state model was introduced; test status timers, server action loading resets, and error logging stay on the same handler paths.
- Diff review: changes are scoped to NetworkConnectionCard and ServerForm extraction, health-report notes, trend metadata, and this task record.

# Previous Task: Lizard UI Batch 6 - Transaction List

Status: complete

Goal: reduce the current TransactionList lizard cluster by splitting the transaction statistics, virtual table, details modal, label editor, and flow-preview mapping helpers without changing row click behavior, label editing, AI suggestions, transaction details status/type/address rendering, wallet badges, running balance columns, or public exports.

## Lizard UI Batch 6 Checklist

- [x] Confirm pushed AgentManagement CI status and clean local baseline.
- [x] Inspect current top lizard targets and TransactionList test coverage.
- [x] Split TransactionList statistics/table/details modal helpers while preserving visible copy and callbacks.
- [x] Split LabelEditor and FlowPreview warning helpers while preserving label and flow rendering.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 6 Review

Changes:

- Reduced `components/TransactionList/TransactionList.tsx` to a 167-line orchestration module and moved stats, virtual-table rendering, table headers, details modal, amount/status hero, metadata cards, address blocks, and modal helpers into focused modules under `components/TransactionList/TransactionList/`.
- Split `components/TransactionList/LabelEditor.tsx` into header, editing, read-only, and shared type modules while preserving edit/save/cancel, selected-label toggles, AI suggestions, legacy labels, and no-label rendering.
- Split `components/TransactionList/FlowPreview.tsx` mapping, total, and guard helpers into `components/TransactionList/FlowPreview/flowPreviewModel.ts`, preserving loading, empty-input, output-label, change-output, fee, and total rendering behavior.
- Added focused branch coverage for the extracted own-address null guard and updated health tracking: full lizard warnings moved from 91 to 88, and `TransactionList`, `LabelEditor`, and `FlowPreview` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/TransactionList.test.tsx tests/components/TransactionList/TransactionList.branches.test.tsx tests/components/TransactionList/LabelEditor.test.tsx tests/components/TransactionList/FlowPreview.branches.test.tsx tests/components/TransactionList/useTransactionList.branches.test.tsx` passed: 5 files, 53 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 397 files, 5,561 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionList/TransactionList.tsx components/TransactionList/TransactionList components/TransactionList/LabelEditor.tsx components/TransactionList/LabelEditor components/TransactionList/FlowPreview.tsx components/TransactionList/FlowPreview tests/components/TransactionList/TransactionList.branches.test.tsx` passed with no warnings.
- Full lizard warning count is now 88; top remaining component targets are `AddressesTab`, `NetworkConnectionCard`, `DeviceDetail`, and `QRSigningModal`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing full transaction details, empty flow inputs, missing outputs, absent counterparty address, absent own address, missing timestamp, zero block height, and empty label inventories are covered.
- Boundary values: 0 confirmations, partial confirmations, deep confirmations, 0 fees, positive fees, receive/send amounts, and self-transfer consolidation address titles remain covered.
- System boundaries: `TransactionList`, `LabelEditor`, and `FlowPreview` public imports remain unchanged; hook payloads, row click callbacks, label callbacks, AI suggestions, action-menu wiring, wallet badges, running balance columns, explorer copy behavior, and user-facing copy remain unchanged.
- Async/race behavior: no new async state model was introduced; existing details loading, label saving, and copy flows still run through the same hook handlers.
- Diff review: changes are scoped to TransactionList extraction, one branch assertion, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 5 - Agent Management

Status: complete

Goal: reduce the current AgentManagement lizard cluster by splitting `AgentRow` and `AgentFormModal` rendering/controller helpers without changing agent CRUD, scoped key issue/revoke, owner funding overrides, wallet/device filtering, policy/monitoring fields, or public exports.

## Lizard UI Batch 5 Checklist

- [x] Confirm pushed Account CI status and clean local baseline.
- [x] Inspect current top lizard targets and AgentManagement test coverage.
- [x] Split AgentRow details/key/action rendering while preserving callbacks and labels.
- [x] Split AgentFormModal initialization/filtering/rendering helpers while preserving form behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 5 Review

Changes:

- Reduced `components/AgentManagement/index.tsx` to a 427-line orchestration/key-modal module and moved the row rendering into focused `AgentRow`, header, info-grid, summary, key-list, action-button, and view-model modules.
- Moved `AgentFormModal` initialization, wallet/device filtering, selection reconciliation, fields, toggles, and form sections into focused modules under `components/AgentManagement/AgentManagement/`.
- Added `tests/components/AgentManagement.extracted.branches.test.tsx` to cover extracted status badges, empty/active key rendering, row view-model fallbacks, invalid form selection reconciliation, null form initialization values, and toggled modal booleans.
- Updated the health assessment and grade history: full lizard warnings moved from 93 to 91, max CCN moved from 55 to 53, and `AgentManagement` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/AgentManagement.extracted.branches.test.tsx tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts tests/components/AgentWalletDashboard.test.tsx` passed: 4 files, 21 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 397 files, 5,561 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/AgentManagement/index.tsx components/AgentManagement/AgentManagement tests/components/AgentManagement.extracted.branches.test.tsx` passed with no warnings.
- Full TSX-aware lizard warning count is now 91; top remaining component targets are `TransactionList`, `NetworkConnectionCard`, `AddressesTab`, and `DeviceDetail`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent `apiKeys`, missing agent user/wallet/device summaries, null policy and monitoring values, and create-form defaults are covered.
- Boundary values: 0 active keys, 1 active key, plural active-key text, blank required form fields, invalid downstream wallet/device selections, and null numeric initialization are covered.
- System boundaries: `AgentManagement` public export, admin API payload builders, key issue/revoke behavior, owner override modal wiring, labels, and user-facing copy remain unchanged.
- Async/race behavior: no new async state model was introduced; existing create/update/key/override flows and load refreshes still run through the same `runAction`/`loadData` paths.
- Diff review: changes are scoped to AgentManagement extraction, focused branch coverage, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 4 - Account

Status: complete

Goal: reduce the current top `Account` lizard finding without changing profile rendering, password validation/submission, 2FA setup/disable/regenerate flows, backup-code copy behavior, modal close/reset behavior, or public exports.

## Lizard UI Batch 4 Checklist

- [x] Confirm pushed ThemeSection CI status and clean local baseline.
- [x] Inspect current top lizard target and Account test coverage.
- [x] Split Account state/handlers and rendering while preserving the public import path.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 4 Review

Changes:

- Reduced `components/Account/Account.tsx` to an 18-line public wrapper and moved password state/submission into `components/Account/Account/usePasswordChangeController.ts`.
- Moved 2FA setup, enable, disable, regenerate, modal reset, and backup-code copy state into `components/Account/Account/useTwoFactorController.ts` with small validation/error helpers.
- Split profile rendering and modal wiring into `ProfileInformation`, `AccountView`, and `AccountModals` while preserving the existing child component contracts and `components/Account` public export.
- Added a focused Account branch test for the no-email profile path needed by the 100% coverage gate.
- Updated the health assessment and grade history: full lizard warnings moved from 94 to 93, and `Account` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/Account.test.tsx tests/components/Account.branches.test.tsx tests/components/Account/PasswordForm.branches.test.tsx tests/components/Account/SetupTwoFactorModal.test.tsx tests/components/Account/DisableTwoFactorModal.branches.test.tsx tests/components/Account/BackupCodesModal.test.tsx` passed: 6 files, 39 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,557 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Account/Account.tsx components/Account/Account` passed with no warnings.
- Full lizard warning count is now 93; top remaining component targets are `AgentManagement`, `TransactionList`, `NetworkConnectionCard`, and `DeviceDetail`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing user/email remains tolerated, empty password fields still fail through existing required inputs or guard logic, and absent backup codes still copy an empty joined string only through the existing copy-all path.
- Boundary values: password mismatch and minimum length checks remain unchanged, setup verification still requires at least six characters, and disable/regenerate guards still require both password and token.
- System boundaries: `authApi.changePassword`, `twoFactorApi` payload shapes, clipboard utility calls, modal prop names, and `components/Account` exports remain unchanged.
- Async/race behavior: password success and copied-code timers still clear their visible state after the same 3000 ms and 2000 ms delays; loading flags still reset in `finally` blocks.
- Diff review: changes are scoped to Account controller/view/helper extraction, one branch test, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 3 - Theme Section

Status: complete

Goal: batch the current ThemeSection lizard cluster by reducing `AppearanceTab` and `BackgroundsPanel` complexity without changing theme selection, background search/category/favorite behavior, seasonal background toggles, per-season configuration, visual settings, or public exports.

## Lizard UI Batch 3 Checklist

- [x] Confirm pushed BlockVisualizer CI status and clean local baseline.
- [x] Inspect current top lizard targets and ThemeSection test coverage.
- [x] Split AppearanceTab data/controller/view helpers while preserving the public import path.
- [x] Split BackgroundsPanel search, category, grid, and seasonal rendering/helpers while preserving behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 3 Review

Changes:

- Reduced `components/Settings/sections/ThemeSection/AppearanceTab.tsx` to a 9-line public wrapper and moved preference derivation, theme/background mapping, favorite toggles, and seasonal updates into focused modules under `components/Settings/sections/ThemeSection/AppearanceTab/`.
- Reduced `components/Settings/sections/ThemeSection/panels/BackgroundsPanel.tsx` to a 21-line public wrapper and moved category filtering, search filtering, counts, tile view models, seasonal toggle state, and seasonal rows into focused modules under `components/Settings/sections/ThemeSection/panels/BackgroundsPanel/`.
- Preserved public `AppearanceTab` and `BackgroundsPanel` exports plus theme selection, background selection, favorites, search clear, category empty states, seasonal enable/disable, and per-season background updates.
- Updated the health assessment and grade history: full lizard warnings moved from 96 to 94, and `AppearanceTab` plus `BackgroundsPanel` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/Settings/sections/ThemeSection/AppearanceTab.branches.test.tsx tests/components/Settings/sections/ThemeSection/panels/BackgroundsPanel.branches.test.tsx tests/components/ThemeSection.test.tsx` passed: 3 files, 10 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Settings/sections/ThemeSection/AppearanceTab.tsx components/Settings/sections/ThemeSection/AppearanceTab components/Settings/sections/ThemeSection/panels/BackgroundsPanel.tsx components/Settings/sections/ThemeSection/panels/BackgroundsPanel` passed with no warnings.
- Full lizard warning count is now 94; top remaining component targets are `Account`, `AgentManagement`, `TransactionList`, and `NetworkConnectionCard`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing user preferences still fall back to `sanctuary`, `zen`, non-dark mode, empty favorites, and default visual settings; missing seasonal maps still use registry defaults; empty favorites/search/category states still render the same messages.
- Boundary values: category counts still exclude favorite IDs that are not available backgrounds, opacity/contrast values pass through unchanged, and the seasonal toggle still falls back to `minimal` when disabling the current seasonal background.
- System boundaries: public ThemeSection exports, panel props, user preference update shapes, theme registry calls, and icon mapping calls remain unchanged.
- Async/race behavior: this batch does not add async work; state changes remain local React state updates or existing `updatePreferences` calls.
- Diff review: changes are scoped to ThemeSection controller/view/helper extraction, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 2 - Block Visualizer

Status: complete

Goal: batch the current BlockVisualizer lizard cluster by reducing `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, and `PendingTxDot` complexity without changing mempool/confirmed block ordering, queued/stuck transaction display, explorer links, animation timing, compact layout, or public exports.

## Lizard UI Batch 2 Checklist

- [x] Confirm pushed Labels/Notifications CI status and clean local baseline.
- [x] Inspect current top lizard targets and BlockVisualizer test coverage.
- [x] Split BlockVisualizer orchestration/rendering while preserving public import paths.
- [x] Split Block, queued-summary, and pending-dot rendering/helpers while preserving behavior.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 2 Review

Changes:

- Reduced `components/BlockVisualizer/BlockVisualizer.tsx` to a 24-line public wrapper and moved block animation state, pending/confirmed splitting, explorer navigation, and queue-summary selection into focused modules under `components/BlockVisualizer/BlockVisualizer/`.
- Reduced `components/BlockVisualizer/Block.tsx` to a 10-line public wrapper and moved block view-model formatting, pending-transaction dot limits, fullness rendering, and tooltip rendering into focused modules under `components/BlockVisualizer/Block/`.
- Split `components/BlockVisualizer/QueuedSummaryBlock.tsx` and `components/BlockVisualizer/PendingTxDot.tsx` into small entrypoints plus view/helper modules while preserving explorer links, stuck transaction indicators, compact rendering, and public imports.
- Updated the health assessment and grade history: full lizard warnings moved from 100 to 96, and `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, and `PendingTxDot` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/BlockVisualizer/BlockVisualizer.branches.test.tsx tests/components/BlockVisualizer/Block.test.tsx tests/components/BlockVisualizer/QueuedSummaryBlock.test.tsx tests/components/BlockVisualizer/PendingTxDot.test.tsx tests/components/BlockVisualizer/blockUtils.test.ts` passed: 5 files, 38 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/BlockVisualizer/BlockVisualizer.tsx components/BlockVisualizer/BlockVisualizer components/BlockVisualizer/Block.tsx components/BlockVisualizer/Block components/BlockVisualizer/QueuedSummaryBlock.tsx components/BlockVisualizer/QueuedSummaryBlock components/BlockVisualizer/PendingTxDot.tsx components/BlockVisualizer/PendingTxDot` passed with no warnings.
- Full lizard warning count is now 96; top remaining component targets are `AppearanceTab`, `Account`, `AgentManagement`, and `TransactionList`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing blocks still show the loading state, absent queued summaries still render only when stuck transactions exist, optional pending transaction arrays still default empty, and absent recipient previews still omit the tooltip recipient row.
- Boundary values: pending dot overflow still uses compact/non-compact limits of 3/5, block fullness remains capped at 100%, median fees below 1 sat/vB keep one decimal, and pending mempool block indices still count from the newest displayed pending block.
- System boundaries: public `BlockVisualizer`, `Block`, `QueuedSummaryBlock`, and `PendingTxDot` import paths and prop contracts remain unchanged; explorer URLs still target block, mempool-block, and transaction routes.
- Async/race behavior: block animation timeouts still clear on unmount and before new animations, and delayed display-block swaps still reset animation flags.
- Diff review: changes are scoped to BlockVisualizer controller/view/helper extraction, health-report notes, trend metadata, and this task record.

## Previous Task: Lizard UI Batch 1 - Labels And Notifications

Status: complete

Goal: batch the next top UI lizard findings by reducing `LabelManager`, `NotificationToast`, and `NotificationPanel`/`NotificationItem` complexity without changing label CRUD behavior, toast timing/styles, notification sorting/navigation, panel dismissal, or public exports.

## Lizard UI Batch 1 Checklist

- [x] Confirm pushed SendTransactionPage CI status and local baseline.
- [x] Inspect current top lizard targets and focused test coverage.
- [x] Split LabelManager into controller/view modules while preserving the public import path.
- [x] Split notification toast/panel helpers and item views while preserving public exports.
- [x] Run focused tests, typecheck/lint, lizard, coverage, and quality guardrails.
- [x] Update health/grade tracking and commit/push the batch after verification.

## Lizard UI Batch 1 Review

Changes:

- Reduced `components/LabelManager.tsx` to a 10-line public wrapper and moved label CRUD state, mutation error handling, delete confirmation, and form behavior into focused controller/view modules under `components/LabelManager/`.
- Reduced `components/NotificationToast.tsx` to the public toast/container exports and moved toast dismiss timing plus icon/color selection into focused modules under `components/NotificationToast/`.
- Split `components/NotificationPanel.tsx` into a small public panel/bell entrypoint, a controller hook, frame/content rendering, item rendering, and notification helper rules under `components/NotificationPanel/`.
- Preserved public import paths and exports for `LabelManager`, `NotificationToast`, `NotificationContainer`, `generateNotificationId`, `NotificationPanel`, and `NotificationBell`.
- Updated the health assessment and grade history: full lizard warnings moved from 104 to 100, and `LabelManager`, `NotificationToast`, `NotificationPanel`, and `NotificationItem` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/LabelManager.test.tsx tests/components/NotificationToast.test.tsx tests/components/NotificationToast.branches.test.tsx tests/components/NotificationPanel.test.tsx tests/components/NotificationPanel.branches.test.tsx` passed: 5 files, 95 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/LabelManager.tsx components/LabelManager components/NotificationToast.tsx components/NotificationToast components/NotificationPanel.tsx components/NotificationPanel` passed with no warnings.
- Full lizard warning count is now 100; top remaining component targets are `BlockVisualizer`, `AppearanceTab`, `Account`, and `AgentManagement`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent label data still renders an empty list, optional label descriptions/counts remain conditional, empty toast messages still omit message copy, and empty notification panels still render the "All caught up!" state.
- Boundary values: toast overflow still uses the four-notification visible limit and singular/plural hidden count wording; notification bell count still caps at `9+`; label save remains disabled for trimmed blank names.
- System boundaries: public component entrypoints, notification IDs, notification navigation state, label hook calls, and toast dismiss timing remain unchanged.
- Async/race behavior: toast exit timers still clean up on repeated dismiss/unmount, auto-dismiss timers still clear on unmount, and notification panel outside-click/Escape listeners still register only while open.
- Diff review: changes are scoped to label and notification presentation/controller extraction, health-report notes, trend metadata, and this task record.

## Previous Task: SendTransactionPage Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the current top high-CCN send transaction page without changing wallet loading, draft resume, preselected UTXO, viewer redirect, device matching, fee, mempool, or wizard behavior.

## SendTransactionPage Complexity Checklist

- [x] Confirm pushed LabelSelector CI status and local baseline.
- [x] Inspect current top lizard targets and SendTransactionPage test coverage.
- [x] Split SendTransactionPage into focused controller/helper/view modules while preserving the public import path and exports.
- [x] Run focused tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update health/grade tracking and commit the change after verification.

## SendTransactionPage Complexity Review

Changes:

- Reduced `components/send/SendTransactionPage.tsx` to a 48-line public wrapper that chooses loading, error, and wizard render states.
- Added focused modules under `components/send/SendTransactionPage/` for loading/error views, route/controller orchestration, API loading, shared page types, and formatting/draft/preselected-UTXO helpers.
- Preserved viewer redirect, wallet formatting, fee formatting, UTXO mapping, mempool fallback, address mapping, wallet-device association and descriptor-fingerprint matching, draft resume, RBF selected-UTXO preservation, unavailable-UTXO warnings, preselected frozen-UTXO removal, and wizard props.
- Updated the health assessment and grade history: full lizard warnings moved from 105 to 104, and `SendTransactionPage` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/send/SendTransactionPage.test.tsx tests/components/send/SendTransactionPage.branches.test.tsx` passed: 2 files, 32 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/send/SendTransactionPage.tsx components/send/SendTransactionPage` passed with no warnings.
- Full lizard warning count is now 104; top remaining component targets are `LabelManager`, `NotificationToast`, `NotificationItem`, and `BlockVisualizer`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: absent user/id still avoids API fetches; empty/failed mempool, address, and device calls preserve fallback arrays/nulls; empty address data still skips label lookup addresses.
- Boundary values: minimum fee fallback remains `1`; preselected frozen-UTXO warnings still use singular/plural wording; all-frozen preselection leaves initial state empty.
- System boundaries: public `SendTransactionPage` import path, wizard prop names, API modules, route state shape, and transaction state serialization shape are unchanged.
- Async/race behavior: unmount during parallel requests still avoids setting page data after the mounted guard flips false.
- Diff review: changes are scoped to SendTransactionPage orchestration extraction, health-report notes, trend metadata, and this task record.

## Previous Task: LabelSelector Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the next tied high-CCN label selector component without changing label selection, creation, search, inline mode, or `LabelBadges` behavior.

## LabelSelector Complexity Checklist

- [x] Confirm pushed DraftList CI status and local baseline.
- [x] Inspect current top lizard targets and LabelSelector test coverage.
- [x] Split LabelSelector into focused controller/view modules while preserving the public import path and exports.
- [x] Run focused tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update review notes and commit the change.

## LabelSelector Complexity Review

Changes:

- Reduced `components/LabelSelector.tsx` to a 45-line public wrapper while preserving the default export, named export, `LabelBadges`, and public prop types.
- Added focused modules under `components/LabelSelector/` for dropdown rendering, inline rendering, reusable label chips, badges, controller state, and shared types.
- Preserved label selection/removal, search, create-label form behavior, outside-click close behavior, disabled state handling, inline mode behavior, and `LabelBadges` truncation behavior.
- Updated the health assessment and grade history: full lizard warnings moved from 106 to 105, and `LabelSelector` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/LabelSelector.test.tsx` passed: 1 file, 43 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/LabelSelector.tsx components/LabelSelector` passed with no warnings.
- Full lizard warning count is now 105; top remaining component targets are `SendTransactionPage`, `LabelManager`, `NotificationToast`, and `NotificationItem`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: `LabelBadges` still returns null for absent/empty labels; dropdown empty, loading, and search-no-results states remain covered.
- Boundary values: create-label still trims blank names, preserves Escape behavior, and handles create failures through the existing mutation path.
- System boundaries: public `LabelSelector` import path, props, exports, wallet-label hooks, and label type contracts are unchanged.
- Async/race behavior: outside-click cleanup, dropdown/input refs, and create mutation loading state remain isolated in the controller.
- Diff review: changes are scoped to LabelSelector presentation/controller extraction, health-report notes, trend metadata, and this task record.

## Previous Task: DraftList Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the current top high-CCN draft-list component without changing draft ordering, PSBT import/export behavior, or coverage thresholds.

## DraftList Complexity Checklist

- [x] Confirm the pushed TransactionRow slice started clean CI and inspect the next lizard target.
- [x] Extract DraftList sorting, PSBT parsing, download helpers, and controller logic into focused modules with low per-function CCN.
- [x] Run focused DraftList tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update health/grade tracking and commit the change after verification.

## DraftList Complexity Review

Changes:

- Reduced `components/DraftList/DraftList.tsx` to a 107-line render surface.
- Added `components/DraftList/draftListHelpers.ts` for expiration sorting, PSBT blob/filename helpers, signed-status selection, and PSBT file parsing.
- Added `components/DraftList/useDraftListController.ts` for draft loading, delete, resume, PSBT download/upload, address labeling, and expansion state.
- Preserved the existing DraftList public export and child component contracts.
- Updated the health assessment and grade history: full lizard warnings moved from 107 to 106, and `DraftList` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/DraftList.test.tsx tests/components/DraftList/DraftList.branches.test.tsx tests/components/DraftList/DraftRow.branches.test.tsx tests/components/DraftList/utils.branches.test.ts` passed: 4 files, 43 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DraftList/DraftList.tsx components/DraftList/draftListHelpers.ts components/DraftList/useDraftListController.ts` passed with no warnings.
- Full lizard warning count is now 106; top remaining component targets are `LabelSelector`, `LabelManager`, `SendTransactionPage`, and `NotificationToast`.
- `git diff --check`, grade-history JSONL parsing, large-file classification, and pinned gitleaks-only quality lane passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty draft lists, absent expiration, absent wallet labels, missing draft upload targets, and optional signed PSBT fallback behavior remain covered.
- Boundary values: expiration ordering still covers expired, critical, warning, normal, and no-expiration drafts; binary/base64/hex/invalid PSBT upload paths remain covered.
- System boundaries: public `DraftList` export, props, row callbacks, API calls, and download behavior are unchanged.
- Async/race behavior: load/delete/upload still go through `useLoadingState`; file upload still reloads drafts only after a non-null operation result.
- Diff review: changes are scoped to DraftList orchestration extraction, helper reuse, health-report notes, trend metadata, and this task record.

## Previous Task: TransactionRow Complexity Reduction

Status: complete

Goal: continue the maintainability roadmap by reducing the next high-CCN transaction-list component without changing row behavior or weakening coverage gates.

## TransactionRow Complexity Checklist

- [x] Confirm pushed grade-improvements CI status and local baseline.
- [x] Inspect current top lizard targets and TransactionRow test coverage.
- [x] Split TransactionRow into focused row/cell modules while preserving the public import path.
- [x] Run focused tests, typecheck/lint, lizard, and coverage as needed.
- [x] Update review notes and commit the change.

## TransactionRow Complexity Review

Changes:

- Kept `components/TransactionList/TransactionRow.tsx` as the public wrapper and reduced it to 52 lines.
- Added focused cell helpers under `components/TransactionList/TransactionRow/` for date, type, amount, balance, confirmation, labels, and wallet badge rendering.
- Added a branch test for the locked-without-draft-label fallback title that the split made visible to coverage.
- Updated the health assessment and grade history: full lizard warnings moved from 108 to 107, and `TransactionRow` dropped out of the current top lizard target list.

Verification:

- `npx vitest run tests/components/TransactionList/TransactionRow.branches.test.tsx tests/components/TransactionList.test.tsx` passed: 2 files, 37 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run test:coverage` passed: 396 files, 5,556 tests, 100% statements/branches/functions/lines.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionList/TransactionRow.tsx components/TransactionList/TransactionRow` passed with no warnings.
- Full lizard warning count is now 107; top remaining component targets are `DraftList`, `LabelSelector`, `LabelManager`, and `SendTransactionPage`.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: row behavior still covers pending timestamps, empty labels, absent balance columns, absent wallet badges, and missing draft labels.
- Boundary values: confirmation branches still cover pending, partial, threshold, and deep-confirmed states.
- System boundaries: public import path and `TransactionRow` props are unchanged for `TransactionList`.
- Async/race behavior: unchanged; row rendering remains synchronous and callback-driven.
- Diff review: changes are scoped to TransactionRow presentation extraction, one focused branch test, health-report notes, trend metadata, and this task record.

## Previous Task: Grade Improvements 3-5

Status: complete

Goal: after pushing the large-file gate fix, address the next grade improvement set: reduce complexity debt, improve warning-band file-size pressure where practical, and make gitleaks grading more reproducible.

## Grade Improvements 3-5 Checklist

- [x] Push the agent repository large-file gate fix.
- [x] Inspect top lizard complexity targets and warning-band file-size targets.
- [x] Inspect current gitleaks availability/tooling path.
- [x] Implement the smallest safe improvement that advances items 3-5.
- [x] Run focused verification and update review notes.

## Grade Improvements 3-5 Review

Changes:

- Split `components/WalletStats.tsx` into a 52-line wrapper plus focused summary-card, chart, and data-helper modules under `components/WalletStats/`.
- Moved dashboard repository aggregation tests from `server/tests/unit/repositories/agentRepository.test.ts` into `server/tests/unit/repositories/agentDashboardRepository.test.ts`, reducing `agentRepository.test.ts` from 890 lines to 724 lines.
- Added pinned gitleaks resolution/bootstrap to `scripts/quality.sh` using `GITLEAKS_VERSION=8.30.1` and `.tmp/quality-tools/gitleaks-8.30.1/gitleaks`, while preserving explicit `GITLEAKS_BIN`.
- Confirmed the pushed large-file fix has Build Dev Images, Release, and Install Tests green; Test Suite was still in progress during local remediation.

Verification:

- `npx vitest run tests/components/WalletStats.test.tsx` passed: 23 tests.
- `npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/agentDashboardRepository.test.ts` passed: 2 files, 13 tests.
- `npm run test:coverage` passed: 396 files, 5,555 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed: 390 files passed, 22 skipped; 9,151 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run typecheck:app` and `npm run typecheck:server:tests` passed.
- `npm run lint:app` and `npm run lint:server` passed.
- `bash -n scripts/quality.sh` passed.
- `QUALITY_SKIP_* ... QUALITY_BOOTSTRAP_TOOLS=0 npm run quality` passed the gitleaks-only lane through the pinned `.tmp/quality-tools/gitleaks-8.30.1/gitleaks` path.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletStats.tsx components/WalletStats ...` passed for the touched files; full lizard warning count moved from 110 to 108 and max CCN from 67 to 65.
- `node scripts/quality/check-large-files.mjs` passed with warning-band files reduced to 9.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: WalletStats still handles empty UTXOs, empty transactions, missing UTXO dates, null fiat values, and missing BTC price through existing tests.
- Boundary values: UTXO age buckets still cover `< 1m`, `1-6m`, `6-12m`, and `> 1y`; accumulation history still keeps the last balance per display date.
- System boundaries: dashboard repository behavior is unchanged; tests now import the dashboard repository directly while `agentRepository.findDashboardRows` remains exported for callers.
- Async/race behavior: chart rendering still waits on `useDelayedRender`; gitleaks tooling resolution is synchronous before scans start.
- Diff review: changes are scoped to the WalletStats split, dashboard test relocation, pinned gitleaks quality tooling, health-report notes, and this task record.

## Previous Task: Agent Repository Large File Remediation

Status: complete

Goal: fix the large-file quality gate by reducing `server/src/repositories/agentRepository.ts` below the 1,000-line limit without weakening the policy or changing agent dashboard behavior.

## Agent Repository Large File Checklist

- [x] Inspect large-file policy and agent repository dashboard responsibilities.
- [x] Extract dashboard read-model code into a focused repository module while preserving existing public imports.
- [x] Run focused agent repository/API tests and quality gates.
- [x] Update task notes and self-review the diff.

## Agent Repository Large File Review

Changes:

- Extracted admin agent dashboard read-model assembly from `server/src/repositories/agentRepository.ts` into `server/src/repositories/agentDashboardRepository.ts`.
- Preserved `agentRepository.findDashboardRows` and the existing dashboard type exports for current callers.
- Reduced `server/src/repositories/agentRepository.ts` from 1,006 lines to 720 lines; the new dashboard repository is 354 lines.
- Added a focused dashboard default test for the missing wallet-balance aggregate row branch so backend coverage stays at 100%.
- Updated the health assessment and grade history to reflect that the large-file policy is green again.

Verification:

- `npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/agent/dto.test.ts` passed: 3 files, 34 tests.
- `npm run test:backend:coverage` passed outside the sandbox: 389 files passed, 22 skipped; 9,151 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run lint:server` passed, including `check:api-body-validation`.
- `npm run typecheck:server:tests` passed.
- `npm run check:architecture-boundaries` passed.
- `node scripts/quality/check-large-files.mjs` passed.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w server/src/repositories/agentDashboardRepository.ts` passed with no warnings.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: dashboard aggregation still short-circuits with no agents; absent balance/count/recent rows default to zero, null, or empty arrays.
- Boundary values: `DASHBOARD_RECENT_LIMIT` remains unchanged at 3; pending draft statuses remain `unsigned`, `partial`, and `signed`.
- System boundaries: raw SQL remains Prisma-tagged and parameterized; no route, DTO, or service API changed.
- Async/race behavior: dashboard aggregation still runs independent grouped/windowed reads in one `Promise.all` and does not introduce shared mutable state.
- Diff review: changes are scoped to dashboard repository extraction, one focused branch test, health-report status, trend metadata, and this task record.

## Previous Task: Full Repository Quality Grade

Status: complete

Goal: run the `$grade` skill against the repository at HEAD, update `docs/plans/codebase-health-assessment.md` with evidence-backed ISO/IEC 25010 scores, and record trend history without changing unrelated code.

## Full Repository Quality Grade Checklist

- [x] Confirm repository state, audit mode, and grading standards.
- [x] Run the grade skill's mechanical signal collectors.
- [x] Inspect targeted files for judged reliability, maintainability, security, performance, test-quality, and operational-readiness criteria.
- [x] Write/update the health assessment report and trend entry.
- [x] Verify the report, task notes, and final workspace state.

## Full Repository Quality Grade Review

Changes:

- Updated `docs/plans/codebase-health-assessment.md` with a full-mode ISO/IEC 25010-aligned grade for commit `d43680aa`.
- Appended the 2026-04-19 full-mode trend entry to `docs/plans/grade-history/sanctuary_.jsonl`.
- Recorded the current score as `92/100`, grade `A`, confidence `High`.

Verification:

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed with tests, lint, typecheck, and heuristic signals.
- `npm run test:coverage` passed with 100% app statements, branches, functions, and lines.
- `npm run test:backend:coverage` passed outside the sandbox with 100% backend statements, branches, functions, and lines after the sandbox run failed with `listen EPERM`.
- `npm run test:coverage` in `gateway` passed outside the sandbox with 100% gateway statements, branches, functions, and lines after the sandbox run failed with `listen EPERM`.
- `npm audit --json`, `npm --prefix server audit --json`, `npm --prefix gateway audit --json`, and `npm --prefix ai-proxy audit --json` found 0 high/critical advisories.
- `gitleaks` completed clean after normalizing a prior grade-history metadata value to the documented schema.
- `lizard` reported 110 CCN warnings, average CCN 1.4, and max CCN 67.
- `jscpd` reported 2.1% duplication.
- `npm run check:architecture-boundaries`, `npm run check:browser-auth-contract`, and `npm run check:openapi-route-coverage` passed.
- `node scripts/quality/check-large-files.mjs` failed on unclassified oversized `server/src/repositories/agentRepository.ts`.

Edge case and self-review:

- Null/undefined and empty inputs: judged validation and tests include request schema parsing, runtime config bounds, null/default schema cases, and empty-state behavior across sampled app/server/gateway tests.
- Boundary values: coverage gates are back at the repository's 100% threshold; config schemas constrain ports, retry counts, timeouts, and batch sizes.
- System boundaries: audits cover dependency advisories, clean gitleaks secret scanning, trust-boundary validation, browser auth contracts, OpenAPI route coverage, and architecture boundaries.
- Async/race behavior: request timeout, retry/backoff, async utility, and local listener behavior were checked; backend/gateway coverage needed non-sandbox execution for `supertest` listener permissions.
- Diff review: changes are scoped to grade documentation, trend history, and this task record.

## Previous Task: GitHub Actions Node 20 Annotation Cleanup

Status: complete

Goal: remove the GitHub Actions Node.js 20 deprecation annotation by updating the changed-files action to a Node.js 24-compatible release without changing CI lane behavior.

## GitHub Actions Node 20 Annotation Checklist

- [x] Confirm the annotation source and current workflow usage.
- [x] Verify the upstream `dorny/paths-filter` release that runs on Node.js 24.
- [x] Patch `.github/workflows/test.yml` with the smallest compatible action update.
- [x] Validate workflow diff, commit, push, and verify the new CI run.

## GitHub Actions Node 20 Annotation Review

Changes:

- Confirmed the only Node.js 20 annotation source in this repository was `dorny/paths-filter@v3` in `.github/workflows/test.yml`.
- Verified upstream `dorny/paths-filter` has a v4 release line and that `v4` declares `runs.using: node24`.
- Updated the changed-files detection step from `dorny/paths-filter@v3` to `dorny/paths-filter@v4` without changing filters, outputs, permissions, or job gating logic.

Verification:

- `git diff --check` passed.
- Parsed `.github/workflows/test.yml` with the repository's existing `js-yaml` dependency.
- Confirmed there are no remaining `dorny/paths-filter@v3` references under `.github`.

Edge case and self-review:

- Null/empty inputs: workflow filter definitions and outputs are unchanged, so empty changed-file sets still follow the existing `false` output behavior.
- Boundary values: PR and push event gating remains unchanged; scheduled runs still skip `detect-changes` through the existing job `if`.
- System boundaries: no test commands, permissions, or checkout behavior changed; only the action runtime provider moved to the Node.js 24-compatible major version.
- Diff review: changes are scoped to the one workflow action version and this task record.

## Previous Task: GitHub Permission Failure CI Fix

Status: complete

Goal: fix the failing GitHub Actions E2E run that presents as missing permissions by addressing the render-regression screenshots where primary controls paint white-on-white before theme utilities are ready.

## GitHub Permission Failure Checklist

- [x] Inspect the failing GitHub Actions run and confirm the actual failing job/log lines.
- [x] Patch the render regression path so screenshots wait for theme variables and Tailwind theme utilities.
- [x] Run targeted local validation for the render regression suite and relevant static checks.
- [x] Commit, push, and verify the new GitHub run.

## GitHub Permission Failure Review

Changes:

- Confirmed the failing GitHub job was `Full E2E Tests`, specifically Chromium render-regression screenshots where primary controls rendered white-on-white.
- Fixed the Tailwind CDN load path so the project config is retained after the CDN script replaces `window.tailwind`, and pinned the CDN URL to the v3.4.17 runtime the unversioned URL already redirects to.
- Added a render-regression readiness gate that waits for theme CSS variables, a `theme-*` body class, and a generated `bg-primary-800` utility before taking Chromium screenshots.

Verification:

- One-off browser runtime inspection confirmed `window.tailwind.config` now contains the custom `primary` color config and generated CSS includes custom theme utilities.
- `npm run test:e2e:render` passed: 43 Chromium render-regression tests.
- `npm run typecheck:tests` passed.
- `npm run build` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and missing DOM state: the screenshot readiness gate returns false until `document.body`, theme variables, theme class, and the probe element exist.
- Async/race behavior: the probe stays mounted long enough for Tailwind CDN's mutation observer to generate the class, is removed in a `finally` block, and screenshots wait two animation frames after readiness.
- System boundaries: the fix does not change wallet permissions, API auth, or role data; it restores theme utility generation and makes visual assertions wait for the same styling state users see.
- Diff review: changes are scoped to Tailwind CDN config loading, visual-regression readiness, and this task record.

## Previous Task: Restore 100% Coverage Gates

Status: complete

Goal: make the app, backend, and gateway coverage commands exit cleanly at the repository's 100% global thresholds without weakening the coverage policy.

## Restore 100% Coverage Checklist

- [x] Inspect exact uncovered app/backend statements, functions, and branches from current coverage artifacts.
- [x] Add the smallest focused tests or narrow justified coverage annotations for legitimate unreachable fallback branches.
- [x] Run app, backend, and gateway coverage commands until all pass.
- [x] Run final quality, edge case, and self-review, then update this review section.

## Restore 100% Coverage Review

Changes:

- Added focused app tests for formatter fallbacks, owner override load/create/revoke failures, import QR guard behavior, device preference defaults, node config control fallbacks, receive modal helpers, wallet draft notifications, and zero-pending balance display.
- Added backend tests for agent destination classification modes, known-address ownership lookups, metadata formatting, Telegram operational-spend copy, address repository dedupe/empty input behavior, and admin agent creator defaults.
- Simplified two legitimate dead/fallback coverage points: gateway audit fire-and-forget now relies on the sender's internal catch, and destination classification now documents the established non-empty current-output invariant with an explicit defensive guard.
- Added narrow `v8 ignore` annotations only for UI-disabled guards and async unmount race guards that are intentionally retained for defensive correctness.

Verification:

- `npm run test:coverage` passed: 396 app test files, 5555 tests, 100% statements/branches/functions/lines.
- `npm run test:backend:coverage` passed: 380 backend test files passed, 22 skipped; 9096 tests passed, 503 skipped; 100% statements/branches/functions/lines.
- `npm run test:coverage` passed in `gateway`: 20 gateway test files, 513 tests, 100% statements/branches/functions/lines.
- `npm run lint:app` passed.
- `npm run lint:server` passed, including `check:api-body-validation`.
- `npm run lint:gateway` passed.
- `npm run typecheck:app` passed.
- `npm run typecheck:tests` passed.
- `npm run typecheck:server:tests` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: covered null user preferences, undefined wallet IDs, null shared users, missing receive candidates, null transaction outputs, empty address lists, and missing operational-spend metadata.
- Boundary values: covered zero pending balance, invalid bigint formatter input, absent alert limits, all unknown-destination handling modes, and QR import data that is present but not yet scanned.
- System boundaries: backend classification still derives from persisted transaction details and known wallet address ownership; notification formatting remains informational and does not sign, approve, or broadcast.
- Async/race behavior: unmount guards for device loading, node config loading, and Payjoin URI loading remain intact; gateway audit dispatch remains fire-and-forget with errors handled inside the sender.
- Diff review: changes are scoped to coverage tests, two small invariant simplifications, and explicit annotations for retained defensive guards. Existing grade-report files remain modified from the prior `$grade` work and were not reverted.

## Previous Task: Agent Wallet Funding Phase 16

Status: complete

Goal: close the remaining Phase 16 monitoring and client follow-up from `tasks/agent-wallet-funding-plan.md` without weakening the security boundary that Sanctuary coordinates, not signs or broadcasts, agent wallet activity.

## Agent Wallet Funding Phase 16 Checklist

- [x] Inspect operational-wallet alert classification, Agent Wallets dashboard alert history, notification copy, and mobile review API/client-test surface.
- [x] Add operational-wallet destination classification for external spend, known self-transfer, change-like movement, and unknown destination.
- [x] Add configured unknown-destination handling mode to alert evaluation: notify only, pause agent, or both.
- [x] Surface destination classifications in Agent Wallets dashboard detail and alert history.
- [x] Preserve notification security boundaries for web/mobile review links and multisig signing requirements.
- [x] Add available server/API/component tests now, and document mobile/deep-link tests that depend on a future client package.
- [x] Run final quality, edge case, and self-review, then update `tasks/agent-wallet-funding-plan.md`.

## Agent Wallet Funding Phase 16 Review

Changes:

- Added operational destination classification for external spend, known self-transfer, change-like movement, and unknown destination using persisted transaction outputs, counterparty metadata, and known Sanctuary wallet address ownership.
- Added `operational_destination_unknown` alerts with destination metadata, dedupe by txid, and per-agent handling metadata for notify-only, pause-agent, notify-and-pause, and record-only states.
- Changed operational spend pausing so pause-only agents can pause on unknown destinations even when notifications are disabled, while notifications still only enrich agents with `notifyOnOperationalSpend`.
- Added audit detail for agent policy updates, including the derived unknown-destination handling mode.
- Surfaced destination classification and handling mode in the Agent Wallets dashboard spend details and alert history.
- Added Telegram operational-spend destination/handling copy and an explicit review-only security boundary: Sanctuary does not sign or broadcast operational wallet spends.
- Documented mobile/deep-link client tests as future work because this workspace has no mobile client package yet; existing server mobile review API tests remain in place.

Verification:

- `npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/formatting.test.ts` passed in `server`: 5 files, 60 tests.
- `npm run test:unit` passed in `server`: 372 files, 8999 tests.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx` passed: 1 file, 5 tests.
- `npm run build` passed in `server`.
- `npm run typecheck:server:tests` passed.
- `npm run typecheck:app` passed.
- `npm run typecheck:tests` passed.
- `npm run lint:app` passed.
- `npm run lint:server` passed, including API body validation.
- `npm run check:architecture-boundaries` passed.
- `npm run check:prisma-imports` passed in `server`.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing transaction rows, empty outputs, blank output addresses, missing counterparty addresses, no sent transactions, and wallets without active agents now no-op or classify as unknown destination without throwing.
- Boundary values: positive and negative sent amounts still normalize to outgoing spend amounts; zero or unset alert thresholds remain disabled; unknown alerts dedupe by txid across retries.
- System boundaries: classification reads stored outputs/address ownership only; notifications do not sign, approve, or broadcast; mobile review remains server/API-only until a client exists.
- Async/race behavior: alert evaluation remains best-effort and returns policy evaluations for notification enrichment/pause decisions; pause failures are logged without blocking notification dispatch.
- Diff review: changes are scoped to agent monitoring, notification enrichment, dashboard display, policy-audit metadata, and focused tests. The Phase 16 mobile/deep-link client checks are explicitly documented as future dependencies because no mobile app package is present in this repository.

## Previous Task: AccessTab CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/WalletDetail/tabs/AccessTab.tsx` at CCN 69, without changing wallet access display, owner/admin actions, sharing controls, transfer controls, or pending-transfer integration.

## AccessTab Checklist

- [x] Inspect AccessTab structure, wallet access helpers, and focused WalletDetail/access tests.
- [x] Extract access metadata, owner/admin action rendering, sharing sections, and transfer integration into focused modules.
- [x] Run focused AccessTab/WalletDetail tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## AccessTab Review

Changes:

- Replaced the render-heavy `components/WalletDetail/tabs/AccessTab.tsx` body with a small orchestrator that keeps the public props and parent `WalletDetail` contract unchanged.
- Added `components/WalletDetail/tabs/access/accessTabData.ts` for tab constants, owner display fallback data, shared-user filtering, and shared-access checks.
- Added focused ownership, sharing, user-search, shared-access-list, sub-tab, and transfers components under `components/WalletDetail/tabs/access/`.
- Preserved the legacy fallback where missing owner/user data renders owner name `You` but avatar initial `U`.
- Reduced `components/WalletDetail/tabs/AccessTab.tsx` from CCN 69 to no focused warning, with all new access modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/tabs/AccessTab.tsx components/WalletDetail/tabs/access` passed with no warnings.
- `npx vitest run tests/components/WalletDetail/tabs/AccessTab.test.tsx` passed: 1 file, 10 tests.
- `npx vitest run tests/components/WalletDetail/tabs` passed: 13 files, 131 tests.
- `npm run typecheck:app` passed.
- `npm run lint:app` passed.
- `npm run check:architecture-boundaries` passed.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing `walletShareInfo`, missing owner rows, missing current user, empty shared users, and absent groups preserve the previous ownership and empty-sharing fallbacks.
- Boundary values: owner-only controls remain hidden for non-owners; selected group controls still render role buttons only when a group is selected; user search loading and empty result states are unchanged.
- System boundaries: `PendingTransfersPanel`, wallet share callbacks, group/user role update callbacks, and transfer completion callback contracts are unchanged.
- Async/race behavior: no async behavior moved into the new components; loading flags still only disable the same sharing buttons/selects.
- Diff review: changes are local to AccessTab rendering decomposition and task tracking. The next tracked plan item is Agent Wallet Funding Phase 16 from `tasks/agent-wallet-funding-plan.md`.

## Previous Task: PendingTransfersPanel CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/PendingTransfersPanel.tsx` at CCN 73, without changing pending-transfer display, accept/reject actions, ownership transfer behavior, or loading/error states.

## PendingTransfersPanel Checklist

- [x] Inspect PendingTransfersPanel structure, transfer-card helpers, and focused transfer tests.
- [x] Extract transfer metadata formatting, accept/reject handlers, state sections, and card rendering into focused modules.
- [x] Run focused PendingTransfersPanel tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## PendingTransfersPanel Review

Changes:

- Replaced the legacy root `components/PendingTransfersPanel.tsx` implementation with a compatibility export to the existing split `components/PendingTransfersPanel/PendingTransfersPanel.tsx` implementation, preserving the public import path.
- Exported `PendingTransfersPanelProps` from the split panel so the root type export remains available.
- Added `transferCardData.ts`, `TransferDirection.tsx`, `TransferMessage.tsx`, `TransferTimestamp.tsx`, and `TransferCardActions.tsx` to separate transfer-card variant metadata, direction labels, message rendering, expiry/timestamp rendering, and action buttons.
- Reduced `components/PendingTransfersPanel.tsx` from CCN 73 to no focused warning, and cleared the related `TransferCard.tsx` CCN 35 warning under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/PendingTransfersPanel.tsx components/PendingTransfersPanel` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/PendingTransfersPanel.test.tsx tests/components/PendingTransfersPanel.branches.test.tsx tests/components/PendingTransfersPanel/PendingTransfersPanel.test.tsx tests/components/PendingTransfersPanel/TransferCard.test.tsx tests/components/PendingTransfersPanel/TransferConfirmationModal.test.tsx tests/components/PendingTransfersPanel/useTransferActions.test.ts tests/components/PendingTransfersPanel/transferTimeUtils.test.ts` passed: 7 files, 96 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing usernames, missing transfer messages, no active transfers, and optional `onTransferComplete` still follow the existing split implementation behavior; null messages remain hidden.
- Boundary values: accepted transfers still fall back from `acceptedAt` to `updatedAt`, expiry text still handles expired/hour/day cases through `transferTimeUtils`, and action loading still disables only the matching transfer.
- System boundaries: `transfersApi` calls, root `components/PendingTransfersPanel` imports, `useUser`, `useLoadingState`, and transfer completion callbacks are unchanged.
- Async/race behavior: action loading and error clearing still live in `useTransferActions`; successful accept/decline/cancel/confirm still refresh transfers and close the modal in the same places.
- Diff review: changes are local to PendingTransfersPanel rendering/export wiring and preserve the public `PendingTransfersPanel` export. The next highest remaining single-component warning is `components/WalletDetail/tabs/AccessTab.tsx` at CCN 69.

## Previous Task: DraftRow CCN Remediation

Status: complete

Goal: reduce one of the next tied component hotspots, `components/DraftList/DraftRow.tsx` at CCN 73, without changing draft status display, signing/resume actions, labels, or delete behavior.

## DraftRow Checklist

- [x] Inspect DraftRow structure, draft-list helpers, and focused DraftList tests.
- [x] Extract draft metadata formatting, status/action rendering, labels, and row action handlers into focused modules.
- [x] Run focused DraftList/DraftRow tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## DraftRow Review

Changes:

- Added `components/DraftList/draftRowData.ts` for row class selection, signature counts, agent-funding checks, PSBT control visibility, and PSBT file selection handling.
- Added `DraftStatusBadges.tsx`, `DraftRecipientSummary.tsx`, `DraftAmountSummary.tsx`, `DraftWarnings.tsx`, `DraftRowActions.tsx`, and `DraftFlowToggle.tsx` to split status/expiration badges, recipient/output rendering, amount/fee rendering, warning/agent/label sections, row actions, and flow preview toggle.
- Reduced `components/DraftList/DraftRow.tsx` from CCN 73 to no focused warning, with all extracted DraftRow modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DraftList/DraftRow.tsx components/DraftList/DraftStatusBadges.tsx components/DraftList/DraftRecipientSummary.tsx components/DraftList/DraftAmountSummary.tsx components/DraftList/DraftWarnings.tsx components/DraftList/DraftRowActions.tsx components/DraftList/DraftFlowToggle.tsx components/DraftList/draftRowData.ts` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/DraftList.test.tsx tests/components/DraftList/DraftRow.branches.test.tsx tests/components/DraftList/DraftList.branches.test.tsx tests/components/DraftList/utils.branches.test.ts` passed: 4 files, 43 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing outputs still fall back to `draft.recipient`; missing expiration info still renders no expiration badge; missing quorum still falls back to one required signature.
- Boundary values: partial signatures still show `0 of 1` or configured quorum counts; send-max outputs still show `MAX` without fiat; expired drafts still disable resume while keeping other row controls consistent.
- System boundaries: `getFlowPreviewData`, `getFeeWarning`, `getExpirationInfo`, `onResume`, `onDelete`, `onDownloadPsbt`, `onUploadPsbt`, and `onToggleExpand` contracts are unchanged.
- Async/race behavior: file-input change handling still calls upload at most once for a selected file and clears the input value; DraftList upload/delete/load flows were not changed.
- Diff review: changes are local to DraftRow rendering and keep the public `DraftRow` export unchanged. The next highest remaining single-component warning is `components/PendingTransfersPanel.tsx` at CCN 73.

## Previous Task: Send ReviewStep CCN Remediation

Status: complete

Goal: reduce the next highest remaining single-component hotspot, the anonymous review block in `components/send/steps/ReviewStep.tsx` at CCN 75, without changing transaction review, signing, file upload, or broadcast behavior.

## Send ReviewStep Checklist

- [x] Inspect ReviewStep structure, signing flow helpers, and focused send-step tests.
- [x] Extract review summary rendering, signing/file upload actions, PSBT display, and broadcast state sections into focused modules.
- [x] Run focused send/ReviewStep tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## Send ReviewStep Review

Changes:

- Added `components/send/steps/review/reviewStepData.ts` for address lookup inputs, change amount, known-address labels, transaction type labels, required signature calculation, broadcast gating, and flow-data assembly.
- Added `components/send/steps/review/useReviewAddressLookup.ts` to isolate wallet-label lookup side effects and lookup failure logging.
- Added `components/send/steps/review/useReviewStepUploads.ts` to isolate single-sig and per-device PSBT upload handling, input reset behavior, upload progress state, and error surfacing.
- Reduced `components/send/steps/ReviewStep.tsx` from focused warnings at CCN 75, 19, and 17 to no focused warning under the review-step `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/send/steps/ReviewStep.tsx components/send/steps/review/reviewStepData.ts components/send/steps/review/useReviewAddressLookup.ts components/send/steps/review/useReviewStepUploads.ts` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/send/ReviewStep.test.tsx tests/components/send/ReviewStep.branches.test.tsx tests/components/send/TransactionSummary.test.tsx tests/components/send/SigningFlow.test.tsx tests/components/send/steps/review/DraftActions.branches.test.tsx tests/components/send/steps/review/UsbSigning.branches.test.tsx` passed: 6 files, 71 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty output addresses still skip wallet-label lookup; missing txData still builds flow data from selected or spendable UTXOs; missing selected UTXO matches still fall back to empty address and zero amount.
- Boundary values: send-max outputs still zero change and use selected total minus fee; quorum `0` still falls back to `1`; multisig broadcast still requires the configured signature count; uploaded signed PSBT still enables broadcast through `psbt-signed`.
- System boundaries: `lookupAddresses`, `onUploadSignedPsbt`, `onSignWithDevice`, `onProcessQrSignedPsbt`, and child review component props are unchanged.
- Async/race behavior: lookup failures still log warnings without blocking render; upload progress still clears in `finally`; device file inputs and single-sig file inputs still reset after success, skip, or failure.
- Diff review: changes are local to the send review step and keep the public `ReviewStep` export unchanged. The next highest remaining warnings are tied: `components/DraftList/DraftRow.tsx` and `components/PendingTransfersPanel.tsx` at CCN 73.

## Previous Task: ReceiveModal CCN Remediation

Status: complete

Goal: reduce the next highest remaining single-component hotspot, `components/WalletDetail/modals/ReceiveModal.tsx` at CCN 81, without changing receive-address generation, QR display, copy behavior, or modal close behavior.

## ReceiveModal Checklist

- [x] Inspect ReceiveModal structure, wallet detail modal contracts, and focused modal tests.
- [x] Extract receive-address actions, QR rendering, address display, and empty/loading/error states into focused modules.
- [x] Run focused ReceiveModal/WalletDetail tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## ReceiveModal Review

Changes:

- Added `components/WalletDetail/modals/useReceiveModalState.ts` to isolate unused-address fetching, selected-address fallback, Payjoin status, Payjoin URI generation, copy handling, close reset, and settings navigation.
- Added `components/WalletDetail/modals/receiveModalData.ts` for unused receive-address filtering, fetch gating, selected-address fallback, Payjoin amount conversion, display labels, and copy/help text.
- Added `ReceiveModalContent.tsx`, `ReceiveAddressPanel.tsx`, `ReceiveQrCode.tsx`, `ReceiveAddressSelector.tsx`, `ReceiveAmountInput.tsx`, `ReceiveValueBox.tsx`, `ReceiveLoadingState.tsx`, and `ReceiveEmptyState.tsx` to split modal rendering into focused pieces.
- Reduced `components/WalletDetail/modals/ReceiveModal.tsx` from CCN 81 to no focused warning, with all extracted ReceiveModal modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/modals/ReceiveModal.tsx components/WalletDetail/modals/receiveModalData.ts components/WalletDetail/modals/useReceiveModalState.ts components/WalletDetail/modals/ReceiveQrCode.tsx components/WalletDetail/modals/ReceiveAddressSelector.tsx components/WalletDetail/modals/ReceiveAmountInput.tsx components/WalletDetail/modals/ReceiveValueBox.tsx components/WalletDetail/modals/ReceiveAddressPanel.tsx components/WalletDetail/modals/ReceiveLoadingState.tsx components/WalletDetail/modals/ReceiveEmptyState.tsx components/WalletDetail/modals/ReceiveModalContent.tsx` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/WalletDetail/modals/ReceiveModal.test.tsx tests/components/WalletDetail/WalletDetailModals.test.tsx` passed: 2 files, 46 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: empty address lists still show the settings empty state; missing selected IDs still fall back to the first unused receive address; missing address IDs still fall back to the raw address for Payjoin URI generation.
- Boundary values: all-used address lists still trigger one fetch attempt when a callback exists; fetch returning `[]` still shows the empty state; zero, negative, invalid, or empty Payjoin amounts still omit the amount option.
- System boundaries: `payjoinApi.getPayjoinStatus`, `payjoinApi.getPayjoinUri`, `useCopyToClipboard`, and `onFetchUnusedAddresses` contracts are unchanged.
- Async/race behavior: address exhaustion fetches still clear loading in `finally`, rejected fetches still land in the empty state, Payjoin status failures still hide Payjoin, and Payjoin URI generation now ignores late responses after dependency changes.
- Diff review: changes are local to ReceiveModal and keep the public `ReceiveModal` export unchanged.

## Previous Task: CreateWallet CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/CreateWallet/CreateWallet.tsx` at CCN 87, without changing wallet creation, signer selection, policy configuration, or review behavior.

## CreateWallet Checklist

- [x] Inspect CreateWallet structure, subcomponents, hooks, and focused tests.
- [x] Extract wallet creation flow state/actions, step rendering, validation helpers, and footer/progress rendering into focused modules.
- [x] Run focused CreateWallet tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## CreateWallet Review

Changes:

- Added `components/CreateWallet/useCreateWalletController.ts` to isolate device loading, wallet form state, navigation, signer toggling, wallet creation, and async error handling.
- Added `components/CreateWallet/createWalletData.ts` for device compatibility, display-account lookup, next-step validation, device-selection updates, continue-button gating, and wallet creation payload construction.
- Added `components/CreateWallet/CreateWalletProgress.tsx`, `CreateWalletStepContent.tsx`, and `CreateWalletFooter.tsx` so the public `CreateWallet` component coordinates the wizard only.
- Added `components/CreateWallet/SignerCompatibilityWarning.tsx`, `SignerDeviceCard.tsx`, `SignerSelectionMessages.tsx`, and `signerSelectionData.ts` to split signer warning, device-card, empty-state, hint, and label text rendering.
- Reduced `components/CreateWallet/CreateWallet.tsx` from CCN 87 to no focused warning, and cleared the related `SignerSelectionStep.tsx` CCN 21 warning under the focused CreateWallet `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/CreateWallet` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/CreateWallet.test.tsx tests/components/CreateWallet` passed: 5 files, 27 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: failed device loads still fall back to an empty list; missing wallet type still prevents step advancement and wallet creation; absent device accounts still use the legacy derivation-path compatibility check.
- Boundary values: zero selected signers still blocks step 2, one multisig signer still emits the existing validation error, single-sig selection still behaves like a radio button, and multisig selection still toggles devices on/off.
- System boundaries: `devicesApi.getDevices`, `useCreateWallet().mutateAsync`, `useErrorHandler`, and wallet creation payload fields remain unchanged.
- Async/race behavior: device loading now ignores late updates after unmount; submit state still clears in `finally`; create failures still log and route through `handleError`.
- Diff review: changes are local to CreateWallet and keep the public `CreateWallet`, step component, and type exports unchanged.

## Previous Task: TransactionActions CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/TransactionActions.tsx` at CCN 91, without changing transaction approval, broadcast, cancel, replace, or export behavior.

## TransactionActions Checklist

- [x] Inspect TransactionActions structure, API boundaries, and focused tests.
- [x] Extract transaction action state/handlers, status helpers, and rendering sections into focused modules.
- [x] Run focused TransactionActions tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## TransactionActions Review

Changes:

- Added `components/TransactionActions/useTransactionActions.ts` to isolate RBF status loading, RBF draft creation, CPFP creation, navigation, callback handling, and async error state.
- Added `components/TransactionActions/transactionActionsData.ts` for RBF draft payload construction, fallback RBF labels, CPFP success messages, and generic error-message mapping.
- Added `components/TransactionActions/TransactionActionsPanel.tsx` for success/error banners, action buttons, RBF current fee display, CPFP availability, and non-replaceable status reasons.
- Added `components/TransactionActions/TransactionActionModals.tsx`, `RBFModal.tsx`, `CPFPModal.tsx`, and `TransactionModalShared.tsx` to split modal composition and shared modal/info box structure.
- Reduced `components/TransactionActions.tsx` from CCN 91 to no focused warning, with all extracted TransactionActions modules clean under the focused `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/TransactionActions.tsx components/TransactionActions` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/TransactionActions.test.tsx` passed: 29 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: confirmed transactions still skip RBF checks and render null; missing optional `onActionComplete` still no-ops; non-replaceable RBF state still shows only the reason.
- Boundary values: RBF fee rate `0` still no-ops, missing `minNewFeeRate` still falls back to `0.1`, and CPFP target fee below `1` now stays guarded in the handler as well as the disabled button.
- System boundaries: `bitcoinApi.checkRBF`, `bitcoinApi.createRBFTransaction`, `bitcoinApi.createCPFPTransaction`, `transactionsApi.getTransaction`, and `draftsApi.createDraft` payload shapes are unchanged.
- Async/race behavior: RBF status still ignores late updates after unmount, processing flags still clear in `finally`, and RBF/CPFP error messages preserve the existing fallback behavior.
- Diff review: changes are local to TransactionActions and keep the public `TransactionActions` export unchanged.

## Previous Task: TelegramSection CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/Settings/sections/TelegramSection.tsx` at CCN 103, without changing Telegram bot configuration, recipient notification, or wallet override behavior.

## TelegramSection Checklist

- [x] Inspect TelegramSection structure, supporting settings tests, and notification/wallet override flows.
- [x] Extract Telegram status/data helpers, recipient actions, wallet override rendering, and section-level form rendering into focused modules.
- [x] Run focused settings/Telegram tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## TelegramSection Review

Changes:

- Added `components/Settings/sections/telegramSectionData.ts` for Telegram preference payload construction, wallet override preservation, chat ID success messages, and test/fetch result mapping.
- Added `components/Settings/sections/useTelegramSettings.ts` for bot token/chat ID form state, test/fetch/save/toggle actions, timeout cleanup, and error mapping.
- Added `components/Settings/sections/TelegramSectionPanel.tsx` for the Telegram notification UI sections: intro links, bot token field, chat ID field, result/error/success alerts, action buttons, enabled toggle, and per-wallet note.
- Reduced `components/Settings/sections/TelegramSection.tsx` from CCN 103 to no focused warning.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/Settings/sections/TelegramSection.tsx components/Settings/sections/TelegramSectionPanel.tsx components/Settings/sections/useTelegramSettings.ts components/Settings/sections/telegramSectionData.ts` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/Settings/sections/TelegramSection.branches.test.tsx tests/components/Settings.interactions.test.tsx tests/components/Settings.test.tsx tests/components/Settings/sections/NotificationsSection.branches.test.tsx` passed: 4 files, 16 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing token/chat ID guards still show the same messages; omitted Telegram wallet overrides still fall back to `{}`; unconfigured Telegram still disables the global toggle.
- Boundary values: repeated saves still clear the previous success timeout; unmount still clears the pending timeout; failed toggle still reverts the optimistic enabled state.
- System boundaries: `authApi.testTelegramConfig`, `authApi.fetchTelegramChatId`, and `updatePreferences` payload shape are unchanged.
- Async/race behavior: test/fetch/save/toggle loading flags still clear in `finally`, and API failures still route through `logError` with the original fallback messages.
- Diff review: changes are local to the Telegram settings section and keep the public `TelegramSettings` export unchanged.

## Previous Task: ImportWallet CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/ImportWallet/ImportWallet.tsx` at CCN 105, without changing wallet import behavior across descriptor, hardware, QR, and metadata flows.

## ImportWallet Checklist

- [x] Inspect ImportWallet structure, step modules, hooks, and focused tests.
- [x] Extract import-step state, derived summaries, completion handlers, and rendering decisions into focused ImportWallet-local modules.
- [x] Run focused ImportWallet tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## ImportWallet Review

Changes:

- Added `components/ImportWallet/useImportWalletActions.ts` to isolate validation, next/back navigation, hardware descriptor creation, import mutation, and import error mapping.
- Added `components/ImportWallet/ImportWalletProgress.tsx`, `components/ImportWallet/ImportWalletStepContent.tsx`, and `components/ImportWallet/ImportWalletFooter.tsx` so the top-level `ImportWallet` component coordinates hooks and layout only.
- Added `components/ImportWallet/steps/useDescriptorInputHandlers.ts` and `components/ImportWallet/steps/DescriptorInputSections.tsx` for file validation, paste validation, textarea rendering, JSON help, and validation error display.
- Added `components/ImportWallet/steps/useHardwareImportActions.ts` and `components/ImportWallet/steps/HardwareImportSections.tsx` for hardware device selection, connect/fetch xpub actions, connected-device sections, script/account controls, and xpub/error rendering.
- Added `components/ImportWallet/steps/useQrScanHandlers.ts` and `components/ImportWallet/steps/QrScanSections.tsx` for camera error mapping, UR:BYTES decoding, JSON/descriptor QR handling, scanner panels, progress overlay, success/error states, and supported-format help.
- Reduced `components/ImportWallet/ImportWallet.tsx` from CCN 105 to no focused warning, and cleared the related `DescriptorInput`, `HardwareImport`, and `QrScanStep` warnings under the focused ImportWallet `-C 15` gate.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/ImportWallet` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/ImportWallet.test.tsx tests/components/ImportWallet` passed: 10 files, 104 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: missing uploaded files still no-op, missing hardware xpub data still blocks advancement, empty descriptor/JSON input still disables next, and empty QR scan results still no-op.
- Boundary values: oversized files/text still return the same size errors, account index still clamps to zero or greater, UR progress still resets on complete/stop, and unsupported UR types still surface validation errors.
- System boundaries: wallet validation/import APIs, hardware wallet runtime calls, QR scanner contract, and import state hook contract are unchanged.
- Async/race behavior: validation and import loading flags still clear in `finally`, hardware connect/fetch errors still map to inline messages, and UR decoder state is reset after stop/failure/success.
- Diff review: changes are local to ImportWallet and keep the public `ImportWallet`, `DescriptorInput`, `HardwareImport`, and `QrScanStep` exports unchanged.

## Previous Task: NodeConfig CCN Remediation

Status: complete

Goal: reduce the next highest remaining component hotspot, `components/NodeConfig/NodeConfig.tsx` at CCN 111, without changing node/proxy/Tor configuration behavior.

## NodeConfig Checklist

- [x] Inspect NodeConfig structure, subcomponents, and focused tests.
- [x] Extract load/save, proxy/Tor, server filtering, and summary logic into focused NodeConfig-local modules.
- [x] Run focused NodeConfig tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## NodeConfig Review

Changes:

- Added `components/NodeConfig/nodeConfigData.ts` for default config, network server filtering/replacement, proxy visibility, and section summaries.
- Added `components/NodeConfig/useNodeConfigData.ts`, `components/NodeConfig/useNodeConfigSave.ts`, `components/NodeConfig/useElectrumServerControls.ts`, and `components/NodeConfig/useProxyTorControls.ts` to isolate loading, saving, Electrum test/server updates, proxy tests, proxy presets, and Tor container actions.
- Added `components/NodeConfig/NodeConfigStatusMessages.tsx`, `components/NodeConfig/NetworkTabsRow.tsx`, `components/NodeConfig/ProxyTorHeader.tsx`, `components/NodeConfig/BundledTorContainerCard.tsx`, `components/NodeConfig/CustomProxyControls.tsx`, and `components/NodeConfig/ProxyTestControls.tsx` to split status, network tabs, proxy header, bundled Tor, custom proxy, and proxy verification rendering.
- Reduced `components/NodeConfig/NodeConfig.tsx` from CCN 111 to no focused warning, and cleared the related NodeConfig section warnings under the focused `-C 15` lizard gate.
- Fixed the extracted Electrum connection handler to `await` `adminApi.testElectrumConnection` inside its `try/catch`, preserving rejected-promise conversion into an inline failure message.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/NodeConfig` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/NodeConfig.test.tsx tests/components/NodeConfig.branches.test.tsx tests/components/NodeConfig.interactions.test.tsx tests/components/NodeConfig.secondpass.test.tsx tests/components/NodeConfig/ExternalServicesSection.test.tsx tests/components/NodeConfig/NetworkConnectionsSection.branches.test.tsx tests/components/NodeConfig/ProxyTorSection.branches.test.tsx` passed: 7 files, 65 tests.
- `node scripts/quality/check-large-files.mjs` passed the classification check.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: failed config/server/Tor loads still fall back to defaults or empty lists; unavailable Tor status still hides the bundled card; empty proxy credentials still normalize to `undefined`.
- Boundary values: empty or invalid proxy port input still clears the numeric port; zero Electrum servers still leaves the tab count blank; disabled testnet/signet still show `(off)` through the extracted tab badge logic.
- System boundaries: admin API, bitcoin API, and NetworkConnectionCard contracts are unchanged; the refactor only moved orchestration and rendering into NodeConfig-local modules.
- Async/race behavior: load cancellation still prevents late state writes after unmount, save/proxy/Tor timeouts still clear their messages, and rejected Electrum tests now stay handled.
- Diff review: changes are local to NodeConfig and keep the public `NodeConfig`, `NetworkConnectionsSection`, and `ProxyTorSection` exports unchanged.

## Previous Task: WalletDetail CCN Assessment

Status: complete

Goal: inspect and safely reduce the current highest remaining component hotspot, `components/WalletDetail/WalletDetail.tsx` at CCN 135, without destabilizing the wallet detail workflow.

## WalletDetail Checklist

- [x] Refresh post-WalletList lizard ranking and identify WalletDetail as the new top hotspot.
- [x] Inspect WalletDetail structure and available focused tests.
- [x] Extract tab-content routing and local side-effect/state helpers where behavior-preserving.
- [x] Run focused WalletDetail tests plus lint/type/lizard/quality gates for the code changes.
- [x] Document the result and remaining blocker.

## WalletDetail Review

Changes:

- Added `components/WalletDetail/WalletDetailTabContent.tsx` to isolate tab routing and tab component rendering from the main container.
- Added `components/WalletDetail/hooks/useWalletDetailTabs.ts` for URL/location-driven tab state and role-based tab visibility correction.
- Added `components/WalletDetail/hooks/useWalletAgentLinks.ts` for admin wallet-agent badge loading and cancellation handling.
- Added `components/WalletDetail/hooks/useWalletDetailAddressActions.ts` for address pagination, address generation, and unused receive-address fetching.
- Added `components/WalletDetail/hooks/useWalletDetailModalState.ts` for export, transaction export, receive, QR, delete, and transfer modal state plus wallet delete handling.
- Added `components/WalletDetail/hooks/useWalletDraftNotifications.ts` for pending-draft notification updates.
- Reduced `components/WalletDetail/WalletDetail.tsx` from CCN 135 to CCN 47. This is a material reduction, but not a full clear.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletDetail/WalletDetail.tsx components/WalletDetail/WalletDetailTabContent.tsx components/WalletDetail/hooks/useWalletDetailTabs.ts components/WalletDetail/hooks/useWalletAgentLinks.ts components/WalletDetail/hooks/useWalletDetailModalState.ts components/WalletDetail/hooks/useWalletDetailAddressActions.ts components/WalletDetail/hooks/useWalletDraftNotifications.ts` now reports the main file at CCN 47, down from 135.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/WalletDetail.test.tsx tests/components/WalletDetail.wrapper.test.tsx tests/components/WalletDetail` passed: 40 files, 502 tests.
- `git diff --check` passed.

Remaining blocker:

- Fully clearing `WalletDetail.tsx` under `-C 15` now requires a broader tab-props context split. The remaining complexity is mostly dense prop assembly for eight tab surfaces and modal wiring, not isolated algorithms. That should be a dedicated pass because it touches high-fanout props for transactions, UTXOs, addresses, drafts, access, settings, logs, and modals.

Edge case and self-review:

- Null/undefined and empty inputs: absent wallet IDs still short-circuit delete/address actions; invalid location tab state still falls back through existing tab guards; missing wallet data still renders loading state.
- Boundary values: zero pending drafts now removes notifications, positive draft counts preserve singular/plural titles, empty unused receive-address results still trigger address generation, and one-point sparkline behavior was not touched.
- System boundaries: API calls remain the same and are now behind local hooks; no wallet, transaction, admin, or notification API contract changed.
- Async/race behavior: admin-agent loading still uses cancellation, address generation still refreshes summary and first page, and wallet delete still navigates only after successful deletion.
- Diff review: changes are local to WalletDetail and keep the public `WalletDetail` export unchanged.

## Previous Task: WalletList CCN Remediation

Status: complete

Goal: reduce the current highest focused lizard hotspot, `components/WalletList/WalletList.tsx` at CCN 178, and clear the local `WalletGridView` warning without changing wallet list behavior.

## WalletList Checklist

- [x] Refresh remaining CCN hotspot evidence and identify WalletList as the next slice.
- [x] Inspect WalletList structure and focused WalletList tests.
- [x] Extract wallet-list preference, network, derivation, and content rendering logic into focused modules.
- [x] Extract grid-card balance, sparkline, badge, and metadata rendering into focused modules.
- [x] Run focused WalletList tests, app lint/typecheck, lizard, architecture, large-file, and diff checks.
- [x] Run final quality, edge case, and self-review.

## WalletList Review

Changes:

- Added `components/WalletList/walletListData.ts` for network validation, wallet filtering/counts/sorting, pending-transaction aggregation, and pending-data attachment.
- Added `components/WalletList/useWalletListPreferences.ts`, `components/WalletList/useWalletNetworkParam.ts`, and `components/WalletList/useWalletListData.ts` for preference updates, URL-backed network selection, React Query data, and derived wallet state.
- Added `components/WalletList/WalletListContent.tsx`, `components/WalletList/WalletListHeader.tsx`, and `components/WalletList/WalletListEmptyState.tsx` to move rendering out of the container.
- Split `WalletGridView` card rendering into `WalletGridCard.tsx`, `WalletGridCardTop.tsx`, `WalletGridCardBalance.tsx`, `WalletGridCardSparkline.tsx`, `WalletGridCardMetadata.tsx`, and `walletGridCardStyles.ts`.
- Added WalletList shared types in `components/WalletList/types.ts`, including the `string | null` formatter return contract used by fiat formatting.
- Reduced `components/WalletList/WalletList.tsx` from a CCN 178 lizard hotspot to no focused warning; `components/WalletList/WalletGridView.tsx` and its extracted card modules also no longer warn under `-C 15`.

Verification:

- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/WalletList` passed with no warnings.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/WalletList.test.tsx tests/components/WalletList.branches.test.tsx tests/components/WalletList/WalletGridView.test.tsx` passed: 46 tests.
- `node scripts/quality/check-large-files.mjs` passed.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: invalid or absent `network` URL params still default to mainnet; missing wallet networks are filtered out of tab views; missing device counts still render as `0 devices`; empty wallet lists keep the existing empty state.
- Boundary values: sort toggles preserve asc/desc behavior, unsupported sort fields remain stable, pending transaction net zero hides the net badge, and sparkline arrays with fewer than two points still render the same empty real-sparkline paths.
- System boundaries: wallet API query hooks and invalidation hooks are unchanged; the refactor only moves calling/derivation/rendering into WalletList-local modules.
- Async/race behavior: React Query data flow, pending transaction refresh inputs, sparkline inputs, and sync invalidation callbacks are behavior-preserving.
- Diff review: decomposition is local to WalletList and keeps the public `WalletList` and `WalletGridView` exports unchanged.

## Previous Task: DeviceList CCN Follow-Up

Status: complete

Goal: finish the DeviceList complexity pass by decomposing the remaining `DeviceList`, `DeviceListHeader`, and `DeviceGroupedView` render/state hotspots without changing behavior.

## DeviceList Checklist

- [x] Inspect `DeviceList` structure, existing subcomponents, and focused tests.
- [x] Extract device-list data derivation and sorting helpers.
- [x] Extract user preference wiring into a hook.
- [x] Extract wallet filter banner and main content rendering.
- [x] Extract header controls into focused components.
- [x] Extract grouped device cards into focused components.
- [x] Extract record loading/edit/delete state and derived table/grouped data into hooks.
- [x] Run focused DeviceList tests, app lint/typecheck, architecture, large-file, lizard, and diff checks.
- [x] Run final quality, edge case, and self-review.

## DeviceList Review

Changes:

- Added `components/DeviceList/deviceListData.ts` for wallet counts, wallet options, stale wallet filter resolution, filtering/sorting, exclusive-device IDs, grouping, and display-name lookup.
- Added `components/DeviceList/useDeviceListPreferences.ts` for device view preferences, sort/filter setters, and column configuration updates.
- Added `components/DeviceList/WalletFilterBanner.tsx` for wallet and unassigned filter summary banners.
- Added `components/DeviceList/DeviceListContent.tsx` for the presentational header/banner/table/grouped rendering.
- Added `components/DeviceList/DeviceListHeaderControls.tsx` for ownership, wallet-filter dropdown, and view/column controls.
- Added `components/DeviceList/DeviceGroupedCards.tsx` for grouped type cards, device title/edit/delete controls, and wallet badges.
- Added `components/DeviceList/useDeviceListRecords.ts` and `components/DeviceList/useDeviceListDerivedData.ts` so the top-level component is now only a coordinator.
- Added shared DeviceList edit/delete state interfaces to `components/DeviceList/types.ts`.
- Reduced `components/DeviceList/DeviceList.tsx` from a 304 CCN lizard hotspot to no focused warning; `DeviceListHeader` and `DeviceGroupedView` also no longer warn under `-C 15`.

Verification:

- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/DeviceList.test.tsx tests/components/DeviceList/DeviceList.branches.test.tsx tests/components/DeviceList/DeviceListHeader.branches.test.tsx tests/components/DeviceList/DeviceGroupedView.test.tsx tests/components/DeviceList/EmptyState.test.tsx` passed: 54 tests.
- `.tmp/quality-tools/lizard-1.21.2/bin/lizard -C 15 -w components/DeviceList` passed with no warnings.
- `node scripts/quality/check-large-files.mjs` passed.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: helper extraction preserves walletCount/wallets fallbacks, stale wallet filter fallback, unknown device display names, empty-device rendering, and missing wallet type fallback.
- Boundary values: singular/plural wallet-count text, exclusive-device badge gating, unknown sort field fallback, unassigned filters, and zero-wallet delete affordance remain covered by existing tests.
- System boundaries: no API contracts changed; `getDevices`, `getDeviceModels`, `updateDevice`, and `deleteDevice` remain behind the DeviceList record hook.
- Async/race behavior: loading, update, delete, dropdown dismissal, and preference-update paths are behavior-preserving extractions.
- Diff review: decomposition is local to DeviceList and keeps the public `DeviceList`, `DeviceListHeader`, and `DeviceGroupedView` exports unchanged.

## Previous Task: Grade Remediation 4-5

Status: complete

Goal: continue the grade remediation by clearing the oversized production file governance failure and reducing targeted maintainability risk where feasible.

## Remediation Checklist

- [x] Refresh large-file and maintainability blocker evidence.
- [x] Split `components/AgentManagement/index.tsx` instead of classifying product UI as an exception.
- [x] Re-run large-file governance check.
- [x] Re-run app lint/typecheck and targeted tests or build checks.
- [x] Assess highest-CCN remediation feasibility after the large-file gate is green.
- [x] Run final quality, edge case, and self-review.

## Remediation Review

Changes:

- Split the funding override modal out of `components/AgentManagement/index.tsx` into `components/AgentManagement/AgentOverridesModal.tsx`.
- Moved shared agent-management display formatting into `components/AgentManagement/formatters.ts`.
- Reduced `components/AgentManagement/index.tsx` from 1,173 lines to 936 lines, clearing the production oversized-file policy failure without adding an exception.
- Updated `docs/plans/codebase-health-assessment.md` with a remediation note for the large-file gate.

Verification:

- `node scripts/quality/check-large-files.mjs` passed; no unclassified files remain above the 1,000-line limit.
- `npm run lint:app` passed.
- `npm run typecheck:app` passed.
- `npx vitest run tests/components/AgentManagement.test.tsx` passed: 8 tests.
- `npm run check:architecture-boundaries` passed.
- `git diff --check` passed.

CCN assessment:

- Focused lizard check still reports broad component CCN warnings in `DeviceList`, `WalletList`, `WalletDetail`, and remaining AgentManagement render sections.
- The highest CCN offenders are large JSX/state-machine components, not isolated helper functions. Reducing the full warning count safely needs a separate behavior-preserving component decomposition pass with screenshots or component tests around each surface.

Edge case and self-review:

- Null/undefined and empty inputs: the split modal preserves existing empty amount/reason/date validation and error display.
- Boundary values: the override amount/date checks are unchanged; the large-file boundary now has `AgentManagement/index.tsx` below the 1,000-line failure threshold.
- System boundaries: no API contract or data-fetching behavior changed; the modal still uses the same admin API calls and metadata types.
- Async/race behavior: override load/create/revoke state transitions were moved intact, including `finally` cleanup of loading and busy state.
- Diff review: extraction is presentational and verified by the existing AgentManagement component test suite.

## Previous Task: Grade Remediation 1-3

Status: complete

Goal: complete the first three grade remediation items: clear high/critical dependency advisories, fix the two empty-catch lint failures, and restore API/repository architecture boundaries.

## Remediation Checklist

- [x] Review current worktree, package metadata, and grade blockers.
- [x] Clear high/critical npm audit findings in root, server, and gateway without unsafe downgrades.
- [x] Fix empty catch lint failures in frontend and server production code.
- [x] Move direct repository access out of the three flagged API route modules.
- [x] Run audits, lint, architecture checks, typechecks, and focused tests.
- [x] Run final quality, edge case, and self-review.

## Remediation Review

Changes:

- Added dependency overrides so vulnerable hard-fail paths resolve to patched versions: root and gateway force `protobufjs@7.5.5`; server forces `protobufjs@7.5.5`, `hono@4.12.14`, and keeps `@hono/node-server@1.19.14`.
- Replaced the two lint-blocking silent catches with contextual debug logging in `components/AgentWalletDashboard/index.tsx` and `server/src/services/agentFundingDraftValidation.ts`.
- Moved repository-backed work out of `server/src/api/admin/agents.ts`, `server/src/api/admin/mcpKeys.ts`, and `server/src/api/agent.ts` into new service modules.
- Added a remediation note to `docs/plans/codebase-health-assessment.md` so the original grade snapshot remains distinguishable from this follow-up.

Verification:

- `npm audit --audit-level=high` passed in root; residual findings are low severity only.
- `npm audit --audit-level=high` passed in `server`; zero vulnerabilities.
- `npm audit --audit-level=high` passed in `gateway`; residual findings are low severity only.
- `npm run check:architecture-boundaries` passed.
- `npm run lint:app`, `npm run lint:server`, and `npm run lint:gateway` passed.
- `npm run typecheck:app` passed.
- `npm run build` in `server` passed.
- `npm run typecheck:server:tests` passed.
- `npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts` in `server` passed.
- `git diff --check` passed.

Edge case and self-review:

- Null/undefined and empty inputs: route schemas still validate request bodies before the new services run; nullable draft `memo` is normalized to `undefined` at the `draftService` boundary.
- Boundary values: existing fee-rate min/max enforcement moved unchanged into `agentApiService`; high/critical audit checks confirmed patched dependency versions are installed in root/server/gateway trees.
- System boundaries: API routes still own request parsing and audit logging; repository access and key material creation now sit behind service functions.
- Race/async behavior: agent funding draft locking and override consumption stay inside the existing `withAgentFundingLock` flow.
- Diff review: new services preserve the previous response/audit contracts and the focused route smoke test covers admin agent creation, agent key issuance, funding draft submission, and mobile review metadata.

## Previous Task: Repository Quality Grade

Status: complete

Goal: run the `$grade` full-repository audit, collect mechanical and judged quality evidence, update trend history, and write `docs/plans/codebase-health-assessment.md`.

## Grade Checklist

- [x] Load grade skill instructions, standards, git status, and project lessons.
- [x] Capture repository provenance and previous grade trend entry.
- [x] Run the project-wide grade signal collector.
- [x] Inspect evidence for judged ISO/IEC 25010 criteria.
- [x] Score domains, hard-fail gates, confidence, risks, and fastest improvements.
- [x] Append grade trend history.
- [x] Write `docs/plans/codebase-health-assessment.md`.
- [x] Run final quality, edge case, and self-review.

## Grade Review

Results:

- Overall grade is `69/100 D` with High confidence. Raw score is `79/100`, capped to D by the hard-fail gate for high/critical dependency advisories.
- Hard-fail blocker: npm audit currently reports root `8 critical`, server `1 critical`, and gateway `1 critical`; AI proxy is clean.
- Secondary gate regressions: lint fails on two production empty catches, architecture boundaries fail on three API-to-repository imports, lizard reports 122 CCN warnings, and large-file policy fails on unclassified `components/AgentManagement/index.tsx`.
- Strengths preserved: root tests pass, typecheck passes, gitleaks is clean, root/backend line coverage is 100%, gateway line/branch coverage is 100%, OpenAPI route coverage passes, API body validation passes, and browser auth contract passes.

Verification:

- `bash /home/nekoguntai/.codex/skills/grade/grade.sh` completed.
- `npm run lint` failed as expected from the two empty-catch lint errors; `npm run lint:gateway` passed.
- `npm run check:browser-auth-contract` passed.
- `npm run check:architecture-boundaries` failed with three direct repository imports from API routes.
- `npm run check:openapi-route-coverage` passed.
- `npm run check:api-body-validation` passed.
- `npm run typecheck:server:tests` passed.
- Root/server/gateway/AI proxy npm audits ran; AI proxy needed an escalated rerun after sandbox DNS failure.
- `/tmp/gitleaks` full-tree/latest-commit/tracked-tree scans found no leaks.
- Lizard, jscpd, and large-file checks ran; lizard and large-file policy report the maintainability blockers above.
- `npm run test:backend:coverage` and `npm --prefix gateway run test:coverage` passed after rerunning outside socket-binding sandbox limits.

Edge case and self-review:

- Null/undefined and empty inputs: sampled request schema and refresh tests cover missing bodies, invalid headers, empty message arrays, and invalid expiry headers.
- Boundary values: coverage and sampled tests cover zero-delay refresh, invalid/locked/spent agent funding inputs, and rate/amount validation paths.
- System boundaries: API body validation, OpenAPI coverage, gitleaks, npm audit, and architecture-boundary checks were all run or explicitly reported failing.
- Async/race behavior: refresh single-flight/Web Locks and backend coverage passed; no new runtime code was edited during the audit.
- Diff review: only the report, trend JSONL, and task log were changed.

## Previous Task: Backend Coverage And Test Gate Follow-Up

Status: complete

Goal: finish the five follow-up items from the backend coverage pass: confirm remote CI, keep backend coverage at literal 100%, remove high-value reachable `v8 ignore` pragmas where practical, make server test type debt explicit and enforceable, and document the 100% coverage policy.

## Follow-Up Checklist

- [x] Confirm the latest remote CI result and diagnose any failure.
- [x] Fix backend coverage drift found by CI.
- [x] Clean up the server test typecheck blockers enough to add an enforceable gate.
- [x] Add the server test typecheck gate to package scripts and CI.
- [x] Replace high-value reachable `v8 ignore` pragmas with focused tests.
- [x] Document the 100% coverage policy and allowed exclusion criteria.
- [x] Run verification and review edge cases.
- [x] Commit and push.

## Follow-Up Review

Remote CI diagnosis:

- The latest `main` Test Suite run for commit `851a7f65` failed only in the backend coverage step.
- The downloaded backend coverage artifact showed one missed branch in `server/src/models/prisma.ts`: the empty-string fallback in `process.env.DATABASE_URL || ''` was uncovered when CI supplied `DATABASE_URL`.
- The follow-up `main` Test Suite run for commit `4c3c8b4b` reached the new backend test typecheck gate and failed because backend-only CI installs do not create a repo-root `node_modules`. `shared/schemas/mobileApiRequests.ts` imports `zod` from the repo-root side of the tree, so unresolved `zod` caused parsed request DTOs to degrade to `unknown` and cascaded into route type errors.

Changes made:

- Added Prisma model behavior tests for both configured and absent `DATABASE_URL` adapter initialization, plus direct `withTransaction` delegation coverage.
- Removed the now-covered `v8 ignore` pragmas from `withTransaction`.
- Added AI insight notification tests for default severity filtering, default Telegram notification preference, explicit notification disablement, and fallback formatting for unknown values.
- Removed the corresponding reachable AI insight `v8 ignore` pragmas.
- Added the missing `wait(ms)` helper exported from `tests/helpers/testUtils.ts`.
- Fixed Vitest 4 custom matcher module augmentation by declaring matchers under `@vitest/expect`.
- Fixed shared test mock typing for Vitest `Mock`, push-device generated types, and `appVersion`.
- Added a backend script that creates a repo-root `node_modules` symlink to `server/node_modules` when the root install is absent, matching the existing Docker build strategy for shared TypeScript files.
- Added that shared-module resolution step to backend build, runtime, test, mutation, server test typecheck scripts, and backend-only CI jobs.
- Added explicit exported repository mock types and callback parameter types so the focused test typecheck does not infer non-portable Vitest internals.
- Added an enforced server test typecheck script and CI steps in quick/full backend jobs.
- Added `server/tsconfig.test.full.json` so the broader historical full-suite test type debt remains measurable while the required gate covers setup, helpers, mocks, and representative typed tests.
- Documented the literal 100% backend coverage policy, allowed exclusion criteria, server test type gates, and updated stale server test README Jest examples to Vitest examples.

Verification:

- `cd server && npx vitest run tests/unit/services/notifications/channels/aiInsights.test.ts tests/unit/models/prisma.behavior.test.ts tests/unit/models/prisma.test.ts` passed: 61 tests.
- `npm run typecheck:server:tests` passed.
- CI-shaped temporary checkout with no repo-root `node_modules` and only `server/node_modules` installed passed `cd server && npm run typecheck:tests`.
- `cd server && npm run test:unit -- --coverage` passed: 372 files, 8996 tests, 100% statements, 100% branches, 100% functions, 100% lines.
- `cd server && npm run build` passed.
- `git diff --check` passed.

Edge case audit:

- Null/undefined and empty input handling: `DATABASE_URL` restoration handles both undefined and configured values; AI insight tests cover missing severity filter and missing Telegram preference.
- Boundary values: the backend coverage gate now covers both sides of the `DATABASE_URL || ''` fallback that differed between local and CI.
- Error handling: existing AI insight repository failure and per-user Telegram send failure tests still pass; new notification-disable tests prove no send occurs when disabled.
- Race/async behavior: no new async scheduling or shared mutable runtime state beyond restoring `process.env.DATABASE_URL` in `afterEach`.
- System boundary handling: backend-only CI now resolves shared schema dependencies without requiring a root package install; the helper refuses to continue if `server/node_modules` is absent instead of silently hiding the install problem.
- Residual risk: `npm run typecheck:tests:full` intentionally remains a debt tracker rather than a release gate. It still exposes historical DTO/fixture/router/mock drift across the full server test suite, so future cleanup should expand `server/tsconfig.test.json` as those files are fixed.

## Previous Task: 100% Coverage Gates

Status: frontend and backend literal 100% coverage gates complete; server test tsconfig no longer references Jest types

Goal: bring the enforced frontend and backend coverage gates to literal 100% with targeted tests where behavior is reachable, using narrowly justified exclusions only for non-runtime shims, type-only files, V8 instrumentation artifacts, or environment entrypoints that cannot be meaningfully unit-covered.

## Coverage Checklist

- [x] Reproduce current frontend and backend coverage failures locally.
- [x] Identify every uncovered file/line that prevents the enforced gates from passing.
- [x] Add focused tests for reachable branch, function, statement, and line gaps in the affected agent funding and WalletDetail surfaces.
- [x] Tighten backend thresholds to 100% once the backend report is literally clean.
- [x] Replace the stale Jest test type reference with Vitest globals in the server test tsconfig.
- [x] Run frontend and backend coverage gates plus relevant type/build checks.
- [x] Add a review section summarizing changes, edge cases, verification, and residual risks.
- [x] Commit and push the coverage fix.

## Coverage Review

Changes made:

- Added frontend route and WalletDetail wrapper coverage for lazy agent routes, admin wallet-agent badge loading, fallback badge labels, rejected fetches, and unmount cancellation.
- Added backend tests around admin agent route validation, scoped agent route rejection metadata, agent funding draft PSBT edge cases, mobile draft review permissions, draft notification metadata, websocket broadcast skips, agent funding policy windows, monitoring alert early returns, middleware auth, Telegram formatting, and repository null/default paths.
- Excluded `src/worker.ts` from backend unit coverage as a side-effect daemon entrypoint; worker behavior remains covered through worker module and worker entry tests.
- Tightened backend Vitest thresholds to 100% for statements, branches, functions, and lines.
- Updated `server/tsconfig.test.json` to use `vitest/globals` instead of missing Jest types, include shared test dependencies, and allow extension-bearing TypeScript imports for the existing test suite layout.

Verification:

- `npm run test:coverage` passed with frontend/root literal 100% coverage: statements 14257/14257, branches 10630/10630, functions 3625/3625, lines 13298/13298.
- `cd server && npm run test:unit -- --coverage` passed with backend literal 100% coverage: statements 21669/21669, branches 10638/10638, functions 4256/4256, lines 20784/20784.
- `npm run typecheck:tests` passed.
- `cd server && npm run build` passed.
- `cd server && npx tsc --noEmit -p tsconfig.test.json --pretty false` no longer fails on missing Jest types; it now exposes pre-existing server test type debt in fixtures, mock imports, Express router test helpers, and stale integration setup signatures.
- `git diff --check` passed.

Residual risk:

- Server runtime build and coverage are green, but the dedicated server test typecheck is not yet clean because the test suite has broader non-Jest typing issues. The missing Jest types blocker is removed; finishing the remaining test type debt should be handled as a separate cleanup pass unless we want to expand this coverage task further.

## Previous Task: Agent Wallet Funding Implementation

Status: Phase 15 implementation and cross-phase corner-case audit complete

Reference plan: `tasks/agent-wallet-funding-plan.md`

## Active Implementation Slice

Goal: make agent wallet funding operable and defensible with operator docs, incident runbooks, backup/restore coverage, release notes, and an end-to-end route smoke path.

- [x] Load `AGENTS.md` and current project lessons into the session.
- [x] Capture the agent funding architecture in `tasks/agent-wallet-funding-plan.md`.
- [x] Inspect the existing draft creation API, service, repository, notification, and tests.
- [x] Add server-side support for creating a draft with an initial signed PSBT and signer device id.
- [x] Validate that initial signature metadata is scoped to a device associated with the wallet.
- [x] Preserve existing draft notification behavior so human parties are alerted.
- [x] Add focused tests for initial partially signed draft creation.
- [x] Add `WalletAgent` and `AgentApiKey` schema models plus a migration for linked funding/operational wallets.
- [x] Add scoped `agt_` bearer key generation, hashing, parsing, revocation/expiry checks, and funding-wallet access enforcement.
- [x] Add repository support for agent profiles and API keys.
- [x] Add a dedicated `POST /api/v1/agent/wallets/:fundingWalletId/funding-drafts` endpoint.
- [x] Ensure the dedicated endpoint creates a normal partial draft using the registered agent signer device.
- [x] Notify all eligible wallet parties for agent-created drafts instead of suppressing the owning human user.
- [x] Audit-log agent funding draft submissions.
- [x] Add OpenAPI coverage for the agent route and the previously undocumented admin MCP key routes.
- [x] Remove direct Prisma access from the transaction export route by moving the transaction wrapper into the repository.
- [x] Decode agent-submitted PSBTs and validate outputs against the linked operational wallet plus funding-wallet change.
- [x] Validate agent-submitted PSBT inputs against funding-wallet UTXOs, spent/frozen state, and active draft locks.
- [x] Validate the registered agent cosigner's actual partial signature on every input.
- [x] Derive agent draft locking and display metadata from decoded PSBT contents.
- [x] Run targeted and full server verification.
- [x] Add a review section summarizing behavior, tests, edge cases, and follow-up work.
- [x] Add admin/API agent management, policy gates, deduped agent notifications, operational spend alerts, and draft-row agent context.
- [x] Add admin options API for user, wallet, and signer-device choices.
- [x] Add frontend admin API bindings for agent profile and key management.
- [x] Add Admin -> Wallet Agents route.
- [x] Add admin list/create/edit/revoke flows for wallet agents.
- [x] Add one-time `agt_` key creation display and key revocation UI.
- [x] Add linked agent wallet badges to wallet detail headers for admins.
- [x] Add focused server, API binding, route, component, and wallet-header tests.
- [x] Run targeted contract checks plus full frontend and server unit verification.
- [x] Add agent operational monitoring policy fields.
- [x] Add persisted agent alert history with dedupe.
- [x] Trigger alerts for low/high operational balance, large operational spends, large operational fees, and repeated rejected funding attempts.
- [x] Expose alert history through admin APIs.
- [x] Add monitoring fields to Admin -> Wallet Agents create/edit UI.
- [x] Add focused repository, service, route, API, and component tests.
- [x] Run targeted contract checks plus full frontend and server unit verification.
- [x] Add server-side Agent Wallets dashboard aggregation endpoint.
- [x] Include agent status, funding wallet, operational wallet, operational balance, pending drafts, recent spends, open alerts, and key counts.
- [x] Add frontend admin API bindings for dashboard metadata.
- [x] Add Admin -> Agent Wallets dashboard route.
- [x] Add pause/unpause, revoke key, review draft, and open linked wallet actions.
- [x] Add detail rows for policy, recent funding requests, operational spends, alerts, and key metadata.
- [x] Add focused server, API binding, route, and component tests.
- [x] Run targeted verification plus broader frontend/server checks.
- [x] Add receive-address-specific repository helpers for agent operational address lookup.
- [x] Add a server service that returns or derives verified linked operational receive addresses.
- [x] Update the agent operational-address endpoint and OpenAPI schema.
- [x] Add focused repository, service, and route tests.
- [x] Run Phase 12 targeted verification and commit.
- [x] Add an `AgentFundingOverride` schema model and migration.
- [x] Add admin API routes for listing, creating, and revoking owner overrides.
- [x] Enforce override eligibility in agent funding policy without bypassing inactive, wrong-destination, or cooldown guards.
- [x] Mark overrides used after draft creation and audit override create/revoke/use events.
- [x] Add admin UI/API bindings for owner override list/create/revoke flows.
- [x] Label override-funded drafts for human review.
- [x] Add focused repository, service, route, DTO, OpenAPI, API binding, and component tests.
- [x] Run Phase 13 targeted and broader verification.
- [x] Add mobile-safe pending agent funding draft repository queries.
- [x] Add mobile review DTOs with decoded draft summaries, linked operational wallet destination, signing metadata, and deep-link payloads.
- [x] Add authenticated mobile endpoints for listing, detail review, approve intent, comment, reject, and signed PSBT submission.
- [x] Enforce mobile wallet permissions before exposing draft details or accepting signatures.
- [x] Route mobile signed PSBT submissions through the existing draft update/signature path.
- [x] Add audit events for mobile approve, comment, reject, and sign actions.
- [x] Add OpenAPI coverage and focused route, service, repository, and route-registration tests.
- [x] Run Phase 14 targeted verification.
- [x] Add operator docs for registering agents, issuing keys, submitting funding drafts, human review, owner overrides, monitoring, and restore checks.
- [x] Add agent wallet funding incident runbooks for suspected `agt_` key compromise, agent signer compromise, and operational wallet compromise.
- [x] Add release notes explaining the single-sig operational wallet boundary and human-review security model.
- [x] Include agent profiles, API key hashes/prefixes, funding attempts, alerts, and owner overrides in backup/restore table ordering.
- [x] Add backup-service tests for agent metadata export and ordering.
- [x] Add an end-to-end route smoke path for admin creates agent -> creates key -> agent submits signed PSBT -> human sees mobile review metadata.
- [x] Run Phase 15 targeted verification.

## Next Slices

- [x] Add admin/API management flows for registering agents and issuing/revoking `agt_` keys.
- [x] Decode and validate destination outputs against the linked operational wallet.
- [x] Validate that the submitted signed PSBT really contains the registered agent cosigner's partial signature.
- [x] Validate the PSBT spends only funding-wallet UTXOs and does not duplicate an active draft that locks the same UTXOs.
- [x] Enforce agent funding policies and rate limits.
- [x] Improve draft row and Telegram copy for agent funding requests.
- [x] Add notification dedupe for repeated agent submissions.
- [x] Add operational wallet monitoring alerts.
- [x] Phase 8: Decisions and safety hardening.
  - [x] Resolve address generation, over-cap behavior, approval semantics, and concurrent draft policy.
  - [x] Guard policy evaluation, draft creation, UTXO locking, and agent cadence updates with a per-agent PostgreSQL advisory lock.
  - [x] Record accepted and rejected agent funding attempts with reason codes.

## Future Implementation Roadmap

Detailed roadmap: `tasks/agent-wallet-funding-plan.md#future-work-roadmap`

Recommended order:

- [x] Phase 8: Decisions and safety hardening.
  - Resolve address generation, over-cap behavior, approval semantics, and concurrent draft policy.
  - Guard policy evaluation, draft creation, UTXO locking, and agent cadence updates with the per-agent PostgreSQL advisory lock.
  - Record rejected agent funding attempts with reason codes.
- [x] Phase 9: Admin agent management UI.
  - Add admin list/create/edit/revoke flows for agents.
  - Add one-time `agt_` key creation display and key revocation UI.
  - Add linked wallet labels in wallet detail views.
- [x] Phase 10: Operational monitoring and alert rules.
  - Add refill/balance/large-spend/large-fee/repeated-failure alert policy.
  - Store alert history and dedupe threshold alerts.
- [x] Phase 11: Agent Wallets dashboard.
  - Show agent status, funding wallet, operational balance, pending drafts, recent spends, and alerts.
  - Add pause/unpause, revoke key, review draft, and open linked wallet actions.
- [x] Phase 12: Operational address generation.
  - Generate next operational receive address when Sanctuary has enough watch-only descriptor metadata.
  - Preserve strict linked-address verification.
- [x] Phase 13: Owner override workflow.
  - Keep default over-cap behavior as hard reject.
  - Add bounded, human-created overrides with audit trail if needed.
- [x] Phase 14: Mobile approval foundation.
  - Add mobile-safe pending agent draft listing, review metadata, comments/rejection, and signer integration path.
- [x] Phase 15: Operational runbooks and E2E coverage.
  - Add docs, key compromise runbook, backup/restore expectations, release notes, and an e2e smoke path.

Next recommended implementation slice:

- [x] Run cross-phase corner-case audit from Phase 1 onward, then push all committed work.

## Review

Cross-phase audit update:

- Re-read the implementation surface from the first agent wallet funding commit through Phase 15, covering the server agent API, draft validation, policy enforcement, admin management, monitoring, dashboard, operational address generation, owner overrides, mobile review APIs, backup metadata, docs, and smoke coverage.
- Fixed a signer metadata edge case found during audit: draft signature updates now validate that any submitted `signedDeviceId` belongs to the draft wallet before appending it to `signedDeviceIds`. This protects the web, mobile, and agent signature-update paths that all delegate through `draftService.updateDraft`.
- Reconciled stale plan state: Phase 1 wallet role labels are implemented and tested, and the original open questions now point at the Phase 8, 12, 13, and 14 decisions.
- Confirmed the intended security boundary is still intact: Sanctuary stores no private keys, agent credentials cannot broadcast or approve policies, mobile approval intent does not sign or broadcast, and owner overrides are human-created, bounded, one-time funding exceptions.
- Remaining residual follow-up is deliberately outside this server-side phase set: robust unknown-destination/self-transfer classification for operational spends needs destination/counterparty detail in transaction notifications, and mobile client tests wait on the future mobile app.

Verification run:

- `cd server && npx vitest run tests/unit/services/draftService.test.ts` — 44 passed.
- `cd server && npx vitest run tests/unit/services/draftService.test.ts tests/unit/api/drafts-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/mobileAgentDraftService.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/services/backupService.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/agentOperationalAddressService.test.ts tests/unit/services/agentMonitoringService.test.ts` — 214 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `git diff --check` — passed.

Twelfth slice update:

- Added `docs/how-to/agent-wallet-funding.md` as the operator guide for registering agents, issuing runtime keys, validating agent funding drafts, human review, owner overrides, monitoring, backup/restore expectations, and targeted verification.
- Added agent wallet funding incident guidance to `docs/how-to/operations-runbooks.md`, including suspected `agt_` key compromise, agent signer compromise, and operational wallet private-key compromise.
- Added `docs/plans/agent-wallet-funding-release-notes.md` covering the release boundary, API surfaces, operator impact, backup/restore behavior, release gates, and known follow-up.
- Updated the docs index to link the new operator guide and release notes.
- Added agent metadata tables to backup/restore ordering: `walletAgent`, `agentApiKey`, `agentFundingOverride`, `agentAlert`, and `agentFundingAttempt`.
- Marked append-only agent alert and funding attempt history as large backup tables so backup export uses cursor pagination instead of loading all rows at once.
- Extended the Prisma test mock with agent override and alert delegates so backup tests can exercise the new tables.
- Added backup-service coverage proving agent profiles, API key hashes/prefixes, alerts, funding attempts, and owner overrides are exported with BigInt-safe serialization.
- Added `tests/unit/api/agent-wallet-funding-smoke.test.ts`, which exercises the full route path: admin registers agent, admin issues a scoped key, agent submits a signed funding draft, and a human/mobile reviewer receives decoded draft metadata and deep-link payloads.

Verification run:

- `cd server && npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/services/backupService.test.ts` — 71 passed.
- `cd server && npx vitest run tests/unit/api/agent-wallet-funding-smoke.test.ts tests/unit/api/agent-routes.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/services/mobileAgentDraftService.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/backupService.test.ts` — 149 passed.
- Post-review backup hardening check: `cd server && npx vitest run tests/unit/services/backupService.test.ts` — 71 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `git diff --check` — passed.

Edge case audit:

- Backups now include hashed agent credential records but still do not include raw `agt_` tokens.
- Agent backup ordering restores wallet/user/device prerequisites before `walletAgent`, then restores key, alert, attempt, and override records after the agent profile.
- Agent alert and funding attempt histories use cursor-paginated backup export because they can grow like audit logs.
- Agent funding attempts and owner override amounts preserve satoshi precision through existing `__bigint__` backup serialization.
- Operator docs explicitly distinguish `agt_` key compromise from agent signer private-key compromise; signer compromise is treated as wallet-descriptor compromise.
- Operational wallet compromise is documented as single-sig agent-controlled funds-at-risk, not as a Sanctuary signing failure.
- The smoke test asserts key hashes are not returned from key creation while the one-time `agt_` token is.
- The smoke test verifies submitted agent drafts keep agent id, operational wallet id, and signed-device metadata through to the human/mobile review payload.
- Residual follow-up: run the requested cross-phase audit before push.

Eleventh slice update:

- Added `GET /api/v1/mobile/agent-funding-drafts` and `GET /api/v1/mobile/agent-funding-drafts/:draftId` for mobile-safe review of pending agent funding drafts.
- Added mobile approve/comment/reject/signature routes under `/api/v1/mobile/agent-funding-drafts/:draftId/*`.
- Returned decoded draft summary metadata from stored PSBT-derived draft fields, including inputs, outputs, selected UTXOs, totals, change, input paths, linked operational wallet id, and wallet metadata.
- Added deep-link payloads that notification senders can reuse for `sanctuary://agent-funding-drafts/:draftId`, web review paths, and API review paths.
- Enforced mobile wallet permissions: `viewTransactions` gates visibility, `signPsbt` gates signed PSBT submission, and review actions require either `signPsbt` or `approveTransaction`.
- Kept approval semantics explicit: mobile approve records audited intent and next action, but it does not auto-sign, broadcast, or force policy approval.
- Routed mobile signed PSBT submission through `draftService.updateDraft`, preserving the existing web signing update path and signed-device aggregation behavior.
- Marked mobile rejections by setting draft `approvalStatus=rejected`, which removes the draft from future pending mobile review lists.
- Added audit events for mobile approve, comment, reject, and sign actions without logging signed PSBT material.
- Added OpenAPI schemas/paths and route registration for the new mobile agent draft API.

Verification run:

- `cd server && npx vitest run tests/unit/services/mobileAgentDraftService.test.ts tests/unit/api/mobile-agent-drafts-routes.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/routes.test.ts` — 33 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run check:prisma-imports` — passed.

Edge case audit:

- Draft list limits are validated and bounded to 1-100 with a default of 25.
- Rejected, vetoed, expired, non-agent, and already-expired drafts are excluded from pending mobile review queries.
- General rejected-draft lookup remains available internally after a reject so the API can return the rejected review payload.
- BigInt satoshi values are serialized as decimal strings to avoid precision loss.
- Missing or null JSON draft fields are normalized to `null` in mobile summaries.
- A draft without `viewTransactions` mobile permission is not returned in lists or detail responses.
- A per-draft mobile permission denial during cross-wallet listing skips that draft instead of failing the whole list.
- Signature submission is denied unless mobile permissions allow `signPsbt`.
- Approver-only users can record review intent but receive `nextAction=none` unless they can also sign.
- Signed PSBT material is passed only to `draftService.updateDraft`; audit details record draft and device metadata, not PSBT content.
- Empty approve/comment/reject bodies are rejected where a comment or reason is required, and comments/reasons are trimmed and capped at 1000 characters.
- Residual follow-up: Phase 15 should add operational docs/runbooks and an e2e smoke test that exercises this flow from admin setup through agent draft submission and human review.

Tenth slice update:

- Added `AgentFundingOverride` persistence for one-time owner-created funding windows bounded by agent, funding wallet, operational wallet, amount, expiry, and status.
- Added admin override APIs: list, create, and revoke, with request validation, OpenAPI coverage, DTO serialization, and audit events for create/revoke.
- Updated funding policy so inactive agents, wrong operational-wallet destinations, and cooldowns remain hard failures; cap violations can proceed only when a matching active, unused, unexpired owner override covers the requested amount.
- Marked the matching override used after draft creation and added an override-use audit event linked to the created draft.
- Labeled override-funded agent drafts with `(owner override)` so human reviewers can distinguish exceptional funding from normal in-policy funding.
- Added Admin -> Wallet Agents override management so humans can view active/used/revoked/expired override history, create bounded overrides, and revoke active overrides. Agent credentials cannot call these admin routes.
- Post-commit hardening made override use conditional on `status=active`, `usedAt=null`, and `revokedAt=null`, bounded override listing to 25 rows by default, and documented the policy invariant that overrides waive caps only after status, destination, and cooldown checks pass.
- Kept Sanctuary's boundary intact: overrides do not sign, broadcast, store private keys, move funds directly, or change wallet descriptors.

Verification run:

- `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/agent/dto.test.ts tests/unit/api/openapi.test.ts` — 84 passed.
- Post-hardening focused server check: `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts` — 85 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run test:unit` — 366 files / 8870 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npx vitest run tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts` — 9 passed.
- Post-hardening focused frontend check: `npx vitest run tests/components/AgentManagement.test.tsx tests/api/adminAgents.test.ts` — 10 passed.
- `npm run typecheck:app` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 395 files / 5535 tests passed. Existing jsdom navigation warning remains in `tests/components/BackupRestore/useBackupHandlers.branches.test.tsx`.
- `git diff --check` — passed.

Edge case audit:

- Whitespace-only override reasons are trimmed before validation and rejected when empty.
- Override amounts must be positive and are serialized as strings to avoid satoshi precision loss.
- Expired overrides stay visible in history but cannot satisfy policy; the UI distinguishes expired active rows from currently usable overrides.
- Used and revoked overrides cannot be reused by policy because lookup requires `status=active`, `usedAt=null`, and `revokedAt=null`.
- Override consumption uses a conditional update so a stale or already-used row cannot be marked used a second time.
- Override list responses are bounded to 25 rows by default and allow an explicit validated limit up to 100.
- Cooldown enforcement runs before any override lookup, so an owner override cannot bypass agent cadence controls.
- Wrong operational-wallet submissions fail before override lookup, even if a broad override exists for the same agent.
- Revoked agents cannot receive new owner overrides.
- Override use is marked only after the draft is created, preventing a failed draft build from consuming the override.
- A used override records the draft id and emits a separate audit event for review/history correlation.
- Admin override UI handles empty, loading, error, create, revoke, expired, used, and revoked states without exposing the full agent API key material.
- Residual follow-up: Phase 14 should expose mobile-safe pending agent draft review, comments/rejection, and signer handoff paths.

Ninth slice update:

- Added a receive-address-specific address repository helper so agent operational address requests cannot return wallet change addresses.
- Added `getOrCreateOperationalReceiveAddress`, which returns an existing unused operational receive address or, when the linked single-sig operational wallet has descriptor metadata, derives and stores a fresh receive-address gap.
- Wrapped operational address generation in the existing per-agent advisory lock to avoid concurrent duplicate derivation for the same agent.
- Kept descriptorless operational wallets in read-only mode: they still fail closed instead of accepting an unverified agent-provided address.
- Updated `GET /api/v1/agent/wallets/:fundingWalletId/operational-address` to use the service and return `generated: true|false`.
- Added `POST /api/v1/agent/wallets/:fundingWalletId/operational-address/verify` so agents can preflight whether a provided destination is a known linked operational receive address.
- Updated OpenAPI docs/schema for the generated-address behavior.
- Kept Sanctuary's boundary intact: the endpoint derives watch-only receive addresses only; it does not store private keys, sign, broadcast, mark addresses used, or accept unverified destinations.

Verification run:

- `cd server && npx vitest run tests/unit/services/agentOperationalAddressService.test.ts tests/unit/api/agent-routes.test.ts tests/unit/repositories/addressRepository.test.ts tests/unit/api/openapi.test.ts` — 86 passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `cd server && npm run test:unit` — 366 files / 8863 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Null/missing descriptors fail closed with an explicit invalid-input error instead of falling back to agent-provided data.
- Empty receive-address sets derive from index `0`; mixed receive/change history derives from the highest receive index plus one.
- Change-address paths are filtered out when selecting an unused operational receive address.
- Malformed derivation-path history is ignored for next-index calculation.
- Generated addresses are persisted as unused and the endpoint does not mark them used prematurely.
- The service validates derived paths are receive paths before storing a generated gap.
- The verification endpoint returns `verified=false` without wallet metadata for unknown addresses, other-wallet addresses, and change addresses.
- Unsupported operational wallet networks and non-single-sig operational wallets fail before derivation.
- A duplicate insert race re-reads the next unused receive address after `createMany(..., { skipDuplicates: true })`.
- Residual follow-up: Phase 13 will add human-created override workflows for exceptional over-cap funding; agent-created over-cap submissions remain rejected.

Eighth slice update:

- Added `GET /api/v1/admin/agents/dashboard` for operational dashboard rows with agent metadata, operational UTXO balance, pending funding draft counts, last funding request, last operational spend, open alert counts, active key counts, recent drafts, recent spends, recent alerts, and key metadata.
- Dashboard balances aggregate unspent operational wallet UTXOs from the database, so the totals come from the same source as wallet balance queries rather than cached UI state.
- Recent funding requests, operational spends, and open alerts are fetched with windowed bulk queries instead of per-agent query fan-out.
- Added frontend admin API bindings and an Admin -> Agent Wallets route.
- Added the Agent Wallets dashboard with spend-ready totals, operational balance totals, pending drafts, open alerts, funding/operational wallet links, review-drafts navigation, pause/unpause actions, and per-key revocation actions.
- Added expandable detail rows for policy settings, recent funding requests, operational spends, open alerts, and active keys.
- Kept Sanctuary's boundary intact: the dashboard does not sign, broadcast, move funds, store private keys, or alter wallet descriptors. Pause/unpause only updates the agent status used by the existing agent API gate.

Verification run:

- `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/agent/dto.test.ts tests/unit/api/admin-agents-routes.test.ts` — 20 passed.
- `npx vitest run tests/components/AgentWalletDashboard.test.tsx tests/components/ui/Button.test.tsx tests/components/ui/LinkButton.test.tsx tests/components/ui/EmptyState.test.tsx tests/api/adminAgents.test.ts tests/src/app/appRoutes.test.ts` — 28 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 395 files / 5534 tests passed.
- `cd server && npm run test:unit` — 365 files / 8849 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Empty dashboard responses render a stable empty state.
- Load failures render retry UI and do not expose stale partial data.
- Dashboard date formatting handles missing values and invalid date strings.
- Dashboard satoshi formatting handles empty or malformed string values without crashing the page.
- Active key counts exclude revoked and expired keys on the server; the UI also filters inactive keys before showing revocation actions.
- Pending draft counts exclude expired drafts and include unsigned, partial, and signed drafts that still need human review or broadcast follow-up.
- Pause/unpause actions call the existing admin agent update endpoint, so paused agents are blocked by the existing agent API status checks.
- Revoke-key actions require confirmation and call the existing scoped key revoke endpoint; wallet descriptors are unchanged.
- Shared link-button styling has direct tests for default secondary links, custom variants/sizes, and forwarded React Router link props.
- Residual follow-up: Phase 12 still needs operational address generation for watch-only wallets with sufficient descriptor metadata.

Seventh slice update:

- Added operational monitoring policy fields to wallet agents: refill threshold, large-spend threshold, large-fee threshold, repeated-failure threshold/lookback, and alert dedupe window.
- Added persisted `AgentAlert` history with dedupe keys, severity/status, optional tx/amount/fee/threshold fields, rejected-attempt context, and JSON metadata for dashboard/mobile use.
- Added a repository-level advisory lock around alert dedupe check/write so concurrent alert evaluation cannot duplicate rows inside the dedupe window.
- Operational outgoing transaction notifications now also evaluate alert rules for linked active agents. Large spends and large fees dedupe per transaction; balance threshold alerts dedupe by agent/wallet/window.
- Rejected agent funding attempts now evaluate repeated-failure alert rules from stored monitoring records instead of logs.
- Added `GET /api/v1/admin/agents/:agentId/alerts` plus OpenAPI coverage and frontend admin API bindings.
- Added monitoring fields to the Admin -> Wallet Agents create/edit UI and summary rows.
- Kept Sanctuary's boundary intact: alerts observe and persist state only; they do not sign, broadcast, move funds, or store private keys.

Verification run:

- `cd server && npm run prisma:generate` — passed.
- `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts` — 41 passed.
- `npx vitest run tests/api/adminAgents.test.ts tests/components/AgentManagement.test.tsx` — 8 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run build` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run typecheck:tests` — passed.
- `npm run test:run` — 393 files / 5528 tests passed.
- `cd server && npm run test:unit` — 364 files / 8843 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- Post-review targeted checks: `cd server && npx vitest run tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentMonitoringService.test.ts tests/unit/agent/dto.test.ts tests/unit/services/bitcoin/transactionService.broadcast.test.ts` — 53 passed.
- Post-review targeted check: `npx vitest run tests/components/AgentManagement.test.tsx` — 6 passed.

Edge case audit:

- Alert rule fields are optional; blank create fields are omitted, and cleared edit fields are sent as `null`.
- Threshold values of `0`, `null`, or unset do not trigger alerts; positive thresholds are required before evaluation writes history.
- Transaction-specific large-spend and large-fee alerts use txid-based dedupe from epoch so retries cannot duplicate the same tx alert.
- Balance and repeated-failure alerts use a configurable dedupe window, defaulting to 60 minutes, to avoid writing on every sync.
- Alert dedupe uses a PostgreSQL advisory transaction lock keyed by dedupe key, preserving repeat alerts after the configured window while preventing concurrent duplicate writes inside the window.
- Monitoring failures are logged and swallowed so alert persistence cannot mask transaction notification delivery or agent API responses.
- Repeated-failure alerts count stored rejected attempts in the configured lookback window.
- Residual follow-up: unknown-destination/self-transfer classification and a dashboard/mobile alert review surface remain Phase 10 follow-up/Phase 11 work.

---

Sixth slice update:

- Added `GET /api/v1/admin/agents/options` so the admin UI can present valid user, funding-wallet, operational-wallet, and signer-device choices without ad hoc client-side discovery.
- Added frontend admin agent API bindings and typed metadata for agent profiles, options, scoped keys, create/update payloads, and one-time key creation responses.
- Added an Admin -> Wallet Agents section with summary stats, agent list rows, policy/status display, create/edit modals, revoke actions, scoped key issuance, one-time `agt_` token display, copy handling, and key revocation.
- Added UI filtering that mirrors core server validation: funding wallets are multisig, operational wallets are single-sig on the same network, both are scoped to the target user, and signer devices must be linked to the funding wallet.
- Added admin-only linked wallet badges in wallet detail headers for "Agent Funding Wallet" and "Agent Operational Wallet" context.
- Hardened UI edge cases for optional numeric policy fields, invalid expiration dates, unavailable clipboard APIs, and stale form selections after user/wallet changes.
- Post-review hardening: wallet detail now requests server-filtered agent links with `walletId`, admin badges align with the existing shared-wallet badge palette, key revoke text has a dark-mode state, and focused tests cover load errors, empty lists, clipboard failures, and admin-gated wallet-detail fetching.

Verification run:

- `npm run typecheck:app` — passed.
- `npx vitest run tests/components/AgentManagement.test.tsx tests/components/WalletDetail.test.tsx tests/components/WalletDetail/WalletHeader.test.tsx tests/api/adminAgents.test.ts` — 39 passed.
- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/openapi.test.ts` — 56 passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run build` — passed.
- `npm run test:run` — 393 files / 5528 tests passed.
- `cd server && npm run test:unit` — 363 files / 8837 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `git diff --check` — passed.

Edge case audit:

- Empty agent lists render a stable empty state, and loading/error states do not expose partial data.
- Create submit stays disabled until a target user, funding wallet, operational wallet, signer, and non-empty name are selected.
- Editing does not allow changing immutable linkage fields; it only updates name, status, policy caps, cooldown, and notification/pause settings.
- Optional caps/cooldowns are omitted on create when blank and sent as `null` on update when cleared.
- Clipboard copy reports an action error when the browser clipboard API is unavailable or denies the write.
- Full `agt_` tokens are held only in the create-key modal state and are cleared when the modal closes.
- Wallet detail agent badges are fetched only for admins; non-admin wallet detail views do not call the admin agent endpoint.
- Residual follow-up: Phase 10 should add persisted alert thresholds/history for operational wallet monitoring beyond the current notification/pause behavior.

---

Fifth slice update:

- Resolved Phase 8 policy semantics in the plan:
  - Agent over-cap submissions remain hard rejected.
  - Human multisig signature is the approval for normal in-policy funding.
  - Agent-provided operational destinations are accepted only when Sanctuary verifies they belong to the linked operational wallet.
  - Concurrent agent drafts are allowed only when they do not violate UTXO locks or aggregate policy caps.
- Added `AgentFundingAttempt` persistence for accepted/rejected funding attempts, including agent id, key metadata, wallet ids, amount, fee rate, recipient, reason code/message, and request metadata.
- Wrapped agent funding policy evaluation, draft creation, UTXO locking, and `lastFundingDraftAt` update in a per-agent PostgreSQL advisory lock.
- Recorded rejected funding attempts on validation, policy, scope, PSBT, and lock failures without hiding the original API error.
- Recorded accepted attempts after draft creation for monitoring symmetry.
- Updated OpenAPI text for the agent funding endpoint to state that agents cannot request/apply owner overrides.
- Added tests for advisory lock usage and funding attempt persistence/rejection recording.
- Post-review hardening: capped in-memory draft notification dedupe to 1,000 keys, aligned the agent funding draft badge with the existing shared palette, and changed the autonomous-spend warning into the standard amber callout pattern.

Verification run:

- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npx vitest run tests/unit/api/agent-routes.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/api/openapi.test.ts` — 60 passed.
- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts` — 134 passed.
- `cd server && npm run test:unit` — 363 files / 8834 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run typecheck:app` — passed.
- `npm run test:run` — 391 files / 5517 tests passed.
- `cd server && npx vitest run tests/unit/services/notifications/notificationService.test.ts` — 6 passed.
- `npx vitest run tests/components/DraftList/DraftRow.branches.test.tsx` — 6 passed.
- `git diff --check` — passed.

Edge case audit:

- Rejected funding attempts are best-effort monitoring records; a failure to write the monitoring record does not mask the original validation/policy error.
- Accepted funding attempt recording is also best-effort and does not make Sanctuary a signer or custodian.
- The advisory lock serializes the critical section across app processes that share the same PostgreSQL database.
- The lock does not refactor all draft writes into one transaction client; if a database failure occurs after draft creation but before cadence update, the API can still surface an error after a draft exists. Daily/weekly aggregate caps still include stored drafts, while cooldown depends on `lastFundingDraftAt`.
- Address generation is intentionally deferred to Phase 12; Phase 8 keeps the stricter current behavior that only known linked operational addresses are returned/accepted.

---

Fourth slice update:

- Added admin-only agent management endpoints for listing, creating, updating, and revoking wallet agents.
- Added admin-only `agt_` key management endpoints for listing, issuing, and revoking scoped agent API keys. Full keys are returned only at creation time.
- Agent creation validates that the target user can access both linked wallets, the funding wallet is multisig, the operational wallet is single-sig, both wallets use the same network, and the registered signer device belongs to the funding wallet.
- Added per-agent policy fields and enforcement for per-request funding caps, operational-wallet balance caps, daily limits, weekly limits, cooldowns, active/revoked state, and linked destination wallet.
- Added agent linked-wallet read endpoints for minimal wallet summary and the next known unused operational receive address.
- Added an agent draft-signature update endpoint that lets an agent refresh the agent signature on its own draft while reusing the same PSBT validation path and existing draft lock.
- Agent-created drafts now store `agentId` and `agentOperationalWalletId`, use a default agent funding label when none is provided, and surface agent metadata through the draft API/client type.
- Telegram draft notifications now use agent-specific copy, include the linked operational wallet name when known, show whether the agent signature is present, warn about post-funding autonomy, and notify only owner/signer wallet parties for agent drafts.
- Draft notification dedupe suppresses repeated agent funding notifications with the same agent/wallet/recipient/amount key for 10 minutes.
- Operational-wallet outgoing transaction notifications are enriched as agent operational spends; configured agents can be auto-paused after such a spend.
- The draft row now labels agent funding requests, shows the linked operational wallet destination context, shows agent signature state, and warns that the operational wallet can spend without multisig approval once funded.
- OpenAPI coverage was added for the admin agent endpoints and agent read/update endpoints.

Verification run:

- `cd server && npx vitest run tests/unit/api/admin-agents-routes.test.ts tests/unit/api/agent-routes.test.ts tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/services/agentFundingPolicy.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/registry.test.ts tests/unit/services/notifications/channels/handlers.test.ts tests/unit/services/telegram/telegramService.test.ts` — 131 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npx vitest run tests/unit/api/openapi.test.ts` — 43 passed.
- `npm run typecheck:app` — passed.
- `cd server && npm run test:unit` — 363 files / 8831 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run test:run` — 391 files / 5517 tests passed.
- `npx vitest run tests/components/DraftList/DraftRow.branches.test.tsx` — 6 passed.
- `git diff --check` — passed.

Edge case audit:

- Null, blank, unknown, expired, malformed, and revoked agent API keys are rejected before route handlers run.
- Agent profiles that are paused, revoked, or linked to different wallets cannot submit funding drafts.
- Admin agent creation rejects same-wallet links, nonexistent users/wallets, wrong wallet types, network mismatches, inaccessible wallets, and signer devices not attached to the funding wallet.
- Agent funding requests reject missing or malformed PSBTs, PSBT transaction mismatches, duplicate inputs, empty inputs/outputs, unknown outputs, missing recipient payment, amount mismatches, spent/frozen/locked UTXOs, and missing/invalid registered signer partial signatures.
- Fee rate must be finite and inside Sanctuary's configured global min/max bounds.
- Per-request, daily, weekly, cooldown, and operational balance caps reject over-limit requests before drafts are stored.
- Agent signature refreshes are limited to the agent's own drafts and tolerate that draft's existing lock while still rejecting conflicting locks from other drafts.
- Telegram agent draft notifications no longer reference a human creator and do not suppress the linked human owner/signer.
- Viewer-only wallet users are not selected for Telegram agent funding draft notifications.
- Duplicate agent draft notification keys are suppressed for a bounded TTL and old keys are pruned opportunistically.
- Operational spend enrichment only runs for outgoing transactions and only for active agents linked to that operational wallet.
- Residual concurrency risk: policy cap checks and draft creation are not wrapped in a serializable transaction, so simultaneous submissions could race on aggregate daily/weekly totals. UTXO draft locks still prevent double-spending the same inputs.

Follow-up work:

- Add a richer admin UI for agent profile/key management instead of API-only management.
- Add an Agent Wallets dashboard section with funding wallet, operational balance, status, and alert summaries.
- Decide whether operational receive addresses should be generated by Sanctuary on demand or only read from already-derived watch-only addresses.
- Decide whether owner override for over-cap funding should exist or whether caps remain hard rejects.
- Consider moving policy evaluation plus draft creation into one serializable database transaction if high-concurrency agent submissions become realistic.
- Extend mobile approval once the mobile app exists.

---

Third slice update:

- Added `agentFundingDraftValidation`, which decodes the unsigned and signed PSBTs before accepting an agent funding draft.
- The signed PSBT must have the same unsigned transaction shape as the submitted draft PSBT.
- Every input must be an available funding-wallet UTXO, and spent, frozen, missing, or draft-locked inputs are rejected.
- Every output must be either a linked operational-wallet payment or funding-wallet change. Unknown outputs are rejected.
- The submitted `recipient` must belong to the operational wallet and `amount` must equal the total paid to that wallet.
- Draft display and locking metadata is now derived from the decoded PSBT: selected outpoints, inputs, outputs, fee, totals, change, RBF signaling, and signer input paths.
- The agent route no longer trusts agent-provided `selectedUtxoIds`, output/input JSON, fee totals, change values, `payjoinUrl`, or `isRBF`; it always creates a non-RBF draft lock for agent funding submissions.
- The signed PSBT must include a cryptographically valid partial signature from the registered agent signer fingerprint on every input.
- Added repository support for exact outpoint lookup with spent/frozen/draft-lock state.

Verification run:

- `cd server && npx vitest run tests/unit/services/agentFundingDraftValidation.test.ts tests/unit/api/agent-routes.test.ts tests/unit/repositories/utxoRepository.test.ts` — 35 passed.
- `cd server && npm run build` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `cd server && npm run test:unit` — 361 files / 8815 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `npm run typecheck:app` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `git diff --check` — passed.

Edge case audit:

- Missing or malformed PSBTs: rejected.
- Signed PSBT transaction mismatch from the unsigned draft PSBT: rejected.
- Empty input or output sets: rejected.
- Missing funding-wallet input UTXOs: rejected.
- Already-spent, frozen, or draft-locked funding UTXOs: rejected.
- Outputs to non-wallet addresses or non-standard scripts: rejected.
- Recipient not in the linked operational wallet: rejected.
- Declared amount differing from decoded operational-wallet payment total: rejected.
- Invalid signer device fingerprint format: rejected.
- Missing or invalid registered agent partial signature on any input: rejected.
- Funding and operational wallet network mismatch or address overlap: rejected.

Follow-up work:

- Add admin/API management flows for registering agents and issuing/revoking `agt_` keys.
- Add policy caps, fee-rate bounds, and rate limits for agent funding requests.
- Improve human-visible draft and Telegram copy for linked operational-wallet destinations.
- Add notification dedupe and operational wallet monitoring.

---

Implemented the second server slice for agent multisig funding:

- `POST /api/v1/wallets/:walletId/drafts` now accepts `signedPsbtBase64` and `signedDeviceId` alongside the unsigned PSBT payload.
- If one initial signature field is present without the other, draft creation is rejected.
- If both are present, Sanctuary verifies the `signedDeviceId` is linked to the funding wallet before creating the draft.
- Accepted initial signatures create a normal draft with `status = partial`, `signedPsbtBase64` set, and `signedDeviceIds = [signedDeviceId]`.
- Added `WalletAgent` and `AgentApiKey` persistence, with `agt_` scoped bearer keys stored as hashes and separated from read-only MCP keys.
- Added `/api/v1/agent/wallets/:fundingWalletId/funding-drafts`, scoped to one funding wallet, one operational wallet, and one signer device.
- Agent-created drafts pass `notificationCreatedByUserId = null`, so Telegram draft notifications go to all eligible wallet parties and show the agent label as the creator.
- Agent submissions are audit logged with agent id, key prefix, wallet ids, signer device id, draft id, amount, and fee rate.
- OpenAPI now declares `agentBearerAuth` and documents the agent funding route. The pre-existing admin MCP key route coverage gap is also documented.
- The Prisma import guardrail no longer needs the transaction export route exception because repeatable-read export transactions now go through the transaction repository.

Verification run:

- `cd server && npx vitest run tests/unit/agent/auth.test.ts tests/unit/repositories/agentRepository.test.ts tests/unit/api/agent-routes.test.ts tests/unit/routes.test.ts tests/unit/api/openapi.test.ts tests/unit/repositories/draftRepository.test.ts tests/unit/services/draftService.test.ts tests/unit/api/drafts-routes.test.ts` — 129 passed.
- `cd server && npx vitest run tests/unit/services/notifications/notificationService.test.ts tests/unit/services/notifications/channels/handlers.test.ts` — 15 passed.
- `cd server && npm run test:unit` — 360 files / 8807 tests passed. Existing Vitest hoist warning remains in `tests/unit/utils/tracing/tracer.test.ts`.
- `cd server && npm run build` — passed.
- `npm run typecheck:app` — passed.
- `npm run check:api-body-validation` — passed.
- `npm run check:openapi-route-coverage` — passed.
- `cd server && npm run check:prisma-imports` — passed.
- `git diff --check` — passed.

Edge case audit:

- Missing `signedPsbtBase64` or missing `signedDeviceId`: rejected.
- Empty initial signature fields: rejected by route validation and service validation.
- Unknown signer device id: rejected before persistence.
- Wallet missing during signer validation: rejected.
- Existing unsigned draft creation path stays unchanged.
- RBF UTXO locking behavior stays unchanged.
- Missing, malformed, unknown, revoked, or expired `agt_` keys: rejected.
- Paused/revoked agent profile: rejected.
- Funding wallet id mismatch: rejected.
- Operational wallet id mismatch: rejected.
- Agent key without `create_funding_draft` scope: rejected.
- Agent-created drafts do not suppress notifications to the linked human user.
- Empty route body and missing required agent funding fields: rejected before service calls.

Follow-up work:

- Validate PSBT contents against funding-wallet UTXOs and operational-wallet destination addresses.
- Validate the agent cosigner's actual partial signature, not only the signer device metadata.
- Add admin/UI flows for creating agents and issuing/revoking agent API keys.
- Enforce agent-specific funding policy caps, rate limits, notification dedupe, and richer notification copy.

---

# HttpOnly cookie auth + refresh flow migration — implementation plan

ADRs:
- `docs/adr/0001-browser-auth-token-storage.md` — Accepted 2026-04-12
- `docs/adr/0002-frontend-refresh-flow.md` — Proposed; awaiting user review

Branch strategy: one PR per phase. Each phase is independently revertible. Do not start a phase until the previous one is merged and CI is green on `main`.

**Resolved decisions** (from the user check-in on 2026-04-12, applying the "no cutting corners" working rule):

1. **CSRF library:** `csrf-csrf` (modern, server-stateless double-submit, well-maintained).
2. **Cookie names:** `sanctuary_access` (HttpOnly access token), `sanctuary_csrf` (readable double-submit token), `sanctuary_refresh` (HttpOnly refresh token, scoped to `/api/v1/auth/refresh`). All snake_case to match the existing `sanctuary_token` convention in `src/api/client.ts:137`.
3. **`/auth/me` endpoint:** already exists at `server/src/api/auth/profile.ts:20`. Reused as-is.
4. **Refresh flow:** included in this work, not deferred. Designed in ADR 0002. Implementation lands in Phase 4.

## Phase 0 — ADR 0002 review and acceptance — COMPLETE 2026-04-12

Goal: the refresh-flow design is reviewed, accepted, and ready to merge into Phase 4. This is a documentation-only phase but it gates everything else — the design must land before any cookie code is written, since the cookie shape (`sanctuary_refresh` scoped to `/api/v1/auth/refresh`) is decided here.

- [x] User reviews `docs/adr/0002-frontend-refresh-flow.md`.
- [x] Push back on any design decisions or accept as-is. (Codex review caught the BroadcastChannel-as-mutex race; ADR 0002 was revised from Option C to Option E — Web Locks API + BroadcastChannel for state propagation only.)
- [x] Mark ADR 0002 status from "Proposed" to "Accepted".
- [x] Update the cross-reference in ADR 0001 to also say "Accepted".

**Exit criteria:** ADR 0002 status is Accepted. ✓ Open questions inside ADR 0002 (refresh lead time, refresh token TTL, WebSocket reconnect on refresh, logout-all UI, Page Visibility API behavior) are deferred to implementation time per the ADR's own "Open questions" section — they do not block Phase 1.

## Phase 1 — Backend foundation (PR 1)

Goal: the backend can verify either a cookie+CSRF or an `Authorization: Bearer` header on every protected route, but no route is yet *issuing* cookies. This phase ships behind no flag and changes no behavior; it just teaches the auth middleware to recognize cookies.

- [ ] Add `cookie-parser` to `server/package.json` and wire it into `server/src/index.ts` before the auth middleware runs.
- [ ] Add `csrf-csrf` to `server/package.json`. Capture the version pin in the PR description.
- [ ] Add CSRF middleware to `server/src/middleware/csrf.ts` using `csrf-csrf`'s `doubleCsrf` factory. Use a stable secret derived from the existing JWT secret material so deployers do not need to add a new env var.
- [ ] Update `server/src/middleware/auth.ts` to read the access token from a `sanctuary_access` cookie when no Authorization header is present.
- [ ] When the request authenticated via cookie, require a valid `X-CSRF-Token` for POST/PUT/PATCH/DELETE. The Authorization-header path is exempt (mobile/gateway).
- [ ] Tests:
  - [ ] `server/tests/unit/middleware/auth.test.ts` — cookie-only auth, header-only auth, both present (cookie wins), neither (401).
  - [ ] `server/tests/unit/middleware/csrf.test.ts` (new) — POST without token rejected, with wrong token rejected, with correct token accepted, GET exempt.
  - [ ] No regression in `server/tests/unit/middleware/gatewayAuth.test.ts`.

**Exit criteria:** `cd server && npm run build`, `cd server && npx vitest run tests/unit/middleware/`, and the existing auth integration suite all pass. No frontend changes yet. No client breaks because no route is *issuing* cookies yet.

## Phase 2 — Backend response cookies + expiry header (PR 2)

Goal: auth endpoints set the cookies on success, clear them on logout, and surface access-token expiry to the client via `X-Access-Expires-At`. The JSON `token`/`refreshToken` fields stay in the response body for one release as a rollback safety net.

- [ ] `server/src/api/auth/login.ts:187-313` — on successful login set:
  - [ ] `sanctuary_access` (HttpOnly, Secure, SameSite=Strict, path `/`, Max-Age = access TTL in seconds)
  - [ ] `sanctuary_refresh` (HttpOnly, Secure, SameSite=Strict, **path `/api/v1/auth/refresh`**, Max-Age = refresh TTL in seconds)
  - [ ] `sanctuary_csrf` (Secure, SameSite=Strict, **NOT HttpOnly** so the frontend can read it)
  - [ ] `X-Access-Expires-At` response header with the access token's `exp` claim as ISO 8601.
  - [ ] Keep the JSON `token`/`refreshToken` fields for one release.
- [ ] `server/src/api/auth/twoFactor/verify.ts:33-140` — same treatment on 2FA success.
- [ ] `server/src/api/auth/tokens.ts:28-81` (refresh):
  - [ ] Read refresh token from `sanctuary_refresh` cookie when the request body has no `refreshToken` field.
  - [ ] Issue rotated `sanctuary_access`, `sanctuary_refresh`, and `sanctuary_csrf` cookies on success.
  - [ ] Set `X-Access-Expires-At` on the response.
  - [ ] Keep accepting the body field for the gateway/mobile path.
- [ ] `server/src/api/auth/tokens.ts:87-160` (logout, logout-all) — clear all three cookies via `Set-Cookie` with `Max-Age=0`.
- [ ] `server/src/api/auth/profile.ts:20` (`/auth/me`) — set `X-Access-Expires-At` on the response so the client can schedule its first refresh after a page reload without an explicit refresh.
- [ ] Update OpenAPI auth response schemas in `server/src/api/openapi/` to document `cookieAuth` and `csrfToken` security schemes alongside the existing `bearerAuth`.
- [ ] Tests:
  - [ ] `server/tests/unit/api/auth.test.ts` and the 2FA verify tests — assert all three Set-Cookie headers carry the expected attributes (HttpOnly where applicable, Secure, SameSite=Strict, expected paths, expected Max-Age).
  - [ ] Logout test — assert all three cookies cleared.
  - [ ] Refresh tests:
    - [ ] Refresh from cookie alone succeeds and rotates the cookies.
    - [ ] Refresh from body alone still succeeds (mobile path regression).
    - [ ] Refresh with both present uses the cookie.
    - [ ] Failed refresh (revoked token) returns 401 and clears the cookies.
  - [ ] Every auth response carries `X-Access-Expires-At` with a valid ISO 8601 timestamp matching the JWT `exp` claim.
  - [ ] OpenAPI tests still pass with the new security schemes documented.

**Exit criteria:** server builds, all auth tests pass, no frontend changes yet, mobile/gateway path still uses the JSON token in the response body.

## Phase 3 — Backend WebSocket cookie reading (PR 3)

Goal: WebSocket upgrades on the same origin authenticate via cookie. The deprecated query parameter token path is removed in the same change.

- [ ] `server/src/websocket/auth.ts:56-72` — extract token from `sanctuary_access` cookie when no Authorization header is present. Use a small cookie-parsing helper (or import from cookie-parser) — do not regex-extract.
- [ ] Remove the deprecated query parameter token path (`server/src/websocket/auth.ts:62-69`). It has been deprecated long enough and removing it eliminates a token-leakage vector via referer headers / server logs.
- [ ] The auth-message-after-connect path (lines 136-191) stays for clients that prefer it. A same-origin browser will normally not need it.
- [ ] Confirm `server/src/utils/jwt.ts` continues to honor the original `exp` claim of an access token until that timestamp passes — so an existing WebSocket connection authenticated with the previous access token survives a cookie rotation. This is one of the open questions in ADR 0002 and the answer governs whether we need to force a WS reconnect on refresh.
- [ ] Tests:
  - [ ] `server/tests/unit/websocket/auth.test.ts`:
    - [ ] Upgrade with valid cookie + no header succeeds.
    - [ ] Upgrade with header only still works (gateway/mobile regression).
    - [ ] Upgrade with deprecated query parameter is now rejected.
    - [ ] Upgrade with a 2FA pending token in the cookie is rejected (the existing `pending2FA` check at line 28 still applies).
  - [ ] `server/tests/integration/websocket/websocket.integration.test.ts` regression check.

**Exit criteria:** all WebSocket auth tests pass, no broken regressions in the WS integration suite, the deprecated query parameter path is gone from the codebase (also remove any client code that emitted it).

## Phase 4 — Frontend cookie auth + refresh flow (PR 4)

This is the biggest phase. It implements both ADR 0001 (cookies replace storage) and ADR 0002 (refresh flow) on the frontend in a single coherent change. Splitting them would mean rewriting `src/api/client.ts` twice.

### 4a — Cookie-based request path

- [ ] `src/api/client.ts` — switch every fetch call (`request`, `fetchBlob`, `download`, `upload`) to `credentials: 'include'`.
- [ ] `src/api/client.ts` — remove `TokenStorageMode`, `getTokenStorageMode`, `getBrowserStorage`, `getPrimaryTokenStorage`, `readStoredToken`, `writeStoredToken`, the legacy localStorage migration block, the `setToken`/`getToken` exports, and the `Authorization` header injection.
- [ ] `src/api/client.ts` — add a CSRF token reader that reads `sanctuary_csrf` from `document.cookie` and injects it as `X-CSRF-Token` on POST/PUT/PATCH/DELETE.

### 4b — Refresh primitive with Web Lock + freshness check

**This is the section that changed after Codex review caught a cross-tab race in the BroadcastChannel-only design. See ADR 0002 Option C (rejected) and Option E (recommended) for the design rationale.**

- [ ] New module `src/api/refresh.ts` (or co-located in `client.ts` if it fits cleanly).
- [ ] Exports `refreshAccessToken()` returning a Promise.
- [ ] Within a single tab, uses single-flight semantics — concurrent callers receive the same in-flight Promise so the lock acquisition itself is not duplicated.
- [ ] The single-flight promise wraps `navigator.locks.request('sanctuary-auth-refresh', { mode: 'exclusive' }, async () => { ... })` for cross-tab mutual exclusion.
- [ ] Inside the lock callback:
  - [ ] **Freshness check first:** if `accessExpiresAt > Date.now() + REFRESH_LEAD_TIME_MS` (60_000), another tab already refreshed during the lock wait — return immediately with no network call.
  - [ ] Otherwise, send `POST /api/v1/auth/refresh` with `credentials: 'include'` and the CSRF header.
  - [ ] On success, parse `X-Access-Expires-At` from the response, update `accessExpiresAt`, broadcast `refresh-complete` with the new expiry, reschedule the local timer.
  - [ ] On failure, broadcast `logout-broadcast` and reject the promise.
- [ ] Lock release happens automatically when the callback returns or throws.

### 4c — Scheduled (proactive) refresh

- [ ] On every successful auth response (`/auth/login`, `/auth/2fa/verify`, `/auth/refresh`, `/auth/me`), parse `X-Access-Expires-At` and schedule a `setTimeout` for `expiresAt - REFRESH_LEAD_TIME_MS` to call `refreshAccessToken()`.
- [ ] Clear the previous timer before scheduling a new one.
- [ ] Clear the timer on logout and on `beforeunload`.

### 4d — Reactive (401) refresh

- [ ] In `src/api/client.ts:request`, when a response status is 401 and the request was not already a retry, await `refreshAccessToken()` and replay the original request once.
- [ ] If the retry also fails with 401, do not retry again — surface the error and trigger logout.
- [ ] Non-401 failures (5xx, network) bypass the refresh path entirely.

### 4e — BroadcastChannel state propagation (NOT mutual exclusion)

- [ ] On client init, open `new BroadcastChannel('sanctuary-auth')`. Mockable for tests via dependency injection.
- [ ] On `refresh-complete` from another tab, update the local `accessExpiresAt` from the broadcast payload and reschedule the local timer.
- [ ] On `logout-broadcast` from another tab, trigger the local logout flow.
- [ ] **Do not implement a `refresh-start` event.** The Web Lock is the start signal. BroadcastChannel is async pub/sub and cannot prevent races; using it as a coordination primitive was the bug Codex caught in the original ADR draft.
- [ ] Close the channel on `beforeunload`.

### 4f — UserContext + logout flow

- [ ] `contexts/UserContext.tsx`:
  - [ ] Stop calling `apiClient.setToken`. The login/2FA-verify handlers no longer touch token storage.
  - [ ] On app boot, call `/api/v1/auth/me`. If it succeeds, hydrate the user and schedule the refresh timer from the response header. If it returns 401, render the login screen.
  - [ ] Logout: clear the scheduled refresh timer, broadcast `logout-broadcast`, redirect to login. Both terminal refresh failure and explicit user logout share this path.

### 4g — Tests

- [ ] `tests/setup.ts`:
  - [ ] Add a `navigator.locks` mock that maintains a Map of held lock names with FIFO waiters and supports multi-instance "tab" simulation. Pure in-memory, no network or filesystem.
  - [ ] Add a BroadcastChannel polyfill or mock that supports multi-instance same-channel pub/sub for the test where two simulated tabs interact.
- [ ] `tests/api/client.test.ts`:
  - [ ] Replace storage mode tests with: every request includes `credentials: 'include'`, non-GET requests include `X-CSRF-Token` from the readable cookie.
  - [ ] `setToken`/`getToken` no longer exist (compile-time error if referenced).
  - [ ] `request()` parses `X-Access-Expires-At` and updates internal state.
- [ ] `tests/api/refresh.test.ts` (new):
  - [ ] Within-tab single-flight: two concurrent `refreshAccessToken()` calls return the same promise; the underlying fetch is called exactly once; the Web Lock is acquired exactly once.
  - [ ] Proactive refresh: with fake timers, advancing past `expiresAt - REFRESH_LEAD_TIME_MS` triggers a refresh exactly once; the new expiry is honored; the timer reschedules itself.
  - [ ] Reactive refresh: a 401 response triggers a refresh and retries the original request; retry success surfaces normally; retry failure surfaces the second 401 and triggers logout.
  - [ ] **Cross-tab Web Lock serialization (the test that catches the bug Codex flagged):** simulate two tabs sharing the same lock state. Both tabs trigger `refreshAccessToken()` simultaneously. Assert exactly one `POST /auth/refresh` is sent across both tabs (the second tab waits on the lock, sees fresh `accessExpiresAt` after the broadcast handler ran, and short-circuits).
  - [ ] Cross-tab race with stale broadcast: same setup, broadcast handler delayed. Assert the second tab still sends its refresh, the second refresh succeeds, and no logout fires (the "wasted refresh but not broken" path).
  - [ ] BroadcastChannel state propagation: `refresh-complete` from another tab updates `accessExpiresAt` and reschedules the timer; `logout-broadcast` triggers the local logout flow.
  - [ ] Terminal refresh failure: server returns 401 on `/auth/refresh`. Assert lock is released, `logout-broadcast` is sent, local logout flow fires.
  - [ ] Non-401 failures (500, network error) do not trigger a refresh attempt.
- [ ] `tests/contexts/UserContext.test.tsx`:
  - [ ] Logout clears the scheduled refresh timer and broadcasts `logout-broadcast`.
  - [ ] On app boot, `/auth/me` is called; success hydrates user + schedules refresh; 401 renders login screen.
- [ ] All existing `apiClient.setToken` test references are removed.
- [ ] Component tests that previously relied on `apiClient.setToken` to seed an authenticated state are updated to mock `/auth/me` instead.
- [ ] Frontend strict typecheck and 100% coverage gate must stay green, including the freshness short-circuit branch and the lock-held-by-another-tab branch.

**Exit criteria:** `npm run typecheck:app`, `npm run typecheck:tests`, `npm run test:coverage` all pass with 100% coverage. `./start.sh --rebuild` and a manual login + 2FA + WebSocket-bearing page works end-to-end in a browser. Verify in browser devtools that:
- The access cookie is HttpOnly (script cannot read it via `document.cookie`).
- The CSRF cookie is readable and is echoed in the `X-CSRF-Token` header on POSTs.
- A scheduled refresh fires before the access token expires.
- Forcing a 401 (e.g., by waiting past expiry without scheduled refresh) triggers a transparent refresh + retry.
- Two open tabs do not race the refresh; the second tab uses the rotated cookie without making its own refresh call.

## Phase 5 — Documentation (PR 5) — COMPLETE 2026-04-13

Goal: the new model is captured in operations and release docs so the next operator does not have to read both ADRs to understand the system.

- [x] `docs/how-to/operations-runbooks.md`:
  - [x] Add the cookie + Secure + TLS termination requirement.
  - [x] Document the CSRF token rotation behavior.
  - [x] Document the refresh token TTL and rotation.
  - [x] Document the BroadcastChannel cross-tab coordination so an operator debugging "why did all my tabs log out at once" knows where to look.
- [x] `docs/reference/release-gates.md` — cookie/CSRF/refresh test suite added to the Browser auth and CSP gate; Phase 4 Browser Auth Gate section rewritten from "remaining architecture decision" to "resolved 2026-04-13".
- [x] `docs/plans/codebase-health-assessment.md`:
  - [x] Security row moved from B to A- (partial schema coverage + accepted dependency findings keep it from a clean A).
  - [x] HttpOnly-cookie ADR row removed from outstanding items table.
  - [x] Ninth Phase 4 slice section records the ADR 0001/0002 implementation and the undocumented refresh-flow gap closure.
- [x] `docs/adr/0001-browser-auth-token-storage.md` — Resolution section added with full commit history, Codex-caught bug list, and Security grade movement.
- [x] `docs/adr/0002-frontend-refresh-flow.md` — Resolution section added with implementation summary, test coverage list, Codex-caught bugs specific to the refresh flow, and answers to all 5 "open questions."
- [x] OpenAPI: `cookieAuth` and `csrfToken` security schemes are now **referenced** from every browser-mounted protected route (not just declared in `components.securitySchemes`). Added `server/src/api/openapi/security.ts` exporting `browserOrBearerAuth = [{ bearerAuth: [] }, { cookieAuth: [], csrfToken: [] }]` and `internalBearerAuth = [{ bearerAuth: [] }]`; every path file (auth, admin, ai, bitcoin, devices, drafts, intelligence, labels, mobilePermissions, payjoin, push, transactions, transfers, walletExport, walletHelpers, walletImport, walletPolicies, walletSettings, walletSharing, wallets) imports the shared constant; `internal.ts` continues to use bearer-only because the `/internal/ai/*` routes are proxied by the AI container, not reachable from browsers. Test assertions in `server/tests/unit/api/openapi.test.ts` updated to `browserOrBearerAuthSecurity` for browser routes and `bearerOnlyAuthSecurity` for internal routes. Caught by Codex stop-time review of Phase 5 — the original carry-over only verified the schemes were *declared*, not *referenced*.

**Exit criteria:** ✓ docs reviewed, both ADR resolution sections filled in, codebase health assessment grade movement recorded.

## Phase 6 — Deprecation removal (PR 6) — COMPLETE 2026-04-13

Goal: remove the rollback safety net once we are confident the cookie + refresh path is stable.

**Scope note:** the original Phase 6 plan assumed browser-mounted and gateway-mounted auth routes were separately mounted. They aren't — there's a single `authRouter` under `/api/v1/auth` that serves both browsers and the gateway's transparent proxy. Mobile is not currently an active consumer. Given that, Phase 6 strips the JSON `token`/`refreshToken` fields from **all** callers of the auth router. If/when a mobile client ships, it will need to authenticate via cookies OR the auth flow will need a cryptographically-verified gateway channel (the `shared/utils/gatewayAuth.ts` HMAC primitive is the obvious building block). That future work is explicitly out of scope here.

- [x] Remove the JSON `token`/`refreshToken` fields from `/auth/register`, `/auth/login`, `/auth/2fa/verify`, and `/auth/refresh` response bodies (`server/src/api/auth/login.ts`, `server/src/api/auth/twoFactor/verify.ts`, `server/src/api/auth/tokens.ts`). Rollback-safety-net comments replaced with Phase 6 rationale.
- [x] Update OpenAPI schemas to drop `token`/`refreshToken` from `LoginResponse` and `RefreshTokenResponse`; `RefreshTokenResponse.required` updated from `['token','refreshToken','expiresIn']` to `['expiresIn']`.
- [x] Remove `VITE_AUTH_TOKEN_STORAGE` leftover from `.env.example` (there was no `vite.config.ts` entry to remove — Phase 4 already did that).
- [x] Audit `src/api/client.ts` for Phase-4-era dead code. Confirmed clean: no `setToken`/`getToken`/`TokenStorageMode`/`readStoredToken`/`writeStoredToken`/`storedToken`/"rollback"/"legacy" references. Phase 4 removed all of it.
- [x] Update 12 unit test assertions in `server/tests/unit/api/auth.routes.registration.test.ts` and `server/tests/unit/api/auth.routes.2fa.test.ts` from `toBeDefined()` to `toBeUndefined()` for `response.body.token` / `response.body.refreshToken`. Where the assertion was load-bearing (rotation tests), replace with `Set-Cookie` content assertions.
- [x] Refactor integration tests in `server/tests/integration/flows/auth.integration.test.ts`, `admin.integration.test.ts`, and `security.integration.test.ts` to read tokens from the `sanctuary_access` / `sanctuary_refresh` Set-Cookie headers instead of the response body. Added `extractAuthTokens(response)` helper in `server/tests/integration/setup/helpers.ts`.

**Exit criteria achieved:**
- ✓ Backend builds and typechecks cleanly.
- ✓ Backend unit + integration test suites pass (8749 unit + 503 integration-skip-when-no-db).
- ✓ Frontend coverage gate stays at 100% (5475 tests).
- ✓ Gateway builds and 510 gateway tests pass.
- ✓ No test references `VITE_AUTH_TOKEN_STORAGE`.
- ✓ No test references `apiClient.setToken`.
- ✓ No production code reads or writes the JSON `token`/`refreshToken` field anywhere on the auth routes.

## Cross-phase guardrails

- Run the full local test suite + typechecks before pushing each phase. CLAUDE.md is explicit: "Do not rely on CI to catch test failures or type errors."
- Pre-commit hooks run AI agents whose feedback must be reviewed (CLAUDE.md "Run `git commit` in foreground"). Each phase commits in foreground.
- Per CLAUDE.md "When fixing CI failures... batch all related fixes together." If a phase touches a pattern (e.g., removing `apiClient.setToken`), grep the full repo for the pattern *before* committing so we do not ship one file at a time.
- The mobile gateway path (`gateway/`, `shared/utils/gatewayAuth.ts`) must remain untouched in functionality. Every phase should run `cd gateway && npm run build` and the gateway request-validation/proxy/HMAC tests as a regression check.
- The 100% frontend coverage gate is non-negotiable. If a refactor removes coverage, the missing branches must be added back in the same PR.
- Per the "no cutting corners" working rule: if a step would be easier by deferring a related concern, push back on the deferral first. The right question is "is the long-term solution healthier?" not "is this slice smaller?"
