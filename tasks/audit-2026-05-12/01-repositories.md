# Phase C — repositories (merged)

**Source:** raw/01-repositories-claude.md + raw/01-repositories-codex.md
**Date:** 2026-05-12

## Summary

| Severity | Claude | Codex | Merged | Dual-flagged |
|---|---|---|---|---|
| Critical | 0 | 3 | 3 | 1 |
| High | 2 | 8 | 8 | 2 |
| Medium | 5 | 7 | 8 | 4 |
| Low | 6 | 4 | 7 | 3 |

**Accepted:** 26 · **Rejected:** 0 · **Deferred:** 0

## Findings (accepted)

### [CRITICAL] server/src/repositories/maintenanceRepository.ts:43 — Expired draft cleanup deletes terminal draft history
**Category:** Persistence / state
**Status:** Accept
**Cross-pass:** Codex only
**What:** `deleteExpiredDrafts` deletes every draft with `expiresAt < now` without restricting to actionable draft statuses. This conflicts with the draft repository's lifecycle rule that `broadcasted` is a retained terminal state.
**Why it matters:** Broadcasted or otherwise terminal draft records can be silently removed by scheduled maintenance, losing transaction history and audit context.
**Repro / trigger:** A broadcasted draft still has an old `expiresAt`; the maintenance cleanup job deletes it.
**Fix shape:** Reuse the same actionable-status predicate as `draftRepository.deleteExpired`, or centralize draft-expiry cleanup in one repository function.
**Confidence:** high

### [CRITICAL] server/src/repositories/policyRepository.ts:411 — Wallet-scoped usage windows can duplicate under concurrency
**Category:** Concurrency / async, persistence
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `findOrCreateUsageWindow` normalizes missing `userId` to `null` and relies on a unique constraint that includes that nullable column. In PostgreSQL, ordinary unique indexes treat `NULL` as distinct, so concurrent wallet-scoped policy windows can both be created instead of hitting the P2002 retry path. Unless the migration uses `UNIQUE NULLS NOT DISTINCT` (PG15+) or a partial index, the retry-based find-then-create pattern silently picks one of multiple duplicates.
**Why it matters:** Per-wallet usage windows (no userId) can be duplicated under load, double-counting spend and letting policy enforcement undercount, bypassing wallet-level controls.
**Repro / trigger:** Two concurrent first-spend evaluations for the same wallet-scoped policy/window with no `userId`; both calls miss the fast-path row and create separate rows. Inspect `policyUsageWindow` for `userId IS NULL` duplicates.
**Fix shape:** Audit the migration; enforce wallet-scoped uniqueness with `NULLS NOT DISTINCT` or a partial unique index `(policyId, walletId, windowType, windowStart) WHERE userId IS NULL`. Then keep the repository retry path or replace with a true upsert keyed by the enforced constraint.
**Confidence:** high

### [CRITICAL] server/src/repositories/walletRepository.ts:316 — Signers satisfy owner-only edit checks
**Category:** Security
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findByIdWithEditAccess` treats both `owner` and `signer` roles as edit access. Owner-only call sites use this helper for wallet mutation and deletion, so the repository predicate grants broader authority than the operation requires.
**Why it matters:** A signer can be accepted by an owner-only path and modify or delete wallet state.
**Repro / trigger:** Give a user direct `signer` access to a wallet, then call an owner-only operation that relies on `findByIdWithEditAccess`.
**Fix shape:** Split repository helpers into explicit owner-only and signer-capable predicates, and make destructive wallet operations call the owner-only helper.
**Confidence:** high

### [HIGH] server/src/repositories/addressRepository.ts:469 — Address lookup ignores group-access wallets
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findByAddressesForUser` filters wallet access through direct `wallet.users.some({ userId })` only. Other repository access helpers include group membership, but this lookup path does not.
**Why it matters:** Users with valid group access get false negatives when resolving addresses that belong to their accessible wallets.
**Repro / trigger:** Give a user wallet access through a group only, then call the address lookup route for an address in that wallet.
**Fix shape:** Reuse `buildWalletAccessWhere(userId)` inside the wallet relation instead of hand-rolling only the direct-user branch.
**Confidence:** high

