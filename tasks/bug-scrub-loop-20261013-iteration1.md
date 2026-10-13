# Bug Scrub Loop 2026-10-13 — Iteration 1 Remediation Plan

- Run: `bug-scrub-loop-20261013-sanctuary`, iteration 1
- Source target SHA: `3450cfe0508da24747eb6eb9d0562f87578435a0` (`origin/main`)
- Scope: whole repository (locked)
- Delivery: one PR from `codex/bug-scrub-loop/20261013-i1`, one commit per phase
- Blocking findings (P0–P2): 9 — two P1, seven P2

## Goal

Fix every confirmed P1/P2 finding from the iteration-1 scrub with a failing
non-regression test written first, and deliver them in one reviewed PR.

## Non-goals

- P3 backlog stays out of this fix set:
  - `historical-price--local-timezone-day`
  - `auth-session--hardcoded-expires-in`
  - `transaction-amount-schema--fractional-500`
  - `mcp-key-scope--empty-wallet-list-unscoped`
  - `admin-group-update--missing-audit-entry`
  - `fcm-provider--v1-invalid-token-unclassified`
  - `electrum-reorder--non-atomic`
  - `transaction-csv--exponent-btc-amounts`
  - `sparrow-export--prototype-key-model-lookup`
  - `admin-audit-logs--invalid-date-500`
  - `admin-node-config--unchecked-integers`
- No Prisma schema or migration changes. The RC10 migration digest is pinned.
- No `shared/` changes. The worktree symlinks `node_modules`, so shared
  workspace edits would resolve to the primary checkout's build.
- No new API endpoints, so the e2e mock maps need no new entries.
- No wallet-name validation change. The fix is at the export boundary.
  Rejecting control characters at write time is a separate product decision.

## Assumptions

- `validatePagination` caps `limit` at 1000 (`server/src/utils/errors.ts:238`).
  The UTXO endpoint therefore cannot return more than 1000 rows per request.
  The client must page.
- The e2e harness keys mocks by `METHOD path` with no query string. Its UTXO
  mocks return `count` equal to the list length. A client that stops on a short
  page makes exactly one request against them.
- `wallet-sync-lifecycle-contract.json` and `wallet-sync-mutation-boundaries.json`
  match on function and method names, not line numbers. Read-only `orderBy`
  changes in `addressRepository`/`utxoRepository` do not alter them.

## Findings and phases (dependency order)

### Phase 1 — Stable paging order (`list-pagination--unstable-tie-order`, P2)

Evidence:
- `server/src/repositories/utxoRepository.ts:277`: `findUnspentWithDraftLocks`
  orders only by `amount desc`.
- `server/src/api/transactions/walletTransactions/listTransactions.ts:117-120`:
  ordered by `blockTime desc nulls first, createdAt desc`, with no `id`.
- `server/src/repositories/addressRepository.ts` has three `index asc`-only
  queries that page with `skip`. Receive and change addresses share indices.
  - `:199` `collectAddressIdsByChain` scan loop.
  - `:274` `findByWalletId`, which takes `skip`/`take`.
  - `:486` the unfiltered labelled list.
  - The other `index` orderBys (`:302`, `:318`, `:332`, `:348`, `:367`,
    `:523`) take no `skip`, so they are left unchanged (audited 2026-10-13).
- `findUnspentWithDraftLocks` has two callers, and both page with take/skip:
  `api/transactions/utxos.ts:43` and the MCP resource
  `server/src/mcp/resources/index.ts:216`. Both are fixed by the repository
  change.
- Reference fix: `server/src/api/transactions/crossWallet.ts:180-192` already
  adds `{ id: 'desc' }` and documents why.

Changes:
- Append an `id` tiebreaker in the same direction to each `orderBy`:
  - `utxoRepository.findUnspentWithDraftLocks`: `[{ amount: 'desc' }, { id: 'desc' }]`.
  - `listTransactions.ts`: add `{ id: 'desc' }`.
  - `addressRepository` `:199`, `:274` and `:486`:
    `[{ index: 'asc' }, { id: 'asc' }]`.

