# Repositories Audit — 2026-05-12

Audit of `server/src/repositories/` (49 TS files). Findings below.

---

### [HIGH] server/src/repositories/maintenanceRepository.ts:66 — `vacuumAnalyze` passes `statement_timeout` as a Prisma bind parameter
**Category:** Persistence / logic invariant
**What:** `await prisma.$executeRaw\`SET statement_timeout = ${String(timeoutMs)}\`` interpolates `timeoutMs` through Prisma's tagged-template parameterization. PostgreSQL `SET` does not accept bind parameters — the value must be a literal. Prisma will send `SET statement_timeout = $1` which Postgres rejects with `42601` syntax error.
**Why it matters:** `vacuumAnalyze` is invoked from `services/maintenance/databaseMaintenance.ts:28`. Every scheduled VACUUM run fails before doing any work, and the subsequent `VACUUM ANALYZE` never executes. Long-term: bloat accumulates, autovacuum thresholds drift, and the failure is hidden behind silent maintenance jobs.
**Repro / trigger:** Trigger the maintenance vacuum task (cron or manual). The first `$executeRaw` throws; the `VACUUM ANALYZE` is skipped (no `try` around the SET).
**Fix shape:** Use `$executeRawUnsafe` with a *validated* numeric literal (`SET statement_timeout = ${Number.isInteger(timeoutMs) ? timeoutMs : 300000}`), or run `SET LOCAL statement_timeout = X` inside an explicit transaction. Also wrap `VACUUM ANALYZE` outside any implicit transaction (Prisma's `$executeRaw` is fine since each call is its own statement, but VACUUM cannot run inside a tx — confirm runtime).
**Confidence:** high

---

### [HIGH] server/src/repositories/deviceRepository.ts:699 — `findByUserIdWithAccounts` always returns `[]` (`id: { in: [] }` hardcoded)
**Category:** Logic / invariant violation
**What:** The function bodies `where: { id: { in: [] }, userId }`. The empty `in: []` matches nothing in Prisma/Postgres semantics, so the query always returns `[]`. A code comment says "Will be overridden by caller's explicit IDs" but no override mechanism exists — callers cannot pass IDs.
**Why it matters:** Any caller that relies on this method gets silently-empty results — a permanent false-negative. The method is exported as part of `deviceRepository`, so a future caller will think they have devices listed when they don't.
**Repro / trigger:** Call `deviceRepository.findByUserIdWithAccounts(userId)`. Result is always `[]` regardless of the user's devices.
**Fix shape:** Either delete the method (dead code), or remove the `id: { in: [] }` constraint so it actually returns devices owned by the user. Likely the intent was `prisma.device.findMany({ where: { userId }, include: { accounts: true } })`.
**Confidence:** high

---

### [MEDIUM] server/src/repositories/draftLockRepository.ts:12-73 — `lockUtxosWithClient` has a check-then-create race; relies on `createMany.count` mismatch as a tripwire
**Category:** Concurrency / async
**What:** `lockUtxos` deletes existing locks for the same draft, then queries for conflicting locks on the requested UTXOs, then issues `createMany` (no `skipDuplicates`). When two concurrent calls race for overlapping UTXOs, both may see "no conflicts," then both proceed; one fails the unique-constraint write and throws (instead of returning the structured "failed" result). The conflict-summary recovery path runs only when `createMany.count !== utxoIds.length`, but unique violation throws before that count is returned.
**Why it matters:** Callers see an unhandled `PrismaClientKnownRequestError(P2002)` instead of a clean `{ success:false, failedUtxoIds, lockedByDraftIds }` payload. The transaction-wrapped overload (line 93) uses default isolation (`ReadCommitted`), which does not prevent two transactions from observing each other's pre-write state.
**Repro / trigger:** Two parallel `lockUtxos(draftA, [u1, u2])` and `lockUtxos(draftB, [u2, u3])` calls — under default isolation the conflict check passes for both, the createMany of the loser throws P2002.
**Fix shape:** Either raise isolation to Serializable (mirror `withSerializableTransaction`), wrap in a Postgres advisory lock keyed by sorted UTXO IDs (matches the pattern in `agentRepository.withAgentFundingTransaction`), or use `createMany({ skipDuplicates: true })` and treat the count gap as the canonical conflict response (already partially implemented at lines 51–65).
**Confidence:** high

---

### [MEDIUM] server/src/repositories/walletSharingRepository.ts:61-76 — `removeUserFromWallet` invalidates the access cache AFTER the delete, leaving a short stale-grant window
**Category:** Security / concurrency
**What:** `walletUser.delete` runs first; only afterwards is `invalidateWalletAccessCache(walletId)` awaited. Between those two awaits, an in-flight request can hit the access cache and be granted access to a wallet the user has just been removed from.
**Why it matters:** Revocation is a security boundary; the property we care about is "after revoke returns, no further request grants access." Today the property is best-effort, not guaranteed. The window is short but exploitable in CI/replay test races and in valid bursty real traffic.
**Repro / trigger:** Concurrent revoke + access-check; the access-check reads the cached "allow" before the revoke completes its invalidation step.
**Fix shape:** Invalidate the cache *before* the delete (so a parallel check refills with the post-delete truth), and invalidate again after for safety. Alternatively, route both writes and cache invalidations through a single advisory-lock-protected helper so invalidation is bounded.
**Confidence:** medium

---

### [MEDIUM] server/src/repositories/draftRepository.ts:322-353 — `update` does an `updateMany` + `findUnique` without a transaction
**Category:** Concurrency / async
**What:** Optimistic concurrency check via `updateMany({ where: { ..., updatedAt: expectedUpdatedAt }, data })` is correct on its own, but the follow-up `findUnique({ where: { id } })` runs outside any transaction. Between the two, another writer can mutate or delete the row; the caller then sees state that does not match what they "successfully" updated.
**Why it matters:** Draft transactions hold PSBTs and signed-device lists. A caller receives a `DraftTransaction` row that may reflect a *third party's* update, not their own — leading to confused signing state, lost signatures, or mistaken "I just signed" UX.
**Repro / trigger:** Two clients update the same draft. Client A's updateMany succeeds. Before A's findUnique runs, B's updateMany succeeds. A reads B's state and returns it as if it were A's own write.
**Fix shape:** Wrap both queries in a `$transaction` (Repeatable Read or higher), or switch to `prisma.draftTransaction.update` with the optimistic `where` clause expanded to include `updatedAt` (which Prisma supports via composite where on a unique tuple — or use `update` after the updateMany succeeds and pass the returning row through). Simplest fix: read inside the same transaction as the update.
**Confidence:** medium

---

### [MEDIUM] server/src/repositories/nodeConfigRepository.ts:79-106 — `saveAsDefault` is two writes outside a transaction; window can leave zero or two defaults
**Category:** Concurrency / async, persistence
**What:** `updateMany({ where: { isDefault: true }, data: { isDefault: false } })` then `upsert({ id: 'default', ..., isDefault: true })`. Between the two, a concurrent reader sees zero defaults; a concurrent writer racing the same flow can both flip the existing default off then both upsert their own "default" — leading to two defaults if the upsert isn't keyed on `id: 'default'` for both (it is here, so the latter risk is bounded — but the "zero defaults during the gap" race is real).
**Why it matters:** `findDefault()` runs frequently. A reader hitting the gap gets `null`, which downstream code may interpret as "no node configured" and fail or fall back to seed values.
**Repro / trigger:** Concurrent admin save + a sync worker calling `findDefault()`.
**Fix shape:** Wrap both writes in `prisma.$transaction([updateMany, upsert])`. Cheap, mechanical, removes the window.
**Confidence:** high

---

### [MEDIUM] server/src/repositories/sessionRepository.ts:139-192 — Token revoke / lastUsed updates silently swallow all DB errors as `log.debug`
**Category:** Error handling / security
**What:** `revokeRefreshToken`, `deleteRefreshTokenById`, and `updateLastUsed` use `.catch(err => log.debug(...))` to handle Prisma errors. The intent is to absorb `P2025` (record not found) but the catch matches *every* error — including connection failures, timeouts, and integrity errors.
**Why it matters:** Token revocation that silently no-ops is a security concern. A caller invoking `revokeRefreshToken(token)` on a still-valid token during a DB hiccup will think they've revoked it; the token remains usable. This is the canonical "fail-open on auth boundary" antipattern.
**Repro / trigger:** Trigger a transient Prisma connection error during logout. The user thinks they've signed out; their refresh token still works.
**Fix shape:** Narrow the catch to `isPrismaError(err) && err.code === 'P2025'` (from `utils/errors`); rethrow everything else. `updateLastUsed` is a best-effort path and can stay broad, but `revoke*` must surface failures.
**Confidence:** high

---

### [LOW] server/src/repositories/policyRepository.ts:476-487 — `decrementUsageWindow` can drive `totalSpent`/`txCount` negative
**Category:** Logic / invariant violation
**What:** Prisma `decrement` is unconditional — no `where: { totalSpent: { gte: amount } }` guard. If a caller decrements more than was incremented (e.g., compensating for a reverted action that was never recorded), `totalSpent` goes negative.
**Why it matters:** Policy budget enforcement reads `totalSpent`. Negative values either bypass spending limits or, depending on signed/unsigned handling downstream, surface as huge positive numbers via integer underflow on coercion.
**Repro / trigger:** Force a decrement-without-increment via a corrupted policy event replay or a buggy compensating action.
**Fix shape:** Use `updateMany` with `where: { id, totalSpent: { gte: amount }, txCount: { gte: 1 } }` and surface a `count === 0` result; or clamp at zero in a `$queryRaw GREATEST(...)` update.
**Confidence:** medium

---

### [LOW] server/src/repositories/policyRepository.ts:400-461 — `findOrCreateUsageWindow` uses `findFirst` after P2002 retry; NULL userId tolerates duplicates depending on index
**Category:** Persistence
**What:** The unique constraint that the comment claims to rely on includes a nullable `userId`. Postgres's default unique-btree behavior treats `NULL` as distinct, so two rows with `userId = NULL` can both exist unless the migration uses `UNIQUE NULLS NOT DISTINCT` (PG15+) or a partial index. The find-then-create-then-retry pattern relies on that uniqueness; if it's not enforced for NULL, the retry path silently picks one of multiple duplicates.
**Why it matters:** Per-wallet usage windows (no userId) could end up duplicated under load, double-counting spend toward policy limits.
**Repro / trigger:** Two concurrent first-spend events on a wallet-scoped (no userId) policy window. Inspect `policyUsageWindow` table for `userId IS NULL` duplicates.
**Fix shape:** Audit the migration; ensure the unique index for `(policyId, walletId, userId, windowType, windowStart)` either uses `NULLS NOT DISTINCT` or is a partial index `(policyId, walletId, windowType, windowStart) WHERE userId IS NULL`. The repository code itself is fine once the index is correct.
**Confidence:** medium

---

### [LOW] server/src/repositories/utxoRepository.ts:83-92 — `markAsSpent` swallows all errors and returns `null` (looks like "not found")
**Category:** Error handling
**What:** `try { prisma.uTXO.update(...) } catch { return null; }` catches everything, not just `P2025`. A connection blip or schema error returns `null`, indistinguishable from the legitimate "row not found" case.
**Why it matters:** Sync code treating `null` as "already spent / unknown UTXO" will silently drop real failures instead of escalating to retry/observability.
**Repro / trigger:** Force a transient Prisma error during `markAsSpent`. The caller sees `null` and moves on.
**Fix shape:** Use `prisma.uTXO.updateMany({ where: { walletId_txid_vout: {...} }, data: { spent: true } })` and check `count`; or narrow the catch to `isPrismaError(error) && error.code === 'P2025'`.
**Confidence:** high

---

### [LOW] server/src/repositories/maintenanceRepository.ts:152-197 — Dynamic table access via `prisma[table]` with `@ts-expect-error` and validation deferred to caller
**Category:** Security
**What:** `exportTable`, `exportTablePaginated`, `deleteAllFromTable`, and `insertIntoTable` accept a `table: string` and call `prisma[table]`. If an untrusted caller (or a future careless one) passes an attacker-controlled string, this can hit internal Prisma symbols (e.g. `$queryRaw`, `$disconnect`, etc.) and crash or leak.
**Why it matters:** The comment says "table name validated by caller" — that's the worst kind of safety boundary: implicit, undocumented, and easy to miss in a future endpoint. Currently used only by backup/restore, but the API shape is footgun-shaped.
**Repro / trigger:** A future route that accepts a table name from query params calls `maintenanceRepository.exportTable(req.query.table)`.
**Fix shape:** Accept a `table: PrismaModelKey` discriminated-union (literal list) instead of `string`. Or have the repo own the whitelist: `const ALLOWED_TABLES = new Set([...])` and assert membership inside the function. Drop the `@ts-expect-error` once typed correctly.
**Confidence:** high

---

### [LOW] server/src/repositories/transactions/core.ts:303-353 — `findByWalletIdWithDetails` spreads caller `where` before the scoped `walletId` constraint
**Category:** Security
**What:** The comment "Keep the scoped wallet constraint last so caller filters cannot override it" is *almost* true: an explicit `walletId` key from the caller will be overridden by the later key. But a caller-supplied top-level `OR: [...]` is preserved and ANDed with `walletId`. The AND keeps the scope intact (`walletId=X AND (caller-OR)`), so this is safe — but the pattern relies on Prisma's AND-semantics for top-level keys and is fragile to refactors (e.g. if someone adds support for `AND: [...]` overrides). Worth a regression test.
**Why it matters:** A future refactor that promotes `options.where` to also include arbitrary `AND`/`NOT`/relation overrides could accidentally widen the scope.
**Repro / trigger:** Audit-only; no current exploit.
**Fix shape:** Either lock the type of `options.where` to a known-safe subset (e.g. `Pick<Prisma.TransactionWhereInput, 'type' | 'blockTime' | ...>`), or wrap the merge so the scoped fields always win via `AND: [callerWhere, { walletId }]`.
**Confidence:** medium

---

### [LOW] server/src/repositories/nodeConfigRepository.ts:254-265 — `esReorderPriorities` runs N parallel updates without a transaction
**Category:** Concurrency
**What:** `Promise.all(updates.map(update))` — if one update fails partway through, the priorities are left half-applied with no rollback.
**Why it matters:** Operator reorders the Electrum server list, one update errors (e.g. row deleted concurrently), and the priorities become inconsistent (gaps, duplicates).
**Repro / trigger:** Concurrent server delete + reorder.
**Fix shape:** Wrap in `prisma.$transaction(updates.map(...))` — same fix as `batchUpdateByIds` already uses elsewhere.
**Confidence:** high

---

### [LOW] server/src/repositories/intelligenceRepository.ts:136-154 — `expireActiveInsights` and `deleteExpiredInsights` evaluate `new Date()` inside the `where` callback; minor double-eval, not a bug
**Category:** Logic
**What:** Both methods call `new Date()` once each — fine. But `deleteExpiredInsights` has an `OR` where one branch matches `expiresAt: { lte: new Date() }, status: 'active'`, which overlaps with `expireActiveInsights`'s domain. If both jobs run, the "active+expired" rows can be deleted before they're marked expired, losing the audit trail.
**Why it matters:** Insights that should briefly transition through `status='expired'` (for notification cleanup) can be deleted directly.
**Repro / trigger:** Run `deleteExpiredInsights` before `expireActiveInsights` in the maintenance cron.
**Fix shape:** Order the cron: expire first, then delete. Or change `deleteExpiredInsights` to exclude `status='active'` and rely on the expire job for the transition.
**Confidence:** medium

---

## Summary

- **Critical:** 0
- **High:** 2 (vacuumAnalyze SET parameterization, deviceRepository dead method)
- **Medium:** 5 (draftLock race, walletSharing cache stale-grant, draft update non-tx read, nodeConfig saveAsDefault non-tx, session token swallow-all)
- **Low:** 6 (policy decrement negative, policy NULL userId, utxo markAsSpent swallow, maintenance dynamic table footgun, transaction scoped-where fragility, electrum reorder non-tx, intelligence delete-before-expire)

**Files read in full:** 18 of 49. (Audit prioritized the larger / mutation-heavy files; remaining read-only "*Reads.ts" and small CRUD files were skimmed via grep.)
