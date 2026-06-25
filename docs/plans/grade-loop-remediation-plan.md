# Grade-Loop Remediation Plan

**Source grade report**: `docs/plans/codebase-health-assessment.md`
**Source grade date**: 2026-06-25
**Source commit**: `7ae26a00`
**Source score**: 93/100 (A, High confidence)
**Selected finding**: Maintainability 3.1 — worst cyclomatic-complexity hotspot. `components/WalletDetail/modals/ExportModal.tsx` has a component body at **CCN 31** (2× the McCabe/SonarQube threshold of 15), the highest in the codebase among 35 functions flagged by ESLint's AST `complexity` rule.

---

## Objective

Reduce the `ExportModal` component-body cyclomatic complexity from **31 to ≤15** by extracting its five self-contained tab bodies (and the tab bar) into focused presentational sub-components, with **no change to rendered DOM, accessibility semantics, or behavior**.

**Acceptance criterion**: `npx eslint components/WalletDetail/modals/ExportModal.tsx --rule '{"complexity":["error",15]}'` reports **zero** complexity violations, and the existing 46-test suite (`tests/components/WalletDetail/modals/ExportModal.test.tsx`) passes unchanged. Frontend coverage stays at 100%.

## Non-Goals

- **No** behavior, layout, styling, or a11y change. This is a pure structural extraction; the DOM output must be identical so the existing tests pass without modification.
- **No** change to `generateMultisigConfigText` (exported and independently tested) — it stays exported from `ExportModal.tsx`.
- **No** change to the public `ExportModal` named export or its props/`index.ts` barrel — all five importers must keep working untouched.
- **Do not** refactor the other 30 production CCN>15 functions in this PR (see Deferred Findings). The rubric warns against broad refactoring campaigns, and no single PR moves the all-or-nothing mechanical 3.1 bucket (needs ≤15 total).
- **Do not** add an ESLint `complexity` CI gate yet — that would lock in 35 violations and add a failure surface to a documented-fragile CI. Sequence after reductions land.
- **Do not** touch CI workflows or version files.

## Selected Slice

Extract from the `ExportModal` body into a new sibling folder `components/WalletDetail/modals/exportTabs/`:

1. `ExportTabBar.tsx` — the five-button tab navigation (removes the `isMultisig &&` device-button branch + five active-state ternaries from the parent). **Constraint**: the existing Device-tab tests (`tests/.../ExportModal.test.tsx:524`) locate the Device tab as "the last `<button>` in the tab row containing the device icon", so the extracted tab bar must keep the identical container element, button ordering, and the `HardDrive` icon inside the Device button.
2. `QrExportTab.tsx` — QR format toggle, size slider, QR render, multisig notes (the highest-branch section: `isMultisig`, `devices.length`, `qrFormat` conditionals).
3. `JsonExportTab.tsx`, `TextExportTab.tsx`, `LabelsExportTab.tsx` — the three simple tab bodies (Text carries the `isCopied` ternaries).
4. `DeviceExportTab.tsx` — loading / empty / list tri-state.

The parent `ExportModal` keeps all state (`exportTab`, `qrFormat`, `qrSize`, `exportFormats`, `loadingFormats`), the `useEffect`, the handlers (`downloadJson`, `downloadLabels`, `downloadDeviceFormat`, `getQrValue`), the a11y hooks, and renders `{exportTab === 'qr' && <QrExportTab .../>}` etc. Moving the branch-heavy JSX into child components removes those decision points from the parent's McCabe count.

## Phases

### Phase A — Extract tab bodies (dependency-ordered, lowest risk first)
- File areas: new `components/WalletDetail/modals/exportTabs/*.tsx`; edited `components/WalletDetail/modals/ExportModal.tsx`.
- Extract the three simple tabs first (Json, Labels, Text), then DeviceExportTab, then QrExportTab, then ExportTabBar — re-running the focused eslint complexity check after each to confirm the count drops monotonically and the parent crosses ≤15.
- Pass only the props each child needs; keep all callbacks and state in the parent.

### Phase B — Verify DOM parity
- Run the existing 46-test suite unchanged. Any failure means the extraction altered output — fix the extraction, not the test.

### Phase C — Coverage parity
- The new sub-components are exercised transitively by the existing ExportModal tests (which render every tab). Confirm frontend coverage stays 100%; add a focused test only if coverage reveals a genuinely new uncovered branch introduced by a prop-defaulting decision.

## Compatibility / Rollback

- Risk is low: presentational extraction guarded by 46 existing tests and the 100% frontend coverage gate. No funds/auth/signing logic is touched.
- Rollback: revert the single commit; the public `ExportModal` API is unchanged, so no caller is affected.

## Verification Commands

Focused (per phase):
- `npx --no-install eslint components/WalletDetail/modals/ExportModal.tsx components/WalletDetail/modals/exportTabs/ --rule '{"complexity":["error",15]}'` → 0 violations.
- `npm run test:run -- tests/components/WalletDetail/modals/ExportModal.test.tsx` → 46 pass.

Closeout (proportional to blast radius — frontend only):
- `npm run typecheck:app && npm run typecheck:tests`
- `npm run lint:app`
- `npm run build`
- `npm run test:coverage` (frontend) → 100%
- `git diff --check`

## Acceptance Criteria

- [ ] `ExportModal.tsx` component body ≤ CCN 15 (eslint complexity clean on the file + new folder).
- [ ] Existing 46 ExportModal tests pass **unmodified**.
- [ ] Frontend typecheck, lint, build pass.
- [ ] Frontend coverage 100%.
- [ ] `ExportModal` public export, props, and barrel unchanged; all 5 importers untouched.
- [ ] No DOM/behavior/a11y change.

## Deferred Findings (explicit)

The remaining 30 production CCN>15 functions are **not** in scope. Recommended phased order (write non-regression tests first per CLAUDE.md, then refactor):

1. **Funds/auth/signing (highest risk)** — `enforceAgentFundingPolicy` (22), `server/src/api/auth/tokens.ts` route (22), ledger `signPsbt` (23), jade `signPSBT` (22), `createTransaction` (16).
2. **Frontend components** — `ChangePasswordModal` (23), `DashboardContent` (21), `AdvancedSettings` (18), `WizardNavigation` (18), `useWalletData`/`useAppearanceTabController`/`useDeviceListPreferences` hooks (17).
3. **Server services/repos** — `notifyAIInsight` (21), `workerHealth` (21), `updateAgent` (18), `registry.invoke` (18), `metricsExporter.buildServerStat` (19), `getMetrics` (17), `executeSyncPipeline` (17), others (16).
4. **scripts/** (4, lowest priority) — perf/architecture tooling.

Mechanical 3.1 stays at 0 until the total is ≤15; it reaches +1 at ≤15 and +3 at ≤5. A complexity-budget ESLint ratchet should be added **after** the count is low, not before.
