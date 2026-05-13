# Repository Layer Audit — 2026-05-12

### [CRITICAL] server/src/repositories/policyRepository.ts:411 — Wallet-scoped usage windows can duplicate under concurrency
**Category:** Concurrency/async
**What:** `findOrCreateUsageWindow` normalizes missing `userId` to `null` and relies on a unique constraint that includes that nullable column. In PostgreSQL, ordinary unique indexes allow multiple `NULL` values, so concurrent wallet-scoped policy windows can both be created instead of hitting the P2002 retry path.
**Why it matters:** Spend-limit accounting can split across duplicate usage windows, letting policy enforcement undercount spending and bypass wallet-level controls.
**Repro / trigger:** Fire two first-spend evaluations for the same wallet-scoped policy/window with no `userId`; both calls can miss the fast-path row and create separate rows.
**Fix shape:** Enforce wallet-scoped uniqueness with `NULLS NOT DISTINCT` or a partial unique index for `userId IS NULL`, then keep the repository retry path or replace it with a true upsert keyed by the enforced constraint.
**Confidence:** high

### [CRITICAL] server/src/repositories/walletRepository.ts:316 — Signers satisfy owner-only edit checks
**Category:** Security
**What:** `findByIdWithEditAccess` treats both `owner` and `signer` roles as edit access. Owner-only call sites use this helper for wallet mutation and deletion, so the repository predicate grants broader authority than the operation requires.
**Why it matters:** A signer can be accepted by an owner-only path and modify or delete wallet state.
**Repro / trigger:** Give a user direct `signer` access to a wallet, then call an owner-only operation that relies on `findByIdWithEditAccess`.
**Fix shape:** Split repository helpers into explicit owner-only and signer-capable predicates, and make destructive wallet operations call the owner-only helper.
**Confidence:** high

### [CRITICAL] server/src/repositories/maintenanceRepository.ts:43 — Expired draft cleanup deletes terminal draft history
**Category:** Persistence/state
**What:** `deleteExpiredDrafts` deletes every draft with `expiresAt < now` without restricting to actionable draft statuses. This conflicts with the draft repository's lifecycle rule that `broadcasted` is a retained terminal state.
**Why it matters:** Broadcasted or otherwise terminal draft records can be silently removed by scheduled maintenance, losing transaction history and audit context.
**Repro / trigger:** A broadcasted draft still has an old `expiresAt`; the maintenance cleanup job deletes it.
**Fix shape:** Reuse the same actionable-status predicate as `draftRepository.deleteExpired`, or centralize draft-expiry cleanup in one repository function.
**Confidence:** high

### [HIGH] server/src/repositories/sessionRepository.ts:143 — Refresh-token revocation fails open on any Prisma error
**Category:** Error handling
**What:** `revokeRefreshToken` catches every delete error and only logs `String(err)`. A missing row may be safe to ignore, but connection errors, timeouts, and other Prisma failures are also swallowed.
**Why it matters:** Logout or forced revocation can appear successful while the refresh token remains valid.
**Repro / trigger:** Trigger a transient database error during `revokeRefreshToken`; the function resolves instead of surfacing the failed revoke.
**Fix shape:** Only suppress the expected Prisma not-found code via `isPrismaError()`/known error helpers, and rethrow all other errors.
**Confidence:** high

### [HIGH] server/src/repositories/emailVerificationRepository.ts:69 — Verification tokens are consumed with an unguarded update
**Category:** Concurrency/async
**What:** `markUsed` updates by `id` only, with no `usedAt: null` or `expiresAt` condition. If two verification requests read the same unused token before either update commits, both can mark it used and proceed as successful.
**Why it matters:** A one-time verification token can be replayed under concurrent requests.
**Repro / trigger:** Submit the same valid verification token twice in parallel; both callers can pass the pre-update checks and `markUsed` succeeds for both.
**Fix shape:** Replace with an atomic `updateMany` guarded by `id`, `usedAt: null`, and `expiresAt > now`, then require `count === 1`.
**Confidence:** high