Tests (write first, must fail on the current code):
- Gating tests are unit tests asserting that the Prisma `orderBy` passed by
  each changed query ends with an `id` key.
  - Use the existing mocked-prisma unit files
    `server/tests/unit/repositories/utxoRepository.test.ts` and
    `addressRepository.test.ts`.
  - For `listTransactions`, use the route's unit test. Locate it with
    `grep -rln "listTransactions\|walletTransactions" server/tests/unit`.
  - Update existing `orderBy` expectations that those files already assert.
- Supplement, not gating: add an integration test in
  `server/tests/integration/repositories/utxoRepository.test.ts`.
  - Seed equal-amount UTXOs and page them, asserting disjoint pages.
  - Postgres often returns stable tie order on tiny tables, so this test may
    pass before the fix.
  - Do not add a new integration spec file. If one is added, it must be
    registered in `scripts/ci/backend-integration-groups.sh`.

Acceptance: all five queries (one UTXO, one transaction, three address) have a
total order, and the tests pass.

### Phase 2 — Send/stats load every UTXO (`send-utxo-loader--silent-1000-cap`, P2; depends on Phase 1)

Evidence:
- `src/components/send/SendTransactionPage/loadSendTransactionPageData.ts:55`
  calls `getUTXOs(walletId)` with no paging.
- `src/components/WalletDetail/hooks/walletDataLoaders.ts:103` (`loadUtxosForStats`)
  does the same.
- The server caps an unpaged request at 1000 rows (`server/src/utils/pagination.ts:11`).
- `useTransactionComposition.ts:69-80` computes `maxSendable` and the available
  balance from the loaded list only.

Changes:
- Add `getAllUTXOs(walletId: string): Promise<GetUTXOsResponse>` to
  `src/api/transactions/utxos.ts` and export it from
  `src/api/transactions/index.ts`.
  - It calls the existing `getUTXOs(walletId, { limit: 1000, offset })`, which
    keeps the `GetUtxosResponseSchema` validation.
  - It loops with `offset` 0, 1000, 2000 and so on.
  - It stops only on a page shorter than 1000 rows, or at the hard page cap
    `ceil(firstPage.count / 1000) + 1`. A stale `count` therefore cannot stop
    paging early, and a growing one cannot loop forever.
  - It dedupes by `id`, keeping the first occurrence.
  - It returns `{ utxos, count, totalBalance }` with `count` and
    `totalBalance` from the first page. Totals can drift if UTXOs change
    mid-paging; that is accepted, the same as the existing single-call
    staleness.
- Implementation divergence (2026-10-13, from pre-commit review): the
  count-based page cap can still stop early when `count` lags the rows. Its
  only purpose was loop safety, so it was replaced:
  - Paging continues while pages are full.
  - It stops on a short page, on a full page that adds no new rows (a server
    ignoring `offset`).
  - Reaching `MAX_UTXO_PAGES = 100` (100,000 UTXOs) throws instead of
    returning a truncated set.
  - `count` is no longer a stop condition.
  - A failed later page rejects the whole call.
- Use `getAllUTXOs` in `loadSendTransactionPageData` and `loadUtxosForStats`.
  The paged UTXO tab (`walletDataLoaders.ts:89`) keeps its explicit paging.
- Update the test mocks that stub `transactionsApi` with only `getUTXOs` and
  the assertions on `getUTXOs('wallet-1')` for these loaders:
  - `tests/components/send/SendTransactionPage.test.tsx` (`:52`, `:172`, `:224`).
  - `SendTransactionPage.branches.test.tsx`.
  - `useSendTransactionPageController.ownership.test.tsx`.
  - `tests/components/WalletDetail/hooks/walletDataLoaders.branches.test.ts`.
  - `WalletDetail.test.tsx`.
  - `useWalletData.test.ts`, `useWalletData.utxoStats.test.ts` and
    `useWalletData.supersession.test.ts`.
  - `useWalletDetailController.network.test.tsx` and
    `useWalletDetailController.utxoStats.test.tsx`.
  - The `WalletDetailWrapper` harness and contracts files.
  - Enumerate them with `grep -rln "getUTXOs" tests src | grep -v "^src/api"`.
    Each mock must provide `getAllUTXOs` where the code under test now calls
    it.

