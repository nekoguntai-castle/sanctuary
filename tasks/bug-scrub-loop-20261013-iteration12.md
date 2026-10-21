# Bug-scrub loop 20261013 — iteration 12 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 12
- **Source SHA:** `51b0b69af08a9c2ebeca10cda429f39222fef517` (`main`, after #1411/#1412)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (2 × P1, 9 × P2; eleven).** Every finding was re-verified from source at `51b0b69af0` (file:line
  in the phase sections). **None is rejected.** The P3 `broadcast-reconciliation--lookup-accepts-unauthenticated-tx` is
  **folded into A1** (same defect class, same authentication helper, its own red tests, D-12.4). Every other P3 from
  this 27-finding scrub (27 minus the eleven blockers and the folded reconciliation P3) is backlog in run state and is
  **outside this fix set**.

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `confirmation-populate--fields-from-unauthenticated-tx-bytes` (+ folded P3 `broadcast-reconciliation--lookup-accepts-unauthenticated-tx`) | P1 (+P3) |
| A2 | `wallet-sync--non-lowercase-electrum-txid-duplicates-authenticated-rows` | **P1** |
| B1 | `tx-label-ai-suggestion--wallet-labels-cache-not-invalidated` | P2 |
| B2 | `restore-warnings--collapsed-and-wiped-after-restore` | P2 |
| B3 | `webhook-replay--resends-retired-delivery-to-repointed-endpoint` | P2 |
| B4 | `assistant-date-range--leap-year-full-year-rejected` | P2 |
| C1 | `ci-verify-vectors--binding-mutation-step-budget-too-tight` | P2 |
| C2 | `ci-diagnostics--breadcrumb-labels-step-timeout-as-post-verification-fault` | P2 |
| C3 | `ci-critical-mutation--incremental-cache-blind-to-contract-files` | P2 |
| C4 | `install-unit-tests--negated-assertions-ignored-by-errexit` | P2 |
| C5 | `rc-canary--deployed-revision-not-bound-to-receipt` | P2 |

## Open questions

All open questions raised by the section drafters are **decided by the coordinator** with the drafters' recommended
defaults. None needed a user decision: each default either keeps current behaviour or is strictly stricter than today,
and none invents product policy.

- **OQ-A1 — in-app detection of non-lowercase rows: DECIDED, no.** No detector, no exclusion from balance or coin
  selection. The limitation and the read-only detection SQL are documented in the changelog (D-12.6). Revisit only if
  an operator reports such a row. (Keeps current behaviour; no data repair.)
- **OQ-A2 — sent-row `addressId` from the populate path: DECIDED, accept.** After D-12.3 the populate path no longer
  sets `addressId` on sent rows. That is already the production behaviour, because Electrum never supplies `prevout`.
  Populating it from authenticated parents is tracked separately, outside this fix set. (Keeps current behaviour.)
- **OQ-B3 — replay after a secret rotation at the same URL: DECIDED, a same-URL replay of a non-retired row stays
  allowed** and is signed with the current secret (D-12.B3a). Rows retired by the rotation itself
  (`dead` + `DELIVERY_ENDPOINT_CHANGED_REASON`) are refused. (Strictly stricter than today.)
- **OQ-B2 — restore warnings on a non-admin login: DECIDED, discard.** A non-admin who signs in on that tab consumes
  and discards the hand-off (warnings name users). The hand-off has a 24 h TTL (D-12.B2b). (Strictly stricter: today
  nobody sees them after re-login.)
- **OQ-B4 — date-range error text: DECIDED, unchanged** (`Date range exceeds ${N} days`, status 400; D-12.B4a).
- **OQ-C5 — canary on the local stack: DECIDED, runbook follow-up.** From v0.8.78 the canary refuses a stack not built
  from `CANARY_COMMIT`. The release runbook/skill step becomes "check out the RC tag in
  `/home/nekoguntai/sanctuary-main`, `./start.sh --rebuild`, then run the canary". This is a skill/runbook follow-up
  outside this repo diff (the `docs/how-to/release-candidate-canary.md` line in C5 states the rebuild requirement).
  (Strictly stricter: refuses what is accepted today.)
- **OQ-C4 — fallout of unmasked negative assertions: DECIDED, handled like D-11.15** (D-12.X5).

## Goal and non-goals

**Goal:** fix every blocking finding (2 × P1, 9 × P2; eleven), plus the folded reconciliation P3, each with a
non-regression test that fails on `51b0b69af0` and passes after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog (above); production data repair of rows already written by a hostile server (D-12.6,
documented with a read-only query only); new Prisma migrations or `schema.prisma` edits (RC10 migration-tree digest);
a version bump (none of this is a release; versions stay as they are); branch-protection changes; new API endpoints
(so **no e2e mock-map edits**: the thirteen `unhandledRequests` sites found by grepping `transactions/balance-history`
stay untouched; B3 only documents an already-reachable 409 on an existing route); an in-app detector for
non-lowercase rows (OQ-A1); server-side storage of restore warnings (D-12.B2b); splitting the binding mutation job
(D-12.C1); a Dockerfile or tag change for the canary (D-12.C6); a full host-Docker vector regeneration (C1 needs only
the provenance rehash).

## Decisions

Decision ids are kept from the section drafts and are unique across the plan: **D-12.1–D-12.6** (Phase A),
**D-12.B1–D-12.B4b** (Phase B), **D-12.C1–D-12.C6** (Phase C), and the cross-cutting **D-12.X1–D-12.X5** below. Every
reference in this plan uses these ids.

### Cross-cutting decisions