### [HIGH] server/src/repositories/deviceRepository.ts:579 — Accessible-device listing omits directly owned devices
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findAccessibleByUser` claims to include owned devices but its `OR` only checks `DeviceUser` rows and group membership. Devices created through the plain `create` path can have `device.userId` without a corresponding `DeviceUser` row.
**Why it matters:** Device access/listing can silently hide a user's own devices.
**Repro / trigger:** Create a device through `deviceRepository.create`, then call `findAccessibleByUser` for that owner.
**Fix shape:** Add `{ userId }` to the access `OR` or route all device creation through a single invariant-preserving owner association path.
**Confidence:** high

### [HIGH] server/src/repositories/draftLockRepository.ts:47 — UTXO lock conflicts race into unique-constraint errors
**Category:** Concurrency / async
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `lockUtxosWithClient` deletes existing locks for the same draft, then queries for conflicting locks on the requested UTXOs, then issues `createMany` without `skipDuplicates`. When two concurrent calls race for overlapping UTXOs, both may see "no conflicts," then both proceed; the loser fails the unique-constraint write and throws (`P2002`) before the structured conflict-summary recovery path (which runs only when `createMany.count !== utxoIds.length`) can fire. The transaction-wrapped overload (line 93) uses default isolation (`ReadCommitted`), which does not prevent two transactions from observing each other's pre-write state.
**Why it matters:** Normal concurrent draft creation turns a recoverable "UTXO already locked" result into an unhandled `PrismaClientKnownRequestError(P2002)` instead of a clean `{ success:false, failedUtxoIds, lockedByDraftIds }` payload.
**Repro / trigger:** Two parallel `lockUtxos(draftA, [u1, u2])` and `lockUtxos(draftB, [u2, u3])` calls — under default isolation the conflict check passes for both; the createMany of the loser throws P2002.
**Fix shape:** Raise isolation to Serializable (mirror `withSerializableTransaction`), or wrap in a Postgres advisory lock keyed by sorted UTXO IDs (matches `agentRepository.withAgentFundingTransaction`), or use `createMany({ skipDuplicates: true })` and treat the count gap as the canonical conflict response (already partially implemented at lines 51–65).
**Confidence:** high

### [HIGH] server/src/repositories/deviceRepository.ts:699 — `findByUserIdWithAccounts` always returns `[]` (`id: { in: [] }` hardcoded)
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**Note:** Codex classified this LOW; Claude HIGH. Using higher confidence/severity.
**What:** The function bodies `where: { id: { in: [] }, userId }`. The empty `in: []` matches nothing in Prisma/Postgres semantics, so the query always returns `[]`. A code comment says "Will be overridden by caller's explicit IDs" but no override mechanism exists — callers cannot pass IDs.
**Why it matters:** Any caller relying on this exported method gets silently-empty results — a permanent false-negative. A future caller will think they have devices listed when they don't.
**Repro / trigger:** Call `deviceRepository.findByUserIdWithAccounts(userId)` for a user who owns devices. Result is always `[]`.
**Fix shape:** Either delete the method (dead code), or remove the `id: { in: [] }` constraint. Likely intent: `prisma.device.findMany({ where: { userId }, include: { accounts: true } })`, or favor existing `findByIdsAndUserWithAccounts`.
**Confidence:** high

### [HIGH] server/src/repositories/emailVerificationRepository.ts:69 — Verification tokens are consumed with an unguarded update
**Category:** Concurrency / async
**Status:** Accept
**Cross-pass:** Codex only
**What:** `markUsed` updates by `id` only, with no `usedAt: null` or `expiresAt` condition. If two verification requests read the same unused token before either update commits, both can mark it used and proceed as successful.
**Why it matters:** A one-time verification token can be replayed under concurrent requests.
**Repro / trigger:** Submit the same valid verification token twice in parallel; both callers can pass the pre-update checks and `markUsed` succeeds for both.
**Fix shape:** Replace with an atomic `updateMany` guarded by `id`, `usedAt: null`, and `expiresAt > now`, then require `count === 1`.
**Confidence:** high

### [HIGH] server/src/repositories/groupRepository.ts:102 — Group membership replacement is not atomic
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Codex only
**What:** `setMembers` reads current members, deletes removed users, then validates and creates new users as separate operations outside a transaction. A failure or race after the delete leaves the group partially updated.
**Why it matters:** Group access can be unintentionally removed or left in a mixed state, which affects every wallet/device that inherits that group.
**Repro / trigger:** Replace group members while the create step fails, or run two `setMembers` calls concurrently for the same group.
**Fix shape:** Validate additions first, then perform the diff delete/create inside a single Prisma transaction, preferably with a group-scoped lock for concurrent replacements.
**Confidence:** high

### [HIGH] server/src/repositories/maintenanceRepository.ts:66 — `vacuumAnalyze` passes `statement_timeout` as a Prisma bind parameter
**Category:** Persistence / state, logic invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `await prisma.$executeRaw\`SET statement_timeout = ${String(timeoutMs)}\`` interpolates `timeoutMs` through Prisma's tagged-template parameterization. PostgreSQL `SET` does not accept bind parameters — the value must be a literal. Prisma sends `SET statement_timeout = $1`, which Postgres rejects with `42601` syntax error.
**Why it matters:** `vacuumAnalyze` is invoked from `services/maintenance/databaseMaintenance.ts:28`. Every scheduled VACUUM run fails before doing any work, and the subsequent `VACUUM ANALYZE` never executes. Long-term: bloat accumulates, autovacuum thresholds drift, and the failure is hidden behind silent maintenance jobs.
**Repro / trigger:** Trigger the maintenance vacuum task (cron or manual). The first `$executeRaw` throws; the `VACUUM ANALYZE` is skipped (no `try` around the SET).
**Fix shape:** Use `$executeRawUnsafe` with a *validated* numeric literal (`SET statement_timeout = ${Number.isInteger(timeoutMs) ? timeoutMs : 300000}`), or run `SET LOCAL statement_timeout = X` inside an explicit transaction. Also confirm `VACUUM ANALYZE` is not wrapped in an implicit transaction.
**Confidence:** high