Tests (first):
- `tests/api/...utxos` or a new `tests/api/transactions/getAllUTXOs.test.ts`:
  - Mock `apiClient.get` to return page 1 with 1000 rows and `count: 1500`,
    then page 2 with 500 rows. Assert both pages are requested, with
    offsets 0 and 1000, and that 1500 rows are returned.
  - A short first page makes a single request.
  - A duplicate id across pages appears once.
  - A count that grows mid-paging stops at the page cap.
- `loadSendTransactionPageData` and `walletDataLoaders` tests assert the new
  helper is used, so a 1500-UTXO wallet yields 1500 UTXOs.
- The frontend coverage threshold is 100%. Cover every branch of the helper.

Acceptance: send-page and stats UTXO sets equal the server's `count` for
wallets with more than 1000 UTXOs, and `vitest --coverage` stays at 100%.

### Phase 3 — Connect Device clears stale identity (`connect-device-form--stale-accounts-after-reimport`, P1)

Evidence:
- `src/components/ConnectDevice/hooks/useDeviceForm.ts:185-219`:
  `applyParseResult` sets `parsedAccounts`, `selectedAccounts` and
  `derivationPath` only when the new import provides them.
- `useDeviceForm.ts:302-309`: `handleSelectMethod` does not reset any
  identity field.
- `buildPayload` (`:329-358`) prefers the stale `parsedAccounts` alongside the
  new fingerprint. The device is saved with fingerprint B and A's xpubs.

Changes:
- Add `resetImportedIdentity(prev)` in `useDeviceForm.ts`. It returns
  `prev` with these fields reset to the values from `createInitialFormData`
  (`:115-124`):
  - `xpub: ''`.
  - `fingerprint: ''`.
  - `derivationPath: "m/84'/0'/0'"`, the existing default, not `''`.
  - `parsedAccounts: []`.
  - `selectedAccounts: new Set()`.
  - The label is kept.
- In both branches of `applyParseResult` (QR at `:191-200`, file at
  `:205-216`), start from `resetImportedIdentity(prev)`. Then apply only the
  fields the new result provides, and guard every assignment.
  - Use `if (result.xpub) updates.xpub = result.xpub`, and the same for
    `derivationPath` and `accounts`.
  - The QR branch's unconditional `updates.xpub = result.xpub` must become
    guarded, so an accounts-only QR result cannot write `undefined` into the
    string field.
  - A field the new result lacks falls back to the default instead of the
    previous import's value.
- The file branch also calls `setQrExtractedFields(null)`, so QR badges from
  an earlier QR import do not survive a file import.
- The USB effect (`:237-249`) also starts from `resetImportedIdentity(prev)`.
  This is low value, since a USB result has accounts and no top-level xpub,
  but it keeps the three import paths consistent.
- `handleSelectMethod` applies `setFormData(resetImportedIdentity)`.
- Validation context: `hasValidImportIdentity` already rejects a top-level
  xpub without a path, and the reverse. The reachable leaks are therefore:
  - stale `parsedAccounts` and `selectedAccounts`;
  - a stale `derivationPath` when the new result carries accounts but no
    top-level path;
  - a stale `xpub` when the new result has accounts only.