- **D-12.X1 lizard headroom.** Pinned lizard 1.24.0 (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`)
  with the repo arguments (`scripts/quality.sh`: `-i 86 -C 15 -T nloc=200`) allows 86 warnings; 84 are used on the
  base. The PR may add at most 2 and targets 0. Every worker runs `lizard -C 15 -T nloc=200 <new/changed
  .ts/.tsx/.js/.mjs files>` and reports zero new warnings. New helpers are top-level `function` declarations, CCN ≤ 15,
  NLOC ≤ 200; do not hoist a nested `function` out of a `describe` without re-measuring.
- **D-12.X2 one worktree per phase.** Phases `a` (A1 + A2), `b1`, `b2`, `b3`, `b4`, `c` (C1–C5) each get a worktree
  under `/home/nekoguntai` (never `/tmp`), `/home/nekoguntai/sanctuary-bug-scrub-20261013-i12-<phase>`, on branch
  `codex/bug-scrub-loop/20261013-i12-<phase>`, cut from the final reviewed plan commit (the integrator records its SHA;
  it differs from `51b0b69af0` only under `tasks/`). Setup: root `npm ci` + `cd server && npx prisma generate` +
  `npm run build --workspace=shared`, nvm node on `PATH`. Every commit goes through
  `flock /home/nekoguntai/.i12-commit.lock git commit …` in the foreground; never while a coverage or Stryker run is
  active; no `git stash`. One commit per finding (test + fix); C3 is two commits (walker + red test, then classifier).
  The integrator alone runs coverage and Stryker, behind the bounded guard.
- **D-12.X3 hold rules.** Only C4 may be held out of the PR without blocking the others, and only by coordinator
  decision on an unmasked real bug (D-12.X5); C4's commits touch no file a later C commit touches (C2 also edits
  `.github/workflows/quality.yml`, at a different line and in an earlier commit), so the integrator can skip them. A1/A2 (P1) are not holdable. If A2's integration case 7 does not fail on base for the stated reason
  (two rows after a sync that resolved with no `lastSyncError` and served the uppercase history and listunspent, with
  the in-process projector mock in place, Phase A2), or case 8 does not go 0 → 1, the A worker stops and the
  coordinator re-assesses before anything is cherry-picked. A held phase keeps
  its branch and worktree, and its finding stays open in run state.
- **D-12.X4 cross-phase couplings (no shared files).** The ownership table is disjoint; the remaining couplings are
  ordering only:
  1. A1's critical shard-3 proof for `broadcastReconciliation.ts` (D-12.4) runs on `server/stryker.critical.config.mjs`,
     which C3 changes to `incremental: false`. The integrator runs it on the integrated tree after both are cherry-picked;
     the `--force` flag in the command is then redundant but harmless.
  2. C3's `check-critical-mutation-config.mjs` walker runs over the integrated tree. No A or B file is in the import
     graph of the 24 critical test entries (A's `broadcastReconciliation.test.ts` is matched by the existing
     `server/tests/unit/services/bitcoin/signingIntent/*` pattern but is not an entry), so the "42 unclassified" count is
     unaffected; the integrator re-runs the checker after all cherry-picks.
  3. Nobody edits `server/tests/mocks/prisma.ts` or `server/tests/setup.ts`; C3 only adds them to
     `is_critical_mutation_file`. C1's `server/tests/fixtures/verified-address-vectors.ts` rehash is a C3 critical input
     too, so the PR selects the critical lane from Phase C alone (A1 already selects it through `signingIntent/*`).
  4. `docs/reference/changelog.md` `## [Unreleased]` (workers hand over bullet text, including the two D-12.6 notes) and
     `docs/architecture/generated/*` are integrator-owned.
- **D-12.X5 (C4) unmasked failures.** Converting the inert negations may surface a check that fails today. Each is
  reported to the coordinator before being changed, classified as (a) a real product/script bug → new finding in run
  state; leaving the test red is not acceptable, so C4 is held (D-12.X3) until the coordinator decides; or (b) a stale or
  mis-specified assertion → fixed in C4 with a one-line justification in the commit body and the PR body.
  One class (b) case is already known and recorded (pass 9, prototyped): `grafana-quiescence.test.sh:1179` in
  `test_client_disconnect_requires_scoped_terminal_outcome`. `docker.log` is not cleared between the first
  `run_helper client-disconnect` (`:1169`), which legitimately logs `compose … stop grafana`, and the second
  `run_helper success` (`:1175`), so the converted `:1179` check fails on the first run's line. C4 inserts
  `: > "$TEST_ROOT/docker.log"` before `:1175` (the same test already clears it before its third run, `:1192`).

### Phase A decisions (D-12.1–D-12.6)

- **D-12.1 (A1) Move `nodeTransactionAuthentication.ts` to the shared bitcoin root.** Phase A adds two consumers
  outside `advancedTx` (sync confirmations, signing-intent reconciliation), next to i11's
  `transactions/helpers.ts:12`. Three of four consumers would then import a feature-private module, so A1 runs
  `git mv src/services/bitcoin/advancedTx/nodeTransactionAuthentication.ts src/services/bitcoin/nodeTransactionAuthentication.ts`
  (it sits next to `rawTransactionEvidence.ts`, the only module it builds on). The move changes only these lines:
  - the module's two imports: `'../nodeClient'` becomes `'./nodeClient'` (type-only) and `'../rawTransactionEvidence'`
    becomes `'./rawTransactionEvidence'`;
  - its header comment, which now names all four consumers;
  - `advancedTx/shared.ts:30`: `from './nodeTransactionAuthentication'` becomes `from '../nodeTransactionAuthentication'`.
    The re-export block `:26-30` stays, so `rbf.ts`, `cpfp.ts` and `batch.ts` keep their `./shared` import lines
    unchanged;
  - `transactions/helpers.ts:12`: `'../advancedTx/nodeTransactionAuthentication'` becomes `'../nodeTransactionAuthentication'`;
  - the test moves to `server/tests/unit/services/bitcoin/nodeTransactionAuthentication.test.ts`, with both relative
    imports re-pointed one level up: `:8` becomes `'../../../../src/services/bitcoin/nodeTransactionAuthentication'`
    and `:9` (`'../../../../../src/services/bitcoin/rawTransactionEvidence'`) becomes
    `'../../../../src/services/bitcoin/rawTransactionEvidence'`.

  Mutation pins are unaffected. `rbf.ts`, `cpfp.ts` and `batch.ts` (the `serverFeePolicy` map entries and the
  `server/stryker.fee-policy.config.mjs:13-16` ranges) are not edited. `shared.ts`, `helpers.ts` and the moved
  module are in no `mutate` list and in no `config/wallet-safety-mutation-map.json` entry. No test mocks the old
  path; `grep -rn nodeTransactionAuthentication server/src server/tests config scripts` finds only the four sites
  above. Graph: the module still imports only `./rawTransactionEvidence` (which imports only `bitcoinjs-lib`) plus a
  type-only `./nodeClient`, so no new edge can close a cycle.
  *Rejected alternative:* keep it under `advancedTx/` and import across. That makes sync and signingIntent depend on a
  feature-private file, and the fourth consumer makes the move cost the same later.
- **D-12.2 (A1) Authenticate and re-project at the populate fetch boundary.** In `sync/confirmations/fetchHelpers.ts`,
  `fetchTransactionDetails` (`:105-120`) and `fetchPreviousTransactionBatch` (`:228-243`) keep their existing
  `client.getTransaction(txid, true[, options])` calls, so the `remoteAwaitInventory.test.ts:20` fragment
  `getTransaction(txid, true, options)` stays. Each fetched value then goes through the new
  `sync/confirmations/authenticatedDetails.ts` export
  `authenticatedPopulationDetails(txid: string, details: unknown, network: LegacyNetworkType): RawTransaction`, which:
  1. calls `authenticateNodeTransaction(txid, details)` (D-12.1). That checks the bytes hash to the requested txid,
     re-encode canonically and stay under the 4,000,000 WU cap (`rawTransactionEvidence.ts:253-280`);
  2. builds the cache value only from `authenticated.transaction`:
     - `vin`: `{ coinbase: <scriptSig hex> }` for an all-zero hash with index `0xffffffff`, else
       `{ txid: <reversed hash hex>, vout: index }` (an empty scriptSig projects the falsy `''`, so test fixtures
       give coinbase inputs a non-empty BIP34 scriptSig; real coinbases always carry one);
     - `vout`: `{ value: Number(output.value) / 100_000_000, n, scriptHex, ...(address && { address }) }`, with
       `address = transactionOutputAddressForNetwork({ value, scriptHex }, network)` from
       `sync/transactionOutputEvidence.ts:20-33`;
     - this matches `projectAuthenticatedTransactionWithComplexity` (`transactionEvidenceProjection.ts:331-343`), plus
       the explicit `address` that the populators read (`transactionOutputAddress` and `transactionOutputAddresses`
       read only explicit fields);
  3. copies only the chain-position metadata `time`, `blockheight` and `confirmations`, and only when
     `typeof value === 'number'`. These are the fields the main pipeline's projection also carries
     (`transactionEvidenceProjection.ts:344-353`), and they are the same trust class as the history heights the
     populate path already uses (`fetchHelpers.ts:21-77`).

  The client's `fee`, `vin[].prevout` and decoded `vin`/`vout` are never copied. The return value is a fresh object
  with exactly `txid` (the requested, now authenticated txid), `vin`, `vout` and the numeric chain-position keys; no
  output entry is a merge onto the client's `details.vout[n]` (a `{ ...details.vout[n], value, n, scriptHex, … }`
  projection keeps the client's `scriptPubKey.address` on an output with no decodable address, such as OP_RETURN,
  and `transactionOutputAddress` (`transactionOutputEvidence.ts:17-18`) falls back to it), and `vin` comes from the
  bytes, never from the client (client txids naming a genuine larger parent forge the fee). A `RawTransactionEvidenceError` (or a
  `null`/non-object result, which becomes `malformed_raw_transaction`) is thrown inside the existing per-txid `try`.
  The existing `catch` (`:113-117`, `:236-240`) handles it: abort is rethrown first, a static-message warning is
  logged, and the entry is dropped. A forged current transaction therefore leaves its row's fields `null`, to be
  retried on the next pass. A forged parent becomes an unresolved input, and the existing partial-input rule
  (`feePopulation.ts:88-91`) leaves the fee null. Both fetch helpers gain a `network: BitcoinNetwork` parameter before
  `options`, and `populateFields.ts:181-184` passes `castNetwork`. Cache maps are typed `Map<string, RawTransaction>`
  (`fetchHelpers.ts:87,89,146,150`, `processUpdates.ts:41-42,114-115,143`). So the strict build stays green, two
  signatures follow the cache type: `populateBlockHeight`'s `txDetails` parameter (`fieldPopulators.ts:21-23`) widens
  to `RawTransaction | undefined` (its body already reads `txDetails?.`; `processUpdates.ts:126` passes
  `txDetailsCache.get(...)`, which is `RawTransaction | undefined`, and would otherwise fail TS2345), and
  `populateTransactionDetails`' `txDetails: any` (`processUpdates.ts:151`) becomes `txDetails: RawTransaction`.
  After an honest Electrum fetch the values
  are numerically identical to today's: `decodeRawTransaction` (`electrum/methods.ts:121-170`) derives the same
  value, script and address from the same bytes.
  *Rejected alternatives:*
  - (a) Authenticate `details.hex` but keep the client's `details` object. Its `vin`/`vout`/`fee`/`prevout` are not
    bound to the hashed bytes. A1 case 6(d) proves this alternative fails (it serves authentic bytes with a client
    `vout` paying a different address). Two partial variants are also rejected: a merge projection over the client's
    `vout` entries (case 6(e): the client's `scriptPubKey.address` survives on an OP_RETURN output) and authenticated
    `vout` with the client's `vin` (case 6(f): a client `vin` naming a genuine 150_000-sat parent forges fee
    `51_000n`). The `authenticatedDetails.test.ts` whole-object `toStrictEqual` case rejects both directly. The same
    alternative applied only to the parent fetch (`fetchPreviousTransactionBatch`, `fetchHelpers.ts:228-243`:
    authenticate the parent but cache its client details) is rejected by cases 6(g) (a client parent `vout[0].value`
    forges the fee) and 6(h) (a client parent `vout[0].scriptPubKey.address` forges the received counterparty).
  - (b) Reuse `projectAuthenticatedTransaction`. It needs per-attempt `limits` from `evidenceAuthentication.ts`, which
    would pull the worker-thread evidence module into confirmations, and it emits script-only outputs that the
    populators cannot read.
  - (c) The shared `fetchAuthenticatedTransaction`. It drops the abort `options` (`nodeTransactionAuthentication.ts:51`).
- **D-12.3 (A1) Remove the populators' reads of unauthenticated value and address fields.** After D-12.2 these
  fields never reach the populators. Electrum, the only `NodeClientInterface` implementation (`nodeClient.ts:8`;
  `PooledNodeClient` wraps `ElectrumClient`, `pooledNodeClient.ts:1,55`), never returns them, because its
  `getTransaction` always decodes raw bytes (`electrum/methods.ts:272-279`). So removing them changes nothing in
  production. Keeping them would leave a server-chosen fee path that one future pass-through could reopen. A1
  removes:
  - `feePopulation.ts:26-38` `electrumFeeSats` and its use in `resolveFeeSats` (`:112-120`). The fee comes only from
    `calculatedFeeSats`. `populateFee` loses its unused `txDetails` parameter (call site `processUpdates.ts:164`).
  - `feePopulation.ts:55-57`, the `input.prevout.value` branch.
  - `counterpartyPopulation.ts:26`, the direct `input.prevout` address, together with `getScriptAddress` /
    `ScriptAddressSource` (`:13-20`), which become unused. The received counterparty comes only from the
    authenticated parent output (`:31`).
  - `fieldPopulators.ts:103-105,114-116,135-156`, the sent-row `addressId` branch (`findSentAddressId`,
    `getInputAddresses`, `isSentType`), which read only `input.prevout`. Sent-row `addressId` is no longer populated
    by this path. That was already true in production.
  - `fetchHelpers.ts:194-199` loses `txDetails.fee == null`, and `:215-221` loses `!input.prevout`.

  The defensive guards in the exported pure populators stay (`try/catch` at `feePopulation.ts:157` and
  `counterpartyPopulation.ts:107`, missing `txid`/`vout`, `|| []`), because they protect public functions whose
  typed input allows those shapes. The flow can no longer reach them, so they are covered by a direct unit test
  (`populators.defensive.test.ts`). Fallbacks in non-exported code that the typed projection makes unreachable are
  removed: `processUpdates.ts:158-159` (`|| []`) and `fetchHelpers.ts:187` (`|| []`).
  *Rejected alternative:* keep the verbose branches and cover them with direct tests. That keeps live code that trusts
  server-chosen fees.
- **D-12.4 (A1, folded P3) Reconciliation lookups authenticate the returned bytes.** `broadcastReconciliation.ts:100`
  and `:152`, `await getTransactionDetails(record.broadcastTxid, record.network)`, each become
  `authenticateNodeTransaction(record.broadcastTxid, await getTransactionDetails(record.broadcastTxid, record.network));`.
  That is one line each, with the `import { authenticateNodeTransaction } from '../nodeTransactionAuthentication';`
  added after `:13`. The authentication replaces the lookup line itself, so it runs before
  `markBroadcastAccepted` (`:101-104`); authenticating after it would accept before verification and then, with the
  throw caught as a lookup miss, re-broadcast and accept a second time (case 8 pins one acceptance, after the
  broadcast). A forged or missing lookup result throws inside the existing `try` blocks. For an uncertain
  intent it is treated as a lookup miss (`:106-114`): the exact durable artifact is re-submitted through
  `broadcastAuthenticatedRawTransaction`, which already checks the node's txid (`networkOperations.ts:126-129`). For a
  stalled intent it stays stalled (`:153-159`). `getTransactionDetails` itself (`networkOperations.ts:214-221`) is not
  changed, because it also feeds the API route `api/bitcoin/transactions.ts:126`. `record.broadcastTxid` already
  matches the DB `CHECK ... ~ '^[0-9a-f]{64}$'`
  (`prisma/migrations/20260810180000_add_signing_intent_broadcast_claims/migration.sql:21`). The fix fits cleanly, so
  the P3 is folded in. One consequence: `signingIntent/**` is in critical mutation shard 3
  (`server/scripts/mutation/shards.mjs:37`), so the critical lane runs for this PR (see Constraints).
- **D-12.5 (A2) Normalize Electrum txids to lowercase at the schema boundary.** `electrum/types.ts` gains
  `export const ElectrumTxidSchema = z.string().regex(/^[0-9a-fA-F]{64}$/, 'expected a 64-character hex txid').toLowerCase();`
  (zod 4.6.5; `ZodString.toLowerCase(): this` is an in-place overwrite, so the schema stays a `ZodString`).
  `HistoryItemSchema.tx_hash` (`:124`) and `UtxoItemSchema.tx_hash` (`:132`) use it. Every Electrum txid ingress
  goes through these two schemas:
  - `getAddressHistory` / `getAddressHistoryBatch` (`methods.ts:241-249,503-529`, via `validateHistoryResponse`
    `:43-58`);
  - `getAddressUTXOs` / `getAddressUTXOsBatch` (`methods.ts:254-262,536-560`);
  - the sync-phase re-parse `fetchUtxos.ts:172-177`.

  All callers use the parsed `data`. Downstream that covers the main pipeline (`fetchHistories.ts:88-94`,
  `historyEvidenceAuthentication.ts`, `checkExisting.ts`, classification, `fetchUtxos`/`insertUtxos`), the legacy
  `blockchain/syncAddress.ts:83-388`, `blockchain/syncWallet.ts:172` and the populate heights
  (`fetchHelpers.ts:66`). No `blockchain.scripthash.get_history`/`listunspent` request bypasses `methods.ts` (grep:
  only `methods.ts:247,260,512,544`). Transaction-byte txids are already lowercase, because they come from
  `getId()`/`Buffer.toString('hex')`.
  *Rejected alternatives:*
  - (a) Reject non-lowercase hex. Electrum responses are hex strings with no case rule, and the authentication layer
    is case-insensitive on purpose (`rawTransactionEvidence.test.ts:100-125`). Rejecting would turn a cosmetic quirk
    into a full address-history or UTXO failure.
  - (b) Re-key `evidenceAuthentication` / `historyEvidenceAuthentication` / persistence by `envelope.txid`. That
    touches many sync-path files, while the raw history and UTXO maps would still carry the raw string.
  - (c) Also re-parse history in `fetchHistories`. That is redundant while Electrum is the only client.

  Behavior change: a non-hex 64-character `tx_hash` now fails schema validation for that address's response
  (history: `ElectrumResponseValidationError`, which goes through the existing fallback and fail-closed handling in
  `fetchHistories`; UTXO batch: the address is left out of the map, so `missing_utxo_result`). Today it fails later
  as `invalid_expected_txid` rejected evidence. Both outcomes are retryable fail-closed results.
- **D-12.6 (A2, A1) No repair of rows already written; documented limitation.** Production data repair and new
  migrations are not authorized, and the release replay gate pins the migration-tree digest, so Phase A changes no
  stored rows. The integrator adds these two notes to `docs/reference/changelog.md` `## [Unreleased]`:
  - A deployment that synced against a hostile or intercepted Electrum server returning non-lowercase txids may hold
    duplicate `transactions` / `utxos` / `transaction_inputs` / `transaction_outputs` rows whose `txid` is not
    lowercase. These rows are never matched or retired again, so they keep the balance inflated. Every legitimate
    source produces lowercase txids, so any such row is suspect. Operators can detect them read-only with
    `SELECT 'transactions' AS t, count(*) FROM transactions WHERE txid <> lower(txid) UNION ALL SELECT 'utxos', count(*) FROM utxos WHERE txid <> lower(txid);`.
    A phantom UTXO cannot move funds: its outpoint parses to the real one (bitcoinjs reads the hash case-insensitively),
    so a spend fails at the node as a duplicate or already-spent input.
  - Missing-field values (fee, consolidation amount, counterparty, addressId) that a hostile server forged before this
    fix are fill-once and are not corrected automatically, and they cannot be detected without re-fetching
    authenticated bytes.

  No in-app detector is added (OQ-A1, decided: no).

### Phase B decisions (D-12.B1–D-12.B4b)

- **D-12.B1 (B1) invalidate the wallet-labels cache from the wallet-detail owner of that cache, not from the
  TransactionList hook.** `useWalletDetailController.handleLabelsChange` (`src/components/WalletDetail/useWalletDetailController.ts:314-318`)
  gains a call to the existing, currently caller-less `useInvalidateWalletLabels()` (`src/hooks/queries/useWalletLabels.ts:36`,
  `createInvalidateAll(walletLabelKeys)` → `queryClient.invalidateQueries({ queryKey: ['walletLabels'] })`,
  `src/hooks/queries/factory.ts:219-229`), inside the existing `if (id)` guard, before `fetchData(true)`.
  `onLabelsChange` is already called by `useTransactionLabelMutations.handleAISuggestion` immediately after
  `labelsApi.createLabel` resolves and **before** the ownership check (`useTransactionLabelMutations.ts:191-196`), so
  the invalidation fires even when the editor was closed or re-targeted mid-request (the label exists on the server
  either way). Invalidation marks the query stale and refetches every mounted observer (`TransactionsTab.tsx:49`,
  `useWalletDetailController.ts:221`, and any mounted `LabelManager`/`LabelSelector`), regardless of the 30 s
  `staleTime` (`src/providers/QueryProvider.tsx:9,15`).
  **Rejected:** (a) `useQueryClient()` inside `useTransactionLabelMutations` — the hook runs in
  `TransactionDetailPanel` for every `TransactionList` consumer (wallet detail, dashboard `RecentTransactions.tsx:170`,
  `ConsoleResultsContent.tsx:164`), and over a dozen frontend test files render `TransactionList` / the hook with no
  `QueryClientProvider` (e.g. `tests/components/TransactionList.test.tsx`, `tests/components/TransactionList/*.test.tsx`,
  `tests/components/Dashboard/RecentTransactions.test.tsx`): all would throw "No QueryClient set". Only the wallet-detail
  tab mounts `useWalletLabels` observers, so the controller is the right owner. (b) Swapping `labelsApi.createLabel`
  for `useCreateWalletLabel().mutateAsync` — same provider problem. (c) Recovering from the 409 by re-reading labels
  — treats the symptom; with a fresh cache the case-insensitive `existing` lookup (`:181-183`) finds the label.
  **Other direct `labelsApi` call sites (sweep, all `src/`):** `useTransactionLabelMutations.ts:160`
  `setTransactionLabels` and `useAddressLabels.ts:88` `setAddressLabels` change only assignments; the wallet label list
  changes only in its `transactionCount`/`addressCount` fields (`src/types/index.ts:334-335`), which no `src/` component
  renders (grep `transactionCount|addressCount` in `src/` hits only types and unrelated wallet/bitcoin DTOs). The
  transaction path still gets the refresh through the same `handleLabelsChange`; the address path is left unchanged
  (no visible staleness). `LabelManager`/`LabelSelector` already use the invalidating mutation hooks
  (`useWalletLabels.ts:15-34`). No other `createLabel`/`updateLabel`/`deleteLabel` caller exists in `src/`.

- **D-12.B2a (B2) warnings get distinct identities.** Each restore warning is added with
  `scopeId: 'restore:<handoffId>:<index>'` and `severity: 'warning'` (was: no `scopeId`, default `'info'`). The
  provider's type+scopeId replace rule (`AppNotificationContext.tsx:266-280`) is kept — it is intentional and pinned
  (`tests/contexts/AppNotificationContext/AppNotificationContext.lifecycle-crud.contracts.tsx:94` "should update
  existing notification with same type and scopeId", `:125` "separate notifications for different scopeIds"). The
  handoff id (`createdAt` in ms plus a counter-free random suffix from `Math.random().toString(36)`) keeps warnings
  from two successive restores distinct.

- **D-12.B2b (B2) warnings cross the forced re-login through a tab-scoped sessionStorage hand-off consumed by the
  authenticated shell; frontend-only, no endpoint.** New module `src/components/BackupRestore/hooks/restoreWarningsHandoff.ts`:
  - `RESTORE_WARNINGS_HANDOFF_KEY = 'sanctuary_restore_warnings_handoff'`, `RESTORE_WARNINGS_HANDOFF_TTL_MS = 24 * 60 * 60 * 1000`;
  - `interface RestoreWarningsHandoff { id: string; createdAt: number; warnings: string[] }`;
  - `stashRestoreWarnings(warnings: readonly string[], now = Date.now()): RestoreWarningsHandoff` — builds the
    handoff, writes it with `sessionStorage.setItem` inside try/catch (`log.debug` on failure — CLAUDE.md: no empty
    catch), and always returns the handoff so the caller can still notify in the current document;
  - `takeRestoreWarnings(now = Date.now()): RestoreWarningsHandoff | null` — reads and **always removes** the key
    (try/catch, `log.debug`), parses with `safeJsonParse` (`src/utils/safeJson.ts:2`, CLAUDE.md rule), and returns
    `null` unless the value is an object with a string `id`, finite `createdAt` with `now - createdAt` in
    `[0, TTL]`, and a non-empty `warnings` array of strings;
  - `restoreWarningNotification(handoff, warning, index): CreateNotificationInput` → `{ type: 'warning', scope:
    'global', scopeId: \`restore:${handoff.id}:${index}\`, severity: 'warning', title: 'Restore Warning', message:
    warning, persistent: true }`.
  `useBackupHandlers.handleRestore` (`useBackupHandlers.ts:236-247`) replaces the inline loop with
  `const handoff = stashRestoreWarnings(result.warnings); result.warnings.forEach((w, i) => addNotification(restoreWarningNotification(handoff, w, i)));`
  (still shown during the ~3 s before reload; the 3 s reload itself is unchanged). New hook
  `src/components/BackupRestore/hooks/useRestoreWarningsHandoff.ts` reads `useUser()` and `useAppNotifications()` and
  runs one effect keyed on `[isAuthenticated, user?.id, user?.isAdmin, addNotification]`: when authenticated, it calls
  `takeRestoreWarnings()`; if a handoff comes back and `user.isAdmin`, it adds every warning with
  `restoreWarningNotification`; for a non-admin it discards (the take already removed it; warnings name users, so
  they are never shown to a non-admin). The hook is called once from `src/app/AppRoutes/AuthenticatedAppShell.tsx`
  (mounted only when `isAuthenticated`, `AppRoutes.tsx:25-29`; the providers wrap it, `src/providers/AppProviders.tsx`).
  Why this survives: terminal logout clears only the notification state and its localStorage key
  (`AppNotificationContext.tsx:150-157,178-182`), not this sessionStorage key; the restore bumps every user's
  `sessionVersion` (`server/src/services/backupService/restoreTransforms.ts:58-67,~350`), so access tokens
  (`server/src/services/accessTokenSessionService.ts:50`) and refresh (`server/src/api/auth/tokens.ts:112-116`) are
  rejected → `refresh.ts:313` `triggerTerminalLogout` → `<Login />`; the shell unmounts and remounts on the next login,
  where the effect consumes the hand-off. It works whether the logout happens after the 3 s reload or earlier from a
  background 401 (then `BackupRestore` unmounts and its cleanup cancels the reload, `useBackupHandlers.ts:67-71`, and
  the re-login happens in the same document). The pre-logout window is safe: the shell is already mounted when the
  stash is written and its effect deps do not change until a different login, so the stale session never consumes
  it. Ids are bound to "an admin on this tab", not to the restoring user id, because the restored `users` table may
  not contain the restoring admin's id (cross-instance restore).
  **Rejected:** (a) show warnings in the restore panel with an explicit acknowledge before reloading — any background
  request 401s immediately after the commit and the terminal logout unmounts the panel, so the acknowledge screen is
  not reliable; (b) exempt restore warnings from the terminal-logout wipe (persisted localStorage) — the wipe is the
  cross-account anti-leak control (`AppNotificationContext.tsx:176-177`) and localStorage outlives the tab;
  (c) server-side storage / a new endpoint — needs a table or setting plus every e2e mock map (CLAUDE.md, 13 sites),
  and no new Prisma migration is allowed; (d) a sessionStorage reader inside `AppNotificationProvider` — the provider
  has no user context (`AppProviders.tsx:13` "no context dependencies") and its tests render it without `UserProvider`.

- **D-12.B3a (B3) recognise a non-replayable delivery by data already on the row; no new status, no migration.**
  A delivery is refused for replay when either (1) `status === 'dead' && lastError === DELIVERY_ENDPOINT_CHANGED_REASON`
  (retired by a repoint or secret rotation, `webhookRepository.ts:153-154,186-195`; covers rotation at an unchanged
  URL), or (2) `delivery.targetUrl !== endpoint.url` (any status, including `delivered`/older rows enqueued before a
  repoint; `targetUrl` is recorded at enqueue, `deliveryService.ts:84`). Same-URL replay of non-retired rows
  (delivered, failed, dead-after-max-attempts) stays allowed and keeps signing with the current secret (the only
  signature the destination can verify). **Rejected:** a new `status: 'retired'` — `status` is free text so it needs no
  migration, but it ripples into delivery DTOs/OpenAPI/frontend status rendering, and rows already retired as
  `dead` + reason on deployed instances would still need the reason check; a stored secret fingerprint per delivery —
  needs a column (migration forbidden); owner-only replay — does not stop an owner from defeating their own
  retirement, and same-URL replay by `edit` members is legitimate (`api/wallets/webhooks.ts:169-170` stays
  `requireWalletAccess('edit')`).

- **D-12.B3b (B3) decide inside the replay transaction under a share lock on the endpoint row.**
  `markDeliveryPendingForReplay` (`webhookRepository.ts:405-436`) first runs two statements, in order, in its existing
  `$transaction`:
  1. lock only the endpoint row:
     ```sql
     SELECT e."id" FROM "webhook_endpoints" e
     WHERE e."id" = (SELECT "endpointId" FROM "webhook_deliveries" WHERE "id" = ${deliveryId})
     FOR SHARE
     ```
     (`tx.$queryRaw<Array<{ id: string }>>(Prisma.sql\`…\`)`);
  2. then a fresh, unlocked read taken **after** the lock is granted (the `createDelivery` pattern,
     `webhookRepository.ts:288-300`):
     ```sql
     SELECT e."url" AS "endpointUrl", d."targetUrl", d."status", d."lastError"
     FROM "webhook_endpoints" e
     JOIN "webhook_deliveries" d ON d."endpointId" = e."id"
     WHERE d."id" = ${deliveryId}
     ```
     (`tx.$queryRaw<Array<{ endpointUrl: string; targetUrl: string; status: string; lastError: string | null }>>(Prisma.sql\`…\`)`).

  Why two statements: a single joined `… FOR SHARE OF e` re-reads only the locked `e` row after waiting (READ
  COMMITTED EvalPlanQual) and keeps the stale `d` snapshot. A replay racing a same-URL secret rotation would then pass
  both checks (URL unchanged; stale `d.status`/`lastError`), and the following `updateMany`, whose `WHERE` checks only
  the lease (`webhookRepository.ts:414-420`), would reset the now-`dead` row to `pending` and send it signed with the
  rotated secret. The second statement starts a new snapshot after the lock wait, so it sees the committed retirement.
  `FOR UPDATE OF d` is **not** added to a joined statement: it would take the delivery lock before the endpoint lock,
  the reverse of `updateEndpoint`'s order, and can deadlock with it.
  *Accepted residual:* the replay's order (endpoint `FOR SHARE`, then the delivery `updateMany`) is the reverse of
  `markDeliveryDelivered`/`Failed`/`Dead` (delivery, then endpoint update, `webhookRepository.ts:451-480`), so replaying
  an expired-lease delivery whose worker is still finishing can deadlock; Postgres detects it (`40P01`, Prisma `P2034`)
  and aborts one side. This is a rare, detected residual of the same class as the existing `updateEndpoint` ×
  `markDelivery*` pair on base; no test or gate change.
  No lock row or no data row → `{ count: 0, delivery: null }` (unchanged contract); a refused row →
  `{ count: 0, delivery: null, refusal: 'endpoint_identity_changed' }` with no write; otherwise the existing guarded
  `updateMany` runs unchanged. `FOR SHARE` conflicts with the `FOR NO KEY UPDATE` that `updateEndpoint` takes before
  repointing and retiring (`webhookRepository.ts:165-170`), so a replay and a repoint (or secret rotation) serialise:
  either the endpoint change commits first (the replay's fresh read then sees the new URL / the retired row and
  refuses) or the replay commits first (the row is `pending`, and the endpoint change's own retirement `updateMany` on
  `pending`/`failed` retires it). The lock statement keeps the text `FROM "webhook_endpoints"` so the integration
  lock-waiter probe can match it. Result type becomes
  `MarkDeliveryPendingForReplayResult { count: number; delivery: WebhookDelivery | null; refusal?: 'endpoint_identity_changed' }`
  (additive: existing service mocks returning `{ count, delivery }` stay valid). A small pure helper
  `isReplayRefused(row)` keeps `markDeliveryPendingForReplay` under the lizard thresholds.
  **API response:** `replayWalletWebhookDelivery` (`endpointService.ts:225-260`) maps `refusal` to
  `throw new ConflictError('Webhook delivery was retired because the endpoint destination or signing secret changed; it cannot be replayed', ErrorCodes.CONFLICT, { deliveryId, reason: 'endpoint_identity_changed' })`
  (signature `ConflictError(message, code = CONFLICT, details?)`, `server/src/errors/ApiError.ts:325-333`) — 409,
  distinct message and `details.reason` from the existing lease-race 409 ("replay already in progress"), and the
  check runs before any queue/send call. The OpenAPI path (`server/src/api/openapi/paths/walletWebhooks.ts:160-173`)
  gains `409: apiErrorResponse` (both 409s were already reachable but undocumented). The frontend
  (`src/components/WalletDetail/WalletWebhooks.tsx:169-178`) already surfaces the server message through
  `runEndpointAction`; no UI change.

- **D-12.B4a (B4) the cap counts days excluding 29 February.** `MCP_MAX_DATE_RANGE_DAYS = N` keeps meaning "N days",
  with a leap day inside the range not counted, so `365` accepts any whole calendar year (the proxy's
  `[Jan 1 00:00:00.000Z, Dec 31 23:59:59.999Z]`, 31,622,399,999 ms in a leap year) while a 366-day range with no
  29 February (e.g. `2025-03-01T00:00Z`–`2026-03-01T23:59:59.999Z`) is still rejected. Implementation in
  `server/src/assistant/tools/utils.ts:26-37`: `span = end - start`; `if (span <= N*DAY) return;`
  `if (span > (N + Math.floor(N / 365) + 1) * DAY) throw …;` (fast reject; bounds the loop below to ≤ 12 years for the
  3650 maximum, `server/src/config/schema.ts:189`) then `if (span > (N + leapDaysWithin(start, end)) * DAY) throw …`.
  `leapDaysWithin` iterates `start.getUTCFullYear()..end.getUTCFullYear()`, keeps Gregorian leap years
  (`y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)`), builds 29 Feb with `const d = new Date(0); d.setUTCFullYear(y, 1, 29)`
  (correct for years < 100, unlike `Date.UTC`), and counts it when `[d, d + DAY)` intersects `[start, end]`.
  The error text (`Date range exceeds ${N} days`) and status 400 are unchanged. **Rejected:** a flat `+1 day`
  tolerance (silently turns 365 into 366 for every range, and for small caps doubles `N = 1`); whole-calendar-day
  counting (a full leap year is 366 inclusive days, still > 365); making the proxy's year end exclusive
  (`[Jan 1, Jan 1)` of a leap year is exactly 366 × 86,400,000 ms, still > 365 days) — and the proxy is a separate
  package whose MCP clients can send the bounds directly anyway.
- **D-12.B4b (B4) delete the dead duplicate.** `server/src/mcp/types.ts:147-155` defines a second
  `enforceDateRange` with the old semantics and no `end < start` check; `grep -rn enforceDateRange server/src` shows no
  importer of it (the MCP server executes the assistant read tools, which import `assistant/tools/utils.ts`;
  `server/src/mcp/` imports from `./types` only `McpHttpError`, `McpForbiddenError`, `McpUnauthorizedError`, types and
  `toMcpAuthInfo`). Delete that function only (keep the file's other exports); worker re-runs the grep before deleting
  and keeps it, aligned to the shared helper, if an importer appears.

### Phase C decisions (D-12.C1–D-12.C6)

- **D-12.C1 (C1) raise the binding proof bound to 15 minutes and the job to 35; do not split.** The step at
  `.github/workflows/verify-vectors.yml:512-523` runs five Stryker profiles in sequence under one
  `with-runner-lock.sh node-toolchain` wait (up to `SANCTUARY_RUNNER_LOCK_TIMEOUT_SECONDS=120`, `:49`). Passing runs
  took 4.6, 5.1 and 7.1 min. The slowest recent green run took 448 of 480 s before any lock wait. Runs 21164, 21144,
  21125 and 21077 were killed at exactly 8:00 in the last profile. `timeout-minutes: 15` is about twice the slowest
  green run plus the 2-minute lock budget. It is also the bound the sibling fee step already uses for the same reason
  (`:597-598`, comment "Two contended PR-event runs reached 91-92% before this step's former eight-minute bound"). The
  job bound goes from 30 to 35 (`:493`) so that install (10) + proof (15) + setup + breadcrumb/summary/upload still fit.
  This matches the fee job (`:575`) and the job comment's own rule ("Above the step bounds … so a run that hits a step
  bound still writes and uploads its diagnostics"). **Rejected: splitting.**
  - A third mutation job costs a runner slot plus a duplicate checkout and `setup-server-dependencies.sh` on a fleet
    where splitting pays only when slots are idle (`tasks/ci-speedup-analysis-2026-10-05.md`, "No PR-time gain … the
    #884 lesson"). The proofs are CPU-quota bound (#1344), so two jobs do not halve the runtime.
  - Two steps in the same job take the runner lock twice and do not shorten the job. Per-profile attribution already
    exists through `time-command.sh`.
  - Every split variant edits the same provenance-pinned workflow, so it saves no regeneration work.
- **D-12.C2 (C2) only a parseable exit-0 sidecar counts as finished.** `run-with-log.sh` writes a sidecar when the
  wrapped command exits, and a best-effort `sink_status: "interrupted"` sidecar (`wrapped_exit: -1`) on SIGTERM/SIGINT
  (`scripts/ci/run-with-log.sh:26-35,147`). A `*.log` with no sidecar, or with a sidecar whose `wrapped_exit` cannot
  be read, is therefore a step that was hard-killed while running (its `timeout-minutes`, the job deadline or a runner
  loss). The breadcrumb reports such logs as an **interrupted step whose proof did not complete**. The
  "post-verification runner/infrastructure fault — not a proof regression" wording is kept only when no such log
  exists and at least one sidecar exited 0. An `interrupted` sidecar (`-1`) is already a failed sidecar
  (`has_failed_sidecar`, `:65`), so it keeps today's "breadcrumb not needed" path. The search is recursive
  (`find -name '*.log'`), as in `write-diagnostic-summary.sh:96` (`rglob`). The rule needs every other file a
  breadcrumb-calling job writes into `$DIAGNOSTIC_DIR` to avoid the `.log` suffix. Sweep at `51b0b69af0`
  (`grep -rnE '\$DIAGNOSTIC_DIR/[^" ]*\.log' .github/workflows`, excluding `run-with-log.sh` calls): only
  `quality.yml:270` in the `dependency-audit` job, which calls the breadcrumb (~`:296`), writes
  `npm-deprecation-install.log` via `redact_file` (never a sidecar); `test.yml:879`'s attempt logs are in
  `full-backend-integration-tests`, which does not call the breadcrumb. C2 renames the `quality.yml:270` output to
  `npm-deprecation-install.redacted.txt` and updates its pin at `tests/ci/check-workflow-composition.test.sh:4077`.
  Otherwise a post-verification fault in that job would be named "never finished … hard-killed". The workflow grep
  cannot see `.log` names that a script builds itself under a `$DIAGNOSTIC_DIR`-derived directory, so the sweep also
  covers those scripts: `scripts/ci/run-parallel-suites.sh` is the only hit. The `ci-classifier-tests` job calls the
  breadcrumb (`quality.yml:973-980`), and its "Run CI classifier tests" step runs
  `scripts/ci/run-parallel-suites.sh "$DIAGNOSTIC_DIR/ci-classifier-suites"` (`quality.yml:879`), which writes
  `$log_dir/$index.log` with **no** sidecar and records completion in a sibling `$index.status`
  (`run-parallel-suites.sh:26-27`). (`backend-coverage-shard.sh`, the emulator proofs, `frontend-coverage-shards.sh`
  and `time-command.sh` write no `.log` there.) A `<stem>.log` with a sibling `<stem>.status` therefore counts as
  finished. Renaming those logs instead would require editing `tests/ci/run-parallel-suites.test.sh:59,60,77`, which
  C does not own. **Rejected:** keeping the infra wording
  and appending the incomplete list. The sentence "not a proof regression" is the one that misdirected the retriggers
  of runs 21125/21144 (CLAUDE.md retrigger discipline).
- **D-12.C3 (C3) the critical mutation gate runs non-incrementally; the cache step is removed.**
  - Options weighed:
    - A test-input hash in the cache key would also have to be in the `restore-keys` prefix (`test.yml:1337-1338`
      restores the newest prefix match whatever the key). Even then it is blind to non-mutated `server/src`
      dependencies and `node_modules`, because Stryker's incremental diff covers only mutated files and the recorded
      test entries.
    - Forcing a full run only on the nightly `schedule` leaves every PR gate fail-open for up to 24 h.
    - Hashing tests, source and dependencies into the prefix makes every lane run on a PR cold anyway. The lane runs on
      a PR only when a critical source or critical test path changed (`test.yml:1293-1297`), and all of those are in
      that hash. That is option (c) with extra machinery.
  - Choice: set `incremental: false` and drop `incrementalFile` (`server/stryker.critical.config.mjs:150-151`), delete
    the "Restore Stryker incremental cache" step (`test.yml:1324-1339`) and remove `shardIncrementalFileName`
    (`server/scripts/mutation/shards.mjs:88-93`) and its check (`scripts/ci/check-critical-mutation-config.mjs:111-113`).
    This is the same policy the seven wallet-safety proofs already use (`incremental: false` in every
    `server/stryker.{fee-policy,psbt-account-binding,taproot-*,receive-evidence}.config.mjs`).
  - CI cost:
    - The lane is never on main pushes (`test.yml:10-15`). It runs on PRs that touch critical paths and on the
      nightly full scan.
    - Measured shard wall times (window with partly cold caches after #1377): shard 1 9.5 min, shard 2 1.2 min,
      shard 3 5.4 min (`tasks/ci-speedup-analysis-2026-10-05.md` §3.5). Each is far below the 60-minute job bound
      (`test.yml:1300`).
    - In those runs the lane finished (≤17.0 min) before the backend tail (Summary at 24.1 min), so cold runs do not
      lengthen required-check time.
  - `check-critical-mutation-config.mjs` gains a fail-closed assertion that the critical config is non-incremental, so
    re-enabling incremental mode fails the quick lane.
- **D-12.C4 (C3) the critical lane selects every test input of its test entries.**
  - The 24 test entries in `buildCriticalTestCommand` (`server/stryker.critical.config.mjs:61-85`) move to one
    exported constant, `CRITICAL_TEST_FILES`, in `server/scripts/mutation/shards.mjs`. The config and the checker both
    read it; the checker already imports `shards.mjs`.
  - `check-critical-mutation-config.mjs` gains `criticalTestInputs()`. It walks relative imports from those entries
    plus `server/tests/setup.ts` (the `setupFiles` entry, `server/vitest.config.ts:19`), using the same specifier regex
    as `tests/ci/renderHarnessInputsClassified.test.ts:26`, which follows only `./` and `../` specifiers. It therefore
    also matches `@fixtures/` specifiers and maps them to `server/tests/fixtures/` (the alias at
    `server/vitest.config.ts:76-79`) **before** the `server/tests/` filter: the critical entry
    `server/tests/unit/services/bitcoin/psbt.verified.test.ts` (`stryker.critical.config.mjs:64`) imports
    `'@fixtures/bip174-test-vectors'` (`:16`) and `'@fixtures/generated-psbt-vectors'` (`:23`), which a relative-only
    walker would miss while `is_critical_mutation_file` still rejects both. It follows only files under `server/tests/`
    and adds `server/vitest.config.ts`. Unlike that walker (which throws on any unresolved import, `:56`), it **drops** a
    specifier whose joined repo-relative path does not start with `server/tests/` before resolving it, and throws only
    when a `server/tests/` target cannot be resolved. Reason: five reached files import
    `…/src/generated/prisma/client` (`server/tests/mocks/prisma.ts`,
    `repositories/transactionSigningIntentRepository.test.ts`, `services/accessControl.test.ts`,
    `accessControl.resource-access.contracts.ts`,
    `transactionServiceBroadcast.broadcastAndSave.notifications.contracts.ts`). That client is untracked, and neither
    CI job that runs the checker generates it (`test.yml:396-415` quick-critical-mutation; `quality.yml:841`
    `ci-classifier-tests`), so a resolve-then-throw walker would be green locally and red in both lanes.
  - Both walkers resolve against `REPO_ROOT` (like `sourceRoot`, `check-critical-mutation-config.mjs:87`), never
    against the `root` argument of `checkCriticalMutationConfig(root)`: the five existing cases in
    `tests/ci/check-critical-mutation-config.test.mjs:21-90` pass a temp fixture root holding only
    `.github/mutation-baseline.json`. The critical config is a static top-level `import` of the checker, so
    `checkCriticalMutationConfig` stays synchronous and those cases' `assert.throws`/`assert.doesNotThrow` keep working.
  - It also gains `unclassifiedCriticalTestInputs()`: one `bash -c` call that sources
    `scripts/ci/classify-files-lib.sh` and prints the paths `is_critical_mutation_file` rejects (the
    `renderHarnessInputsClassified.test.ts:79-93` pattern). `checkCriticalMutationConfig()` fails when that list is
    non-empty.
  - The checker's signature becomes `checkCriticalMutationConfig(root = REPO_ROOT, config = criticalConfig,
    listUnclassified = unclassifiedCriticalTestInputs)` and it calls `assertNonIncrementalCriticalConfig(config)` and
    `listUnclassified()` itself (pass 15: the quick lane runs only the CLI, `test.yml:415`, and `ci-classifier-tests`
    is not selected by a `server/tests/*`-only or `stryker.critical.config.mjs`-only PR,
    `classify-quality-scope.sh:105-108`, so an unwired check would leave both guarantees silent). The defaults keep the
    CLI and the five existing temp-root cases unchanged.
  - At `51b0b69af0` the walk reaches 61 test-tree files. 40 of them, plus `server/tests/setup.ts` and
    `server/vitest.config.ts`, are unclassified: **42 paths**. Every psbtValidation/auth/accessControl contracts file,
    every `transactionServiceBroadcast/*` file except `broadcastContracts.test.ts`, the four `transactionsHttpRoutes`
    contracts not yet listed plus their harness, `transactionsSigningIntentBroadcast{,.replacement,.retry}.test.ts`,
    `transactionService.broadcast.test.ts`, `transactionSigningIntentRepository.test.ts`, the harnesses, and the shared
    `tests/{fixtures/bip174-test-vectors.ts,fixtures/bitcoin.ts,fixtures/generated-psbt-vectors.ts,fixtures/generated-signed-psbt-vectors.ts,fixtures/verified-address-vectors.ts,helpers/testUtils.ts,helpers/validatedBroadcastArtifact.ts,mocks/prisma.ts}`
    (the first and third reached only through the `@fixtures/` alias).
  - `is_critical_mutation_file` (`scripts/ci/classify-files-lib.sh:206-213`) gains these patterns. Nothing is removed
    or narrowed (fail-closed):
    - `server/tests/unit/services/bitcoin/psbtValidation/*`
    - `server/tests/unit/middleware/auth/*`
    - `server/tests/unit/api/transactionsHttpRoutes/*`
    - `server/tests/unit/services/bitcoin/transactionServiceBroadcast/*`
    - `server/tests/unit/api/transactionsSigningIntentBroadcast*.test.ts`
    - `server/tests/unit/services/bitcoin/transactionService.broadcast.test.ts`
    - `server/tests/unit/repositories/transactionSigningIntentRepository.test.ts`
    - `server/tests/unit/services/accessControl.resource-access.contracts.ts`
    - the eight shared fixture, helper and mock files above (incl. `server/tests/fixtures/bip174-test-vectors.ts` and
      `server/tests/fixtures/generated-psbt-vectors.ts`)
    - `server/tests/setup.ts` and `server/vitest.config.ts`
  - Because the quick lane (`test.yml:396-415`) runs `check-critical-mutation-config.mjs` on every PR that changes a
    critical entry, a new import added to a critical test is caught on that PR. This is stronger than D-11.17's
    scheduled-only residual.
  - **Residual (documented, not fixed):**
    - The Vitest runner's `related` mode (`@stryker-mutator/vitest-runner` default `related: true`) can also kill
      mutants with tests outside the declared entry list.
    - A non-mutated `server/src` dependency change does not select the lane on a PR.
    - With D-12.C3, the nightly full scan re-proves both cold every night.
  - Cost: the lane now also runs on PRs that edit `tests/mocks/prisma.ts`, `tests/helpers/testUtils.ts` or
    `tests/setup.ts` (rare, deliberate edits), and on every PR that rehashes the verifier provenance in
    `server/tests/fixtures/verified-address-vectors.ts`. That file changes on every verifier-source edit (14 commits since
    2026-08-21, against 6 for `tests/mocks/prisma.ts`), and each such PR now runs all three critical shards cold
    (about 16 slot-minutes). C1 itself rehashes it in this PR. `server/vitest.config.ts` adds nothing: it already
    selects the full scan (`classify-files-lib.sh:528`). Accepted explicitly: a verifier-provenance PR is already a
    wallet-safety change, and the fixture is imported by critical entries, so re-proving their kills is the point.
- **D-12.C5 (C4) a uniform rule for negated statements in shell tests.**
  - New `scripts/ci/check-negated-test-assertions.mjs` scans `git ls-files '*.test.sh'`. It joins backslash
    continuations into logical lines and rejects every logical line that starts with `!` (`/^\s*!\s/`) and contains no
    `||`.
  - The accepted failing forms are `if cmd; then echo 'FAIL: …' >&2; return 1; fi` (`exit 1` in a subshell, `bash -c`
    body or heredoc script) and `! cmd || fail …`.
  - **Rejected:** a "non-final statement" analysis. It needs a bash parser (multi-line quoted `awk`/`bash -c` bodies,
    heredocs, `done`/`fi`/`else` successors). It would also allow function-final `!`, which becomes inert as soon as
    another line is appended below it.
  - The rule therefore also rewrites the 11 function-final, subshell-final or script-final `!` lines that work today.
    That is a semantics-preserving change.
  - Scope is `*.test.sh` only. Sourced helpers such as `tests/install/utils/upgrade-assertions.sh:285-286` use `!` as
    an `if … ||` continuation, which the line rule would misreport.
  - Residual: a mid-line negation (`a && ! b`) is not detected.
  - The guard runs as a step in the always-on `large-file-classification` job of `quality.yml`. That job runs whenever
    a non-docs file changes (`scripts/ci/classify-quality-scope.sh:87-94,218-219`), which covers any `*.test.sh` edit.
    The guard's own regression test runs in `ci-classifier-tests`.
- **D-12.C6 (C5) bind the receipt to the deployed images' revision label; v3 receipt from v0.8.78.**
  - No Dockerfile change is needed. Every image the probe attests already carries the label:
    - `server/Dockerfile:93-107` (backend and worker)
    - `docker/frontend/Dockerfile:52-66`
    - `gateway/Dockerfile:69-83`
    - `llm-egress-proxy/Dockerfile:29-43`
  - Each Dockerfile rejects an empty or `unknown` `SANCTUARY_SOURCE_COMMIT`. `docker-compose.yml:206,621,658,729,857`
    pass the commit with `${SANCTUARY_SOURCE_COMMIT:?}`. Local rebuilds take it from `git rev-parse HEAD`
    (`scripts/ownership/producer-hooks.sh:268-279`). The offline bundle already enforces the same equality
    (`scripts/offline/create-bundle.sh:234-256`).
  - The probe reads each container's image revision before seeding and again at attestation, and refuses to run (exit
    2) or to write a receipt unless every revision equals `CANARY_COMMIT` and the image IDs did not change in between
    (pure `deployedImageDriftProblems(deployed, attested)` in `lib/canary-runtime.mjs`; at attestation both checks
    gate the exit through one pure exported `attestationProblems(deployed, attested, commit)` that returns the
    revision problems plus the drift problems; the receipt's images come from the attestation-time read). Both reads go through `attestDeployedImages()`, a member of the `createCanaryRuntime`
    object (it needs its `docker`/`inspectContainer`/`project` closures), which reads the trimmed label of each
    container's `c.Image`; each refusal exits 2 before the next step.
  - The receipt becomes `sanctuary.release-candidate-canary.v3`: v2 plus
    `releaseCandidate.images: [{ service, imageId, revision }]`.
  - The verifier requires v3 for tags `≥ v0.8.78` (compared in numeric tuple order: the first differing integer
    component decides, never a string compare; so `v0.9.0`, `v0.10.0`, `v0.8.100` and `v1.0.0` are included)
    and rejects any revision ≠ the expected `--commit`. `promote-release.sh`
    (`:130-134`) and `publish-release.sh` (`:107-109`) already pass the expected commit, so they inherit the binding
    without edits.
  - The version gate is needed because `v0.8.77` is already a stable tag (`git tag`: `v0.8.77`, `v0.8.77-rc1`) and its
    v2 receipt must keep verifying. Pushed tags are immutable and nothing is bumped
    (`docs/reference/release-distribution.md`).
  - Trust boundary is unchanged: the probe is operator-run and self-reports. The fix stops a stale, main-HEAD or
    previous-RC stack from producing an accepted receipt for the RC. It does not defend against a forged receipt.
  - A dirty working tree still builds with HEAD's label. That is a residual, and the runbook already requires
    rebuilding from the RC checkout.

## Assumptions and constraints

- **No migrations, no data repair.** Integration coverage is only added to specs already registered in
  `scripts/ci/backend-integration-groups.sh` (`syncMutationNetworkTransactions.test.ts` `:74`,
  `webhookEndpointEnqueueOrdering.integration.test.ts` `:86`), so that file needs no edit. B3 needs no column (D-12.B3a).
- **Coverage.** Frontend 100% and backend `tests/unit` 100% (backend run scoped to `tests/unit`, as CI).
  `**/index.ts` and `**/types.ts` are excluded from backend coverage (`server/vitest.config.ts:38-41`): A2's
  `electrum/types.ts` schema change is therefore guarded only by the txid-case suite, not by the coverage gate. All new
  branches live in covered files (`sync/confirmations/authenticatedDetails.ts`, the exported populators,
  `assistant/tools/utils.ts`, `webhookRepository.ts`, `endpointService.ts`, `restoreWarningsHandoff.ts`,
  `useRestoreWarningsHandoff.ts`, `useWalletDetailController.ts`).
- **Large files** (`scripts/quality/check-large-files.mjs`, `> 1000` lines fails, JS/TS only):
  `server/tests/unit/services/bitcoin/sync/confirmationUpdater.test.ts` (exactly 1,000) is not touched; largest touched
  test files stay well below the limit (`webhookRepository.test.ts` ≈ 830, `broadcastReconciliation.test.ts` ≈ 400,
  `syncMutationNetworkTransactions.test.ts` ≈ 380). Shell suites (`grafana-quiescence.test.sh` 1,437,
  `check-workflow-composition.test.sh` 4,642) are not scanned by the gate.
- **Mutation pins (D-12.1).** No file named in `config/wallet-safety-mutation-map.json` and no `server/stryker.*.config.mjs`
  `mutate` range is edited (grep for every A-touched path in the map and the Stryker configs: no hits); A1 changes only
  the import line of `advancedTx/shared.ts` and `transactions/helpers.ts`, neither of which is pinned. The fee-policy
  profile is therefore **not** re-run locally; the Verification block proves pin neutrality with a `git diff` gate, and
  the PR's verify-vectors run executes the fee-policy proof anyway. `server/stryker.critical.config.mjs` is changed by
  C3 only (D-12.C3).
- **Critical mutation lane.** A1 edits `server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts` (shard 3,
  `server/scripts/mutation/shards.mjs:37`), and C3 edits the critical config and classifier, so Full Critical Mutation
  runs on the PR, cold (no cache step after C3). Its weighted gate in CI is binding; the integrator runs shard 3 locally
  (D-12.X4.1). The default critical runner is Stryker's Vitest runner over `server/vitest.config.ts`
  (`stryker.critical.config.mjs:22-24,92-104`), so `broadcastReconciliation.test.ts` kills shard-3 mutants even though
  it is not in the 24-entry command-fallback list.
- **verify-vectors and provenance.** A1/A2 touch `server/src/services/bitcoin/**` (`config/wallet-safety-critical-paths.json`)
  and C1 edits `.github/workflows/verify-vectors.yml`, which is in `VERIFIER_SOURCE_FILES`
  (`scripts/verify-addresses/sourceManifest.ts:4`). C1 therefore rehashes `sourceSha256` in both vector outputs in the
  same commit (Phase C1); no other phase touches a `sourceManifest` file. The workflow edit runs the full verify-vectors
  workflow on the PR, including emulator lanes; if one flakes, record the CLAUDE.md four-part retrigger evidence before
  any second attempt.
- **Hardware-proof sources.** `config/hardware-emulator-source-inventory.json` lists `.github/workflows/verify-vectors.yml`
  and `.github/workflows/quality.yml`, both edited by Phase C (C1; C2 and C4). The inventory pins no digest, so no
  inventory edit or gate change is needed; the edits select the emulator lanes, which the plan already expects (the
  verify-vectors bullet above). It lists no other A/B/C source file.
- **Sync-path inventories.** No repository call is added to a sync-path file (`config/wallet-sync-mutation-boundaries.json`
  unchanged), no `utxoRepository` writer is added (replay driver and `driverSha256` untouched), and the
  `remoteAwaitInventory.test.ts:20-21` fragments are preserved (D-12.2).
- **Signer inventory.** No new identifier with prefix `sign`, `finalize` or `broadcast` in `src/`
  (`npm run verify:signer-inventory`).
- **Architecture.** New edges: `sync/confirmations/authenticatedDetails → nodeTransactionAuthentication`,
  `→ sync/transactionOutputEvidence`; `signingIntent/broadcastReconciliation → nodeTransactionAuthentication`; re-pointed
  edges from `advancedTx/shared` and `transactions/helpers` (D-12.1); `src/app/AppRoutes/AuthenticatedAppShell.tsx →
  src/components/BackupRestore/hooks/useRestoreWarningsHandoff.ts` (B2); `scripts/ci/check-critical-mutation-config.mjs →
  server/stryker.critical.config.mjs` and `scripts/release/canary/lib/canary-runtime.mjs →
  scripts/release/verify-release-candidate-canary.mjs` (C). None closes a cycle (`check:server-cycle-baseline`). The
  integrator runs `npm run arch:graphs` and `npm run arch:calls` and commits `docs/architecture/generated` in the
  integrator commit before the Verification block, so `arch:check` is a pure check (the Architecture lane is not
  PR-required).
- **CI classifier changes stay fail-closed.** C3 only adds `is_critical_mutation_file` patterns; C4 adds a guard step;
  no predicate is removed or narrowed; `classify-files-lib.sh` still sources under POSIX `sh`; the F1 drift guard
  `tests/ci/vitestRepoInputsClassified.test.ts` and the render-input guard stay green over the final tree.
- **Lifecycle registry.** No new `rm -rf`, `kill` or container-mutating docker call; C5 adds a read-only
  `docker image inspect` (outside the registry patterns). New test files reuse registered fixture patterns.
- **Release surface.** No tag, version or Dockerfile change; v0.8.77 and older canary receipts keep verifying (D-12.C6).
- **Commits** are foreground, through the flock, never during a coverage/Stryker run (the pre-commit hook runs AI review
  agents and tests).

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Owns |
|---|---|
| A (A1 + A2; one worktree, A2 commit then A1 commit, both extend the integration file) | `server/src/services/bitcoin/nodeTransactionAuthentication.ts` (moved in), `server/src/services/bitcoin/advancedTx/nodeTransactionAuthentication.ts` (removed), `server/src/services/bitcoin/advancedTx/shared.ts` (import path only), `server/src/services/bitcoin/transactions/helpers.ts` (import path only), `server/src/services/bitcoin/sync/confirmations/{authenticatedDetails.ts (new),fetchHelpers.ts,populateFields.ts,processUpdates.ts,feePopulation.ts,counterpartyPopulation.ts,fieldPopulators.ts}`, `server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts`, `server/src/services/bitcoin/electrum/types.ts`; tests `server/tests/unit/services/bitcoin/nodeTransactionAuthentication.test.ts` (moved in), `server/tests/unit/services/bitcoin/advancedTx/nodeTransactionAuthentication.test.ts` (removed), `server/tests/unit/services/bitcoin/sync/confirmations.test.ts`, `server/tests/unit/services/bitcoin/sync/confirmations/{confirmationsNodeFixtures.ts (new),confirmations.populate-authentication.contracts.ts (new),authenticatedDetails.test.ts (new),populators.defensive.test.ts (new),confirmations.populate-main-flow.contracts.ts,confirmations.populate-address-id.contracts.ts,confirmations.populate-error-handling.contracts.ts,confirmations.populate-mixed-fallbacks.contracts.ts,confirmations.populate-fee-partial-inputs.contracts.ts,confirmations.populate-counterparty-fallbacks.contracts.ts,confirmations.populate-network-history.contracts.ts}`, `server/tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts`, `server/tests/unit/services/bitcoin/electrum.methods.txidCase.test.ts` (new), `server/tests/unit/services/bitcoin/sync/phases/fetchUtxos.contracts.ts`, `server/tests/unit/services/bitcoin/blockchain/{syncWallet-core.contracts.ts,transactions-reconciliation.contracts.ts}`, `server/tests/unit/services/blockchainService/{utxo-management.contracts.ts,broadcasting-validation-reorg.contracts.ts}` (A2: non-hex listunspent txid fixtures, plus any non-hex txid fixture the A2 sweep finds), `server/tests/integration/repositories/syncMutationNetworkTransactions.test.ts` |
| B1 | `src/components/WalletDetail/useWalletDetailController.ts`; `tests/components/WalletDetail/{useWalletDetailController.network.test.tsx,useWalletDetailController.utxoStats.test.tsx}`, `tests/components/WalletDetail.test.tsx`, `tests/components/WalletDetailWrapper/WalletDetailWrapperTestHarness.tsx`, `tests/components/TransactionList/useTransactionLabelMutations.test.tsx` |
| B2 | `src/components/BackupRestore/hooks/{useBackupHandlers.ts,restoreWarningsHandoff.ts (new),useRestoreWarningsHandoff.ts (new)}`, `src/app/AppRoutes/AuthenticatedAppShell.tsx`; `tests/components/BackupRestore/{useBackupHandlers.restoreWarnings.test.tsx (new),useRestoreWarningsHandoff.test.tsx (new),restoreWarningsHandoff.test.ts (new),useBackupHandlers.branches.test.tsx}`, `tests/components/BackupRestore.test.tsx`, `tests/App.branches.test.tsx` |
| B3 | `server/src/repositories/webhookRepository.ts`, `server/src/services/webhooks/endpointService.ts`, `server/src/api/openapi/paths/walletWebhooks.ts`; `server/tests/unit/repositories/webhookRepository.test.ts`, `server/tests/unit/services/webhooks/endpointService.test.ts`, `server/tests/unit/api/openapi.wallet.contracts.ts`, `server/tests/integration/repositories/webhookEndpointEnqueueOrdering.integration.test.ts` |
| B4 | `server/src/assistant/tools/utils.ts`, `server/src/mcp/types.ts` (delete `enforceDateRange` only); `server/tests/unit/assistant/readToolUtils.test.ts` |
| C (C1–C5; one worktree, one commit per finding, C3 in two) | **C1:** `.github/workflows/verify-vectors.yml`, `scripts/verify-addresses/output/verified-vectors.ts`, `server/tests/fixtures/verified-address-vectors.ts`. **C2:** `scripts/ci/write-empty-diagnostic-breadcrumb.sh`, `tests/ci/write-empty-diagnostic-breadcrumb.test.sh`, `.github/workflows/quality.yml` (`:270` output name only). **C3:** `server/stryker.critical.config.mjs`, `server/scripts/mutation/shards.mjs`, `scripts/ci/check-critical-mutation-config.mjs`, `tests/ci/check-critical-mutation-config.test.mjs`, `.github/workflows/test.yml`, `scripts/ci/classify-files-lib.sh`, `tests/ci/classify-test-changes.test.sh`, `tests/ci/plan-test-run.test.sh`, `docs/reference/ci-cd-strategy.md` (one sentence). **C1 + C2 + C3 (same worktree, sequential commits):** `tests/ci/check-workflow-composition.test.sh` (C2: the `:4077` pin only). **C4:** `tests/install/unit/{grafana-quiescence,grafana-password-migration,optional-stack-lifecycle,upgrade-helpers}.test.sh`, `tests/ci/{pre-commit-agent-gate,relay-job-diagnosability,isolated-subject-drivers}.test.sh`, `scripts/ci/check-negated-test-assertions.mjs` (new), `tests/ci/check-negated-test-assertions.test.mjs` (new), `.github/workflows/quality.yml` (one step + one `node --test` line; shared with C2, earlier commit). **C5:** `scripts/release/canary/canary-probe.mjs`, `scripts/release/canary/lib/canary-runtime.mjs`, `scripts/release/verify-release-candidate-canary.mjs`, `tests/release/release-candidate-canary.test.mjs`, `tests/release/canary-probe-tooling.test.mjs`, `docs/how-to/release-candidate-canary.md` |
| Integrator (applied once) | `docs/reference/changelog.md` `## [Unreleased]` (bullets handed over by every phase, plus the two D-12.6 notes), `docs/architecture/generated/*` (regenerated after all phases), this plan file |

**Overlap resolution.** The three drafts claim no common file. Checked explicitly: `server/tests/mocks/prisma.ts`,
`server/tests/setup.ts` and `server/vitest.config.ts` (named by C3's classifier patterns; edited by nobody);
`config/wallet-safety-mutation-map.json` and every `server/stryker.*.config.mjs` other than the critical one (edited by
nobody; critical config C3 only); broadcast/signing-intent tests (`broadcastReconciliation.test.ts` A only; the
critical entries and `transactionServiceBroadcast/*` edited by nobody); `scripts/ci/classify-files-lib.sh`,
`.github/workflows/{test,quality,verify-vectors}.yml` and `tests/ci/check-workflow-composition.test.sh` (C only, where
C1, C2 and C3 share the composition suite, and C2 and C4 share `quality.yml`, inside one worktree as sequential
commits, so neither is a cross-phase file);
`tests/install/unit/upgrade-helpers.test.sh` (C4 only); `docs/reference/changelog.md` and `docs/architecture/generated`
(integrator only). Ordering-only couplings are in D-12.X4. B1 and B2 are both frontend but disjoint
(`WalletDetail`/`TransactionList` vs `BackupRestore`/`app`/`App.branches`); B3 and B4 are server-side and disjoint from
A (no `services/bitcoin` file).

---

## Phase A — sync-path data integrity (A1, A2)

All evidence re-read on `51b0b69af0` in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i12`. Paths are relative to
`server/` unless they start with `server/`, `config/`, `scripts/` or `docs/`. Decisions: D-12.1–D-12.6; open questions
OQ-A1/OQ-A2 are decided (see Open questions).

### Phase A1 — Authenticate the bytes behind missing-field population (P1 `confirmation-populate--fields-from-unauthenticated-tx-bytes`; folded P3 `broadcast-reconciliation--lookup-accepts-unauthenticated-tx`)

**Evidence (re-verified at 51b0b69af0).**
- `sync/confirmations/fetchHelpers.ts:109-112` and `:232-235` call `client.getTransaction(txid, true[, options])`
  and cache the result under the requested txid (`:123`, `:255`) with no txid binding.
  `electrum/methods.ts:272-279` returns `decodeRawTransaction(rawTx)`, whose `txid` is the decoded `getId()`, never
  compared with the request. The i11 module documents exactly this gap
  (`advancedTx/nodeTransactionAuthentication.ts:4-9`).
- Fee path:
  - `feePopulation.ts:63` reads prevout values from `prevTxCache` (unauthenticated parents);
  - `:26-38` trusts a client `fee` field, and `:55-57` trusts `prevout.value`;
  - the result passes only `isValidFeeSats` (`:22-24`, any value below 1 BTC);
  - `:122-134` `applyFeeUpdate` sets `updates.amount = BigInt(-feeSats)` for a zero-amount consolidation (`:131`);
  - `populateFields.ts:216-218` then sets `hasAmountUpdates`, and `:239-249` runs `recalculateWalletBalances` inside
    the `balance_recalculation` mutation unit.
- Counterparty and addressId:
  - `counterpartyPopulation.ts:22-33` takes a received row's sender from `prevout` or from unauthenticated parent
    bytes, and `:48-60` takes a sent row's recipient from the unauthenticated current-transaction `vout`;
  - `fieldPopulators.ts:96-106,118-156` takes addressId from the same `vout`/`prevout`.
  - Every field is filled only while null (`feePopulation.ts:14-20`, `counterpartyPopulation.ts:93`,
    `fieldPopulators.ts:79`), so an honest pass never corrects it.
- Reachability: `worker/jobs/canonicalIncrementalSync.ts:295` (every canonical incremental sync) and
  `services/sync/confirmationUpdater.ts:259` (block-driven sweep). Row selection is
  `repositories/transactions/sync.ts:877-914`; every received row starts with `counterpartyAddress` null.
- Folded P3: `signingIntent/broadcastReconciliation.ts:100` and `:152` discard the lookup result.
  `blockchain/networkOperations.ts:214-221` is a bare `client.getTransaction(txid, true)`. Any successful answer
  moves the intent to accepted (`:101-105`, `:161-166`).
- Tests miss it: every populate contract (`tests/unit/services/bitcoin/sync/confirmations/confirmations.populate-*.contracts.ts`)
  serves hand-built objects without `hex` under synthetic txids (`'tx-sent'`, `'prev-fee'`, …). None serves bytes
  for a different txid. `broadcastReconciliation.test.ts:120,158,235,299,332,351` resolve the lookup with
  `{ txid: 'b'.repeat(64) }` and no bytes.

**Fix design.**
- D-12.1: move the module.
- D-12.2: add `sync/confirmations/authenticatedDetails.ts` with top-level `function` declarations
  `authenticatedPopulationDetails`, `chainPosition`, `projectInput` and `projectOutput`, each CCN ≤ 4. The coinbase
  check is a local two-line predicate mirroring `transactionEvidenceProjection.ts:138-139`, which is not exported and
  is not edited, because that file is the main receive-evidence projector. Wire it into both fetch helpers and pass
  `castNetwork` from `populateFields.ts`.
- D-12.3: remove the verbose-field reads and type the caches (with D-12.2's two signature changes:
  `populateBlockHeight(…, txDetails: RawTransaction | undefined, …)` and `processUpdates.ts:151`
  `txDetails: RawTransaction`; `cd server && npx tsc --noEmit` must stay clean).
- D-12.4: the two reconciliation lines.

Imports are `authenticatedDetails.ts → ../../nodeTransactionAuthentication`, `→ ../transactionOutputEvidence` and
`import type → ../types` / `@sanctuary/shared/constants/bitcoin`. No repository call is added, so
`config/wallet-sync-mutation-boundaries.json` is unchanged; its `populateFields.ts` /
`populateMissingTransactionFields` entries keep their counts. No new identifier starts with `sign`, `finalize` or
`broadcast`.

**Failing-first tests.**
- New harness file `tests/unit/services/bitcoin/sync/confirmations/confirmationsNodeFixtures.ts`, all top-level
  `function` declarations:
  - `walletOutput(n)`: mainnet P2WPKH `{ address, script }` from `const payment = bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, n), network: bitcoin.networks.bitcoin })`,
    returning `script: payment.output!` (a `Uint8Array` in the pinned bitcoinjs-lib, `payments/index.d.ts:29`);
  - `buildTransaction({ inputs: Array<{ txid: string; vout: number } | 'coinbase'>, outputs: Array<{ script: Uint8Array; valueSats: bigint }>, locktime? })`
    — **every fixture transaction has at least one input** (`'coinbase'` or a dummy outpoint such as
    `{ txid: '11'.repeat(32), vout: 0 }`), and `buildTransaction` throws on an empty `inputs` array (pass 6: a
    zero-input transaction serializes to `0100000000 01 …`, which `Transaction.fromHex` reads as a segwit marker and
    throws "Offset is outside the bounds of Uint8Array"; `decodeRawTransaction` turns it into
    `Failed to decode transaction` at `electrum/methods.ts:169-171`, so `nodeDetails(tx)` would throw in the fixture
    itself). Old `vin: []` fixtures are ported with a dummy input;
    (`script: Uint8Array`, matching `Transaction.addOutput`, `transaction.d.ts:35`; a `Buffer` field fails
    `npm run typecheck:tests`, CI's Full Backend Typecheck). A `'coinbase'` input is added with a fixed **non-empty**
    scriptSig, a BIP34 height push (`03` + 3 bytes, exported as `COINBASE_SCRIPT_SIG_HEX`). With the default empty
    scriptSig (`addInput(Buffer.alloc(32), 0xffffffff)` round-trips script `""`) D-12.2 projects `{ coinbase: '' }`,
    which is falsy, so the `if (input.coinbase)` arms at `feePopulation.ts:76` and `counterpartyPopulation.ts:40`
    would no longer be reached and backend `tests/unit` coverage would drop below 100% with no visible failure;
  - `nodeDetails(tx, metadata?)` = `{ ...decodeRawTransaction(tx.toHex(), 'mainnet'), ...metadata }`, the exact shape
    the production client returns;
  - `serveNodeTransactions(entries: Array<[requestedTxid, details | Error]>)`: a `vi.fn` that resolves by requested
    txid, rejects on `Error` and returns `null` otherwise.
- New contracts file `confirmations/confirmations.populate-authentication.contracts.ts`, registered in
  `tests/unit/services/bitcoin/sync/confirmations.test.ts` inside `describe('populateMissingTransactionFields')`.
  Wallet network `'mainnet'`; rows use real `getId()` txids. Each case builds the honest chain first and changes one
  served value:
  1. **Forged parent → fee.** Sent row S spends parent P:0 (100_000 sats); its outputs total 99_000 (honest fee 1_000).
     Served: P's txid answers with P′, a different transaction whose output 0 is 150_000. Expect no `fee` in S's patch.
     **Red on base:** `fee === 51_000n`.
  2. **Forged parent → consolidation amount and balances.** Consolidation row C, `amount: 0n`, same forged parent.
     Expect no patch for C and `mockRecalculateWalletBalances` not called. **Red on base:** `fee`, `amount === -fee`,
     and the recalculation called.
  3. **Forged current transaction → sent counterparty.** Sent row whose txid answers with a transaction paying
     attacker output `walletOutput(9)`. Expect no `counterpartyAddress`. **Red on base:** the attacker address.
  4. **Forged parent → received counterparty.** Received row R spends P2:0 (sender `walletOutput(7)`). P2's txid
     answers with P2′ paying `walletOutput(9)`. Expect no `counterpartyAddress`. **Red on base:** `walletOutput(9).address`.
  5. **Forged current transaction → received addressId.** The genuine R pays wallet address A1 (`addr-1`). The forgery
     pays wallet address A2 (`addr-2`). Expect no `addressId`. **Red on base:** `'addr-2'`.
  6. **Verbose fields ignored (D-12.3), authentic bytes.**
     - (a) Sent S3's details carry `fee: 0.5`. Expect `fee === 1_000n`, computed from the authenticated parent.
       **Red on base:** `50_000_000n`.
     - (b) Received R3's `vin[0]` carries `prevout.scriptPubKey.address = walletOutput(9).address`. Expect the
       authenticated parent's sender. **Red on base:** the attacker address.
     - (c) Sent S4 with `addressId: null` and a `vin[0].prevout` naming wallet address A1. Expect no `addressId`.
       **Red on base:** `'addr-1'`.
     - (d) **Client `vout` ignored (rejected alternative D-12.2(a)).** Sent row S5 with authentic bytes paying
       `walletOutput(2)`, served as `{ ...nodeDetails(s5), vout: <the decoded vout of a transaction paying walletOutput(9)> }`.
       Expect `counterpartyAddress === walletOutput(2).address`. **Red on base:** `walletOutput(9).address`. An
       `authenticatedPopulationDetails` that authenticates `details.hex` but returns the client's decoded `vin`/`vout`
       passes cases 1, 2 and 6(b) and fails this case (pass 8: cases 1–5 forge the bytes, which (a) also rejects).
     - (e) **Client address on an address-less output ignored.** Sent row S6 whose authentic bytes pay an OP_RETURN
       output (index 0) plus wallet change, served as `nodeDetails(s6)` with `vout[0].scriptPubKey.address =
       walletOutput(9).address`. Expect no `counterpartyAddress` in S6's patch. **Red on base:**
       `walletOutput(9).address`. A merge projection (`{ ...details.vout[n], value, n, scriptHex, …(address) }`)
       passes 1–5, 6(a–d) and 7 and fails this case (`transactionOutputAddress` falls back to the surviving client
       field, `counterpartyPopulation.ts:48-58` persists it).
     - (f) **Client `vin` ignored (fee forgery on the funds path; mandatory).** Sent row S7 with authentic bytes
       spending P:0 (100_000 sats) and paying 99_000; P and a genuine larger parent PL (output 0 = 150_000 sats) are
       both served authentically. S7 is served as `{ ...nodeDetails(s7), vin: [{ txid: PL.getId(), vout: 0 }] }`.
       Expect `fee === 1_000n`. **Red on base:** `51_000n`. An implementation that authenticates `vout` but keeps
       the client's `vin` passes 1–5, 6(a–e) and 7 and fails this case.
     - (g) **Parent client value ignored (fee forgery through the parent; mandatory).** Sent row S8 with authentic
       bytes spending P:0 (100_000 sats) and paying 99_000. P is served as `nodeDetails(p)` with `vout[0].value` set
       to `0.0015` (bytes unchanged). Expect `fee === 1_000n`. **Red on base:** `51_000n` (on a consolidation this
       also forges `amount` and the balance recalculation).
     - (h) **Parent client address ignored.** Received row R4 spends P:0, whose bytes pay `walletOutput(1)`. P is
       served as `nodeDetails(p)` with `vout[0].scriptPubKey.address = walletOutput(9).address`. Expect
       `counterpartyAddress === walletOutput(1).address`, the address in P's bytes. **Red on base:** the attacker
       address. Pass 10: rejected alternative D-12.2(a) applied only to the parent fetch (authenticate the parent in
       `fetchPreviousTransactionBatch`, `fetchHelpers.ts:228-243`, but cache the client's details) passes 1, 2, 4,
       6(a–f), 7, the strict unit test and coverage, and fails 6(g) and 6(h).
     - (i) **Client vin index ignored** (pass 11 field sweep: `vin[].vout` had no case). Sent row S9 spends P:0 and pays
       99_000; P is authentic with output 0 = 100_000 and output 1 = 150_000. S9 is served as
       `{ ...nodeDetails(s9), vin: [{ txid: P.getId(), vout: 1 }] }`. Expect `fee === 1_000n`. **Red on base:**
       `51_000n`. A helper taking each input's txid from the bytes but `vout: details.vin[k].vout` passes 6(f)–6(h)
       and the honest flow, and fails only 6(i).
  7. **Honest guard** (passes on base and after). Authentic S, C (amount 0), R and parents produce the same patches as
     today: S `fee 1_000n` plus `counterpartyAddress`; C `fee` and `amount: -fee`, plus the balance recalculation; R
     `counterpartyAddress` (sender) and `addressId: 'addr-1'`.
  - A request txid in uppercase is not tested here: DB txids are lowercase (A2).
- `tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts`, new `describe('node lookup authentication')`.
  `TX_HEX` / `OTHER_TX_HEX` are built with `buildTransaction` from `../sync/confirmations/confirmationsNodeFixtures`
  (≥1 input; `OTHER` differs only in an output value), never as zero-input transactions (pass 7: a zero-input
  transaction makes `authenticateNodeTransaction` throw `malformed_raw_transaction`, not `txid_mismatch`, so case 8
  would only re-prove case 10 and a parse-only lookup would pass):
  8. **Uncertain intent, forged lookup.** `mocks.lookup` resolves the self-consistent forgery
     `{ txid: OTHER_TXID, hex: OTHER_TX_HEX }` (pass 8: the production client never returns a `txid` that differs
     from its bytes, because `electrum/methods.ts:272-279` returns `decodeRawTransaction(hex)`, whose `txid` is the
     bytes' own `getId()`. A `{ txid: TXID, hex: OTHER_TX_HEX }` fixture would let an implementation that binds to the
     returned field, `authenticateNodeTransaction(details.txid, details)`, pass while accepting a real forgery). Expect
     `mocks.broadcast` called with `expectedTxid: TXID`, and acceptance only after it, pinned as
     `expect(mocks.accepted).toHaveBeenCalledTimes(1)` and
     `mocks.accepted.mock.invocationCallOrder[0] > mocks.broadcast.mock.invocationCallOrder[0]` (pass 9: an
     implementation that authenticates after `markBroadcastAccepted` accepts first, then re-broadcasts and accepts
     again, passing 8–10 without these two assertions). The case also asserts
     `parseAuthenticatedRawTransaction({ expectedTxid: OTHER_TXID, rawHex: OTHER_TX_HEX })` succeeds, imported from
     the unmoved `src/services/bitcoin/rawTransactionEvidence` (not from the D-12.1 moved module, which does not exist
     before the `git mv`, so importing it would fail the whole suite at collection with "Cannot find module" instead of
     for the stated reasons). So the forged bytes are well-formed and only the binding to `record.broadcastTxid`
     rejects them. **Red on base:** `mocks.broadcast` not called; accepted from the lookup. A field-binding
     implementation also fails this case, and so does an authenticate-after-accept ordering (two acceptances, the
     first before the broadcast).
  9. **Stalled intent, forged lookup.** `mocks.lookup` resolves the same self-consistent
     `{ txid: OTHER_TXID, hex: OTHER_TX_HEX }`. Expect `mocks.stalledAccepted` and `mocks.persist` not called.
     **Red on base:** both called. A field-binding implementation also fails this case.
  10. **Lookup without bytes** (`{ txid: TXID }`) is treated as a miss on both paths. **Red on base:** accepted.
- Supporting units (they fail on base only because the module does not exist, so they are not behavioral reds):
  - `tests/unit/services/bitcoin/sync/confirmations/authenticatedDetails.test.ts` (100% branches):
    - coinbase vs normal input; the coinbase case asserts `vin[0].coinbase === COINBASE_SCRIPT_SIG_HEX` (non-empty);
    - an OP_RETURN output, which has no `address` key;
    - numeric vs non-numeric or absent `time`/`blockheight`/`confirmations`;
    - `fee`/`prevout` never copied;
    - client `vin`/`vout` differing from the bytes are ignored; the projection comes only from the bytes. This case
      asserts `toStrictEqual` on the whole returned object (exactly `txid`, `vin`, `vout` and the numeric metadata;
      exact `vin`/`vout` arrays; no `scriptPubKey`, `prevout`, `fee` or `hex` key anywhere) with client details
      carrying a `vin` that differs from the bytes in BOTH `txid` and `vout` (bytes `vout: 0`, client `vout: 1`), a
      `vout` with an extra trailing element, and a
      `scriptPubKey.address` on the OP_RETURN index (pass 9: per-field assertions let a merge projection or the
      client's `vin` through);
    - `null` details → `malformed_raw_transaction`;
    - mismatching bytes → `txid_mismatch`.
  - `tests/unit/services/bitcoin/sync/confirmations/populators.defensive.test.ts`: direct calls to the exported
    `populateFee`, `populateCounterpartyAddress`, `populateAddressId`, `populateBlockHeight` and `populateBlockTime`.
    It takes over the defensive cases the flow can no longer reach: throwing getters (formerly
    `confirmations.populate-error-handling.contracts.ts:55-80`), inputs without `vout`/`txid` (formerly
    `confirmations.populate-fee-partial-inputs.contracts.ts:36-43`), and details without `vin`/`vout`.
  - The moved `tests/unit/services/bitcoin/nodeTransactionAuthentication.test.ts`.
- Confirm red first (tests only, before the source change):
  `cd server && npx vitest run tests/unit/services/bitcoin/sync/confirmations.test.ts tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts`
  Cases 1–6 (including 6(d), 6(e), 6(f), 6(g), 6(h) and 6(i)) and 8–10 fail for the stated reason; case 7 and every existing case pass. A
  `broadcastReconciliation.test.ts` red run reports 3 failed (8–10) / 41 passed, not a collection error (the file
  imports only modules that exist on base); after the fix it is 44/44, and an implementation that binds to the
  returned `details.txid` fails 8 and 9, and one that authenticates after `markBroadcastAccepted` fails 8. After the source change, the
  full A1 set:
  `cd server && npx vitest run tests/unit/services/bitcoin/sync/confirmations.test.ts tests/unit/services/bitcoin/sync/confirmations/authenticatedDetails.test.ts tests/unit/services/bitcoin/sync/confirmations/populators.defensive.test.ts tests/unit/services/bitcoin/sync/confirmations/batchUpdates.test.ts tests/unit/services/bitcoin/sync/remoteAwaitInventory.test.ts tests/unit/services/bitcoin/signingIntent/broadcastReconciliation.test.ts tests/unit/services/bitcoin/nodeTransactionAuthentication.test.ts tests/unit/services/bitcoin/advancedTx.test.ts tests/unit/services/bitcoin/transactionHelpers.legacyRawTx.test.ts tests/unit/services/bitcoin/blockchain.test.ts`
  `advancedTx.test.ts` and `transactionHelpers.legacyRawTx.test.ts` cover the D-12.1 import sites; `blockchain.test.ts`
  registers `blockchain/transactions-reconciliation.contracts.ts` (populate through the blockchain service). Integration:
  `flock /home/nekoguntai/.i12-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/syncMutationNetworkTransactions.test.ts`

**Existing tests the fix breaks (fixture migrations).** The worker first applies only the source change, runs the
commands above and records the failing set. Every case in it must be in the list below. Migrated cases keep their
names, except the D-12.3 cases called out below, whose subject is removed.
- **Rule.** Every populate case whose `getTransaction` mock is reached serves objects without `hex` under non-txid
  strings. Each such case is migrated to `confirmationsNodeFixtures`: real transactions, row `txid` = `getId()`, row
  `id` values unchanged (so `getTransactionFieldPatch('<id>')` assertions survive), and metadata
  (`blockheight`/`confirmations`/`time`) passed through `nodeDetails(tx, metadata)`.
- `confirmations.populate-main-flow.contracts.ts`:
  - `:13` ("populates block/fee/address fields…"): `t3`'s sender moves from `prevout` (`:35-40`) to a served
    authenticated parent; `t4`'s `fee: 0.00002` (`:46`) and `prevout` (`:47-54`) become a parent worth 100_000 sats
    with a 98_000 output, so `fee 2000n` / `amount -2000n` (`:186-187`) hold.
  - `:197` (cancellation chunk): 51 distinct transactions (`locktime = index`, each with one dummy input) served with `{ blockheight: 900 }`;
    `toHaveBeenCalledTimes(50)` and the not-called check on the 51st txid stay.
- `confirmations.populate-address-id.contracts.ts`:
  - `:8` "populates addressId for sent transactions from input prevout wallet addresses" is renamed to "does not
    populate sent addressId from server-supplied prevout fields" and expects no patch (D-12.3);
  - `:54`, `:89` are migrated;
  - `:125` "handles sent addressId fallback branches…" becomes a received-row lookup-miss case; the sent branch it
    covered is gone.
- `confirmations.populate-error-handling.contracts.ts:54`: the flow keeps the outer per-transaction catch
  (`processUpdates.ts:79-83`) by making `mockGetBlockTimestamp` reject once for a row with `blockHeight` set and
  `blockTime: null`. The throwing-getter inner catches move to `populators.defensive.test.ts`. `:12` is unchanged.
- `confirmations.populate-mixed-fallbacks.contracts.ts:8`: the invalid-fee and `prevout` assertions are removed with
  their code (D-12.3) and re-expressed as case 6. The coinbase branch (`feePopulation.ts:76`, today covered only by `{ coinbase: true }` at `:19`) is covered by a
  real coinbase transaction from `buildTransaction({ inputs: ['coinbase'] })`, whose non-empty scriptSig keeps
  `input.coinbase` truthy; the
  consolidation amount and `prev-fail` keep their assertions with real bytes.
- `confirmations.populate-fee-partial-inputs.contracts.ts:23`: the partial, complete and missing-parent rows are
  migrated; `sent-no-vout` / `sent-no-txid` (`:36-43`) move to the defensive unit (real bytes cannot express them).
- `confirmations.populate-counterparty-fallbacks.contracts.ts:8`: the `prevout` mixes (`:14-52`) become authenticated
  parents, with the `getTransaction` call expectations (`:160-162`) re-keyed to real parent txids. The
  `{ coinbase: true }` input (`:42`, the only coverage of `counterpartyPopulation.ts:40`) becomes a real coinbase input
  from `buildTransaction({ inputs: ['coinbase'] })` (non-empty scriptSig), so that arm stays reached.
- `confirmations.populate-network-history.contracts.ts:19`: `t-needs-timestamp` is served authentic bytes, so
  `populateBlockTimeFromHeader` is still reached (`mockGetBlockTimestamp` called with `999`). `tx-no-height` keeps
  serving `{}` (now rejected, with the same `updated: 0`). `:84` is unchanged.
- `confirmations.populate-core.contracts.ts` and `confirmations.network-fail-closed.contracts.ts`: unchanged (no
  fetch is reached).
- Integration `tests/integration/repositories/syncMutationNetworkTransactions.test.ts:188` ("commits production
  missing-field network work through the exact fence"): `createTestTransaction(…, { txid: tx.getId() })` for a
  transaction with one non-coinbase dummy input `{ txid: '11'.repeat(32), vout: 0 }` (the current fixture's `vin: []`,
  `:206`, cannot be serialized; the fake returns `null` for that parent, so the counterparty stays null) paying
  `ADDRESSES[0]`; `setTransactionDetails(txid, { ...decodeRawTransaction(tx.toHex(), 'testnet3'), confirmations: 6, blockheight: 100_000, time })`.
  The `updated: 1` and `addressId` expectations stay.
- `broadcastReconciliation.test.ts`: `record()` (`:73`, `broadcastTxid`) uses a real fixture `TXID` instead of
  `'b'.repeat(64)`, with every assertion that uses `'b'.repeat(64)` updated to match, including the default
  `mocks.broadcast.mockResolvedValue({ txid: 'b'.repeat(64), … })` at `:88`. Every `mocks.lookup.mockResolvedValue*`
  that returns a txid (at `51b0b69af0`: `:120`, `:158`, `:235`, `:299`, `:332`, `:351`) resolves
  `{ txid: TXID, hex: TX_HEX }`; the worker re-greps `mocks.lookup.mockResolvedValue` rather than trusting these line
  numbers. The file grows from 357 to about 400 lines.
- Not affected (they mock populate wholesale): `confirmationUpdater.test.ts` (1,000 lines, not edited),
  `confirmationUpdaterSettlementLock.test.ts`, `syncServiceTestHarness.ts`, `syncJobs*.test.ts`,
  `canonicalIncrementalSync.test.ts`, `expiredIncrementalReclaim.integration.test.ts`. The populate cases of
  `transactions-reconciliation.contracts.ts:228-266` reach no fetch. The advancedTx suites are not affected (D-12.1
  keeps the `./shared` re-export).

**Acceptance.**
- No fee, consolidation amount, counterparty or addressId is persisted from bytes whose txid differs from the
  requested txid, or from client-supplied `fee`/`prevout`/decoded `vin`/`vout` fields of the current transaction or
  of any parent (cases 6(d), 6(e) — a client address on an OP_RETURN output — 6(f) — a client `vin` naming a genuine
  larger parent, fee stays `1_000n` — 6(g) — a client parent `vout` value, fee stays `1_000n` — 6(h) — a client
  parent `vout` address, the counterparty is the address in the parent's bytes — and 6(i) — a client `vin` index
  pointing at a larger output of the same parent, fee stays `1_000n`);
  such rows stay null and are retried. `authenticatedPopulationDetails` returns exactly the byte projection
  (whole-object `toStrictEqual`).
- An honest Electrum server produces byte-identical patches (case 7).
- A reconciliation lookup marks an intent accepted only for bytes that authenticate to `broadcastTxid`,
  never to the lookup's own `txid` field (cases 8 and 9 serve a self-consistent forgery), and accepts exactly once,
  after the re-broadcast (case 8 call count and `invocationCallOrder`).
- Backend `tests/unit` coverage stays at 100%.
- The `serverFeePolicy` and other mutation-map canaries are untouched (no pinned file edited).
- Critical shard 3 reports no surviving or no-coverage mutant on the two changed `broadcastReconciliation.ts` lines.
- Signer inventory is unchanged.

### Phase A2 — Canonical lowercase Electrum txids (P1 `wallet-sync--non-lowercase-electrum-txid-duplicates-authenticated-rows`)

**Duplicate-row trace (re-verified at 51b0b69af0; the P1 stands).** Setup: an existing lowercase row for txid `t`, and
a hostile server whose history and listunspent return `T = t.toUpperCase()` and which serves the genuine bytes for
`blockchain.transaction.get(T)`.

| Step | Code | What happens to `T` |
|---|---|---|
| Schema | `electrum/types.ts:123-136` (`z.string().length(64)`) | accepted as is |
| History index | `fetchHistories.ts:85-91`; `historyEvidenceAuthentication.ts:134-137` | `allTxids`/`txHeightMap` keyed `T`; `currentTxids = [T]` |
| Compact authentication | `evidenceAuthentication.ts:175-199,301-304`; `transactionEvidenceProjection.ts:187-191,193-198`; `rawTransactionEvidence.ts:262-273` | bytes hash to `t`, compared with `T.toLowerCase()`, so the check passes; `authenticatedTransactionEvidence.set(T, envelope)` |
| History filter | `historyEvidenceAuthentication.ts:90-99,108-121` | `acceptedCurrent.has(T)`, the envelope pays the wallet script, so the item is kept with `tx_hash: T` |
| Existing check | `checkExisting.ts:93-130` → `repositories/transactions/sync.ts:725-733` (`txid: { in: [T] }`, case-sensitive Postgres `text`) | misses row `t`, so `T` goes into `newTxids` |
| Full projection | `evidenceAuthentication.ts:348-359` | `txDetailsCache.set(T, …)` |
| Row creation | `phases/processTransactions/classification.ts:440` `txid: args.item.tx_hash` → `reconcileTransactionBatch` `createManyAndReturn({ skipDuplicates: true })` (`repositories/transactions/sync.ts:698-703`) | inserted: `@@unique([txid, walletId])` (`prisma/schema.prisma:599`) is case-sensitive, with no `CHECK`/`lower()`/citext on `transactions.txid` in any migration (`grep -rniE "check.*txid\|lower\(.*txid\|citext" prisma/migrations` matches only the signing-intent `broadcastTxid` check) |
| UTXO evidence | `fetchUtxos.ts:172-189`; `evidenceAuthentication.ts:413-428,447-470` | outpoint evidence keyed `T:vout`, so the UTXO is accepted |
| UTXO insert | `fetchUtxos.ts:85-87`; `insertUtxos.ts:33-66` → `utxoRepository.findExistingByOutpoints` (`utxoRepository.ts:539-559`, exact `txid` match) | misses row `t`; a second UTXO row with `txid: T` is created (`@@unique([walletId, txid, vout])`, `schema.prisma:698`, case-sensitive) |
| Retirement | `historyEvidenceAuthentication.ts:20-22,63-79` (spent keys from packed input bytes, so lowercase); `reconcileUtxos.ts:148-155` | the `T` row is never in `authenticatedSpentOutpointKeys`, so it is never marked spent; omission never deletes |

Result: one honest-looking transaction can be persisted under up to 2^64 case variants, with the balance and received
totals inflated permanently, even after switching to an honest server. Nothing on the path lowercases a txid
(`grep -n toLowerCase server/src/services/bitcoin/sync` matches only scripts and the two remote-txid comparisons).
The same raw string also reaches `blockchain/syncAddress.ts:169,224,312,388`. Severity P1 (data corruption) is
confirmed. Precondition: a hostile or MITM'd (plain-TCP) Electrum server.

**Fix design.** D-12.5. Only `electrum/types.ts` changes: add `ElectrumTxidSchema` and use it in both item schemas
(`.length(64)` is replaced by the regex). `fetchUtxos.ts` needs no edit, because its re-parse (`:172-177`) now
returns lowercase. `rawTransactionEvidence.ts` stays case-insensitive and unedited (it is the receive-evidence
mutation profile). D-12.6 covers rows that already exist.

**Failing-first tests.**
- New `tests/unit/services/bitcoin/electrum.methods.txidCase.test.ts`. Address
  `tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx`, network `'testnet3'`; `T` is a real txid in uppercase.
  1. `getAddressHistory(requestFn, addr, 'testnet3')` with `requestFn` resolving `[{ tx_hash: T, height: 100 }]`
     resolves `tx_hash === T.toLowerCase()`. **Red on base:** `T`.
  2. `getAddressHistoryBatch` with a mixed-case item → lowercase. **Red on base:** mixed case preserved.
  3. `getAddressUTXOs` and `getAddressUTXOsBatch` with an uppercase item → lowercase. **Red on base:** uppercase.
  4. `const parsed = UtxoItemSchema.safeParse({ tx_hash: T, tx_pos: 0, height: 1, value: 1 })`; assert
     `parsed.success` is true, then `parsed.data?.tx_hash === T.toLowerCase()` (zod 4 types `.data` as
     `T | undefined` on the result union, so a bare `.data.tx_hash` fails `npm run typecheck:tests`; narrow with
     `if (!parsed.success) throw …` or use `?.`) (the `fetchUtxos` re-parse). **Red on base:** `T`.
  5. `tx_hash: 'g'.repeat(64)`: `getAddressHistory` rejects with `ElectrumResponseValidationError`, and
     `getAddressUTXOsBatch` leaves the address out of the map. **Red on base:** accepted.
  6. Guard: lowercase input is returned unchanged (passes on base).
- Duplicate-row proof (integration, real Postgres). Added to
  `tests/integration/repositories/syncMutationNetworkTransactions.test.ts`, which A1 also owns and which is already
  grouped at `scripts/ci/backend-integration-groups.sh:74`, so no registration change is needed.
  - The hoisted `fakeNode` gains `setWire(wire | undefined)`, which is reset in the existing `afterEach`. While a wire
    is set, the fake's `getAddressHistoryBatch`, `getAddressHistory`, `getAddressUTXOsBatch`, `getAddressUTXOs` and
    `getTransactionsBatch` delegate to the **real** `electrum/methods` functions (loaded with `await import(...)` inside
    the implementation). The stub `BatchRequestFn`/`RequestFn` answers from `wire`, so the production schemas are on
    the path. Transaction lookups are keyed by `String(params[0]).toLowerCase()`, so the hostile server serves the
    genuine bytes for any case. The wire records the methods and txids it served, so a case can assert what was
    requested.
  - **In-process evidence projector (part of the harness).** A real `syncWallet` sends compact evidence projection to a
    real worker thread (`sync/transactionEvidenceWorkerFactory.ts:7-19,33-44`). Under the `.ts` source runtime the
    worker module `transactionEvidenceWorker.ts` fails with `ERR_MODULE_NOT_FOUND` (extensionless imports, no loader),
    the projector rejects (`transactionEvidenceThread.ts:149-152`), X is never inserted and the count stays 1 on base
    for a reason unrelated to the bug. The file therefore adds
    `vi.mock('../../../src/services/bitcoin/sync/transactionEvidenceThread', …)` that keeps `...actual` and replaces
    `createTransactionEvidenceProjector` and `createCompactTransactionEvidenceProjector` with in-process projection
    through `transactionEvidenceProjection` (the pattern of
    `tests/unit/services/bitcoin/sync/receiveEvidenceAuthentication.test.ts:45-128`). The compact projector must
    provide every method the sync path calls — `projectCompact` (`evidenceAuthentication.ts:190`), `projectFull`
    (`:354`), `extractOutput`, `extractOutputs` (`:461`) and `close` (`:328/371/494`) — and
    `createTransactionEvidenceProjector` must provide `project` and `close`; a missing method throws a `TypeError`
    that becomes a fail-closed rejection (`receiveEvidenceGate.ts:15-21`), failing cases 7 and 8 for a harness reason
    and tripping the D-12.X3 stop rule. Only the pattern's `setImmediate` and the `projectionControl`/complexity
    `WeakMap` test-control hooks are dropped.
  - Fixture: a coinbase-shaped transaction X (one input with an all-zero hash and index `0xffffffff`, so there are no
    parent fetches) paying 50_000 sats to `ADDRESSES[2]`. History and listunspent are requested only for wallet
    `Address` rows (`sync/context.ts:35-47,89`), so every wallet in cases 7 and 8 gets
    `createTestAddress(factoryClient, wallet.id, { address: ADDRESSES[2], index: 2 })`. `createTestUtxo` is added to
    the `./setup` import list (`:78-83`, which today imports only `createTestAddress`, `createTestTransaction`,
    `createTestUser`, `createTestWallet`). One production `syncWallet` runs through the same claim and fence pattern as
    `:143-186`.
  7. **Hostile case-variant sync.** The wallet is seeded with the honest rows:
     `createTestTransaction(…, { txid: x, type: 'received', amount: 50_000n })` and
     `createTestUtxo(…, { txid: x, vout: 0, amount: 50_000n, address: ADDRESSES[2], scriptPubKey: <p2wpkh script> })`.
     The wire returns `X = x.toUpperCase()` in history and listunspent. Expect `syncWallet` to resolve, the wallet's
     `lastSyncError` to be null, and the wire to have served the uppercase history **and** listunspent for
     `ADDRESSES[2]`; then `prisma.transaction.count({ where: { walletId, txid: { equals: x, mode: 'insensitive' } } }) === 1`,
     the same for `prisma.uTXO`, and no row with `txid <> lower(txid)`. **Red on base:** both counts are 2.
  8. **Honest control, insertion reachable** (passes on base and after). A wallet with the same address but **no**
     seeded transaction or UTXO rows, lowercase wire. Both counts go from 0 before the sync to 1 after it, with
     `lastSyncError` null. This proves the harness actually inserts from the wire (a sync that never processed the wire
     would leave 0), so case 7's base failure comes from the bug.
  - If case 7 does **not** fail on base, or fails for a reason other than the second insert (for example a
    gap-limit or descriptor error from `createTestWallet`, a non-null `lastSyncError`, a projector/worker error, or a
    wire that never served listunspent), the worker stops (D-12.X3). It records the observed path and reports to the
    coordinator for re-assessment instead of adjusting the assertion.
- Confirm red first:
  `cd server && npx vitest run tests/unit/services/bitcoin/electrum.methods.txidCase.test.ts`
  and
  `flock /home/nekoguntai/.i12-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/syncMutationNetworkTransactions.test.ts`
  A plain run skips without `DATABASE_URL`.

**Existing tests the fix breaks.** Five known migrations. Mocking the node client above `methods.ts` does **not**
bypass the sync-phase re-parse: every listunspent item still goes through `UtxoItemSchema.safeParse` at
`fetchUtxos.ts:172`, so under D-12.5 a non-hex listunspent txid becomes `invalid_utxo_result` and the sync throws at
`receiveEvidenceGate` (or, for `fetchUtxos.contracts.ts`, the key is missing). Each of these listunspent fixtures uses
a non-hex `'…'.padEnd(64, …)` txid:
1. `tests/unit/services/bitcoin/sync/phases/fetchUtxos.contracts.ts:261` ("should build UTXO data map with correct
   keys", registered by `sync/phases.test.ts:765`): `txid = 'utxo_tx'.padEnd(64, 'a')`; `allUtxoKeys.has(key)` fails.
2. `tests/unit/services/bitcoin/blockchain/syncWallet-core.contracts.ts:150`: `'sync-tx'.padEnd(64, 'a')` (registered
   by `blockchain.test.ts`).
3. `tests/unit/services/bitcoin/blockchain/transactions-reconciliation.contracts.ts:185`: `'recv'.padEnd(64, 'c')`
   (registered by `blockchain.test.ts`).
4. `tests/unit/services/blockchainService/utxo-management.contracts.ts:186`: `'confirmed-tx'.padEnd(64, 'a')`.
5. `tests/unit/services/blockchainService/broadcasting-validation-reorg.contracts.ts:274`: `'reorged-tx'.padEnd(64, 'b')`.

Cases 4 and 5 are registered by `tests/unit/services/blockchainService.test.ts`. Each txid becomes lowercase hex
(e.g. `'ab'.repeat(32)`, distinct per fixture where a file uses several); the assertions are unchanged. All five files
are in the Phase A ownership row. The repo-wide survey of `tx_hash` literals in `server/tests`
(`grep -rnoE "tx_hash: *'[^']*'"`) found further non-hex 64-character history items at `sync/phases.test.ts:452`,
`blockchain/transactions-reconciliation.contracts.ts:387`, `blockchain/syncAddress.contracts.ts:499` and
`blockchain/syncWallet-core.contracts.ts:458`; the worker checks each against the run below and migrates any that
fails. That literal survey misses txids built in variables (`'…'.padEnd(64, …)`, template strings), so the worker also
sweeps `grep -rnE "padEnd\(64|txid = '" tests/unit/services` for non-hex txid variables that reach `HistoryItemSchema`/`UtxoItemSchema` (directly, through `methods.ts`, or through the
`fetchUtxos` re-parse) and migrates each one found the same way, listing them in the commit body. The schema-level
suites (`electrum.methods.utxoBatch.test.ts`, `electrum.historyBounds.test.ts`, `electrum.behavior.test.ts`) use
lowercase hex. The authentication case tests (`rawTransactionEvidence.test.ts:100-125`,
`transactionEvidenceProjection.test.ts:30`) are untouched. Rule: the worker runs
`cd server && npx vitest run tests/unit/services/bitcoin/electrum.methods.utxoBatch.test.ts tests/unit/services/bitcoin/electrum.historyBounds.test.ts tests/unit/services/bitcoin/electrum.behavior.test.ts tests/unit/services/bitcoin/electrum.test.ts tests/unit/services/bitcoin/sync tests/unit/services/bitcoin/blockchain tests/unit/services/bitcoin/blockchain.test.ts tests/unit/services/blockchainService.test.ts`
after the change. Any case that fails because a fixture uses a non-hex or uppercase 64-character `tx_hash` going
through a real schema gets lowercase-hex values; no assertion is weakened. The replay fixture
(`scripts/perf/wallet-sync-persistence-fixture.cjs:161-178`) uses lowercase txids and `'33'.repeat(32)`, so
`driverSha256` and the replay are unaffected.

**Acceptance.**
- No Electrum `tx_hash` other than canonical lowercase hex reaches sync, the legacy per-address sync or populate.
- A case-variant hostile history or listunspent creates no second transaction or UTXO row (case 7, in a sync that
  resolved with no `lastSyncError` and served the uppercase history and listunspent).
- Honest syncs still insert from the wire (case 8: counts 0 → 1 on an unseeded wallet).
- The five listunspent fixtures (`fetchUtxos.contracts.ts:261`, `syncWallet-core.contracts.ts:150`,
  `transactions-reconciliation.contracts.ts:185`, `utxo-management.contracts.ts:186`,
  `broadcasting-validation-reorg.contracts.ts:274`) and any other swept non-hex txid fixture use lowercase hex, with
  assertions unchanged.
- Existing non-canonical rows are documented as a limitation with a read-only detection query (D-12.6); no
  migration, no data repair.

### Phase A constraints checklist

- **Mutation pins.** No file in `config/wallet-safety-mutation-map.json` or any `server/stryker.*.config.mjs`
  `mutate` range is edited (D-12.1). **Critical shard 3:** `broadcastReconciliation.ts` is covered by the
  `signingIntent/**` glob (`server/scripts/mutation/shards.mjs:37`). After A1, the integrator runs, under the heavy-run
  guard and outside any coverage run,
  `cd server && MUTATION_SHARD=3 npx stryker run stryker.critical.config.mjs --force` (the full shard, as CI runs it; after
  C3 the config is non-incremental, so `--force` is redundant but harmless, D-12.X4.1).
  The integrator reads `server/reports/mutation/critical-mutation-report.shard-3.json` and confirms that no mutant on a
  changed `broadcastReconciliation.ts` line is undetected (Verification block); tests 8–10 are expected to kill them.
  The default critical runner is Stryker's Vitest runner over `server/vitest.config.ts`, so `broadcastReconciliation.test.ts`
  participates although it is not in the 24-entry command-fallback list.
- **verify-vectors.** It runs, because `server/src/services/bitcoin/**` is a wallet-safety critical path. No
  `sourceManifest` file and no `.github/workflows/verify-vectors.yml` edit, so no vector regeneration is needed.
- **Coverage.** Backend `tests/unit` must be 100% (`cd server && npx vitest run --coverage tests/unit`):
  - new branches live in `authenticatedDetails.ts` and are covered by its unit test;
  - branches the flow can no longer reach are removed (D-12.3) or are in exported populators covered by
    `populators.defensive.test.ts`;
  - the one-line `electrum/types.ts` schema is guarded by the txid-case suite (`**/types.ts` is excluded from backend
    coverage, `server/vitest.config.ts:41`, so the coverage gate does not see it).
- **Lizard.** New helpers are top-level `function` declarations, CCN ≤ 15, NLOC ≤ 200. D-12.3 removes functions and
  adds none to the populators. Each contracts `register…` function stays under 200 NLOC (split the new contracts file
  into two register functions if needed, and measure). Every worker runs `lizard -C 15 -T nloc=200 <changed files>`
  and reports zero new warnings.
- **Large files.** Largest touched test files: `broadcastReconciliation.test.ts` (357 → about 400 lines),
  `syncMutationNetworkTransactions.test.ts` (237 → about 380), and the new files (each under 400).
  `confirmationUpdater.test.ts` (exactly 1,000 lines) is not touched.
- **Architecture.** New edges:
  - `sync/confirmations/authenticatedDetails → nodeTransactionAuthentication` and `→ sync/transactionOutputEvidence`;
  - `signingIntent/broadcastReconciliation → nodeTransactionAuthentication`;
  - re-pointed edges from `advancedTx/shared` and `transactions/helpers`.
  None can close a cycle (`nodeTransactionAuthentication` imports only `rawTransactionEvidence` plus a type-only
  `nodeClient`; `transactionOutputEvidence` imports only `bitcoinjs-lib` and constants), and
  `check:server-cycle-baseline` stays green. The integrator regenerates `docs/architecture/generated`.
- **Other gates.**
  - Sync-path inventories: `remoteAwaitInventory.test.ts:20-21` fragments preserved; no repository call added
    (`config/wallet-sync-mutation-boundaries.json` unchanged); no `utxoRepository` writer added (replay driver
    untouched).
  - Signer inventory: new identifiers `authenticatedPopulationDetails`, `chainPosition`, `projectInput`,
    `projectOutput`, `ElectrumTxidSchema`; `npm run verify:signer-inventory`.
  - `npm run check:safety-catch-guards`: no new `catch`, but run it, since reconciliation errors flow through existing
    catches.
  - No new API endpoint, so no e2e mock maps; no new integration spec, so no `backend-integration-groups.sh` edit;
    no migration.
- **Changelog** (handed to the integrator): "Missing-field population (fee, consolidation amount, counterparty,
  addressId) and signing-intent reconciliation lookups now read only transaction bytes authenticated against the
  requested txid; unauthenticated verbose `fee`/`prevout` fields are ignored." and "Electrum history and UTXO txids are
  normalized to lowercase hex, so a case-variant txid can no longer duplicate an authenticated transaction or UTXO."
  The integrator adds the two D-12.6 limitation notes. File ownership: the A row of the merged table.

---

## Phase B — application fixes (B1–B4)

All evidence re-read on `51b0b69af0`. Decisions: D-12.B1–D-12.B4b. B1–B4 run in four worktrees (`b1`–`b4`).

### Phase B1 — An AI-created label reaches the wallet-labels cache (P2 `tx-label-ai-suggestion--wallet-labels-cache-not-invalidated`)

**Evidence (re-verified).** `src/components/TransactionList/hooks/useTransactionLabelMutations.ts:191-198`
`labelsApi.createLabel(...)` then `onLabelsChange?.()` and local `setAvailableLabels(…created)` only;
`onLabelsChange` is `controller.handleLabelsChange` (`WalletDetailLoadedView.tsx:86,243`), which only runs
`fetchData(true)` (`useWalletDetailController.ts:314-318`). `walletLabelKeys` is invalidated only by the three mutation
hooks (`src/hooks/queries/useWalletLabels.ts:15-34`); `useInvalidateWalletLabels` (`:36`) has no caller in `src/`.
`QueryProvider.tsx:15` `refetchOnWindowFocus: false`. `handleEditLabels` seeds from the stale `walletLabels`
(`:97-104`), the case-insensitive lookup misses (`:181-183`), and the server refuses the duplicate name with
`ConflictError('A label with this name already exists')` (`server/src/services/labelService.ts:72`). No test covers
cache invalidation (`tests/components/TransactionList/useTransactionLabelMutations.test.tsx` mocks `labelsApi` only).
Confirmed.

**Fix design.** D-12.B1.

**Failing-first tests.**
- `tests/components/WalletDetail/useWalletDetailController.network.test.tsx` (478 lines): add
  `invalidateWalletLabels: vi.fn()` to the hoisted `controllerState` (reset in the existing `beforeEach`), extend the
  `useWalletLabels` mock (`:66-68`) with `useInvalidateWalletLabels: () => controllerState.invalidateWalletLabels`,
  and extend the existing case "builds an anonymous empty-route owner and guards route-bound label refreshes"
  (`:403-415`): after the empty-route `handleLabelsChange()` assert `invalidateWalletLabels` not called; after the
  `'wallet-1'` call assert it was called once (and `fetchData` with `true`, as today).
  **Red on base:** the controller never calls the invalidator (`expected "vi.fn()" to be called 1 times, but got 0`).
- `tests/components/TransactionList/useTransactionLabelMutations.test.tsx` (738 lines), guard (passes on base, pins
  the precondition D-12.B1 relies on): "notifies onLabelsChange once the AI-created label exists even when the editor
  closed mid-request" — deferred `createLabel`, `handleCancelEdit()` before resolve, resolve → `onLabelsChange`
  called once, `availableLabels` unchanged.
- Confirm red first: `npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail/useWalletDetailController.network.test.tsx tests/components/TransactionList/useTransactionLabelMutations.test.tsx`
  — record the failing network case (the label-mutations guard passes).

**Existing tests the fix breaks.** Every `vi.mock` factory of `src/hooks/queries/useWalletLabels` that renders the real
controller lacks the new export, and Vitest throws on access to a missing export of a factory mock:
`tests/components/WalletDetail/useWalletDetailController.network.test.tsx:66-68` (above),
`tests/components/WalletDetail/useWalletDetailController.utxoStats.test.tsx:57-59`,
`tests/components/WalletDetail.test.tsx:80-82`,
`tests/components/WalletDetailWrapper/WalletDetailWrapperTestHarness.tsx:115-…` (used by
`tests/components/WalletDetail.wrapper.test.tsx` and the three `WalletDetailWrapper.*.contracts.tsx`). Each gains
`useInvalidateWalletLabels: () => vi.fn()` (or the spy). Not affected: `LabelSelector.test.tsx`, `LabelManager.test.tsx`,
`WalletDetail/tabs/TransactionsTab.test.tsx` (their subjects do not import the new export).

**Acceptance.** After accepting a new AI suggestion and saving, reopening the editor on any transaction lists the new
label, the filter bar shows it, and accepting the same suggestion selects it instead of returning 409; no reload
needed. Frontend coverage stays 100% (the new line is covered by the network case).

### Phase B2 — Every restore warning survives the forced re-login (P2 `restore-warnings--collapsed-and-wiped-after-restore`)

**Evidence (re-verified).** `src/components/BackupRestore/hooks/useBackupHandlers.ts:236-247` adds one notification
per warning, all `type: 'warning'`, no `scopeId`; `AppNotificationContext.tsx:266-280` replaces an existing
notification with the same type+scopeId, so N warnings leave the last one; `restoreTransforms.ts` emits per-user
(`disableTelegramCredentials`, `disableUndecryptableTwoFactor`) and per-category warnings (`processNodeConfigRecords`
`:45-48`, SMTP `:79-81`, AI credentials, API-key revocation) and bumps every restored user's `sessionVersion`
(`processUserRecords` `:57-67` → `invalidateUserSessions`). After the 3 s reload (`useBackupHandlers.ts:249-254`) the
access token is rejected (`accessTokenSessionService.ts:50`), refresh is rejected (`api/auth/tokens.ts:112-116`),
`refresh.ts:313` → `triggerTerminalLogout` (`:350-355`) → `AppNotificationContext.tsx:178-182` clears state and
localStorage. Tests only count `addNotification` calls on a mock (`tests/components/BackupRestore/useBackupHandlers.branches.test.tsx:239-258`,
`tests/components/BackupRestore.test.tsx:568-614`). Confirmed.

**Fix design.** D-12.B2a, D-12.B2b. `AppNotificationContext.tsx` is not edited.

**Failing-first tests.**
- `tests/components/BackupRestore/useBackupHandlers.restoreWarnings.test.tsx` (new): renders
  `() => ({ handlers: useBackupHandlers(null), notifications: useAppNotifications().notifications })` with the **real**
  `AppNotificationProvider` as wrapper; mocks `src/api/admin` (`validateBackup` valid, `restoreBackup` →
  `{ success: true, warnings: ['w1', 'w2', 'w3'] }`) and the logger as in `useBackupHandlers.branches.test.tsx`; fake
  timers (unmount before the 3 s reload; jsdom has no `location.reload`); `afterEach` clears `sessionStorage` and
  `localStorage`. Cases: (1) after upload + `setConfirmText('RESTORE')` + `handleRestore()`, the `'Restore Warning'`
  notifications' messages are `['w1', 'w2', 'w3']` with three distinct `scopeId`s and `severity: 'warning'`.
  **Red on base:** only `['w3']` (type+scopeId replace). (2) `sessionStorage[RESTORE_WARNINGS_HANDOFF_KEY]` parses to
  `warnings: ['w1','w2','w3']`; then `act(() => triggerLogout())` (real `src/api/refresh.ts` export) empties the
  provider's notifications (the anti-leak wipe still works) while the sessionStorage key is still present.
  **Red on base:** the key is absent (literal key string asserted, so the case runs on base).
- `tests/components/BackupRestore/useRestoreWarningsHandoff.test.tsx` (new): mocks `src/contexts/UserContext`
  (`useUser` from hoisted mutable state) and uses the real `AppNotificationProvider`. Cases: admin consumes a stashed
  handoff → three persistent `'Restore Warning'` notifications, key removed; non-admin → none, key removed;
  unauthenticated → none, key kept, then rerender as admin → consumed; stash written **after** mount with the same
  admin and a rerender → not consumed (pre-logout window), then a different `user.id` → consumed; expired
  (`createdAt` older than the TTL), malformed JSON, non-array/empty/non-string `warnings`, missing `id` → removed,
  nothing added; `sessionStorage.getItem` throwing → nothing added, no throw. **Red on base:** the module does not
  exist (import failure).
- `tests/components/BackupRestore/restoreWarningsHandoff.test.ts` (new): `stashRestoreWarnings` writes and returns the
  handoff; `setItem` throwing (quota) still returns it; `takeRestoreWarnings` returns `null` when absent, removes the
  key on every read, enforces TTL bounds (future `createdAt` rejected); `restoreWarningNotification` builds the exact
  input. **Red on base:** module missing. (100% branches for the new module.)
- `tests/App.branches.test.tsx`, new case "an admin login consumes a stashed restore hand-off" (pass 8: nothing else
  proves `AuthenticatedAppShell` calls `useRestoreWarningsHandoff()`. The shell has no branches, so coverage cannot
  notice a missing call, the existing `App.branches` users have no `id`/`isAdmin` and sessionStorage is empty, and the
  three new files above prove the stash and the hook separately). Setup:
  - a hoisted, stable `mockAddAppNotification` spy, served by the `src/contexts/AppNotificationContext` mock as
    `useAppNotifications: () => ({ addNotification: mockAddAppNotification })` (not a fresh `vi.fn()` per render: the
    hook's effect depends on `addNotification`, so an unstable function re-runs the effect on every render);
  - `sessionStorage.clear()` added to the file's `beforeEach`;
  - seed `sessionStorage['sanctuary_restore_warnings_handoff']` with a valid two-warning hand-off;
  - render `<App />` with `mockUseUser` returning
    `{ isAuthenticated: true, user: { id: 'admin-1', isAdmin: true, usingDefaultPassword: false, preferences: {} }, … }`.

  Assert `mockAddAppNotification` is called twice with `objectContaining({ title: 'Restore Warning', severity: 'warning' })`
  and the key is removed. **Red on base:** the spy is never called (the shell does not call the hook).
- Confirm red first: `npx vitest run --config config/tooling/vitest.config.ts tests/components/BackupRestore/useBackupHandlers.restoreWarnings.test.tsx tests/components/BackupRestore/useRestoreWarningsHandoff.test.tsx tests/components/BackupRestore/restoreWarningsHandoff.test.ts tests/App.branches.test.tsx`
  — record the two behavioural failures of the first file, the two import failures, and the `App.branches` hand-off
  case failing because the spy is never called (every existing `App.branches` case passes).

**Existing tests the fix breaks / re-runs.**
- `tests/App.branches.test.tsx:82-86` mocks `src/contexts/AppNotificationContext` with only `AppNotificationProvider`;
  the shell now calls `useAppNotifications` → the mock gains `useAppNotifications` returning the hoisted, stable
  `mockAddAppNotification` (see the new hand-off case above). Its `useUser` mock (`:51-56`) already serves the shell;
  the existing cases run with sessionStorage cleared in `beforeEach`, so nothing is added for them.
- `useBackupHandlers.branches.test.tsx:239-258` ("…`addNotification` toHaveBeenCalledTimes(2)") and
  `BackupRestore.test.tsx:568-614` (`objectContaining({ type: 'warning', title: 'Restore Warning' })`) keep passing
  (still one call per warning); add `sessionStorage.clear()` to their `afterEach` so the new key does not leak between
  cases. `tests/contexts/AppNotificationContext*` unchanged.
- Re-run `tests/components/BackupRestore*` and `tests/App.branches.test.tsx`.

**Architecture note.** New import edge `src/app/AppRoutes/AuthenticatedAppShell.tsx → src/components/BackupRestore/hooks/useRestoreWarningsHandoff.ts`
(app → components already exists: `AppRoutes.tsx:2-4`); no cycle (the hook imports only contexts, utils and its
sibling module). The integrator regenerates `docs/architecture/generated`.

**Acceptance.** Restoring a backup that yields N warnings shows N distinct warnings immediately and, after the forced
sign-out and the next admin sign-in on that tab, shows all N again in the notification panel (persistent,
dismissible), proven end to end through the shell by the `App.branches` hand-off case; a non-admin signing in on
that tab sees none; no new endpoint, no e2e mock change; terminal logout still
clears notifications. Playwright: no route or API change — run the admin backup/restore e2e and render-regression specs
through the static-server config in the Verification block.

### Phase B3 — Replay refuses deliveries retired by a repoint or secret rotation (P2 `webhook-replay--resends-retired-delivery-to-repointed-endpoint`)

**Evidence (re-verified).** `server/src/repositories/webhookRepository.ts:156-200` `updateEndpoint` locks the endpoint
(`FOR NO KEY UPDATE`, `:165-170`) and retires `pending`/`failed` deliveries as `dead` with
`DELIVERY_ENDPOINT_CHANGED_REASON` (`:153-154,186-195`) when `changesDeliveryDestinationOrSigning` holds
(`server/src/services/webhooks/endpointService.ts:192-202`: URL change, any supplied secret, auth dropped).
`markDeliveryPendingForReplay` (`webhookRepository.ts:405-436`) guards only on the attempt lease and resets any row to
`pending`, `lastError: null`; `replayWalletWebhookDelivery` (`endpointService.ts:225-260`) checks only wallet/endpoint
scope. `sendWebhookDelivery` posts to `validateWebhookEndpointUrl(delivery.endpoint.url)` (`deliveryService.ts:139`),
never comparing the recorded `targetUrl` (`:84`). Replay is `requireWalletAccess('edit')`
(`api/wallets/webhooks.ts:169-170`) while repoint is owner-only (`:112`). Tests: `endpointService.test.ts:513-560`
cover retirement; no test replays a retired or pre-repoint delivery. Confirmed.

**Fix design.** D-12.B3a, D-12.B3b. No migration, no new endpoint (the route and its success shape are unchanged).

**Failing-first tests.**
- `server/tests/unit/repositories/webhookRepository.test.ts` (786 lines), in the `markDeliveryPendingForReplay` block
  (`:396-475`). Each replay case queues **two** `$queryRaw` `Once` values, in statement order: first the lock rows
  (`[{ id: 'endpoint-1' }]`), then the data row. (1) "refuses a delivery whose recorded target differs from the
  endpoint URL" — lock rows, then
  `mockTx.$queryRaw.mockResolvedValueOnce([{ endpointUrl: 'https://new.example/hook', targetUrl: 'https://example.com/hook', status: 'delivered', lastError: null }])`
  → `{ count: 0, delivery: null, refusal: 'endpoint_identity_changed' }`, `updateMany` not called; (2) "refuses a
  delivery retired by an endpoint change" — same URL, `status: 'dead'`, `lastError: DELIVERY_ENDPOINT_CHANGED_REASON`
  → refused; (3) "returns not found when the delivery row is gone" — lock rows `[]` (no second query is issued) and,
  separately, lock rows present but data row `[]` → `{ count: 0, delivery: null }`, no `refusal`, and
  `expect(mockTx.webhookDelivery.updateMany).not.toHaveBeenCalled()` in both sub-cases (the no-write path); (4) guard: same
  URL, `dead` with another `lastError` → resets (existing assertions); (5) the lock statement is issued first and
  contains `FROM "webhook_endpoints"` and `FOR SHARE` and no `FOR UPDATE`, and the data statement carries no locking
  clause. Assert `mockTx.$queryRaw` `toHaveBeenCalledTimes(2)`, then on each call's `.text` — the pattern of `:311-313`
  (`mock.calls[0][0] as { text: string }`), never the Sql object's `.strings` array (pass 15: on an array
  `not.toContain('FOR UPDATE')` checks element equality and always passes, so the rejected `FOR UPDATE OF d` / joined
  `FOR SHARE OF e` designs would pass): lock `.text` `toContain('FROM "webhook_endpoints"')`, `toContain('FOR SHARE')`,
  `not.toContain('FOR UPDATE')`; data `.text` `not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO KEY UPDATE|KEY SHARE)\b/)`. **Red on base:** (1), (2), (3) and (5) — base
  never reads the row and calls `updateMany`, whose unstubbed mock returns `undefined`, so the call rejects / resets
  instead of refusing; for (3), base calls the unstubbed `updateMany` → `TypeError` on `result.count`
  (`webhookRepository.ts:421`), and it never issues the lock query, so `{ count: 0, delivery: null }` is never
  returned.
- `server/tests/unit/services/webhooks/endpointService.test.ts` (623 lines): "refuses to replay a delivery retired by
  an endpoint change" — `mockFindDeliveryById.mockResolvedValueOnce(makeDelivery({ status: 'dead' }))` (defaults
  `walletId: 'wallet-1'`, `endpointId: 'endpoint-1'`, `:596-604`; `replayWalletWebhookDelivery` returns `null` unless
  wallet and endpoint match, `endpointService.ts:231-235`, and the `beforeEach` `clearAllMocks` at `:72-73` keeps an
  earlier persistent `mockFindDeliveryById.mockResolvedValue(makeDelivery({ endpointId: 'other-endpoint' }))` (`:300`)
  that would otherwise leak; this matches the lease-race case at `:308-316`), and
  `mockMarkDeliveryPendingForReplay.mockResolvedValue({ count: 0, delivery: null, refusal: 'endpoint_identity_changed' })`
  → rejects `toMatchObject({ statusCode: 409, message: expect.stringContaining('retired'), details: { reason: 'endpoint_identity_changed' } })`;
  queue and send not called. **Red on base:** base throws the lease-race message "Webhook delivery replay already in
  progress" without `details.reason`.
- `server/tests/integration/repositories/webhookEndpointEnqueueOrdering.integration.test.ts` (274 lines, already
  registered at `scripts/ci/backend-integration-groups.sh:86`): (1) create a delivery (`createInput`), mark it
  `delivered` via `prisma.webhookDelivery.update`, repoint with `updateWalletWebhook(…, { url: 'https://new.example/hook' }, 'owner')`
  → `markDeliveryPendingForReplay` returns the refusal and the row is still `delivered`; (2) a `failed` delivery
  retired by `updateWalletWebhook(…, { secret: 'rotated-secret-value' }, 'owner')` at the same URL → refused, row stays
  `dead` with the reason; (3) guard: a same-URL `dead` row with another `lastError` resets to `pending`; (4) lock
  order: `holdEndpointRow(prisma, endpointId, tx => repoint + retire)` (existing helper `:172-206`, which takes
  `FOR UPDATE`), start the replay, wait for it to block on the endpoint row, release → refused. Generalise
  `waitForEndpointLockWaiter` (`:257-274`) with a `lockClause` parameter (default `'FOR NO KEY UPDATE'`, existing
  callers unchanged; the new cases pass `'FOR SHARE'`). The helper's SQL is a Prisma tagged template whose filter is
  today a quoted literal (`:267`, `AND query ILIKE '%FOR NO KEY UPDATE%'`): bind the WHOLE pattern as one parameter —
  `AND query ILIKE ${`%${lockClause}%`}` (or `'%' || ${lockClause} || '%'`) — and never interpolate inside the quotes
  (pass 6: `'%${lockClause}%'` yields `ILIKE '%$2%'` with the value unbound, a bind-count error or a literal `%$2%`
  match that fails identically on base and after the fix); (5) same-URL secret-rotation race (the stale-snapshot case):
  `holdEndpointRow(prisma, endpointId, tx => same-URL secret change + the retirement updateMany)` on a `failed`
  delivery, start the replay, wait with `lockClause: 'FOR SHARE'`, release → the replay returns the refusal and the row
  is still `dead` with `DELIVERY_ENDPOINT_CHANGED_REASON` (not reset to `pending`). **Red on base:** (1), (2) reset to
  `pending`; (4) and (5) time out ("Timed out waiting for a webhook endpoint row lock waiter") because base takes no
  endpoint lock — the recorded red must show that timeout message, not a bind or syntax error from the helper. (5) would also fail against a single joined `FOR SHARE OF e` design (stale `d` snapshot → reset to
  `pending`), which is why D-12.B3b re-reads after the lock. The file proves the raw SQL against Postgres (unit mocks
  cannot).
- `server/tests/unit/api/openapi.wallet.contracts.ts` ("documents wallet webhook routes including replay", `:308-362`):
  assert `openApiSpec.paths['/wallets/{walletId}/webhooks/{webhookId}/deliveries/{deliveryId}/replay'].post.responses[409].content['application/json'].schema`
  `toEqual({ $ref: '#/components/schemas/ApiError' })` — a literal, following the file's own pattern at `:226-241`/`:511`.
  Do NOT import `apiErrorResponse` (pass 15: it is a non-exported local in `paths/walletWebhooks.ts:28`, so an import
  is `undefined`, and `toEqual(undefined)` would pass on base and fail after the fix). **Red on base:** a TypeError
  reading `content` of the missing `409` entry.
- Confirm red first:
  `cd server && npx vitest run tests/unit/repositories/webhookRepository.test.ts tests/unit/services/webhooks/endpointService.test.ts tests/unit/api/openapi.test.ts`
  (the contracts file runs only through `openapi.test.ts:8`), then
  `flock /home/nekoguntai/.i12-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/webhookEndpointEnqueueOrdering.integration.test.ts`.

**Existing tests the fix breaks.** `webhookRepository.test.ts` cases that call `markDeliveryPendingForReplay` without
stubbing `$queryRaw`: "resets replay state only for a row with no live lease" (`:396-426`), "leaves a leased delivery untouched when replay races an in-flight
attempt" (`:428-435`), and "does not let a replayed delivery clobber a concurrent delivered outcome" (`:437-475`) —
each needs two `Once` values before the replay call, in statement order: `mockTx.$queryRaw.mockResolvedValueOnce([{ id: 'endpoint-1' }])`
(lock rows), then `mockTx.$queryRaw.mockResolvedValueOnce([{ endpointUrl: 'https://example.com/hook', targetUrl: 'https://example.com/hook', status: …, lastError: null }])`
(data row) (the `$queryRaw` mock is shared with `updateEndpoint` cases, so use `Once`). The file's `beforeEach`
(`:47-48`) only runs `vi.clearAllMocks()`, which in vitest 4.1.11 does not empty queued `Once` values (only
`mockReset` does); base never calls `$queryRaw` in `markDeliveryPendingForReplay`, so the replay cases' leftovers
would be consumed by the later "retiring outstanding deliveries on endpoint change" cases (`:671`, `:695`, `:710`,
`:720`) and fail them for a harness reason. Add `mockTx.$queryRaw.mockReset();` after `vi.clearAllMocks()` in that
`beforeEach` (the mock has no default implementation, so the reset is safe); the red-on-base list stays (1), (2), (3) and (5). `endpointService.test.ts` replay cases (`:247-316`) keep passing
(their mocks omit `refusal`). `server/tests/unit/api/wallet-webhooks-routes.test.ts` mocks the service — unchanged.

**Acceptance.** After a repoint or secret rotation, replaying a retired delivery, or any delivery whose recorded target
differs from the current URL, returns 409 with `details.reason: 'endpoint_identity_changed'` and sends nothing;
same-URL replays of non-retired rows behave as before; a replay racing a repoint or a same-URL secret rotation either
refuses or is retired by it (no window where an old event reaches the new destination or is signed with the rotated
secret; integration cases 4 and 5). The replay decision reads delivery and endpoint state only after the endpoint
share lock is granted (no joined `FOR SHARE OF e` statement, no `FOR UPDATE OF d`). OpenAPI documents the 409.

### Phase B4 — A full leap year passes the assistant/MCP date-range cap (P2 `assistant-date-range--leap-year-full-year-rejected`)

**Evidence (re-verified).** `server/src/assistant/tools/utils.ts:26-37` throws `AssistantToolError(400, 'Date range exceeds 365 days')`
when `end - start > maxDateRangeDays * 86_400_000`; default `MCP_MAX_DATE_RANGE_DAYS=365`
(`server/src/config/envSections.ts:134`; schema `int().min(1).max(3650)`, `server/src/config/schema.ts:189`).
`dateRangeWhere` (`:60-73`) is used by `query_transactions`; `policyReadTools.ts:168` and `analyticsReadTools.ts:164`
call `enforceDateRange` too. The proxy builds whole years as `[Jan 1 00:00:00.000Z, Dec 31 23:59:59.999Z]`
(`llm-egress-proxy/src/consoleProtocolDates.ts:52-65`), 31,622,399,999 ms for a leap year > 31,536,000,000.
`server/src/mcp/types.ts:147-155` holds an unused copy. No leap-year test exists
(`server/tests/unit/assistant/readToolUtils.test.ts:24-44`). Confirmed.

**Fix design.** D-12.B4a, D-12.B4b.

**Failing-first tests.** `server/tests/unit/assistant/readToolUtils.test.ts` (new `describe('date-range cap and leap days')`,
first asserting the precondition `expect(config.mcp.maxDateRangeDays).toBe(365)` — the unit env sets no
`MCP_MAX_DATE_RANGE_DAYS`):
- full 2024 `[2024-01-01T00:00:00.000Z, 2024-12-31T23:59:59.999Z]` and `dateRangeWhere` with the same strings → no
  throw / `{ gte, lte }`; full 2028 and 2000 likewise. **Red on base:** throws "Date range exceeds 365 days".
- `[2027-03-01T00:00:00.000Z, 2028-02-29T23:59:59.999Z]` (366 calendar days containing 29 Feb) → accepted.
  **Red on base:** throws.
- a range ending exactly at the leap day counts it: `[2023-02-28T00:00:00.000Z, 2024-02-29T00:00:00.000Z]` (exactly
  366 × DAY; `d <= end` boundary) → accepted. **Red on base:** throws (base rejects anything over 365 days).
- a range starting inside the leap day counts it: `[2024-02-29T12:00:00.000Z, 2025-03-01T11:59:59.999Z]` (just under
  366 days; `d + DAY > start` true) → accepted. **Red on base:** throws.
- year-0050 bounds exercise `setUTCFullYear`: `new Date('0048-01-01T00:00:00.000Z')` to `0048-12-31T23:59:59.999Z`
  (0048 is leap) → accepted. **Red on base:** throws.
- guards (pass on base and after; each must throw or accept as stated): full 2025 accepted;
  `[2025-03-01T00:00Z, 2026-03-01T23:59:59.999Z]` (366 days, no 29 Feb) throws; full 1900 (not leap)
  `[1900-01-01, 1900-12-31T23:59:59.999Z]` accepted and `[1900-01-01, 1901-01-01T23:59:59.999Z]` throws;
  `[2024-01-01T00:00Z, 2025-01-01T00:00:00.001Z]` throws (1 ms over); **leap year in the span but its 29 Feb outside
  the range** (these defeat a naive "count leap years between the two years" and execute the false side of each
  intersection operand): `[2024-03-01T00:00:00.000Z, 2025-03-01T23:59:59.999Z]` throws (29 Feb before start;
  `d + DAY == start`, so `d + DAY > start` is false) and `[2023-02-28T00:00:00.000Z, 2024-02-28T23:59:59.999Z]` throws
  (29 Feb after end; `d <= end` is false); a 20-year range throws via the fast path. Existing `:29-35` cases
  unchanged.
- Confirm red first: `cd server && npx vitest run tests/unit/assistant/readToolUtils.test.ts`.

**Existing tests the fix breaks.** None expected: the existing out-of-range case (2020→2026) still throws via the fast
path. Re-run `tests/unit/assistant` and `tests/unit/mcp` (D-12.B4b deletion; no test imports `enforceDateRange` from
`mcp/types`).

**Acceptance.** "This year"/"last year"/an explicit full calendar year succeed in every year including 2028/2029; the
cap still rejects any range longer than N days plus the 29 Februaries it contains; error text unchanged; backend
`tests/unit` coverage 100% for `utils.ts` (every branch of `leapDaysWithin`, including the false side of both
intersection operands `d <= end` and `d + DAY > start`, and the fast path covered); a range whose span includes a leap
year but not its 29 February is still rejected; lizard: two
small helpers, no new warning.

**Phase B notes (ownership: the B1–B4 rows of the merged table).** B1 and B2 are both frontend but disjoint (`WalletDetail`/`TransactionList` vs `BackupRestore`/`app`/`App.branches`).
None of these files is pinned by `config/wallet-safety-mutation-map.json` or a `server/stryker.*.config.mjs` `mutate`
range, none is in a sync path or the verify-addresses source manifest, no new identifier starts with `sign`,
`finalize` or `broadcast`, no new integration spec file (B3 extends a registered one), no `rm -rf`/`kill`, no new
endpoint (no e2e mock-map change). All touched test files stay well under 1000 lines (largest after edits:
`webhookRepository.test.ts` ≈ 830). Changelog bullets handed to the integrator: B1 "AI-suggested labels appear in label
editors and filters immediately"; B2 "All backup-restore warnings are kept and shown again after the post-restore
sign-in"; B3 "Webhook replay refuses deliveries retired by an endpoint repoint or secret rotation (409)"; B4 "Assistant
and MCP date ranges accept a full leap year".

---

## Phase C — CI, release and test-harness fixes (C1–C5)

All five subsections run in **one worktree and one branch** (`c`; C1, C2 and C3 all edit
`tests/ci/check-workflow-composition.test.sh`, and C2 and C4 both edit `.github/workflows/quality.yml`, as sequential
commits). Line numbers were re-read on `51b0b69af0`.
Decisions: D-12.C1–D-12.C6; C4 fallout per D-12.X5. Ownership: the C row of the merged table; ordering couplings with
Phase A in D-12.X4.

### Phase C1 — The binding mutation proof gets real headroom (P2 `ci-verify-vectors--binding-mutation-step-budget-too-tight`)

**Evidence (re-verified).**
- `.github/workflows/verify-vectors.yml:512-523`: "Prove PSBT account-binding invariants by mutation" has
  `timeout-minutes: 8` around wallet-policy, psbt-account-binding:browser, psbt-account-binding, taproot-construction
  and taproot-artifact-finalization, all inside one `with-runner-lock.sh node-toolchain` wait.
- The job is `timeout-minutes: 30` (`:493`), with the comment "(10 + 8)" (`:491`).
- `tests/ci/check-workflow-composition.test.sh:1981-1985` pins `timeout-minutes: 8` ("PSBT account-binding mutation
  proof keeps its bound").
- The workflow is in `VERIFIER_SOURCE_FILES` (`scripts/verify-addresses/sourceManifest.ts:4`). Its bytes feed
  `VERIFIER_PROVENANCE.sourceSha256` in `scripts/verify-addresses/output/verified-vectors.ts:74` and
  `server/tests/fixtures/verified-address-vectors.ts:74`, both `088bca79…c07a`. That value is asserted by
  `tests/scripts/verifyAddressesGenerated.test.ts:35`.
- The run history in the packet (4 of the last 9 verify-vectors runs killed at 8:00) stands. Confirmed.

**Fix design.** D-12.C1.
- `:513` becomes `timeout-minutes: 15`.
- `:493` becomes `timeout-minutes: 35`.
- The `:491` comment becomes "(10 + 15)".
- No other edit to the workflow.

**Provenance regeneration (mandatory, same commit).**
- A workflow-only edit changes only the provenance hash; the vector data does not depend on the workflow bytes.
  PR #1375 (`53c530a46`) is the precedent: the same split-job workflow edit changed exactly one line in each output
  file.
- Run from the worktree root, with the worktree set up by root `npm ci` and the nvm Node 24 on `PATH`:
  ```bash
  NEW=$(./node_modules/.bin/tsx -e "import('./scripts/verify-addresses/generate-vectors.ts').then((m) => console.log(m.calculateSourceSha256()))")
  OLD=088bca79f04d605047b8c8913e046270eccbcd4da6926932e040d2df0112c07a
  sed -i "s/\"sourceSha256\": \"$OLD\"/\"sourceSha256\": \"$NEW\"/" \
    scripts/verify-addresses/output/verified-vectors.ts server/tests/fixtures/verified-address-vectors.ts
  git diff --stat -- scripts/verify-addresses/output/verified-vectors.ts server/tests/fixtures/verified-address-vectors.ts   # exactly 1 line each
  ```
  This calls the real `calculateSourceSha256()` (`scripts/verify-addresses/generate-vectors.ts:50-60`). It was checked
  read-only in the primary checkout: it prints the committed `088bca79…` for unchanged inputs.
- That the vectors are byte-identical apart from `sourceSha256` is proved by the PR's own verify-vectors run. The
  `verify-vectors` job's "Run cross-implementation address verifier" step (`verify-vectors.yml:270-286`) runs
  `npm run verify:repeatable` (`generate-vectors.ts --verify-only`). That regenerates the vectors with the pinned
  four-implementation stack and compares them with both committed files, including `sourceSha256`.
- The host-Docker full regeneration (`cd scripts/verify-addresses && npm run generate:repeatable`, documented in
  `docs/reference/ci-cd-strategy.md:163-173`) is **not** needed for a workflow-only edit, and the phase does not run
  it. If the PR's verifier step reports any vector diff other than `sourceSha256`, stop. That would mean the edit
  touched verifier semantics, and the coordinator decides on a supervised `generate:repeatable` run.

**Failing-first tests.**
- `tests/ci/check-workflow-composition.test.sh:1981-1985`: the needle becomes `timeout-minutes: 15`, and the label
  becomes "PSBT account-binding mutation proof has a contention-safe timeout". **Red on base:** the step says 8.
- Add one `assert_named_job_contains "$VV" "verify-vectors-mutation-binding" "binding mutation job outlasts its
  install and proof bounds" "timeout-minutes: 35"` next to it. **Red on base:** the job says 30.