### [HIGH] server/src/repositories/nodeConfigRepository.ts:84 — Saving the default node can leave no default configured
**Category:** Concurrency / async, persistence
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**Note:** Claude classified MEDIUM; Codex HIGH. Using higher severity.
**What:** `saveAsDefault` does `updateMany({ where: { isDefault: true }, data: { isDefault: false } })` then `upsert({ id: 'default', ..., isDefault: true })`. Between the two writes (outside a transaction), a concurrent reader sees zero defaults; a failed upsert leaves that state behind. Concurrent flows could also briefly produce two defaults if upserts weren't keyed on a stable id (they are here, bounding that risk).
**Why it matters:** `findDefault()` runs frequently. Sync and node-connection code can intermittently behave as if no node is configured, or fall back to seed values.
**Repro / trigger:** Concurrent admin save + sync worker calling `findDefault()`; or force the upsert to fail after `updateMany` succeeds.
**Fix shape:** Wrap both writes in `prisma.$transaction([updateMany, upsert])`. Consider enforcing the singleton default invariant at the database level.
**Confidence:** high

### [HIGH] server/src/repositories/sessionRepository.ts:139 — Token revoke / lastUsed updates silently swallow all DB errors
**Category:** Error handling / security
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `revokeRefreshToken`, `deleteRefreshTokenById`, and `updateLastUsed` use `.catch(err => log.debug(...))`/`String(err)` to absorb Prisma errors. The intent is to ignore `P2025` (record not found), but the catch matches *every* error — including connection failures, timeouts, and integrity errors.
**Why it matters:** Token revocation that silently no-ops is a security concern. A caller invoking `revokeRefreshToken(token)` during a DB hiccup will think they've revoked it; the token remains usable. Canonical "fail-open on auth boundary" antipattern.
**Repro / trigger:** Trigger a transient Prisma connection error during logout; the user thinks they've signed out but the refresh token still works.
**Fix shape:** Narrow the catch to `isPrismaError(err) && err.code === 'P2025'` (from `utils/errors`); rethrow everything else. `updateLastUsed` is best-effort and can stay broad, but `revoke*` must surface failures.
**Confidence:** high