### [HIGH] server/src/repositories/groupRepository.ts:102 — Group membership replacement is not atomic
**Category:** Logic/invariant
**What:** `setMembers` reads current members, deletes removed users, then validates and creates new users as separate operations outside a transaction. A failure or race after the delete leaves the group partially updated.
**Why it matters:** Group access can be unintentionally removed or left in a mixed state, which affects every wallet/device that inherits that group.
**Repro / trigger:** Replace group members while the create step fails, or run two `setMembers` calls concurrently for the same group.
**Fix shape:** Validate additions first, then perform the diff delete/create inside a single Prisma transaction, preferably with a group-scoped lock for concurrent replacements.
**Confidence:** high

### [HIGH] server/src/repositories/draftLockRepository.ts:47 — UTXO lock conflicts race into unique-constraint errors
**Category:** Concurrency/async
**What:** `lockUtxosWithClient` checks for existing locks, then calls `createMany` without `skipDuplicates`. Concurrent lock attempts can both see no conflict; the loser throws a unique-constraint error before the structured conflict branch can run.
**Why it matters:** Normal concurrent draft creation turns a recoverable "UTXO already locked" result into an unhandled Prisma error.
**Repro / trigger:** Run two `lockUtxos` calls in parallel with overlapping UTXO IDs.
**Fix shape:** Serialize by sorted UTXO IDs, use serializable isolation, or use `createMany({ skipDuplicates: true })` and treat a count gap as the conflict response.
**Confidence:** high

### [HIGH] server/src/repositories/maintenanceRepository.ts:67 — VACUUM setup uses a bind parameter where PostgreSQL expects a literal
**Category:** Persistence/state
**What:** `vacuumAnalyze` sends `SET statement_timeout = ${String(timeoutMs)}` through Prisma's tagged-template parameterization. PostgreSQL `SET` statements do not accept bind placeholders in that position.
**Why it matters:** The maintenance VACUUM path fails before `VACUUM ANALYZE` runs, so scheduled database maintenance does not perform the intended cleanup.
**Repro / trigger:** Call `maintenanceRepository.vacuumAnalyze()` against PostgreSQL; the initial `SET statement_timeout` statement is rejected.
**Fix shape:** Validate `timeoutMs` as an integer and use a safe literal form for `SET`, or use a transaction-local configuration approach that PostgreSQL accepts.
**Confidence:** high

### [HIGH] server/src/repositories/transactions/core.ts:101 — Transaction pagination stalls on null block times
**Category:** Null/boundary
**What:** `findByWalletIdPaginated` only emits `nextCursor` when the last item has a non-null `blockTime`. The same query can still set `hasMore: true`, leaving clients with more rows but no usable cursor.
**Why it matters:** Wallets with enough pending/unconfirmed transactions can make transaction history pagination stop early.
**Repro / trigger:** Query a wallet where the first page ends on a transaction with `blockTime === null` and at least one extra row was fetched.
**Fix shape:** Use a cursor shape that can represent null block times, or order by a non-null stable field before using `blockTime` as a secondary key.
**Confidence:** high

### [HIGH] server/src/repositories/nodeConfigRepository.ts:84 — Saving the default node can leave no default configured
**Category:** Concurrency/async
**What:** `saveAsDefault` clears all current defaults with `updateMany`, then performs the `upsert` in a second write outside a transaction. Readers between those awaits observe zero default node configs, and a failed upsert leaves that state behind.
**Why it matters:** Sync and node-connection code can intermittently behave as if no node is configured.
**Repro / trigger:** Run `saveAsDefault` while another worker calls `findDefault`, or force the upsert to fail after `updateMany` succeeds.
**Fix shape:** Wrap the unset and upsert in one transaction, and consider enforcing the singleton default invariant at the database level.
**Confidence:** high

### [HIGH] server/src/repositories/deviceRepository.ts:579 — Accessible-device listing omits directly owned devices
**Category:** Logic/invariant
**What:** `findAccessibleByUser` claims to include owned devices but its `OR` only checks `DeviceUser` rows and group membership. Devices created through the plain `create` path can have `device.userId` without a corresponding `DeviceUser` row.
**Why it matters:** Device access/listing can silently hide a user's own devices.
**Repro / trigger:** Create a device through `deviceRepository.create`, then call `findAccessibleByUser` for that owner.
**Fix shape:** Add `{ userId }` to the access `OR` or route all device creation through a single invariant-preserving owner association path.
**Confidence:** high