Tests (first, `tests/components/ConnectDevice/useDeviceForm.*.test.tsx`):
- Covers `handleSelectMethod`; this is the user-reported flow:
  - Apply a two-account import, call `handleSelectMethod('file')`, apply a
    single-xpub file import with fingerprint `bbbbbbbb` and no accounts, then
    save.
  - Assert the payload has `{ xpub, derivationPath }` from import B,
    `fingerprint: 'bbbbbbbb'` and no `accounts`.
  - This test fails today.
- Gating test for the `applyParseResult` reset: without reselecting the
  method, apply an accounts-bearing import, then an xpub-only import. The
  payload carries no accounts from the first import. It must fail with only
  the `handleSelectMethod` change in place.
- Apply an accounts-only QR result after a single-xpub import. Afterwards
  `formData.xpub === ''`, not `undefined`.
- After a QR import that sets `qrExtractedFields`, a file import clears them.
- After an import, `handleSelectMethod` resets `derivationPath` to
  `m/84'/0'/0'` and `parsedAccounts` to `[]`.
- Existing `useDeviceForm.coverage.test.tsx` expectations stay green.

Acceptance: no combination of sequential imports produces a payload that
mixes identity fields from two imports.

### Phase 4 — Group-shared signers resolve in wallet import (`wallet-import--group-shared-signer-not-resolved`, P2)

Evidence:
- `server/src/repositories/deviceRepository.ts:103-117`:
  `findByUserIdWithModel` matches only on `userId` or `users.some`.
- `server/src/services/walletImport/deviceReuseAccess.ts:15-31` grants reuse
  through the group role.
- `Device.fingerprint` is unique, so creating the device raises P2002, which
  becomes a 409.

Changes:
- Add the group-membership branch used by `findAccessibleByUser`
  (`deviceRepository.ts:619`) to the `OR` in `findByUserIdWithModel`:
  `{ groupId: { not: null }, group: { members: { some: { userId } } } }`.
  Keep the existing `{ userId }` owner branch.
  - `findAccessibleByUser` has no owner branch, so a shared fragment would not
    be identical. Write the clause inline, with a comment pointing to
    `findAccessibleByUser`.
- Its only production caller is `deviceResolution.ts:46`. That is used by the
  import preview, the import, and `assertExistingDeviceBindingsUnchanged`.
  All three now agree.
- Label dedupe (`existingLabels`) now also covers group devices, so new
  devices never collide with a visible label. This is intended.
- Preview semantics: the preview reports reuse for a group device without
  checking the role. The import transaction still enforces
  `assertDeviceReuseAccess` (view to reuse an exact account, owner to add an
  account). The preview is left as it is; it already behaves this way for
  `DeviceUser` viewer grants.
- Guard configs grepped (`config/*.json`, `scripts/check-*.mjs`): there are
  no pins on `findByUserIdWithModel` or `deviceResolution`.

Tests (first):
- Update `server/tests/unit/repositories/deviceRepository.test.ts:170-191`,
  which asserts the current `where`, to the new shape.
- Unit test for `resolveDevices`:
  - a group-only device with a matching fingerprint returns
    `willCreate: false` and `existingDeviceId: D`;
  - a group device's label is counted for dedupe.
- Integration test, required:
  - Extend `server/tests/integration/flows/walletImportConcurrency.integration.test.ts`
    or the existing wallet-import integration flow file, without adding a new
    spec file.
  - User B in group G imports a descriptor containing the fingerprint of
    group-shared device D, which has a matching account.
  - Expect the wallet to be created and bound to D with no new device row.
- `walletImportConcurrency.contracts.ts:69` and the integration spy at
  `:373-374` keep working. Run them.

Acceptance: a group member's import reuses a group-shared device. A viewer
role still cannot add a new account, which `assertDeviceReuseAccess` enforces.

### Phase 5 — MCP admin summary honours wallet scope (`mcp-admin-summary--ignores-key-wallet-scope`, P1)

Evidence:
- `server/src/assistant/tools/adminReadTools.ts:87-93` checks only
  `requireAdminContext`, then calls
  `findAdminAgentDashboardRowsForAssistant(rowLimit + 1)`.