### [HIGH] server/src/repositories/transactions/core.ts:101 — Transaction pagination stalls on null block times
**Category:** Null / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findByWalletIdPaginated` only emits `nextCursor` when the last item has a non-null `blockTime`. The same query can still set `hasMore: true`, leaving clients with more rows but no usable cursor.
**Why it matters:** Wallets with enough pending/unconfirmed transactions can make transaction history pagination stop early.
**Repro / trigger:** Query a wallet where the first page ends on a transaction with `blockTime === null` and at least one extra row was fetched.
**Fix shape:** Use a cursor shape that can represent null block times, or order by a non-null stable field before using `blockTime` as a secondary key.
**Confidence:** high

### [MEDIUM] server/src/repositories/addressRepository.ts:284 — Nullable derivation paths are typed as non-null
**Category:** Null / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findDerivationPathsByAddresses` promises `derivationPath: string`, but the selected database field is nullable. A row with `derivationPath = null` is returned through a non-null type.
**Why it matters:** PSBT construction can receive `null` where downstream code expects a derivation path string.
**Repro / trigger:** Store or import an address row without a derivation path, then fetch paths for transaction construction.
**Fix shape:** Return `string | null` and force callers to handle the missing path, or filter out/null-reject rows at the repository boundary with a domain-specific error.
**Confidence:** high

### [MEDIUM] server/src/repositories/draftRepository.ts:322 — `update` does an `updateMany` + `findUnique` without a transaction
**Category:** Concurrency / async
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Optimistic concurrency check via `updateMany({ where: { ..., updatedAt: expectedUpdatedAt }, data })` is correct on its own, but the follow-up `findUnique({ where: { id } })` runs outside any transaction. Between the two, another writer can mutate or delete the row; the caller then sees state that does not match their successful update.
**Why it matters:** Draft transactions hold PSBTs and signed-device lists. A caller receives a `DraftTransaction` row that may reflect a third party's update — leading to confused signing state, lost signatures, or mistaken "I just signed" UX.
**Repro / trigger:** Two clients update the same draft. Client A's updateMany succeeds. Before A's findUnique runs, B's updateMany succeeds. A reads B's state and returns it as if it were A's own write.
**Fix shape:** Wrap both queries in a `$transaction` (Repeatable Read or higher), or switch to `prisma.draftTransaction.update` with the optimistic `where` expanded. Simplest fix: read inside the same transaction as the update.
**Confidence:** medium

### [MEDIUM] server/src/repositories/maintenanceRepository.ts:152 — Dynamic table access via `prisma[table]` with `@ts-expect-error` and validation deferred to caller
**Category:** Security / persistence
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**Note:** Claude classified LOW; Codex MEDIUM. Using higher severity.
**What:** `exportTable`, `exportTablePaginated`, `deleteAllFromTable`, and `insertIntoTable` accept `table: string` and call `prisma[table]` / `tx[table].deleteMany({})` behind `@ts-expect-error`. The repository owns destructive operations but does not enforce an allowlist locally. If an untrusted caller (or a future careless one) passes an attacker-controlled string, this can hit internal Prisma symbols (`$queryRaw`, `$disconnect`, etc.) or wipe unintended tables.
**Why it matters:** The comment says "table name validated by caller" — that's the worst kind of safety boundary: implicit, undocumented, and easy to miss. Currently used only by backup/restore, but the API shape is footgun-shaped.
**Repro / trigger:** A future route that accepts a table name from query params calls `maintenanceRepository.exportTable(req.query.table)`. Or pass a valid Prisma delegate name the restore flow did not intend to clear.
**Fix shape:** Accept a `table: PrismaModelKey` discriminated-union (literal list) instead of `string`. Or have the repo own the whitelist: `const ALLOWED_TABLES = new Set([...])` and assert membership inside the function. Drop the `@ts-expect-error` once typed correctly.
**Confidence:** high

### [MEDIUM] server/src/repositories/nodeConfigRepository.ts:228 — Health update swallows all database errors
**Category:** Error handling
**Status:** Accept
**Cross-pass:** Codex only
**What:** `esUpdateHealth` catches every error, logs a stringified value, and resolves. It does not distinguish expected missing-row cases from Prisma outages or schema errors.
**Why it matters:** Node health state can stay stale while the caller believes it was persisted, reducing observability during connectivity incidents.
**Repro / trigger:** Trigger any Prisma error during an Electrum health update.
**Fix shape:** Use `getErrorMessage()` for logging, suppress only known benign Prisma errors, and rethrow or surface unexpected persistence failures.
**Confidence:** high