### [HIGH] server/src/repositories/addressRepository.ts:469 — Address lookup ignores group-access wallets
**Category:** Logic/invariant
**What:** `findByAddressesForUser` filters wallet access through direct `wallet.users.some({ userId })` only. Other repository access helpers include group membership, but this lookup path does not.
**Why it matters:** Users with valid group access get false negatives when resolving addresses that belong to their accessible wallets.
**Repro / trigger:** Give a user wallet access through a group only, then call the address lookup route for an address in that wallet.
**Fix shape:** Reuse `buildWalletAccessWhere(userId)` inside the wallet relation instead of hand-rolling only the direct-user branch.
**Confidence:** high

### [MEDIUM] server/src/repositories/walletSharingRepository.ts:68 — Wallet access cache is invalidated after revocation
**Category:** Concurrency/async
**What:** `removeUserFromWallet` deletes the `WalletUser` row before invalidating the access cache. A concurrent request can read the stale cached grant in the window between delete and invalidation.
**Why it matters:** Access revocation is briefly fail-open under concurrent traffic.
**Repro / trigger:** Run a wallet access check concurrently with `removeUserFromWallet`; the check can use the old cache entry before invalidation completes.
**Fix shape:** Invalidate before and after the delete, or serialize role changes and access-cache refreshes through one helper.
**Confidence:** medium

### [MEDIUM] server/src/repositories/draftRepository.ts:335 — Draft update reads the result outside the write transaction
**Category:** Concurrency/async
**What:** `update` performs an optimistic `updateMany`, then separately calls `findUnique` to return the draft. Another writer can mutate or delete the row between those operations.
**Why it matters:** A caller can receive a draft state that is not the state it just wrote, confusing PSBT/signature flows.
**Repro / trigger:** Two clients update the same draft nearly simultaneously; the first update succeeds, then reads the second client's state.
**Fix shape:** Put the update and follow-up read in a single transaction, or use an update form that returns the written row under the same guarded predicate.
**Confidence:** medium

### [MEDIUM] server/src/repositories/walletRepository.ts:296 — Additional wallet filters can overwrite the access predicate
**Category:** Security
**What:** `findAccessibleWithSelect` spreads `additionalWhere` after `buildWalletAccessWhere(userId)`. If a caller passes an `OR` key, it replaces the access-control `OR` instead of being combined with it.
**Why it matters:** A future or internal caller can accidentally widen a scoped wallet query and expose wallets outside the user's access set.
**Repro / trigger:** Call `findAccessibleWithSelect(userId, select, { OR: [{ network: 'mainnet' }] })`; the repository no longer applies the original wallet-access OR.
**Fix shape:** Combine predicates as `AND: [buildWalletAccessWhere(userId), additionalWhere ?? {}]` so caller filters cannot replace the access condition.
**Confidence:** high

### [MEDIUM] server/src/repositories/maintenanceRepository.ts:181 — Dynamic table deletion relies on caller-side validation
**Category:** Persistence/state
**What:** `deleteAllFromTable` accepts `table: string` and calls `tx[table].deleteMany({})` behind `@ts-expect-error`. The repository owns a destructive operation but does not enforce an allowlist locally.
**Why it matters:** A bad caller or restore bug can delete records from the wrong Prisma model.
**Repro / trigger:** Pass any valid Prisma delegate name that the restore flow did not intend to clear.
**Fix shape:** Replace `string` with a typed allowlist of restorable model keys and validate inside the repository before performing destructive writes.
**Confidence:** high

### [MEDIUM] server/src/repositories/nodeConfigRepository.ts:257 — Electrum priority reorder can partially apply
**Category:** Logic/invariant
**What:** `esReorderPriorities` runs all priority updates through `Promise.all` without a transaction. If one update fails, other updates may already be committed.
**Why it matters:** The Electrum server ordering can be left with duplicate, missing, or stale priorities.
**Repro / trigger:** Delete or modify one server concurrently while a reorder is in progress.
**Fix shape:** Use `prisma.$transaction(updates.map(...))` so the reorder commits or rolls back as a unit.
**Confidence:** high