- `server/src/mcp/tools/index.ts:22-33` passes `walletScopeIds`, which this
  tool never reads.

Changes:
- `findDashboardRows(options?: { limit?: number; walletIds?: string[] })` in
  `agentDashboardRepository.ts`: when `walletIds` is defined, filter agents
  with
  `where: { fundingWalletId: { in: walletIds }, operationalWalletId: { in: walletIds } }`.
  Both wallets must be in scope, because each row reveals both wallets' names.
  - The filter goes in the `findMany` `where` of `findDashboardAgents`, before
    `take`, never as a post-filter.
  - AND is required because `summarizeDashboardRow` (`adminReadTools.ts:34-59`)
    exposes both wallet summaries. `agent.user` and `signerDevice` are loaded,
    but the tool already redacts them.
- `findAdminAgentDashboardRowsForAssistant(limit, walletIds?)` forwards the
  filter.
- Scope rule in the tool, because the two sources encode "unscoped"
  differently:
  - MCP: `buildMcpKeyScope` (`mcp/auth.ts:47`) leaves `walletIds` undefined
    for an unscoped key.
  - Console: `scopeWalletIds` (`assistant/console/protocol.ts:207-212`)
    returns `[]` for the `general` and `admin` scopes, the scopes meant for
    this tool.
  - Rule:
    - `context.source === 'mcp'` and `walletScopeIds !== undefined`: filter
      by `walletScopeIds`. An empty array yields zero rows, failing closed.
    - Otherwise, a non-empty `walletScopeIds` (a console wallet or
      wallet-set scope): filter by it.
    - Otherwise: unfiltered, the current behaviour.
  - Other wallet tools treat `[]` as nothing visible
    (`dashboardReadTools.ts:63`). This admin tool differs on purpose, because
    a console admin scope is expressed as `[]`. Document this in a code
    comment.
- Other admin assistant tools were checked:
  `get_admin_operational_summary` is the only `kind: 'admin'` tool
  (`grep "kind: 'admin'" server/src/assistant/tools`).
- The admin REST dashboard (`adminAgentService.ts:363`) is unchanged.

Tests (first, a new `server/tests/unit/assistant/adminReadTools.test.ts` or
an existing assistant tools unit file). All use an admin actor and a mocked
repository.
- MCP with `walletScopeIds: ['w1']` calls the repository with
  `walletIds: ['w1']`. This test fails today.
- MCP with `walletScopeIds: []` calls it with `walletIds: []`.
- MCP with `undefined` calls it unfiltered.
- Console with `[]` (admin scope) calls it unfiltered.
- Console with `['w2']` calls it with `['w2']`.
- `agentDashboardRepository.test.ts`: a `walletIds` value produces the AND
  `where` together with `take`. Omitting it leaves the query unchanged.

Acceptance: a wallet-scoped MCP key never receives rows for wallets outside
its scope.

### Phase 6 — Push cleanup is idempotent (`push-device-cleanup--non-idempotent-delete`, P2)

Evidence:
- `server/src/services/push/pushService.ts:146`: after a successful send,
  `updateLastUsed` throws P2025 on a removed row, and the catch records a
  push failure for a delivered push.
- `pushService.ts:177`: `deleteById` throws inside `catch`, escapes
  `sendToUser`, and aborts the `notifyNewTransactions` user loop (`:277`).
- `pushDeviceRepository.ts:113-127` uses `update` and `delete`.

Changes:
- `pushDeviceRepository.updateLastUsed` uses `updateMany({ where: { id } })`.
  `deleteById` uses `deleteMany({ where: { id } })`. Both are idempotent and
  ignore missing rows, and both keep `Promise<void>`.
  - Callers:
    - `pushService.ts:146`, `:152` and `:177`.
    - `server/src/api/push.ts:315`, the gateway invalid-token removal. It
      already documents idempotent intent ("Return success even if not
      found"), and `deleteMany` closes its findById→delete race.
    - Other grep hits are same-named functions in unrelated repositories.
  - Run the route's tests (`server/tests/unit/api/push/*`, harness at
    `pushTestHarness.ts`). Add a case where `deleteById` resolves after the row
    vanished and the route still returns success.
  - `server/tests/integration/repositories/pushDeviceRepository.test.ts` has
    no throw-on-missing assertion.