### [MEDIUM] server/src/repositories/nodeConfigRepository.ts:254 — `esReorderPriorities` runs N parallel updates without a transaction
**Category:** Concurrency / logic invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**Note:** Claude classified LOW; Codex MEDIUM. Using higher severity.
**What:** `Promise.all(updates.map(update))` — if one update fails partway through, the priorities are left half-applied with no rollback. Other updates may already be committed.
**Why it matters:** Operator reorders the Electrum server list, one update errors (e.g. row deleted concurrently), and priorities become inconsistent (gaps, duplicates, stale).
**Repro / trigger:** Concurrent server delete + reorder.
**Fix shape:** Wrap in `prisma.$transaction(updates.map(...))` — same fix as `batchUpdateByIds` already uses elsewhere.
**Confidence:** high

### [MEDIUM] server/src/repositories/walletRepository.ts:296 — Additional wallet filters can overwrite the access predicate
**Category:** Security
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findAccessibleWithSelect` spreads `additionalWhere` after `buildWalletAccessWhere(userId)`. If a caller passes an `OR` key, it replaces the access-control `OR` instead of being combined with it.
**Why it matters:** A future or internal caller can accidentally widen a scoped wallet query and expose wallets outside the user's access set.
**Repro / trigger:** Call `findAccessibleWithSelect(userId, select, { OR: [{ network: 'mainnet' }] })`; the repository no longer applies the original wallet-access OR.
**Fix shape:** Combine predicates as `AND: [buildWalletAccessWhere(userId), additionalWhere ?? {}]` so caller filters cannot replace the access condition.
**Confidence:** high

### [MEDIUM] server/src/repositories/walletSharingRepository.ts:61 — `removeUserFromWallet` invalidates the access cache AFTER the delete
**Category:** Security / concurrency
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** `walletUser.delete` runs first; only afterwards is `invalidateWalletAccessCache(walletId)` awaited. Between those two awaits, an in-flight request can hit the access cache and be granted access to a wallet the user has just been removed from.
**Why it matters:** Revocation is a security boundary; the property we care about is "after revoke returns, no further request grants access." Today the property is best-effort. The window is short but exploitable in CI/replay races and bursty real traffic.
**Repro / trigger:** Concurrent revoke + access-check; the access-check reads the cached "allow" before the revoke completes its invalidation.
**Fix shape:** Invalidate the cache *before* the delete (so a parallel check refills with the post-delete truth), and invalidate again after for safety. Alternatively, serialize role changes and access-cache refreshes through one advisory-lock-protected helper.
**Confidence:** medium

### [MEDIUM] server/src/repositories/utxoRepository.ts:83 — `markAsSpent` swallows all errors and returns `null`
**Category:** Error handling
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**Note:** Claude classified LOW; Codex MEDIUM. Using higher severity.
**What:** `try { prisma.uTXO.update(...) } catch { return null; }` catches everything, not just `P2025`. A connection blip or schema error returns `null`, indistinguishable from the legitimate "row not found" case.
**Why it matters:** Sync/reconciliation code treating `null` as "already spent / unknown UTXO" silently drops real failures instead of escalating to retry/observability.
**Repro / trigger:** Force a transient Prisma error during `markAsSpent`. Caller sees `null` and moves on.
**Fix shape:** Use `prisma.uTXO.updateMany({ where: { walletId_txid_vout: {...} }, data: { spent: true } })` and check `count`; or narrow the catch to `isPrismaError(error) && error.code === 'P2025'` and rethrow others with `getErrorMessage()` context.
**Confidence:** high

### [LOW] server/src/repositories/auditLogRepository.ts:88 — Falsy JSON details are replaced with an empty object
**Category:** Null / boundary
**Status:** Accept
**Cross-pass:** Codex only
**What:** `create` stores `details: input.details || {}`. Valid JSON values like `false`, `0`, or an empty string are replaced with `{}`.
**Why it matters:** Audit entries can lose the exact value a caller attempted to record.
**Repro / trigger:** Create an audit log with `details: false` or `details: 0`.
**Fix shape:** Use nullish coalescing, `input.details ?? {}`, so only absent details get the default.
**Confidence:** medium

### [LOW] server/src/repositories/draftLockRepository.ts:144 — Type assertion hides a partial lock shape
**Category:** TypeScript Rules violations
**Status:** Accept
**Cross-pass:** Codex only
**What:** `findByUtxoId` selects only `draftId`, `utxoId`, and `createdAt`, then casts the result to `DraftUtxoLock`. The runtime object lacks fields such as `id` even though the type says they exist.
**Why it matters:** A future caller can read `lock.id` and get `undefined` despite TypeScript accepting it.
**Repro / trigger:** Call `findByUtxoId` and access any unselected `DraftUtxoLock` field.
**Fix shape:** Either select the full lock row or return an explicit narrow type matching the selected fields.
**Confidence:** high

### [LOW] server/src/repositories/intelligenceRepository.ts:136 — `expireActiveInsights` and `deleteExpiredInsights` overlap; delete can precede expire
**Category:** Logic
**Status:** Accept
**Cross-pass:** Claude only
**What:** Both methods call `new Date()` once each. `deleteExpiredInsights` has an `OR` where one branch matches `expiresAt: { lte: new Date() }, status: 'active'`, which overlaps with `expireActiveInsights`'s domain. If both jobs run, "active+expired" rows can be deleted before they're marked expired, losing the audit trail.
**Why it matters:** Insights that should briefly transition through `status='expired'` (for notification cleanup) can be deleted directly.
**Repro / trigger:** Run `deleteExpiredInsights` before `expireActiveInsights` in the maintenance cron.
**Fix shape:** Order the cron: expire first, then delete. Or change `deleteExpiredInsights` to exclude `status='active'` and rely on the expire job for the transition.
**Confidence:** medium

### [LOW] server/src/repositories/policyRepository.ts:476 — `decrementUsageWindow` can drive `totalSpent`/`txCount` negative
**Category:** Logic / invariant
**Status:** Accept
**Cross-pass:** Double-flagged (Claude + Codex) — high signal
**What:** Prisma `decrement` is unconditional — no `where: { totalSpent: { gte: amount } }` guard. If a caller decrements more than was incremented (e.g., compensating for a reverted action that was never recorded), `totalSpent` goes negative.
**Why it matters:** Policy budget enforcement reads `totalSpent`. Negative values either bypass spending limits or, depending on signed/unsigned handling downstream, surface as huge positive numbers via integer underflow on coercion. Compensating operations corrupt counters; later limit checks undercount usage.
**Repro / trigger:** Force a decrement-without-increment via a corrupted policy event replay, a buggy compensating action, or calling `decrementUsageWindow` twice for one recorded spend.
**Fix shape:** Use `updateMany` with `where: { id, totalSpent: { gte: amount }, txCount: { gte: 1 } }` and surface a `count === 0` result; or clamp at zero in a `$queryRaw GREATEST(...)` update.
**Confidence:** medium

### [LOW] server/src/repositories/transactions/core.ts:303 — `findByWalletIdWithDetails` spreads caller `where` before the scoped `walletId` constraint
**Category:** Security
**Status:** Accept
**Cross-pass:** Claude only
**What:** The comment "Keep the scoped wallet constraint last so caller filters cannot override it" is *almost* true: an explicit `walletId` key from the caller will be overridden by the later key. But a caller-supplied top-level `OR: [...]` is preserved and ANDed with `walletId`. The AND keeps the scope intact (`walletId=X AND (caller-OR)`), so this is currently safe — but the pattern relies on Prisma's AND-semantics for top-level keys and is fragile to refactors (e.g. if someone adds support for `AND: [...]` overrides). Worth a regression test.
**Why it matters:** A future refactor that promotes `options.where` to also include arbitrary `AND`/`NOT`/relation overrides could accidentally widen the scope.
**Repro / trigger:** Audit-only; no current exploit.
**Fix shape:** Either lock the type of `options.where` to a known-safe subset (e.g. `Pick<Prisma.TransactionWhereInput, 'type' | 'blockTime' | ...>`), or wrap the merge so the scoped fields always win via `AND: [callerWhere, { walletId }]`.
**Confidence:** medium

## Considered & rejected

_(none)_

## Deferred

_(none)_