### [MEDIUM] server/src/repositories/nodeConfigRepository.ts:228 — Health update swallows all database errors
**Category:** Error handling
**What:** `esUpdateHealth` catches every error, logs a stringified value, and resolves. It does not distinguish expected missing-row cases from Prisma outages or schema errors.
**Why it matters:** Node health state can stay stale while the caller believes it was persisted, reducing observability during connectivity incidents.
**Repro / trigger:** Trigger any Prisma error during an Electrum health update.
**Fix shape:** Use `getErrorMessage()` for logging, suppress only known benign Prisma errors, and rethrow or surface unexpected persistence failures.
**Confidence:** high

### [MEDIUM] server/src/repositories/addressRepository.ts:284 — Nullable derivation paths are typed as non-null
**Category:** Null/boundary
**What:** `findDerivationPathsByAddresses` promises `derivationPath: string`, but the selected database field is nullable. A row with `derivationPath = null` is returned through a non-null type.
**Why it matters:** PSBT construction can receive `null` where downstream code expects a derivation path string.
**Repro / trigger:** Store or import an address row without a derivation path, then fetch paths for transaction construction.
**Fix shape:** Return `string | null` and force callers to handle the missing path, or filter out/null-reject rows at the repository boundary with a domain-specific error.
**Confidence:** high

### [MEDIUM] server/src/repositories/utxoRepository.ts:89 — Marking a UTXO spent hides all failures as not found
**Category:** Error handling
**What:** `markAsSpent` catches every exception and returns `null`. A transient database error is indistinguishable from the valid "UTXO row does not exist" case.
**Why it matters:** Sync/reconciliation code can skip retries and silently fail to persist spent state.
**Repro / trigger:** Trigger a Prisma connection error during `markAsSpent`; callers see `null` and may continue.
**Fix shape:** Narrow handling to the expected Prisma not-found error or use `updateMany` and inspect `count`; rethrow all unexpected errors with `getErrorMessage()` context.
**Confidence:** high

### [LOW] server/src/repositories/deviceRepository.ts:699 — Exported account lookup always returns an empty array
**Category:** Logic/invariant
**What:** `findByUserIdWithAccounts` hardcodes `id: { in: [] }`, so it can never match any device. The comment says IDs will be overridden, but the function has no parameter that can do that.
**Why it matters:** Any caller using this exported repository method gets a silent false-negative.
**Repro / trigger:** Call `deviceRepository.findByUserIdWithAccounts(userId)` for a user who owns devices.
**Fix shape:** Remove the impossible ID predicate or delete the dead method in favor of `findByIdsAndUserWithAccounts`.
**Confidence:** high

### [LOW] server/src/repositories/policyRepository.ts:480 — Usage-window decrement can make counters negative
**Category:** Logic/invariant
**What:** `decrementUsageWindow` unconditionally decrements `totalSpent` and `txCount`. There is no guard that `totalSpent >= amount` or `txCount >= 1`.
**Why it matters:** Compensating operations can corrupt policy counters and make later limit checks undercount usage.
**Repro / trigger:** Call `decrementUsageWindow` twice for one recorded spend, or call it for a spend that was never incremented.
**Fix shape:** Use a guarded `updateMany` and require `count === 1`, or clamp with a database expression that cannot go below zero.
**Confidence:** medium

### [LOW] server/src/repositories/draftLockRepository.ts:144 — Type assertion hides a partial lock shape
**Category:** TypeScript Rules violations
**What:** `findByUtxoId` selects only `draftId`, `utxoId`, and `createdAt`, then casts the result to `DraftUtxoLock`. The runtime object lacks fields such as `id` even though the type says they exist.
**Why it matters:** A future caller can read `lock.id` and get `undefined` despite TypeScript accepting it.
**Repro / trigger:** Call `findByUtxoId` and access any unselected `DraftUtxoLock` field.
**Fix shape:** Either select the full lock row or return an explicit narrow type matching the selected fields.
**Confidence:** high

### [LOW] server/src/repositories/auditLogRepository.ts:88 — Falsy JSON details are replaced with an empty object
**Category:** Null/boundary
**What:** `create` stores `details: input.details || {}`. Valid JSON values like `false`, `0`, or an empty string are replaced with `{}`.
**Why it matters:** Audit entries can lose the exact value a caller attempted to record.
**Repro / trigger:** Create an audit log with `details: false` or `details: 0`.
**Fix shape:** Use nullish coalescing, `input.details ?? {}`, so only absent details get the default.
**Confidence:** medium