- In `sendToUser`, the success and invalid-token cleanup calls (`:146`,
  `:152`, `:177`) go through a `cleanupDevice` helper that catches and logs
  any error at warn level. Cleanup failures never:
  - reach the per-device failure path, so no false `recordPushFailure`;
  - escape the loop, so the remaining devices and users are still notified.

Tests (first, `server/tests/unit/services/push/pushService.test.ts`, mocked
repository):
- `deleteById` rejects, with any error, for device A of a user with devices
  A and B. `sendToUser` still sends to B and resolves. This fails today.
- `updateLastUsed` rejects after a successful send. `recordPushFailure` is
  not called. This fails today.
- In the invalid-token result branch (`:152`), a `deleteById` rejection does
  not record a push failure.
- `server/tests/unit/repositories/pushDeviceRepository.test.ts`: assert the
  `updateMany` and `deleteMany` calls.
- Add an integration case to the existing integration file: `deleteById` and
  `updateLastUsed` on a missing id resolve.

Acceptance: concurrent device removal cannot fail a delivered push or abort
other users' notifications.

### Phase 7 — Console fallback dates validate calendars (`console-fallback-dates--invalid-iso-date`, P2)

Evidence:
- `llm-egress-proxy/src/consoleProtocolDates.ts:113-126` calls `toISOString()`
  on an unchecked `Date`.
- In Node, `2024-13-01` gives Invalid Date, and `toISOString()` throws a
  RangeError. `2024-02-31` rolls over to `2024-03-02`.

Changes:
- `parseIsoDateRange` parses each `YYYY-MM-DD` into numbers and builds the
  dates with `new Date(Date.UTC(y, m - 1, d))` plus `setUTCFullYear(y)`, so
  years 0000-0099 are not remapped.
  - It requires `getUTCFullYear() === y`, `getUTCMonth() === m - 1` and
    `getUTCDate() === d` for both ends.
  - If either end fails, it returns `null`.
  - It keeps the end-of-day time (`23:59:59.999Z`) for `dateTo`.
- On `null`, the chain at `:167` falls through to the month-year parsers.
  Those match month names only (`monthNumbers`), so `2024-13-01` cannot match
  them, and the planner applies no date filter.
- The other `toISOString` sites (`:53`, `:57`, via `toIsoDate`) take month
  indices from the `monthNumbers` map (0-11) and a 4-digit year, so they
  cannot produce Invalid Date. Audited; they are unchanged.

Tests (first, `tests/llm-egress-proxy/consoleProtocol*.test.ts` or a new
`tests/llm-egress-proxy/consoleProtocolDates.test.ts`, run with
`npx vitest run --config llm-egress-proxy/vitest.config.ts <file>`):
- `fallbackPromptDateRange` for "transactions 2024-13-01 to 2024-13-05" does
  not throw and returns `{}`. That function returns `{}` when no parser
  matches.
- "2024-02-30 to 2024-02-31" produces no March dates.
- A valid range is unchanged.

Acceptance: no prompt text can make the fallback planner throw.

### Phase 8 — AI JSON cleanup respects strings (`ai-structured-response--comment-strip-corrupts-strings`, P2)

Evidence:
- `llm-egress-proxy/src/aiClient.ts:352-356` applies regex comment and
  trailing-comma stripping across string contents.
- `insightRoutes.ts:79-87` returns 500 when parsing fails.