- After the workflow edit and **before** the rehash, `tests/scripts/verifyAddressesGenerated.test.ts` ("is tied to the
  current verifier source") is red because `sourceSha256` drifted. It turns green after the rehash. This proves the pin
  was exercised.

**Confirm red first.**
```bash
bash tests/ci/check-workflow-composition.test.sh          # red on base: the two binding-bound assertions
# after the workflow edit, before the rehash:
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts   # red: sourceSha256
```

**Existing tests the fix breaks.**
- `check-workflow-composition.test.sh:1981-1985`: updated above.
- `tests/scripts/verifyAddressesGenerated.test.ts`: repaired by the rehash.
- Nothing else pins these two values:
  - `tests/ci/subject-budget-workflows.test.mjs` checks only steps that call `subject-budget.mjs`.
  - `tests/scripts/verifyPsbtProvenance.test.ts:63-80` asserts workflow content, not bytes.
  - `config/hardware-emulator-source-inventory.json` and `config/wallet-safety-critical-paths.json` list the
    workflow by path only.
- Editing the workflow triggers the full verify-vectors run on the PR, including the emulator lanes. Expected.

**Acceptance.**
- The binding step is bounded at 15 minutes and its job at 35.
- Both vector outputs differ from base only in `sourceSha256`.
- `verifyAddressesGenerated.test.ts` and `check-workflow-composition.test.sh` pass.
- The PR's `Verify Bitcoin Vectors / summary` is green. Record the five `time-command.sh` profile timings of the
  binding job in the PR body.

---

### Phase C2 — A step killed at its timeout is reported as interrupted, not as infrastructure (P2 `ci-diagnostics--breadcrumb-labels-step-timeout-as-post-verification-fault`)

**Evidence (re-verified).** `scripts/ci/write-empty-diagnostic-breadcrumb.sh`:
- `has_failed_sidecar` (`:52-71`) and `count_succeeded_sidecars` (`:79-100`) iterate only over `*.log.status.json`.
- `:117-131` writes "All N captured verification step(s) succeeded (wrapped_exit 0); this job failure is a
  post-verification runner/infrastructure fault -- not a proof regression" whenever N > 0.
- A `*.log` without a sidecar is never considered.
- `tests/ci/write-empty-diagnostic-breadcrumb.test.sh:112-143` (case 3) covers only a lone exit-0 sidecar. There is no
  case with a sidecar-less log.
- Run 21164 job 264922 (packet): the install step's sidecar (exit 0) plus a sidecar-less `psbt-account-binding-mutation.log`
  produced the infra wording. Confirmed by reading the code paths.

**Fix design.** D-12.C2.
- Extract the duplicated `sed` that reads `wrapped_exit` (`:61-64`, `:90-93`) into one `read_wrapped_exit
  STATUS_PATH`, reused by both existing functions.
- Add `list_incomplete_logs`. For each regular `*.log` under `$DIAGNOSTIC_DIR` (recursive, `find -print0`, sorted), it
  prints the path relative to the directory (`${path#"$DIAGNOSTIC_DIR"/}`) when `<log>.status.json` is missing or
  `read_wrapped_exit` is empty, **unless** a sibling `<stem>.status` exists (the `run-parallel-suites.sh` completion
  record for `<stem>.log`, `run-parallel-suites.sh:26-27`), in which case the log is finished.
- Capture `INCOMPLETE_LOGS="$(list_incomplete_logs)"` **before any write to `$DIAGNOSTIC_DIR`**, and branch on that
  variable; never call `list_incomplete_logs` inside the `cat >"$LOG_PATH" <<LOG` heredoc. The shell creates
  `$LOG_PATH` before it expands the heredoc (verified: `cat > x.log <<EOF` with `$(ls *.log)` prints `x.log`), so an
  inline call would list the breadcrumb's own sidecar-less log as "never finished".
- After the unchanged `has_failed_sidecar` early exit:
  1. If `$INCOMPLETE_LOGS` is non-empty, write this breadcrumb (pass 5: the heredoc is unquoted —
     `cat >"$LOG_PATH" <<LOG`, `write-empty-diagnostic-breadcrumb.sh:118,133` — so the text must be plain, with NO
     backticks: a backticked `$TITLE` or `timeout-minutes` is executed as a command substitution, prints "command not
     found", exits 0 and silently drops those words. Write it like the existing infra text, e.g.:)

         ${TITLE} failed with step log(s) that never finished: <list>. run-with-log.sh writes a sidecar when a
         wrapped command exits or is signalled, so a missing or unreadable one means the step was hard-killed while
         running, most often at its step timeout-minutes or the job deadline. Treat it as an interrupted step whose
         verification did not complete, not as a post-verification infrastructure fault. Compare the step's elapsed
         time with its timeout-minutes before any retrigger.
  2. Otherwise, if N > 0, write the existing infra text unchanged.
  3. Otherwise, write the existing generic text.
- The sidecar the breadcrumb writes is unchanged (`wrapped_exit: 1`).
- `.github/workflows/quality.yml:270`: `redact_file "$install_log" "$DIAGNOSTIC_DIR/npm-deprecation-install.log"` writes
  `npm-deprecation-install.redacted.txt` instead (D-12.C2 sweep), and the matching pin at
  `tests/ci/check-workflow-composition.test.sh:4077` is updated in the same commit.
- No new `rm` or `kill`. The script is not in any provenance manifest or emulator inventory (grep: none).

**Failing-first tests.** `tests/ci/write-empty-diagnostic-breadcrumb.test.sh` (172 lines) gains an
`assert_not_contains` helper (the mirror of `assert_contains`, `:53-62`) and five cases (three red, two guards):
1. **Run 21164 shape:** `install-server-dependencies.log` with an exit-0 sidecar, plus
   `psbt-account-binding-mutation.log` with no sidecar. Expected:
   - exit 0;
   - the breadcrumb contains `psbt-account-binding-mutation.log` and `never finished`;
   - it contains the case's title string and `timeout-minutes` (`assert_contains`; pass 5 — proves the plain-text
     wording survives the unquoted heredoc);
   - it does **not** contain `not a proof regression`;
   - it does **not** contain its own basename (`assert_not_contains` on
     `verify-vectors-mutation-binding-failure.log`, the breadcrumb log the case writes), so an incomplete list
     computed after the breadcrumb log exists fails;
   - its sidecar has `"wrapped_exit": 1`.

   **Red on base:** the infra wording is written.
2. A log whose sidecar has no `wrapped_exit` field. Expected: the interrupted wording. **Red on base:** the generic
   wording, without the log name.
3. A sidecar-less log in a nested directory (`diag/sub/step.log`) plus an exit-0 sidecar at the top. Expected:
   `sub/step.log` is listed. **Red on base.**
4. **Guard** (passes on base and after): an exit-0 sidecar plus a sidecar-less file that is not a step log
   (`npm-deprecation-install.redacted.txt`). Expected: the infra (#1009) wording, and no `never finished`.
5. **Guard** (passes on base and after; the `ci-classifier-tests` shape): an exit-0 sidecar plus `sub/0.log` with a
   sibling `sub/0.status` (the `run-parallel-suites.sh` layout, no sidecar). Expected: the infra (#1009) wording, and
   no `never finished`. Without the `.status` rule, the recursive `find` would list every suite log as hard-killed.

Existing cases 1–4 stay unchanged and green. Case 3 has a sidecar but no log file, so it still gets the infra wording.

**Confirm red first.** `bash tests/ci/write-empty-diagnostic-breadcrumb.test.sh` (red on base: new cases 1–3; guards 4 and 5
pass). After the `quality.yml:270` rename and before the pin update, `bash tests/ci/check-workflow-composition.test.sh`
fails on the `:4077` needle; it is green after the pin update.

**Existing tests the fix breaks.** `tests/ci/check-workflow-composition.test.sh:4077` pins the old
`npm-deprecation-install.log` `redact_file` line; it is updated with the rename. Case 3's assertions (`:141-142`)
hold, because no incomplete log exists there. The suite already has a `config/resource-lifecycle-callsites.json:2301` entry for its `mktemp`/`rm -rf`
pattern, and the new cases reuse `start_test` and `end_test_pass`.

**Acceptance.** A job whose wrapped step was hard-killed after a successful setup step gets a breadcrumb that names the
unfinished step log and never says "not a proof regression". Pure post-verification failures keep the #1009 wording,
including in `dependency-audit`, whose redacted install output is no longer a `*.log` (case 4 guards a sidecar-less
non-log file), and in `ci-classifier-tests`, whose `run-parallel-suites.sh` suite logs count as finished through their
sibling `.status` files (case 5).
`bash tests/ci/write-empty-diagnostic-breadcrumb.test.sh` passes, and it runs in `ci-classifier-tests`
(`quality.yml:821,961`), which a `scripts/ci/*` change selects.

---

### Phase C3 — The critical mutation gate re-proves kills when its tests change (P2 `ci-critical-mutation--incremental-cache-blind-to-contract-files`)

**Evidence (re-verified).**
- `server/stryker.critical.config.mjs:150-151` sets `incremental: true` with a per-shard `incrementalFile`.
- `.github/workflows/test.yml:1324-1339` restores `server/.stryker-cache`. The key hashes only the mutated sources,
  `shards.mjs` and the config, and the `restore-keys` prefix (`:1338-1339`) falls back to the newest cache for the
  layout.
- The assertions live in unrecorded contracts files: `psbtValidation.test.ts` registers the five
  `psbtValidation/*.contracts.ts`, and `middleware/auth.test.ts` imports `auth/*.contracts.ts`. The packet's
  incremental-file inspection stands.
- `is_critical_mutation_file` (`scripts/ci/classify-files-lib.sh:206-213`) lists neither directory, and it lists only
  two of the six `transactionsHttpRoutes` contracts.
- No `--force` exists. Confirmed.
- My import walk (61 reachable test-tree files, 42 unclassified inputs, including the two `@fixtures/` imports of
  `psbt.verified.test.ts`) is described in D-12.C4.

**Fix design.** D-12.C3 and D-12.C4.

Files:
- `server/stryker.critical.config.mjs`: `incremental: false`; drop `incrementalFile` and the
  `shardIncrementalFileName` import; `buildCriticalTestCommand` maps `CRITICAL_TEST_FILES`.
- `server/scripts/mutation/shards.mjs`: export `CRITICAL_TEST_FILES` (the 24 paths, unchanged order); remove
  `shardIncrementalFileName`.
- `scripts/ci/check-critical-mutation-config.mjs`:
  - remove the incremental-path check;
  - add `assertNonIncrementalCriticalConfig(config)`, which throws `critical mutation configuration: the critical gate
    must not reuse incremental results` when `config.incremental !== false` or `'incrementalFile' in config`;
  - add `criticalTestInputs()` and `unclassifiedCriticalTestInputs()`;
  - `checkCriticalMutationConfig(root = REPO_ROOT, config = criticalConfig, listUnclassified =
    unclassifiedCriticalTestInputs)` calls `assertNonIncrementalCriticalConfig(config)` and fails on a non-empty
    `listUnclassified()`, both BEFORE `readBaseline(root)` (pass 16: placed after it, the four
    `/serverCritical baseline … invalid/` cases keep throwing their own message and commit 1 measures 14 pass / 2 fail
    instead of the recorded count) (pass 15: injected so a wiring case can prove the CLI path runs both checks). The default
    `criticalConfig` is the critical config, which the checker loads with a
    **static top-level** `import` (no dynamic `await import`), so the function stays synchronous and the five existing
    `assert.throws`/`assert.doesNotThrow` cases (`tests/ci/check-critical-mutation-config.test.mjs:21-90`) keep
    working. `criticalTestInputs()` and `unclassifiedCriticalTestInputs()` resolve against `REPO_ROOT` (like
    `sourceRoot`, `:87`), not the `root` argument, because those cases pass a temp fixture root that holds only
    `.github/mutation-baseline.json`. The walker drops non-`server/tests/` specifiers before resolving (D-12.C4), so
    the untracked `server/src/generated/prisma/client` is never required.

    Importing the config is already done by `tests/ci/check-critical-mutation-config.test.mjs:12`. Its only side effect
    is defaulting `SANCTUARY_SHARED_DIST` in the checker's own process.
- `.github/workflows/test.yml`: delete `:1324-1339`, the comment and the restore step.
- `scripts/ci/classify-files-lib.sh`: the additive patterns in D-12.C4.
- `docs/reference/ci-cd-strategy.md`: one sentence next to `:368`: "The critical mutation gate runs non-incrementally,
  so a change to a killing test is re-proved (D-12.C3)."

All new functions stay under the lizard thresholds (`lizard -C 15 -T nloc=200` → zero new warnings).

**Failing-first tests.**
- `tests/ci/check-critical-mutation-config.test.mjs` (145 lines). The new checker exports
  (`assertNonIncrementalCriticalConfig`, `criticalTestInputs`, `unclassifiedCriticalTestInputs`) are read through
  `import * as checker from …` — never added to the named imports at `:8-11` (pass 14: a named import of a missing export
  fails to link on base, `does not provide an export named 'assertNonIncrementalCriticalConfig'`, pass 0 / fail 1, so the
  five existing temp-root cases go red with it and the stated base reds never show). Base: 12 pass / 4 fail, each for its
  stated reason:
  - **"the critical gate never reuses incremental results"**: imports `server/stryker.critical.config.mjs` default and
    asserts `config.incremental === false` and `!('incrementalFile' in config)`. **Red on base:** `incremental: true`.
  - A case that runs `checker.assertNonIncrementalCriticalConfig({ incremental: true })` and `({ incremental: false,
    incrementalFile: 'x' })` and expects both to throw matching `/must not reuse incremental results/` (pass 14: a bare
    `assert.throws` is satisfied on base by the TypeError from calling `undefined`). **Red on base:** the message does
    not match (`checker.assertNonIncrementalCriticalConfig is not a function`).
  - **Wiring case (pass 15)** on a valid-baseline `fixtureRoot`:
    `assert.throws(() => checkCriticalMutationConfig(root, { incremental: true }, () => []), /must not reuse incremental results/)`
    and `assert.throws(() => checkCriticalMutationConfig(root, { incremental: false }, () => ['server/tests/x.ts']),
    /server\/tests\/x\.ts/)`. Without it, a checker that never calls `assertNonIncrementalCriticalConfig` or
    `unclassifiedCriticalTestInputs` passes every other case while the CLI exits 0 with `incremental: true` restored or
    a classifier pattern dropped. **Red on base:** `Missing expected exception` (base ignores the extra arguments).
    Prototyped: base red, correct fix 16 pass / 0 fail, unwired variant red.
  - **"every test input of the critical entries selects the critical lane"**: asserts
    `unclassifiedCriticalTestInputs()` is `[]`, and that `criticalTestInputs()` includes
    `server/tests/unit/services/bitcoin/psbtValidation/psbtValidation.payjoin.contracts.ts` and
    `server/tests/unit/middleware/auth/auth.authenticate.contracts.ts` and `server/tests/fixtures/generated-psbt-vectors.ts`
    (reached only through the `@fixtures/` alias), so a walker that drops imports fails.

    **Red on base**, in two commits on the branch: (1) the walker and test land first, and the test fails listing
    exactly the 42 paths of D-12.C4; (2) the classifier edit turns it green. Record both outputs in the PR body.
    At commit 1 (walker, no classifier) the five existing temp-root cases go red too, because
    `checkCriticalMutationConfig` now fails on the non-empty unclassified list: the measured run is 10 pass / 6 fail
    (those five plus the walker case; the wiring case passes at commit 1 because it injects its own config and list —
    pass 16: 9/6 was the pre-wiring-case 15-case count). That is the expected commit-1 red, not a regression; commit 2 turns all 16
    green.
- `tests/ci/classify-test-changes.test.sh` (901 lines; ≤ 1000 after the edit): one loop, using the existing
  fixture-commit pattern of the `critical_mutation_changed` assertions at `:440-543`. Each of the following yields
  `critical_mutation_changed=true` (**red on base**):
  - `server/tests/unit/services/bitcoin/psbtValidation/psbtValidation.payjoin.contracts.ts`
  - `server/tests/unit/middleware/auth/auth.authenticate.contracts.ts`
  - `server/tests/unit/services/bitcoin/transactionServiceBroadcast/transactionServiceBroadcast.errors.contracts.ts`
  - `server/tests/unit/api/transactionsSigningIntentBroadcast.retry.test.ts`
  - `server/tests/mocks/prisma.ts`
  - `server/tests/setup.ts`
- `tests/ci/plan-test-run.test.sh` (558 lines): one case, following `:305-317`. A commit that touches only
  `server/tests/unit/middleware/auth/auth.authenticate.contracts.ts` gives `lanes.critical_mutation.run == true`.
  **Red on base.**
- `tests/ci/check-workflow-composition.test.sh:2508-2522`: replace the two cache assertions with:
  - `assert_not_contains "$TEST_WORKFLOW" "critical mutation shards never restore an incremental cache" "server/.stryker-cache"`;
  - the same assertion for `Restore Stryker incremental cache`.

  **Red on base.** The comment above becomes "The critical gate is non-incremental (D-12.C3); PR #1377's
  layout-prefix problem no longer applies."

**Confirm red first.**
```bash
node --test tests/ci/check-critical-mutation-config.test.mjs
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/check-workflow-composition.test.sh
node scripts/ci/check-critical-mutation-config.mjs     # after the walker lands, before the classifier edit: lists the 42 paths
# once, in a tree without server/src/generated (as both CI lanes run it), e.g. a scratch worktree under /home/nekoguntai
# with root npm ci but no prisma generate: the checker must not throw on the generated-client imports
node scripts/ci/check-critical-mutation-config.mjs
```

**Existing tests the fix breaks.**
- `check-workflow-composition.test.sh:2508-2522`: replaced above.
- `check-critical-mutation-config.mjs:111-113`: the incremental-path check is removed with the export.
- No other consumer of `shardIncrementalFileName`, `.stryker-cache` or `buildCriticalTestCommand` exists (grep:
  `scripts`, `tests`, `server/tests`, `.github`).
- `classify-test-changes.test.sh:117-153` (`assert_every_test_workflow_script_is_classified`) is unaffected: the
  predicate only grows.

**Acceptance.**
- A PR that edits only a critical contracts or helper file runs Full Critical Mutation. Every run executes all mutants
  with no cache restore.
- The quick lane fails if a critical test gains an unclassified test-tree import, or if incremental mode returns:
  `checkCriticalMutationConfig` runs both checks on the CLI path, proven by the injected-config wiring case.
- The checker runs green in a tree without `server/src/generated` (recorded once by the C worker), and the five
  existing temp-root cases of `check-critical-mutation-config.test.mjs` stay synchronous and green.
- Record the PR's three shard wall times (cold) in the PR body. Each must be well under the 60-minute job bound.

---

### Phase C4 — Negative assertions in shell suites fail their tests (P2 `install-unit-tests--negated-assertions-ignored-by-errexit`)

**Evidence (re-verified).**
- `tests/install/unit/grafana-quiescence.test.sh` runs `set -euo pipefail` (`:3`) and calls each `test_*` directly at
  top level (`:1397-1435`).
- Inert non-final negations: 643, 664, 665, 676, 734, 818, 844, 875, 931, 932-933, 944, 945, 969, 1002, 1014, 1043,
  1158, 1179, 1294. That is 19, matching the packet.
- Loop-final checks: 756, 876, 957, 1015, 1044 (5). Each `done` is the function's last statement, so only the last
  iteration counts.
- Function-final negations, which work today: 735, 745, 835, 946, 988, 1003, 1151, 1164.
- `:898` already uses `! … || {` (correct).
- `tests/install/unit/grafana-password-migration.test.sh:100` is non-final.
- `tests/ci/pre-commit-agent-gate.test.sh:138` sits in the `OK` branch of a `for rubric in OK BLOCK` loop inside a
  `set -eu` heredoc script (`:123-150`). It is followed by `else`, so it never decides anything.
- Neither grafana suite sources `tests/install/utils/helpers.sh` or `assertion-tracking.sh`.
- Prototype of the D-12.C5 rule over `git ls-files '*.test.sh'` at `51b0b69af0`: **43 violations**:

  | File | Lines |
  | --- | --- |
  | `grafana-quiescence.test.sh` | 32 |
  | `relay-job-diagnosability.test.sh` | 59, 98, 111, 115 (function-final) |
  | `upgrade-helpers.test.sh` | 2577, 2600, 2635 (subshell-final) |
  | `optional-stack-lifecycle.test.sh` | 323 (function-final) |
  | `isolated-subject-drivers.test.sh` | 38 (final statement of a `bash -c` body) |
  | `grafana-password-migration.test.sh` | 100 |
  | `pre-commit-agent-gate.test.sh` | 138 |

  `compose-operator-env.test.sh:127,160,164` and `classify-test-changes.test.sh:131,145` already use `|| …` and are
  allowed. Confirmed.

**Fix design.** D-12.C5.
- **Rewrites (behaviour preserved or fixed):**
  - All 32 `grafana-quiescence.test.sh` lines become `if <cmd>; then echo 'FAIL: <property>' >&2; return 1; fi`.
    Pipelines stay whole (`if find … | grep -q .; then …`), with the same `pipefail` semantics as the `!` form. The
    loop checks return from inside the loop, so every iteration is checked.
  - `grafana-quiescence.test.sh:1175`: insert `: > "$TEST_ROOT/docker.log"` immediately before the second
    `run_helper success` in `test_client_disconnect_requires_scoped_terminal_outcome`, then convert `:1179`. This is
    the recorded D-12.X5 class (b) fix: the log still holds the first `client-disconnect` run's legitimate
    `compose … stop grafana`, so the converted check would fail on a stale line (prototyped: without the clear the
    converted suite exits 1 at `:1179`; with it the suite passes).
  - `grafana-password-migration.test.sh:100`: same form.
  - `pre-commit-agent-gate.test.sh:138`: `if verdict_blocks_commit "$verdict"; then printf '%s\n' 'OK rubric blocked
    the commit' >&2; exit 1; fi` (heredoc `sh` script, so `exit`).
  - `relay-job-diagnosability.test.sh:59-64,98,111,115`: `if …; then return 1; fi`.
  - `upgrade-helpers.test.sh:2577,2600,2635`: `if …; then exit 1; fi` (subshell bodies).
  - `optional-stack-lifecycle.test.sh:323`: `if …; then return 1; fi`.
  - `isolated-subject-drivers.test.sh:38`: `if grep -q unbounded "$JOB_LOG_DIR/container-logs.log"; then exit 1; fi`
    (inside the single-quoted `bash -c` body, so no single quotes).
- No `rm`, `kill` or docker operation is added. `kill -0` at `:818` stays a probe. The per-file lifecycle registry
  entries (`config/resource-lifecycle-callsites.json:1923,1986,2434,2441,2448,2483,2511`) are unaffected.
  `grafana-quiescence.test.sh` (1437 lines) is a shell file, and `scripts/quality/check-large-files.mjs:41` scans only
  JS/TS.
- **Guard:** `scripts/ci/check-negated-test-assertions.mjs` (new, `isMainModule` guard from
  `scripts/lib/is-main-module.mjs`) exports:
  - pure `findNegatedAssertionViolations(text)`, returning the 1-based start lines;
  - `listRepositoryViolations(root)`, which runs `git -C root ls-files '*.test.sh'`.

  Run as a CLI, it prints `file:line` for each violation and exits 1 if there is any.
- `quality.yml`:
  - a step "Check negated shell test assertions" (`node scripts/ci/check-negated-test-assertions.mjs`, wrapped in
    `run-with-log.sh` like `:1180-1183`) in the `large-file-classification` job;
  - `node --test tests/ci/check-negated-test-assertions.test.mjs` in the `ci-classifier-tests` list next to `:841`.
- **Interaction with iteration 11's `tests/install/utils/assertion-tracking.sh`:**
  - That helper fixes a different mechanism: `run_test` suites that run bodies with errexit off and keep only the last
    status (D-11.14). The grafana and pre-commit suites run under errexit with direct calls, and abort on the first
    explicit `return 1`, so they are fail-closed once the `!` forms are gone. They are **not** moved onto
    `install_test_run_function`.
  - The guard also covers the four D-11.14 suites. Their assertions use `assert_*` helpers that record failures, and
    the only leading-`!` lines among them are `upgrade-helpers.test.sh:2577,2600,2635`, which are rewritten here.
  - The iteration-11 static wiring check in `tests/install/unit/install-assertion-tracking.test.sh` is unaffected:
    no `run_test` body or `assert_*` definition changes.

**Failing-first tests.**
- New `tests/ci/check-negated-test-assertions.test.mjs` (`node:test`, no temp dirs, no `rm`):
  1. `findNegatedAssertionViolations` flags `! grep -q x f` followed by another statement, a loop-final `! grep` before
     `done`, `! a | b`, and a heredoc-body `! cmd`. It also flags these indented forms, each asserted with its expected
     1-based line number (pass 8: all 43 real violations are indented, so a guard anchored at `/^!\s/` instead of
     `/^\s*!\s/` would pass column-0 fixtures, and after conversion case 3 would pass vacuously):
     - an indented line in a function body: `f() {\n  ! grep -q x f\n  echo next\n}` (line 2);
     - a tab-indented `! cmd` line;
     - a `! cmd` on its own line inside a `then` body, followed by another statement before `fi`;
     - an indented loop-final `! grep` before `done`.
  2. It accepts `! cmd || fail x`, `! cmd \` + `  || fail x`, `if ! cmd; then`, `[ ! -f x ]` and `[[ ! … ]]`.
  3. `listRepositoryViolations(REPO_ROOT)` deep-equals `[]`.

  **Red on base:** the module does not exist. Once it lands, case 3 fails listing exactly the 43 lines above. Record
  that output, then convert.
- Behavioural proof (recorded, not committed), in a scratch git worktree under `/home/nekoguntai` (memory:
  long-lived worktrees not in `/tmp`):
  1. Prepend `[ "${SANCTUARY_INSTALL_MODE:-}" = offline ] || docker pull "$resolved_image" >/dev/null 2>&1 || true`
     to `resolve_migration_image` in `scripts/ops/run-grafana-password-migration.sh` (`:90-99`).
  2. Run `bash tests/install/unit/grafana-quiescence.test.sh` with the base test file. Expected: exit 0. The online
     `! grep -Eq '^pull '` at `:1158` is inert, and the offline check at `:1164` does not fire.
  3. Run it with the converted test file (including the `:1175` log clear). Expected: non-zero, with
     `test_online_and_preloaded_offline_helpers_never_pull` failing at its converted `:1158` check; the recorded output
     must show that test and line. A non-zero exit from `:1179` (`test_client_disconnect_requires_scoped_terminal_outcome`)
     does not count: it means the class (b) log clear is missing, and the proof is non-zero for the wrong reason.
     Without the mutation the converted suite exits 0.

  If the mutation breaks an unrelated base test, record which one and use the `:844` property instead: add
  `docker volume rm "$resolved_data_volume" >/dev/null 2>&1 || true` after the lost-create recovery message in the
  same helper.

**Confirm red first.**
```bash
node --test tests/ci/check-negated-test-assertions.test.mjs     # red on base (module missing), then lists 43 lines
node scripts/ci/check-negated-test-assertions.mjs               # exit 1, 43 file:line entries
# after conversion (with the :1175 docker.log clear, D-12.X5 class (b)), the suites stay green:
bash tests/install/unit/grafana-quiescence.test.sh     # red at :1179 if the clear is missing
bash tests/install/unit/grafana-password-migration.test.sh
bash tests/install/unit/optional-stack-lifecycle.test.sh
bash tests/install/unit/upgrade-helpers.test.sh
bash tests/ci/pre-commit-agent-gate.test.sh
bash tests/ci/relay-job-diagnosability.test.sh
bash tests/ci/isolated-subject-drivers.test.sh
bash scripts/ci/run-install-unit-tests.sh
bash tests/ci/ci-registration-completeness.test.sh
node scripts/ownership/check-lifecycle-callsites.mjs
```

**Existing tests the fix breaks.**
- `grafana-quiescence.test.sh` `test_client_disconnect_requires_scoped_terminal_outcome`: converting `:1179` unmasks a
  stale assertion (the second `run_helper success` at `:1175` reads a `docker.log` that still holds the first
  `client-disconnect` run's legitimate `compose … stop grafana`). It is a D-12.X5 class (b) fix, recorded here, in the
  C4 commit body, in the PR body and in Completion: `: > "$TEST_ROOT/docker.log"` before `:1175`. Without it this
  suite, `scripts/ci/run-install-unit-tests.sh` and the Verification block go red.
- No other suite breaks (prototyped after converting all 43 lines: grafana-password-migration,
  optional-stack-lifecycle, upgrade-helpers 100/100, pre-commit-agent-gate, relay-job-diagnosability,
  isolated-subject-drivers, check-workflow-composition with the C4 `quality.yml` step, ci-registration-completeness and
  the lifecycle checker are green). Every other rewrite is a pure equivalent or a strengthening.

If a converted check now fails because the subject really does the forbidden action, handle it per D-12.X5 (the D-11.15 rule):
report it to the coordinator with the failing property, write the non-regression test first, and fix the subject in
this phase only if it is inside the owned files. Otherwise it becomes a new finding.

`tests/ci/check-workflow-composition.test.sh` asserts `quality.yml` structure. Re-run it after adding the step.

**Acceptance.**
- Every negative assertion in the seven suites can fail its test.
- The guard fails CI on any new leading-`!` statement without `||` in a `*.test.sh`, and it runs on every non-docs PR.
- The behavioural proof shows a forbidden action that base misses and the patched suite catches, failing at `:1158`
  (`test_online_and_preloaded_offline_helpers_never_pull`), not at `:1179`.
- The `:1179` stale-log assertion is fixed by the `:1175` `docker.log` clear (D-12.X5 class (b)) and passes.
- All listed suites pass.

---

### Phase C5 — The canary receipt is bound to the images actually running (P2 `rc-canary--deployed-revision-not-bound-to-receipt`)

**Evidence (re-verified).**
- `scripts/release/canary/canary-probe.mjs:34-35` reads `TAG`/`COMMIT` from env only.
- `:350` builds `hostImages` from `inspectContainer` (`lib/canary-runtime.mjs:347-360`: `c.Image`, no labels).
- `:351` and `:370` copy `{ tag: TAG, commit: COMMIT }` and `imageIds` into the attestation and the receipt (`schemaVersion` literal
  `…v2`, `:369`).
- `grep -n 'revision\|Labels'` finds nothing in the probe or the lib.
- `scripts/release/verify-release-candidate-canary.mjs`:
  - `validateReleaseCandidateShape` (`:290-300`) checks `imageIds` only for shape and uniqueness;
  - `validateIdentity` (`:71-93`) compares the self-reported tag and commit;
  - `parseArguments` (`:467-486`) has no image input.
- The runbook step "Confirm the deployed tag and full commit SHA match the accepted RC"
  (`docs/how-to/release-candidate-canary.md:150`) is manual.
- Labels are already set: see D-12.C6. Confirmed.

**Fix design.** D-12.C6.
- `verify-release-candidate-canary.mjs`:
  - New exported constants: `CANARY_RECEIPT_V3_SCHEMA_VERSION = 'sanctuary.release-candidate-canary.v3'` and
    `CANARY_ATTESTED_SERVICES = ['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy']` (the probe's set,
    `:350`).
  - A schema generation number replaces the `v2` boolean. `v2` means generation ≥ 2, so every v2 rule applies to v3.
    All five v2-only sites are converted (missing one lets a v3 receipt skip that rule while case 1 still passes):
    - `:72`, the supported-version list (adds v3);
    - `:161`, `validateWindow` (`completedAt - startedAt` ≥ the claimed probe window), written
      `=== CANARY_RECEIPT_V2_SCHEMA_VERSION`;
    - `:327` and `:372`, the `v2` locals in the shape and receipt validators;
    - `:482`, `verifyReleaseCandidateCanary`'s raw-evidence sha256/bytes identity check, written
      `=== CANARY_RECEIPT_V2_SCHEMA_VERSION`.
  - `requiresV2Receipt` (`:95-104`) is generalized to `tagAtLeast(tag, [major, minor, patch])`, keeping its
    numeric tuple comparison over the parsed integer components (the first differing component decides — never a
    string comparison, which would order `0.10.0` before `0.9.0` and `0.8.100` before `0.8.78`; a component-wise `>=` on every part would treat
    `v0.9.0-rc1` and `v1.0.0-rc1` as below v0.8.78 and switch the binding off at the next minor). Tags `≥ v0.8.78`
    require v3 and get `'v0.8.78 requires a v3 canary receipt'`. This is checked before the v0.8.69 rule, so a v1 receipt
    for `v0.8.78-rcN` gets the v3 message.
  - `validateReleaseCandidateShape`: for v3 the keys are `tag`, `commit`, `imageIds` and `images`. `images` must be an
    array with exactly one `exactKeys(['service', 'imageId', 'revision'])` entry per attested service, with no
    duplicates or extras. `imageId` must match `IMAGE_ID_PATTERN` and `revision` must match `COMMIT_PATTERN`. The
    members of `imageIds` must equal the unique set of `images[].imageId`.
  - `validateIdentity`: for v3, every `images[].revision` must equal `expected.commit`, or it throws `'canary receipt
    images were not built from the release candidate commit'`.
  - The CLI arguments are unchanged.
- `lib/canary-runtime.mjs`:
  - Import `CANARY_ATTESTED_SERVICES` from the verifier. It has no side effects; `main()` is guarded at `:533`.
  - Add a pure exported `deployedRevisionProblems(images, commit)` that returns readable problems: missing service,
    empty or unlabelled revision, revision ≠ commit, or an invalid `commit`.
  - Add a pure exported `deployedImageDriftProblems(deployed, attested)` that returns one readable problem per service
    whose `imageId` differs between the two lists, or that is missing from `attested`, each naming the service.
  - Add a pure exported `attestationProblems(deployed, attested, commit)` that returns
    `[...deployedRevisionProblems(attested, commit), ...deployedImageDriftProblems(deployed, attested)]`. The probe's
    attestation exit is gated on it, so a drift problem cannot be computed and then only recorded as a warning.
  - Add a runtime `attestDeployedImages()` as a member of the object `createCanaryRuntime` (`:323`) returns (next to
    `docker`, `inspectContainer`, …), because it needs the closures `docker`, `inspectContainer` and `project`; the
    probe destructures it from the runtime. For each service it calls `inspectContainer(`${project}-${service}-1`)`,
    then `docker('image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', imageId)`
    with `imageId` the container's `c.Image` (never the image tag or name, which reads a rebuilt-but-not-restarted
    image's label), and `.trim()`s the output (an untrimmed `"<sha>\n"` never equals `CANARY_COMMIT`). It returns
    `{ service, containerId, imageId, revision, status, restartCount, health }`.
  - This is a read-only docker call: no `rm`/`stop`/`kill`, so it is outside the lifecycle registry's patterns
    (`scripts/ownership/check-lifecycle-callsites.mjs:320-325`).
- `canary-probe.mjs`:
  1. Right after `createCanaryRuntime(...)` (`:62-69`), before backend discovery, seeding and arming:
     `const deployed = await attestDeployedImages()`. If `deployedRevisionProblems(deployed, COMMIT)` is non-empty,
     print `canary refused: the running stack was not built from CANARY_COMMIT: …` and exit 2. Otherwise
     `record({ type: 'deployed_revision', images: … })`.
  2. At attestation (`:350`, after `type: 'armed'`), a second call `hostImages = await attestDeployedImages()`. If
     `attestationProblems(deployed, hostImages, COMMIT)` is non-empty (a revision mismatch, or the stack was swapped
     mid-run), record a `refusal` event and exit 2 **before** `receipt.json` is written (`:403`). The probe calls
     `deployedImageDriftProblems(` nowhere outside `attestationProblems`.
  3. The receipt uses `schemaVersion: CANARY_RECEIPT_V3_SCHEMA_VERSION` (imported) and
     `releaseCandidate.images = hostImages.map(({ service, imageId, revision }) => …)`, built from the attestation-time
     `hostImages`, never from the startup `deployed` list.
  4. The header comment (`:2`) names v3.
- `promote-release.sh` and `publish-release.sh`: no change. They already pass `--commit "$RELEASE_COMMIT"`, and the
  verifier now enforces the binding.
- `docs/how-to/release-candidate-canary.md`:
  - step 1 (`:150`) says the probe now enforces this and refuses before arming;
  - the receipt section (`:175-190`) documents v3 and the v0.8.78 requirement;
  - add one line: rebuild the stack from a clean checkout of the RC commit before running the canary.

**Failing-first tests.**
- Both test files read the new symbols through namespaces (pass 11): the verifier's new exports
  (`CANARY_RECEIPT_V3_SCHEMA_VERSION`, `CANARY_ATTESTED_SERVICES`) via `import * as verifier from …`, and the new
  runtime exports and members via `runtime.*`, the pattern `canary-probe-tooling.test.mjs:21-23` already prescribes.
  Named imports of a missing export make the whole file fail to link on base (`does not provide an export named
  'CANARY_ATTESTED_SERVICES'`, pass 0 / fail 1), so every case goes red for the wrong reason and guard case 5 goes red
  too. The recorded base red run shows each case's stated message and case 5 green, never a link error.
- `tests/release/release-candidate-canary.test.mjs` (457 lines) declares a test-local literal
  `SERVICES = ['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy']` and gains a `validV3Receipt(rawEvidence)`
  helper (v2 plus `images` built from that literal `SERVICES`, revision `COMMIT`, tag `V3_TAG = 'v0.8.78-rc1'`). Neither
  the helper nor any case reads `verifier.CANARY_ATTESTED_SERVICES` (pass 12: it is `undefined` on base, so iterating or
  mapping it throws a TypeError before the verifier is called, and a `?? []` fallback makes case 2 vacuous); only
  `verifier.CANARY_RECEIPT_V3_SCHEMA_VERSION` is read through the namespace (on base it is `undefined`, which
  `JSON.stringify` drops, so the base red is the stated exact-keys message). A four-service constant then also fails
  case 1 ("release candidate images are invalid"). These cases:
  1. **Accepts a v3 receipt whose images were built from the RC commit**, through `verifyReleaseCandidateCanary` with
     evidence. **Red on base:** rejected by the v1/v2 exact-keys check (`:328-332`, "canary receipt has an invalid
     schema"); `validateShape` (`:373`) runs before `validateIdentity` (`:374`), so the unsupported-version message is
     never reached.
  2. **Rejects a v3 receipt with one image revision ≠ the commit**, iterating the test-local literal `SERVICES`:
     each sub-case mismatches exactly one service's revision and is rejected matching `/not built from the release
     candidate commit/` (pass 8: a check of only `images[0]` or only `backend` passes a fixture that mismatches the
     first entry). **Red on base:** rejected by the v1/v2 exact-keys check ("canary receipt has an invalid schema").
  3. **Rejects a v2 receipt for `v0.8.78-rc1`, `v0.9.0-rc1`, `v1.0.0-rc1`, `v0.10.0-rc1` and `v0.8.100-rc1`** (all
     match `RC_TAG_PATTERN`, `:32`), each matching `/v0\.8\.78 requires a v3 canary receipt/` (pass 9: a
     component-wise `tagAtLeast` passes cases 3 and 5 on v0.8.78/v0.8.77 alone but accepts v2 at the next minor or
     major; pass 10: a string-compare `tagAtLeast` passes the first three and accepts v2 for `v0.10.0-rc1` and
     `v0.8.100-rc1`). **Red on base:** each is accepted.
  4. **Rejects v3 shape drift:** a missing service, a duplicate service, an extra key in an image entry, a non-hex
     revision, and `imageIds` disagreeing with `images`. Each expects the v3 shape or images error. **Red on base:**
     rejected by the v1/v2 exact-keys check ("canary receipt has an invalid schema"), a different message.
  5. **v2 for `v0.8.77-rc1` and the existing `V2_TAG` still verify.** Green on base; this is a guard against breaking
     the published v0.8.77 receipts.
  6. **v3 keeps the raw-evidence identity rule (`:482`):** a valid v3 receipt verified with evidence bytes that do not
     match its recorded sha256/bytes is rejected, matching `/canary raw evidence identity mismatch/`. **Red on base:**
     rejected by the v1/v2 exact-keys check ("canary receipt has an invalid schema").
  7. **v3 keeps the window rule (`:161`):** a v3 receipt with `completedAt - startedAt < probeWindowMs` is rejected,
     matching `/shorter than the claimed probe window/`. **Red on base:** rejected by the v1/v2 exact-keys check
     ("canary receipt has an invalid schema").
- `tests/release/canary-probe-tooling.test.mjs` (459 lines) declares the same test-local literal
  `SERVICES = ['backend', 'worker', 'frontend', 'gateway', 'llm-egress-proxy']`; cases 1, 1b and 1c build their image
  lists from and iterate that literal, and only case 3 reads `verifier.CANARY_ATTESTED_SERVICES` (pass 13: it is
  `undefined` on base, so a fixture that maps it throws `Cannot read properties of undefined (reading 'map')` before the
  runtime call and the stated "export is missing" reason never appears; a `?? []` fallback empties case 1's sub-loop):
  1. **`deployedRevisionProblems`:** all five services matching gives `[]`; a revision mismatch, iterated over the
     literal `SERVICES` with exactly one service mismatched per sub-case, gives a problem naming that service;
     a missing service, an empty revision or a short commit each give a problem naming the service. **Red on base:**
     the export is missing (`runtime.deployedRevisionProblems is not a function`).
  1b. **`deployedImageDriftProblems`:** identical lists give `[]`; a changed `imageId` on one service, and a service
     missing from `attested`, each give a problem naming that service. **`attestationProblems`:** a drift-only input
     (every revision equals the commit, one service's `imageId` changed) gives a non-empty result naming that service;
     a revision-only mismatch also gives a non-empty result. Fixtures are built from the literal `SERVICES`. **Red on
     base:** the exports are missing (`runtime.deployedImageDriftProblems is not a function`).
  1c. **`attestDeployedImages()` reads each running container's image label.** A fake `docker` script on `PATH` in a
     `mkdtempSync` dir (the suite already mkdtemps at `:243` with no `rm`; the case adds no `rm` or `kill` callsite),
     plus an env file with `JWT_SECRET` and `WORKER_DIAGNOSTICS_SECRET`, passed to `createCanaryRuntime`. The fake
     answers `inspect p-<service>-1` with a distinct image id per service (`idOf(service)`, for example `sha256:` + the
     service's index repeated 64 times); `image inspect … idOf(service)` prints a distinct `revOf(service)` + `\n`, and
     any other argument prints a different commit. Assert all five entries project to
     `[service, idOf(service), revOf(service)]`, with the service order checked against the literal list
     `['backend','worker','frontend','gateway','llm-egress-proxy']` (the same literal as case 3, never
     `CANARY_ATTESTED_SERVICES` itself). **Red on base:** the member is missing. Prototyped: green on a
     correct implementation, red without `.trim()`, red when inspecting by image name instead of `c.Image`, and
     (pass 10) red when one label is read once (for example from the backend image) and stamped on all five entries,
     which a shared image id would let pass.
  2. **The probe refuses a foreign build before seeding**, using the `at()` ordering pattern of `:203-210`. The source
     calls `deployedRevisionProblems(` before `canary-fleet.mjs … seed` and before `type: 'armed'`; the receipt uses
     `CANARY_RECEIPT_V3_SCHEMA_VERSION`; there is no `'sanctuary.release-candidate-canary.v2'` literal in the probe.
     It also asserts that a second `attestDeployedImages()` call and the `attestationProblems(` check come
     after `type: 'armed'` and before the `receipt.json` write (`canary-probe.mjs:403` at base), and that
     `releaseCandidate.images` is built from `hostImages`. It also asserts that each refusal exits before proceeding
     (pass 9: recording a refusal without exiting passes the call-order checks): the first `process.exit(2)` after
     `deployedRevisionProblems(` comes before `containerIps(\`${PROJECT}-backend-1\`)` (`:85` at base), and the first
     `process.exit(2)` after `attestationProblems(` comes before the `receipt.json` write, and `deployedImageDriftProblems(`
     does not appear in the probe source (it is reached only through `attestationProblems`; pass 10: computing the drift
     and only recording it as a warning passes the other checks, because the first exit after it is the revision exit).
     Case 2 first asserts `check > 0` (the startup `deployedRevisionProblems(` call is found) and `gate > 0` (the
     `attestationProblems(` gate is found) before any position comparison (pass 15: with `check === -1`,
     `check < seed && check < armed` passes on a probe with no startup check, and `indexOf('process.exit(2)', -1)` finds
     the base exit at `canary-probe.mjs:48`, before `:85`, so the bounded exit passes too — prototyped green with the
     startup check deleted, red only once `check > 0` is required, the correct probe green under both).
     Both exit checks must find the exit AND place it between the anchors — `const e = probe.indexOf('process.exit(2)',
     gate); assert.ok(gate > 0 && e > gate && e < receiptWrite)`, and likewise `check > 0 && e > check && e <
     containerIpsAnchor` for the startup check (pass 14: with `indexOf` alone, a probe that records the refusal and drops the exit makes `indexOf` return -1
     and `-1 < receiptWrite` passes — prototyped: the record-but-continue probe was 50/50 green; with the bounded form it
     is red, as is the startup variant, and the correct probe is green). The base probe exits only at `:48`, `:94`,
     `:102` and `:114`, none between `:350` and `:403`. It also asserts that the probe source matches
     `/attestationProblems\(\s*deployed\s*,\s*hostImages\s*,\s*COMMIT\s*\)/` (pass 11: `attestationProblems(hostImages,
     hostImages, COMMIT)` never sees drift and `attestationProblems(deployed, deployed, COMMIT)` never checks the
     attestation-time images; both pass every other assertion; prototyped red on both, green on the correct probe).
     **Red on base.**
  3. **`CANARY_ATTESTED_SERVICES` is exactly the five services:**
     `assert.deepEqual(verifier.CANARY_ATTESTED_SERVICES, ['backend','worker','frontend','gateway','llm-egress-proxy'])`
     (pass 11: after step 2 the probe holds no service list to compare against, and tooling cases 1 and 1b iterate
     the constant, so only a literal catches a constant that drops a service such as `llm-egress-proxy`; pass 12: the
     verifier test iterates its own literal `SERVICES`, so a four-service constant also fails verifier case 1). **Red on base:** the export is missing (`undefined`, a per-case failure through the
     namespace).

**Confirm red first.**
```bash
node --test tests/release/release-candidate-canary.test.mjs tests/release/canary-probe-tooling.test.mjs
npm run test:release-distribution        # full aggregate after the fix (package.json:146)
```
On base both files load (namespace imports) and fail per case: canary cases 1, 2, 4, 6 and 7 with "canary receipt
has an invalid schema", case 3 with "Missing expected exception", case 5 green; tooling cases 1, 1b, 1c, 2 and 3 red
for their stated reasons. A link error (`does not provide an export named …`) is a wrong red and must be fixed in the
test before the source change.

**Existing tests the fix breaks.**
- None expected. The v1/v2 cases use `v0.8.68-rc2` and `v0.8.69-rc14` (`release-candidate-canary.test.mjs:23-24`),
  which are below the v3 gate.
- `promote-release.test.sh:68` and `publish-release.test.sh:146` stub the verifier.
- `release-candidate-canary.test.mjs:275-310`, the exact-keys and identity-drift cases, run on v1/v2 receipts and keep
  their messages.
- The suite's existing lifecycle-registry entry (`config/resource-lifecycle-callsites.json:2826`) covers its temp-dir
  pattern. The new cases add none; `canary-probe-tooling.test.mjs` case 1c reuses a `mkdtempSync` dir and adds no `rm`
  or `kill` callsite.

**Acceptance.**
- The probe refuses, before seeding or arming, a stack whose image revision labels are not `CANARY_COMMIT`, and it
  never writes a receipt if the stack changed mid-run (`attestationProblems`, revision plus drift, gates the exit at
  attestation; the receipt's images come from the attestation-time call). Each refusal exits 2 before the next step (source order: the first
  `process.exit(2)` after each check precedes backend discovery and the `receipt.json` write respectively).
- `attestDeployedImages()` (a `createCanaryRuntime` member) reads the trimmed revision label of each running
  container's `c.Image`, per service (case 1c, distinct image ids and revisions per service).
- The attestation gate is called as `attestationProblems(deployed, hostImages, COMMIT)` (tooling case 2 regex), and
  `CANARY_ATTESTED_SERVICES` is exactly the literal five-service list (tooling case 3).
- `verify-release-candidate-canary.mjs` (and so promote and publish) rejects any receipt for `≥ v0.8.78` that lacks
  v3 per-service revisions or whose revision differs from `--commit` for any one of the five services, including
  `v0.9.0-rc1`, `v1.0.0-rc1`, `v0.10.0-rc1` and `v0.8.100-rc1` (numeric tuple-order `tagAtLeast`, never a string
  compare, case 3).
- Every v2 rule applies to v3: the window and raw-evidence identity checks reject v3 receipts (cases 6 and 7).
- v0.8.77 and older receipts still verify.
- No tag, version or Dockerfile change.
- `npm run test:release-distribution` passes.

**Operational note (OQ-C5, decided).** From v0.8.78 the canary must run on a stack rebuilt from exactly the RC commit.
The memory "canary fleet on local stack" says the stack is rebuilt from the `sanctuary-main` checkout. If that checkout
is at a later `main` HEAD than the RC, the probe will now refuse, which is the purpose of the fix. The release skill's
canary step should say "check out the RC tag in sanctuary-main, `./start.sh --rebuild`, then run the canary". That is a
skill/doc follow-up outside this repo diff.

---

## Implementation log (coordinator)

- Phases a (A1, A2, folded P3), b1, b2, b3, b4 and c (C1–C5) implemented by one worker per worktree; every planned red
  case recorded red on base for its stated reason and green after; 13 commits cherry-picked with `-x`; each phase
  branch proven upstream with `git cherry` and removed. C added one comment-only follow-up (`run-parallel-suites.sh`
  named by basename so the script walk does not see a new reach).
- `/simplify` (reuse, quality, efficiency) and an adversarial review run on the integrated diff. Applied: the verifier's
  exported `COMMIT_PATTERN` reused in the canary runtime; default `ConflictError` code; dead `mcp/types.ts`
  `parseDateInput` deleted; the critical-lane classifier comment corrected to the named entries. Rejected: merging the
  replay lock and read (the D-12.B3b stale-snapshot race), editing `transactionEvidenceProjection.ts` (D-12.2), changing
  tested projections/call counts. Adversarial: no P0–P2; D-12.6 changelog notes written by the integrator (wording
  re-verified: phantom rows are never retired, `reconcileUtxos.ts:155` matches only lowercase authenticated spends).
- New P3 backlog: `ci-critical-mutation--lane-completeness-covers-named-entries-only`,
  `sync-populate--parent-outputs-all-address-decoded-and-refetched`, `rc-canary--drift-check-ignores-container-recreation`.

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage, no Stryker) and record red runs on the
plan-commit base. The integrator runs the whole block below, as written, as one script on the integrated PR branch in
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i12` (every `cd server` is in a subshell), only after every non-held
phase branch is cherry-picked, and is the only one who runs coverage and Stryker. Write the block to
`$SCRATCH/i12-verify.sh` and run `bash "$SCRATCH/i12-verify.sh"` — never paste it into `bash -c` or the Bash tool:
the block's own text contains `stryker run`, so a `pgrep -f` guard would match the integrator's shell (pass 6; the
guard is anchored to `[n]ode_modules/.bin/stryker run`, which is how a live `npx stryker run` appears).

**Integrator step before the block.** Run `npm run arch:graphs` and `npm run arch:calls` and commit
`docs/architecture/generated` in the integrator commit (with the changelog bullets and the two D-12.6 notes), so
`arch:check` below is a pure check. Write the Playwright scratch inputs described in the block comments.

```bash
set -euo pipefail
BASE=51b0b69af08a9c2ebeca10cda429f39222fef517
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
# heavy-run guard (D-12.X2): bounded wait, fails loudly; covers vitest coverage (incl. `npx vitest run --config ... --coverage`) and Stryker
wait_for_no_coverage() {
  for _ in $(seq 1 180); do
    if ! pgrep -f '[n]ode_modules/.bin/vitest run.*--coverage' >/dev/null && ! pgrep -f '[n]ode_modules/.bin/stryker run' >/dev/null; then
      return 0
    fi
    sleep 10
  done
  echo "coverage guard: another vitest coverage or Stryker run is still active after 30 min" >&2
  return 1
}
# One gate per line: under `set -e`, a failing non-final command of an `&&` list does not exit.
npm run build --workspace=shared
( cd server && npx prisma generate )
( cd server && npx tsc --noEmit )
( cd server && npm run typecheck:tests )
# targeted backend: A1/A2 (sync, populate, reconciliation, Electrum schemas, moved module + its import sites), B3, B4
( cd server && npx vitest run tests/unit/services/bitcoin/sync tests/unit/services/bitcoin/signingIntent \
  tests/unit/services/bitcoin/blockchain tests/unit/services/bitcoin/blockchain.test.ts \
  tests/unit/services/bitcoin/nodeTransactionAuthentication.test.ts tests/unit/services/bitcoin/advancedTx.test.ts \
  tests/unit/services/bitcoin/transactionHelpers.legacyRawTx.test.ts \
  tests/unit/services/bitcoin/electrum.methods.txidCase.test.ts tests/unit/services/bitcoin/electrum.methods.utxoBatch.test.ts \
  tests/unit/services/bitcoin/electrum.historyBounds.test.ts tests/unit/services/bitcoin/electrum.behavior.test.ts \
  tests/unit/services/bitcoin/electrum.test.ts tests/unit/services/blockchainService.test.ts \
  tests/unit/repositories/webhookRepository.test.ts tests/unit/services/webhooks tests/unit/api/wallet-webhooks-routes.test.ts \
  tests/unit/api/openapi.test.ts tests/unit/assistant tests/unit/mcp )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped as CI
# integration (real DB via the compose-backed runner; serialized host-wide)
flock /home/nekoguntai/.i12-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/syncMutationNetworkTransactions.test.ts
flock /home/nekoguntai/.i12-integration.lock npm --prefix server run test:integration:db -- tests/integration/repositories/webhookEndpointEnqueueOrdering.integration.test.ts
# mutation pins unchanged (D-12.1): no pinned file, map or non-critical Stryker profile edited, so no fee-policy re-run
git diff --exit-code "$BASE" -- config/wallet-safety-mutation-map.json 'server/stryker.*.config.mjs' ':(exclude)server/stryker.critical.config.mjs' \
  server/src/services/bitcoin/advancedTx/rbf.ts server/src/services/bitcoin/advancedTx/cpfp.ts server/src/services/bitcoin/advancedTx/batch.ts \
  server/src/services/bitcoin/rawTransactionEvidence.ts server/src/services/bitcoin/sync/transactionEvidenceProjection.ts
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
# critical shard 3 (D-12.4, D-12.X4.1): full shard, cold (C3 makes the config non-incremental; --force is redundant but harmless)
wait_for_no_coverage || exit 1
( cd server && MUTATION_SHARD=3 npx stryker run stryker.critical.config.mjs --force )
git diff -U0 "$BASE" -- server/src/services/bitcoin/signingIntent/broadcastReconciliation.ts \
  | sed -nE 's/^@@ -[0-9,]+ \+([0-9]+)(,([0-9]+))? @@.*/\1 \3/p' \
  | awk '{ n = ($2 == "" ? 1 : $2); for (i = 0; i < n; i++) print $1 + i }' | sort -u >"$SCRATCH/i12-br-changed-lines.txt"
test -s "$SCRATCH/i12-br-changed-lines.txt"
jq -e '[.files | keys[] | select(endswith("signingIntent/broadcastReconciliation.ts"))] | length == 1' server/reports/mutation/critical-mutation-report.shard-3.json
jq -r '.files | to_entries[] | select(.key | endswith("signingIntent/broadcastReconciliation.ts")) | .value.mutants[] | select(.status != "Killed" and .status != "Timeout") | .location.start.line' \
  server/reports/mutation/critical-mutation-report.shard-3.json | sort -u >"$SCRATCH/i12-br-undetected-lines.txt"
test -z "$(comm -12 "$SCRATCH/i12-br-changed-lines.txt" "$SCRATCH/i12-br-undetected-lines.txt")"   # every mutant on a changed line detected
# C1 provenance: vectors differ from base only in sourceSha256, and the pin is satisfied
git diff --numstat "$BASE" -- scripts/verify-addresses/output/verified-vectors.ts server/tests/fixtures/verified-address-vectors.ts \
  | awk '$1 != 1 || $2 != 1 { bad = 1 } END { exit (bad || NR != 2) }'
npx vitest run --config config/tooling/vitest.config.ts tests/scripts/verifyAddressesGenerated.test.ts
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail tests/components/WalletDetail.test.tsx \
  tests/components/WalletDetail.wrapper.test.tsx tests/components/WalletDetailWrapper tests/components/TransactionList \
  tests/components/BackupRestore tests/components/BackupRestore.test.tsx tests/App.branches.test.tsx
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold
# Playwright (CLAUDE.md static-build procedure; no host dev server). Scratch inputs written by the integrator before the
# block:
# - $PW_DIR/playwright.static.config.mts, a wrapper that imports the repo config by absolute path (a copied config
#   cannot load outside the repo, and config/tooling/playwright.config.ts:5 derives repoRoot from its own directory):
#     import base from '/home/nekoguntai/sanctuary-bug-scrub-20261013-i12/config/tooling/playwright.config.ts';
#     export default { ...base, webServer: undefined, use: { ...base.use, baseURL: 'http://127.0.0.1:4173' }, projects: base.projects?.filter((p) => p.name === 'chromium') };
#   Chromium only, as CI (test.yml, scripts/ci/run-lane.sh) and the *-chromium-linux.png baselines; record the
#   `--list` count (401 tests in 19 files at iteration 11).
# - $PW_DIR/known-auth-login-failures.txt: the 7 known static-server POST /auth/login cases, one `file :: title` per
#   line, sorted, built from a chromium-only JSON run of this same wrapper (`.file` relative to testDir, e.g. auth.spec.ts).
# Known limitation: the static server cannot answer POST /auth/login, so those 7 cases fail here; the Playwright exit
# status is recorded, not gated. Bounded and non-vacuous: the block fails if results.json is empty, if fewer than 380
# tests executed, or if any failing case is outside that list.
PW_DIR="$SCRATCH/i12-playwright"
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done   # bounded readiness wait (30 s)
curl -fsS -o /dev/null http://127.0.0.1:4173/   # readiness gate: fails if the static server never came up
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?   # chromium suite incl. admin backup/restore (B2) and render-regression.spec.ts (B2 edits src/app)
echo "playwright exit $PW_RC (recorded)"
test -s "$PW_DIR/results.json"
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380   # executed-count floor
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test "$(wc -l <"$PW_DIR/known-auth-login-failures.txt")" -eq 7
test ! -s "$PW_DIR/unexpected.txt" || { echo "Playwright failures beyond the 7 known auth/login cases:" >&2; cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
git diff --exit-code -- tests/e2e/render-regression.spec.ts-snapshots   # PNG baselines unchanged
# quality gates
npm run lint
npm run quality:lizard                             # cap 86; 84 on the base (D-12.X1)
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh   # fresh dir
npm run check:architecture-boundaries
npm run check:server-cycle-baseline
npm run arch:check                                 # pure check: graphs regenerated and committed before the block
node scripts/ownership/check-lifecycle-callsites.mjs
npm run check:resource-ownership-contract
npm run verify:signer-inventory
npm run check:safety-catch-guards
npm run check:wallet-sync-mutation-boundaries
npm run check:wallet-sync-lifecycle-contract
npm run check:openapi-route-coverage
npm run check:api-body-validation
npm run check:supply-chain-locks
node scripts/ci/check-negated-test-assertions.mjs  # new C4 guard: no leading-`!` statement without `||` in any *.test.sh; omit when C4 is held (D-12.X3)
node --test tests/ci/check-negated-test-assertions.test.mjs  # omit when C4 is held (D-12.X3)
# CI, install and release suites (C)
bash tests/ci/write-empty-diagnostic-breadcrumb.test.sh
node --test tests/ci/check-critical-mutation-config.test.mjs
node scripts/ci/check-critical-mutation-config.mjs   # over the integrated tree (D-12.X4.2): non-incremental, no unclassified critical test input
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/plan-test-run.test.sh
bash tests/ci/check-workflow-composition.test.sh
bash tests/ci/classify-quality-scope.test.sh
bash tests/ci/pre-commit-agent-gate.test.sh
bash tests/ci/relay-job-diagnosability.test.sh
bash tests/ci/isolated-subject-drivers.test.sh
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-verify-vectors-scope.test.sh
sh -c '. scripts/ci/classify-files-lib.sh; is_critical_mutation_file server/tests/setup.ts'   # lib still sources under POSIX sh; C3 pattern present
bash tests/install/unit/grafana-quiescence.test.sh   # green only with C4's :1175 docker.log clear (D-12.X5 class (b))
bash tests/install/unit/grafana-password-migration.test.sh
bash tests/install/unit/optional-stack-lifecycle.test.sh
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites (incl. upgrade-helpers); installs tests/ci/lib
node tests/install/unit/install-workflow-trigger-contract.test.mjs   # needs tests/ci/lib from the line above
node --test tests/release/release-candidate-canary.test.mjs tests/release/canary-probe-tooling.test.mjs
npm run test:release-distribution
npx vitest run --config config/tooling/vitest.config.ts tests/ci/renderHarnessInputsClassified.test.ts
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB cannot start, record the failure and rely on the CI integration groups
(`backend-integration-groups.sh:74,86`); never skip silently. `/simplify` and an adversarial review before committing;
commits in the foreground through `flock /home/nekoguntai/.i12-commit.lock git commit …`; never while a
coverage/Stryker run is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i12` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i12`),
  one commit per finding (test + fix; A2 then A1 from the A branch; C3 as two commits: walker + red test, then
  classifier), then the integrator commit (changelog `[Unreleased]` bullets incl. the two D-12.6 notes, regenerated
  `docs/architecture/generated`).
- **Workers (D-12.X2):** phases `a`, `b1`, `b2`, `b3`, `b4`, `c` in parallel, each in
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i12-<phase>` on `codex/bug-scrub-loop/20261013-i12-<phase>`. Workers
  edit only owned files, run typechecks and targeted tests, run lizard on changed files (zero new warnings), record red
  runs, and commit through the flock. The A worker records the failing set after the source-only change (Phase A1) and
  the A2 integration red run; the C worker records the C1 pre-rehash red, the C3 42-path listing, the C3 checker run in a tree
  without `server/src/generated`, the C4 43-line listing and the C4 behavioural proof.
- **Integrator:** cherry-picks serially with `-x` (A, B1, B2, B3, B4, C), never resolves a conflict by editing another
  phase's files (conflicts go back to the owner), then runs the block. After the cherry-picks land, each phase branch
  is proven upstream with `git cherry codex/bug-scrub-loop/20261013-i12 <phase-branch>` (every line `-`), deleted with
  `git branch -D`, and its worktree removed by path; a held phase (D-12.X3) keeps branch and worktree.
- **Merge:** squash through protected `main`; no admin bypass; merges are serial and no other open PR is rebased; poll
  required contexts via `/commits/<sha>/statuses` (not the combined status, which can report success while a required
  verify-vectors summary is pending). Expected lanes: full verify-vectors incl. emulator lanes and the fee-policy proof
  (C1 edits the workflow; A touches `server/src/services/bitcoin/**`); Full Critical Mutation, cold (A1 `signingIntent/*`,
  C3); Full Render E2E (B2 edits `src/app`); `ci-classifier-tests` and the new negated-assertion guard; whatever install
  and release lanes the classifiers select for `tests/install/unit/*` and `scripts/release/*`. Any retrigger carries
  the CLAUDE.md four-part evidence (immutable SHA + run/job ids, failure signature, new hypothesis, cheap
  discriminator); a timed-out binding step after C1 is diagnosed with C2's breadcrumb and the host snapshots, not
  assumed flake. Verify the reported `merge_commit_sha` (not the head SHA) is an ancestor of `origin/main` before
  deleting the branch.
- **PR-body flags:**
  - A1: P1 + folded P3; fail-closed semantics (forged bytes leave fields null and retried; reconciliation treats a
    forged lookup as a miss and re-submits the exact durable artifact, binding to `broadcastTxid`, never to the
    lookup's own `txid` field — cases 8/9 serve a self-consistent forgery; authentication precedes acceptance, which
    happens exactly once after the re-broadcast — case 8); verbose `fee`/`prevout` reads removed
    (D-12.3, no production change) and the client's decoded `vin`/`vout` ignored (cases 6(d), 6(e) OP_RETURN client
    address, 6(f) client-`vin` fee forgery, 6(g)/6(h) parent client `vout` value and address ignored, 6(i) client `vin` index ignored; whole-object `toStrictEqual` projection unit); module move (D-12.1), mutation pins untouched; critical shard-3 changed-line evidence.
  - A2: P1; lowercase normalization at the schema boundary (D-12.5), non-hex `tx_hash` now fails validation (retryable);
    the five non-hex listunspent fixture migrations (assertions unchanged) and any swept extras;
    the integration red/green pair (cases 7/8); D-12.6 limitation + read-only SQL; no migration, no data repair.
  - B1: invalidation owned by the wallet-detail controller (no `QueryClientProvider` requirement on `TransactionList`).
  - B2: tab-scoped sessionStorage hand-off, admin-only, 24 h TTL, non-admin discard; terminal-logout wipe unchanged;
    no endpoint; `App.branches` proves the shell consumes the hand-off.
  - B3: replay refusal rule (identity-changed retirement or `targetUrl ≠ url`), `FOR SHARE` lock on the endpoint row
    then a fresh post-lock read (not a joined `FOR SHARE OF e`, which keeps a stale delivery snapshot), serialised with
    repoint and secret rotation, 409 with `details.reason`, OpenAPI 409 documented; same-URL replay of non-retired rows
    unchanged; the accepted replay × finishing-worker deadlock residual (detected, `40P01`/`P2034`, D-12.B3b).
  - B4: leap-day-aware cap, error text unchanged, dead `mcp/types.ts` duplicate removed.
  - C1: 8 → 15 min step and 30 → 35 min job, provenance rehash (one line per vector file), the five binding profile
    timings from the PR's run.
  - C2: interrupted-step wording, never "not a proof regression" with an unfinished log; `dependency-audit`'s redacted
    install output renamed off `.log` (`quality.yml:270`, composition pin `:4077`); `run-parallel-suites.sh` suite
    logs with a sibling `.status` count as finished (guard case 5).
  - C3: critical gate non-incremental, cache step removed, classifier patterns added (the 42-path red listing), walker
    tolerant of the untracked generated Prisma client (run recorded without `server/src/generated`), CI-cost note
    (incl. every verifier-provenance rehash of `verified-address-vectors.ts` now selecting the cold lane) and the PR's
    three cold shard wall times; the injected-config wiring case and the commit-1 red (10 pass / 6 fail, the five
    temp-root cases red with the walker case, expected); residuals (Vitest-runner related tests, non-mutated `server/src`
    dependencies) re-proved nightly.
  - C4: the guard rule (anchored `/^\s*!\s/`, proven on indented, tab, `then`-body and loop-final fixtures), the
    43-line red listing, the behavioural proof (base suite exit 0, converted suite non-zero at `:1158`,
    `test_online_and_preloaded_offline_helpers_never_pull`), every unmasked failure and its classification (D-12.X5),
    including the class (b) fix: `grafana-quiescence.test.sh:1179` was a stale assertion over an uncleared
    `docker.log`, fixed by `: > "$TEST_ROOT/docker.log"` before the second `run_helper success` (`:1175`). If C4 is held (D-12.X3), say so instead, name the
    unmasked failure that held it, and note the two C4 guard lines were omitted from the Verification block.
  - C5: v3 receipt from v0.8.78 (all five v2-only verifier sites converted, so window and raw-evidence identity apply
    to v3), per-service revision binding for all five services, mid-run image swap refused before the receipt
    (exported `attestationProblems` = revision plus drift problems gating the exit, called as
    `attestationProblems(deployed, hostImages, COMMIT)` and pinned by regex; receipt images from the
    attestation-time read), `CANARY_ATTESTED_SERVICES` pinned to a literal five-service list, namespace imports so
    base reds are per-case, each refusal exiting before the next step, `attestDeployedImages()` reading the trimmed
    label of each container's `c.Image` (fake-docker case 1c, distinct image id and revision per service), v2 rejected
    for `v0.8.78`, `v0.9.0`, `v1.0.0`, `v0.10.0` and `v0.8.100` RCs (numeric tuple order), v0.8.77 receipts still verify, trust boundary unchanged, and the runbook follow-up (OQ-C5).
  - "No e2e mock-map change, no new endpoint, no migration, no version bump"; the P3 backlog stays outside this PR.
- **Rollback:** every phase is code/CI-only. No schema, migration or stored-shape change: A changes what is written in
  future, not existing rows; B2 stores only a tab-scoped sessionStorage key; B3 reads existing columns. Reverting A1/A2
  re-opens the forgery/duplication paths; reverting C1 needs the provenance rehash reverted with it (same commit);
  reverting C3 restores the incremental cache step; reverting C5 drops the v3 requirement for ≥ v0.8.78 receipts.
- **Concurrency:** B3's replay decision runs in the existing transaction: a `FOR SHARE` lock on the endpoint row, ordered
  against `updateEndpoint`'s `FOR NO KEY UPDATE`, then a fresh read of delivery and endpoint state (integration cases 4
  and 5); a replay racing a still-finishing worker's `markDelivery*` can deadlock and is detected and aborted by
  Postgres (accepted residual, D-12.B3b); A adds no shared state; B2's hand-off is
  consumed once (take-and-remove).
- **Deployment:** none until clean closeout (coordinator policy); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] Every failing-first test above fails on `51b0b69af0` code (red runs recorded per phase) and passes on the PR head;
  A1's behavioural reds 1–6 (incl. 6(d), client `vout` ignored; 6(e), client address on an OP_RETURN output; 6(f),
  client `vin` fee forgery, `51_000n` on base; 6(g), parent client `vout` value, `51_000n` on base; 6(h), parent
  client `vout` address; 6(i), client `vin` index, `51_000n` on base) and 8–10 (self-consistent forged lookup, well-formedness
  asserted with `parseAuthenticatedRawTransaction`; case 8 one acceptance ordered after the broadcast) and A2's
  integration case 7 are among them; the `authenticatedDetails.test.ts` whole-object `toStrictEqual` case is green.
- [ ] A: honest-path guards (A1 case 7; A2 case 8 counts 0 → 1 on an unseeded wallet) green; the five A2 listunspent
  fixtures migrated with assertions unchanged and backend `tests/unit` coverage at 100% (coinbase arms reached through
  the non-empty fixture scriptSig); A2 case 7 red on base
  recorded with `syncWallet` resolved, no `lastSyncError`, and the uppercase history and listunspent served; critical shard 3 has no undetected mutant on a changed
  `broadcastReconciliation.ts` line; pin-neutrality `git diff` gate green.
- [ ] B: B1 network red → green; B2 three-warning and hand-off reds → green, including the `App.branches` shell-consumes-hand-off case; B3 unit reds (incl. case (3)) + integration reds (incl. the lock
  waiter and the same-URL secret-rotation race, case 5) → green; B4 leap-year reds → green and the two 29-Feb-outside-the-range guards throw.
- [ ] C: C1 composition reds and the pre-rehash `verifyAddressesGenerated.test.ts` red recorded, both vector files
  differ from base by exactly the `sourceSha256` line; C2 three new cases red → green and the non-log and `.status` guards (cases 4, 5) green, with the `quality.yml:270` output
  renamed and its composition pin updated; C3 42-path listing recorded then `[]` (commit-1 checker test 10 pass / 6
  fail, base 12 pass / 4 fail, final 16 pass / 0 fail, the wiring case red on base), and the checker run without
  `server/src/generated` recorded green; C4 (unless held, D-12.X3) guard case 1 flags the indented, tab-indented, `then`-body and loop-final fixtures at their line numbers, 43-line listing recorded then `[]`, behavioural proof recorded failing at `:1158` (not `:1179`), the `:1179` stale-log assertion fixed by the `:1175` `docker.log` clear (D-12.X5 class (b), named in the commit and PR bodies), every other unmasked failure resolved per D-12.X5;
  C5 v3 reds (incl. the per-service revision mismatch over all five services, the window and raw-evidence identity
  cases 6 and 7, v2 rejected for `v0.9.0-rc1`, `v1.0.0-rc1`, `v0.10.0-rc1` and `v0.8.100-rc1` in case 3,
  `deployedImageDriftProblems` and the drift-only `attestationProblems` case 1b plus the attestation-time source-order
  check, the exit-before-proceed source order gated on `attestationProblems(` with the startup and gate indices
  required `> 0` before any position check, the
  `attestationProblems(deployed, hostImages, COMMIT)` argument pin in tooling case 2, the literal five-service
  `deepEqual` in tooling case 3, and the per-service fake-docker `attestDeployedImages()` case 1c) → green and v0.8.77
  guard green; the recorded base red run shows per-case messages (namespace imports), never a link error.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded (with the two C4 guard
  lines omitted when C4 is held, D-12.X3); both integration specs
  executed through the flock'd `test:integration:db`.
- [ ] Playwright (static build, chromium-only `playwright.static.config.mts` wrapper importing the repo config) run
  recorded: exit status, a non-empty `results.json` with at least 380 executed tests, the failing set, and its
  classification — only the 7 known static-server `POST /auth/login` cases may fail; render-regression PNG baselines
  unchanged. CI's browser lane is binding.
- [ ] PR merged; target-branch CI green on its merge commit (incl. verify-vectors binding job within its new bound);
  ancestry of `merge_commit_sha` verified; branches and worktrees cleaned (`git cherry` proof per phase branch); held
  phases kept.
- [ ] PR body carries every flag listed under Delivery.
- [ ] Run state updated (eleven findings resolved, folded reconciliation P3 resolved by A1, decisions D-12.1…D-12.6,
  D-12.B1…D-12.B4b, D-12.C1…D-12.C6, D-12.X1…D-12.X5 and the decided open questions recorded); OQ-C5 runbook follow-up
  recorded.
- [ ] P3 backlog remains outside the blocking fix set.

## Review log

- Draft assembled 2026-10-21 from plan12-section-A/B/C and plan12-findings (source `51b0b69af0`).
- Pass 1 (2026-10-21): 13 accepted comments applied (A 7, B 2, C/cross-cutting 4); rejected: none.
- Pass 2 (2026-10-21): 4 accepted comments applied (A 2: projector mock method set, fixture Uint8Array script type; B 1: $queryRaw mockReset in the webhookRepository beforeEach; C 1: held-C4 carve-out in the Verification block, Completion and PR flags); rejected: none.
- Pass 3 (2026-10-21): 10 accepted comments applied (A 3: five non-hex listunspent fixtures + ownership/run command, non-empty coinbase scriptSig, zod .data narrowing; B 3: case (3) red on base, findDeliveryById stub, documented replay×worker deadlock residual; C 4: run-parallel-suites .status siblings, all five v2-only verifier sites + two v3 cases, base-red reasons, hardware-proof inventory wording); rejected: none.
- Pass 4 (2026-10-21): 2 accepted comments applied (C3 @fixtures alias in the critical-input walker, 40 -> 42 paths; C2 incomplete-log list captured before the breadcrumb writes its own log); A and B clean (both prototyped in scratch extracts); rejected: none.
- Pass 5 (2026-10-21): 1 accepted comment applied (C2 breadcrumb wording must be plain text — no backticks in the unquoted heredoc — and case 1 asserts the title and `timeout-minutes`); A and B clean (second consecutive clean pass each); C1, C3, C4, C5, decisions and cross-cutting sections clean; rejected: none.
- Pass 6 (2026-10-21): 3 accepted comments applied (A: every fixture transaction has ≥1 input — a zero-input transaction cannot round-trip through Transaction.fromHex; B3: the lock-waiter probe binds the whole ILIKE pattern as one parameter, never inside quotes; Verification: Stryker pgrep guard anchored to node_modules/.bin and the block run from a script file); rejected: none.
- Pass 7 (2026-10-21): 1 accepted comment applied (A1 broadcastReconciliation fixtures built with buildTransaction, ≥1 input, and case 8 proves the forged bytes are well-formed so only the txid binding rejects them); B and C clean (SQL rendered with Prisma 7.10.0 and executed on PGlite; guard patterns checked against live processes); rejected: none.
- Pass 8 (2026-10-21): 7 accepted comments applied (A 3: self-consistent forged lookup so field-binding implementations fail, well-formedness via the unmoved parseAuthenticatedRawTransaction, case 6(d) client vout ignored; B 1: App.branches proves the shell consumes the hand-off; C 3: negated-assertion fixtures indented/tab/then/loop-final, deployedImageDriftProblems + attestation-time images, per-service revision mismatch); rejected: none.
- Pass 9 (2026-10-21): 6 accepted comments applied (A 2: strict whole-object projection test + flow cases 6(e) OP_RETURN address and 6(f) client-vin fee forgery, case 8 acceptance call-count/order; C 4: grafana-quiescence :1179 stale-log fix + proof must fail at :1158, attestDeployedImages member + fake-docker case 1c, exit-before-proceed source order, v2 rejected for v0.9.0/v1.0.0); B clean (App.branches case prototyped; eight wrong B4 variants caught); rejected: none.
- Pass 10 (2026-10-21): 4 accepted comments applied (A 1: flow cases 6(g)/6(h) — parent client fields ignored; C 3: tag cases v0.10.0-rc1/v0.8.100-rc1 and D-12.C6 numeric tuple order, per-service distinct image ids/revisions in case 1c, exported attestationProblems gating the receipt); B clean; rejected: none.
- Pass 11 (2026-10-21): 4 accepted comments applied (A 1: flow case 6(i) — client vin index ignored, found by a full field sweep; every other populator field already has a failing case; C 3: namespace imports so base reds are per-case, attestationProblems argument pinning, literal five-service list); B clean; rejected: none.
- Pass 12 (2026-10-21): 1 accepted comment applied (C5 verifier tests use a test-local literal SERVICES list; only CANARY_RECEIPT_V3_SCHEMA_VERSION goes through the namespace, so base reds are the stated per-case messages); A clean (6(i) prototyped; field and ingress sweeps independently re-derived), B clean (fifth time), C1–C4 and cross-cutting clean; rejected: none.
- Pass 13 (2026-10-21): 1 accepted comment applied (C5 tooling cases 1/1b/1c use the same test-local literal SERVICES; only case 3 reads verifier.CANARY_ATTESTED_SERVICES, so base reds are the stated member-missing messages); A and B clean (B byte-identical since pass 8, commands runnable in order), C1–C4 and cross-cutting clean; rejected: none.
- Pass 14 (2026-10-21): 2 accepted comments applied (C5 tooling case 2 exit checks bounded on both sides — a missing exit no longer passes via indexOf -1; C3 checker test reads the new exports through a namespace and matches the throw message); A and B clean (byte-identical outside the C5 block); C1, C2, C4 and cross-cutting clean; rejected: none.
- Pass 15 (2026-10-21): 4 accepted comments applied (B3 2: replay SQL asserted on .text with call count, OpenAPI 409 pinned to a literal $ref; C3 1: checkCriticalMutationConfig injects config/listUnclassified and a wiring case proves the CLI fails on incremental or an unclassified input; C5 1: startup and attestation call indices required > 0 before position checks); A clean; rejected: none.
- Pass 16 (2026-10-21): 1 accepted comment applied (C3 commit-1 count corrected to 10 pass / 6 fail with the wiring case, and both checks placed before readBaseline(root)); A and B clean (B3 tests prototyped against the real source; rejected lock designs red), C1, C2, C4, C5 and cross-cutting clean (quick-lane CLI exits non-zero on restored incremental / dropped patterns on the real tree); rejected: none.
- Pass 17 (2026-10-21): clean — no verified actionable comments in any section (A and B byte-identical to pass 16; C3 placement and counts prototyped: base 12/4, commit 1 10/6, final 16/0; C1–C5 and cross-cutting re-read). Converged after 17 passes; origin/main unchanged at 51b0b69af0, so every finding stands as re-verified.