Changes:
- `parseStructuredResponse` first tries `JSON.parse(jsonMatch[0])` unchanged.
- Only on failure does it run a string-aware cleanup:
  - A small scanner that tracks whether it is inside a double-quoted string,
    including escapes.
  - Outside strings it removes `//` comments up to the next newline or the
    end of input, and `/*…*/` comments.
  - It drops a comma when the next non-whitespace character is `}` or `]`.
  - An unterminated `/*` stops the scan and leaves the remaining text
    unchanged, so `JSON.parse` fails and the function returns `null`.
  - Single quotes are ordinary characters, because they do not delimit
    strings in JSON.
- Then it calls `JSON.parse`. On failure it still returns `null`.
- Drop the blank-line collapse `.replace(/\n\s*\n/g, "\n")`. Whitespace
  between tokens is irrelevant to `JSON.parse`, and a raw newline inside a
  string is already invalid JSON.
- No new dependency (no JSON5).
- Callers: `insightRoutes.ts:79` and `consoleProtocolPlanParsing.ts:83`. A
  console plan containing a URL now parses on the first try instead of going
  through `recoverStructuredPlan`.
- Non-goal: the code-fence and greedy `\{[\s\S]*\}` extraction stay as they
  are.

Tests (first, `tests/llm-egress-proxy/aiClient.test.ts`, run with
`npx vitest run --config llm-egress-proxy/vitest.config.ts tests/llm-egress-proxy/aiClient.test.ts`):
- A pretty-printed object whose summary is `"see https://x.y"` parses intact.
  This fails today.
- A value containing `"a /* b */ c"` and one containing `",}"` are preserved.
- A value with an escaped quote and comment-like text (`"a \" // b"`) is
  preserved.
- Real `//` and `/* */` comments and trailing commas outside strings are
  still tolerated.
- Valid JSON input deep-equals `JSON.parse(input)`.

Acceptance: valid JSON is never altered, and the existing lenient cases still
parse.

### Phase 9 — Exports neutralise line breaks (`wallet-export--unsanitized-newlines`, P2)

Evidence:
- `server/src/services/export/handlers/descriptor.ts:27` (`# Wallet: ${name}`)
  and `:49` (`# - ${label}`).
- `coldcard.ts:104` and `bluewallet.ts:118` (`Name: ${name}`).
- The wallet name schema is `z.string().min(1)` (`api/wallets/crud.ts:58`).

Changes:
- Add `server/src/services/export/handlers/textLine.ts` exporting
  `singleLine(value: string): string`. It replaces `\r\n`, `\r`, `\n`, U+2028
  and U+2029 with a single space.
- The handlers are `bluewallet.ts`, `coldcard.ts`, `descriptor.ts` and
  `sparrow.ts`. Sparrow emits JSON and is unchanged. Apply `singleLine` to
  every interpolated value in the three text handlers:
  - `descriptor.ts`: wallet name (`:27`) and device label, fingerprint,
    derivationPath and xpub (`:49-53`).
  - `coldcard.ts`: wallet name (`:104`) and the fingerprint, derivationPath
    and xpub lines (`:112`, `:128`).
  - `bluewallet.ts`: wallet name (`:118`) and the derivationPath, fingerprint
    and xpub lines (`:134-135`).
  - Coldcard has no device label line.
  - Fingerprints, xpubs and paths are format-validated at device
    registration. Sanitising them is defence in depth and cheap.
- Do not sanitise the descriptor body lines (`wallet.descriptor` and
  `changeDescriptor`). They are server-built.
- Filenames already strip to `[a-zA-Z0-9-_]`. The Content-Disposition
  handling of `options.filename` is out of scope (MINOR, not a finding).

Tests (first; plus a `textLine` unit test):
- Coldcard: `server/tests/unit/services/export/coldcardHandler.test.ts`.
- BlueWallet and descriptor: `formatHandlers.test.ts`.
- A wallet name of `"a\nPolicy: 1 of 1"` exported via Coldcard and BlueWallet
  produces exactly one line starting with `Policy:`, the real one.
- A descriptor export whose name and device label contain a newline and a
  descriptor still has the real descriptor as the only non-comment line.

Acceptance: no user-controlled field can add a line to a text export.

### Phase 10 — Changelog comparison link for v0.8.77 (`release-changelog--missing-stable-comparison-link`, P2; added during delivery)

Found by PR #1387's required `CI classifier tests` lane (run 20583, job 257052).
- The stable tag `v0.8.77` was pushed on 2026-10-12 at 19:56 HST, after
  `main`'s push CI on `3450cfe050` had passed.
- `tests/release/changelog-coverage.test.mjs` then requires a
  `[0.8.77]: …v0.8.77` link that `docs/reference/changelog.md` lacks, so
  every PR fails this required lane.

Changes:
- Add `[0.8.77]: …/compare/v0.8.76...v0.8.77`.
- Move the `[Unreleased]` link to `v0.8.77...HEAD`.

Test: the existing `changelog-coverage.test.mjs` failed locally before the
change and passes after. `npm run test:release-distribution` passes (118).

## Verification

Focused, per phase: run the new and changed test files with `npx vitest run <file>`
in `server/` or at the root.

Broad, at the final integrated head in the worktree, with no concurrent
coverage run (check `pgrep -fa "[n]ode_modules/.bin/vitest run --coverage"`):

```bash
cd server && npm run typecheck:tests && npx tsc --noEmit && npx vitest run
cd server && npx vitest run --coverage tests/unit
cd .. && npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all && npm run test:run
npx vitest run --coverage            # frontend, 100% threshold
node scripts/quality/check-large-files.mjs
npm run arch:check                   # in the primary checkout only (symlink artifact)
```

Also:
- llm-egress-proxy:
  - The package's own test config is `llm-egress-proxy/vitest.config.ts`,
    which covers `tests/llm-egress-proxy/**`. This is the same config CI's
    `npm --prefix llm-egress-proxy run test` uses.
  - The package has no typecheck script. Root `typecheck:app` and
    `typecheck:tests` cover its source and tests.
  - The worktree has no `llm-egress-proxy/node_modules`. Run the egress tests
    with the root binary instead:
    `npx vitest run --config llm-egress-proxy/vitest.config.ts`.
- Lizard and complexity: there is no new nested-function hoisting in
  describes.
- `git diff --check`.
- Playwright and render regression: no UI markup changes are expected.
  Phase 3 changes hook state only, and Phase 2 changes data loading only.
  CI's e2e lane is the check. A local build plus a static-serve Playwright
  run is done only if CI e2e fails.

## Delivery

- Branch `codex/bug-scrub-loop/20261013-i1`, worktree
  `/tmp/sanctuary-bug-scrub-20261013-i1`. Both are reserved in the run ledger.
- One PR with phases as separate commits and this plan file committed under
  `tasks/`.
- All phases are compatible, with no migration or rollout ordering, so no
  split is needed. Phase 2 depends on Phase 1's stable order, and both are in
  the same PR.
- Merge with a Forgejo squash after the required checks are green. Verify the
  merge commit's ancestry and target-branch CI, then clean up the branch and
  worktree.
- Deployment policy `final`: no rebuild in this iteration.

## Rollback

Each phase is a self-contained code change with no data migration. To roll
back, revert the squash commit. Phase 6 changes repository semantics to
idempotent. Callers that relied on a missing-row throw are checked in that
phase.

## Completion criteria

- [ ] Each phase's failing test was observed failing before its fix, then
      passing.
- [ ] Full backend and frontend suites, typechecks and coverage gates pass
      locally at the final head.
- [ ] PR merged. Merge SHA verified on `origin/main`. Target CI green.
- [ ] Owned branch, remote branch and worktree removed.
- [ ] Iteration 2 rescrub covers the repaired seams and the iteration-1 gaps
      (frontend signing/broadcast/hardware-wallet/settings/backup UI,
      `shared/types`, `backupService/validation.ts`).
