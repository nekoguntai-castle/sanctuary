# Bug-scrub loop 20261013 — iteration 13 remediation plan

- **Run:** `bug-scrub-loop-20261013-sanctuary`, iteration 13
- **Source SHA:** `20361d62b302ea473a5ebe0ad735d1f37831c3cd` (`main`, after #1413)
- **Scope:** whole repository (locked at run start)
- **Blocking findings (1 × P1, 6 × P2; seven).** Every finding was re-verified from source at `20361d62b3` (file:line
  in the phase sections). **None is rejected.** `approval-any-n--stale-votes-count-after-access-loss` was reported P3
  and **escalated to P2 at triage**: the `'specific'` quorum already re-filters approve votes against the live approver
  list (`approvalService.ts:682-686`, whose comment names exactly this case), so `any_n` counting a revoked approver's
  vote is an inconsistently enforced spend-authorization control. The other 16 new P3s from this 23-finding scrub are
  backlog in run state and are **outside this fix set** (including `wallet-sync-replay--registered-container-start-attach-next-exit-race`,
  the same race class as C2 in a separate harness, not folded: D-13.C6 sweep).

| Phase | Finding id | Sev |
|---|---|---|
| A1 | `nested-segwit-fee-policy--slip132-ypub-signer-xpub-rejected` | **P1** |
| A2 | `approval-any-n--stale-votes-count-after-access-loss` | P2 (escalated) |
| B1 | `intelligence-status--disabled-feature-1hz-poll-forever` | P2 |
| B2 | `wallet-transactions--manual-filters-and-stats-loaded-page-only` | P2 |
| B3 | `user-preference-write--user-keyed-effects-refetch` | P2 |
| C1 | `postgres-password-reconcile--project-from-dir-basename` | P2 |
| C2 | `install-smoke--backup-volume-init-rerun-fails-on-podman-runner` | P2 (carried from iteration 12, diagnosed in the iteration-13 scrub) |

## Open questions

All open questions raised by the section drafters are **decided by the coordinator** with the drafters' recommended
defaults. None needs a user decision: each default either keeps current behaviour, matches an existing sibling rule,
or is strictly stricter than today, and none invents product policy. Each deferred item is recorded in run state as a
P3 follow-up, outside this fix set.

- **OQ-A1 — a re-granted approver's old vote counts again: DECIDED, accept** (matches `'specific'` re-listing; D-13.8).
- **OQ-A2 — revocation racing resolution: DECIDED, accept and document** (the same window exists for `'all'`; closing it
  needs a cross-repository lock; D-13.9).
- **OQ-A3 — displayed `currentApprovals` still counts stale votes: DECIDED, API shape unchanged** (an `eligibleApprovals`
  field for all three quorum types is a P3 follow-up; changing `currentApprovals` in place would alter an audit field).
- **OQ-B1 — `GET /intelligence/status` answering 200 when the flags are off: DECIDED, defer** (after D-13.B1a the cost is
  one 403 per session; the change would alter a public contract and the gate invariant at `intelligence.ts:66-68`).
- **OQ-B2 — server-side filtered paging and filtered stats: DECIDED, P3 follow-up.** D-13.B2b makes today's behaviour
  honest; label and confirmation filters cannot run server-side anyway.
- **OQ-B3 — open tabs noticing an admin enabling Treasury Intelligence: DECIDED, no** (reload or re-login picks it up).
- **OQ-C1 — a missing or stopped postgres at `password_reconciled`: RESOLVED (coordinator, review pass 1).**
  `start.sh`'s `password_reconciled` block re-runs the same idempotent `up $postgres_up_flags postgres` as the
  `postgres_started` stage (`start.sh:443`) immediately before the reconcile script, so a resumed run whose postgres
  was removed or stopped between attempts brings it back first. The reconcile script then treats **both** a missing
  and a stopped postgres container for the lock-derived project as fatal (D-13.C3). No wedge remains on the
  `start.sh` path, and no P3 follow-up is opened.

**P3 follow-ups recorded in run state (outside this fix set):** OQ-A3 (`eligibleApprovals` display field), OQ-B2
(server-side filtered paging and stats), and `offline-bundle--compose-project-ignores-sanctuary-project`
(`scripts/offline/create-bundle.sh:533-568` `resolve_compose_project_name` never reads `SANCTUARY_PROJECT`, so an
offline upgrade of a non-default project skips the pre-upgrade backup prompt; same class as C1, not folded; C1 sweep).

## Goal and non-goals

**Goal:** fix every blocking finding (1 × P1, 6 × P2; seven), each with a non-regression test that fails on
`20361d62b3` and passes after the fix, delivered in one protected PR with green CI.

**Non-goals:** the P3 backlog (above); production data repair; new Prisma migrations or `schema.prisma` edits (RC10
migration-tree digest); new API endpoints or query parameters (so **no e2e mock-map edits**: the thirteen
`unhandledRequests` sites found by grepping `transactions/balance-history` stay untouched); server-side transaction
filtering (OQ-B2); a change to the intelligence status contract (OQ-B1); a version bump; branch-protection changes;
normalising stored xpubs at write time (D-13.2) or a shared account-node parser (D-13.3).

## Decisions

Decision ids are kept from the section drafts and are unique across the plan: **D-13.1–D-13.11** (Phase A),
**D-13.B1a–D-13.B3d** (Phase B), **D-13.C1–D-13.C7** (Phase C), and the cross-cutting **D-13.X1–D-13.X4** below.

### Cross-cutting decisions

- **D-13.X1 lizard headroom.** Pinned lizard 1.24.0 (`/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard`)
  with the repo arguments (`scripts/quality.sh`: `-i 86 -C 15 -T nloc=200`) allows 86 warnings; the integrator records
  the base count on `20361d62b3` before cherry-picking (84, re-measured at `20361d62b3`). The PR targets 0 new
  warnings, and the Verification block enforces it with a `grep -c ': warning:'` count gate at ≤ 84 (if the
  integrator's recorded base count differs, that number replaces 84 in the gate). Every
  worker runs `lizard -C 15 -T nloc=200 <new/changed .ts/.tsx/.js/.mjs files>` and reports zero new warnings. New helpers
  are top-level `function` declarations, CCN ≤ 15, NLOC ≤ 200; do not hoist a nested `function` out of a `describe`
  without re-measuring.
- **D-13.X2 one worktree per phase.** Phases `a` (A1 + A2), `b1`, `b2`, `b3`, `c` (C1 + C2) each get a worktree
  `/home/nekoguntai/sanctuary-bug-scrub-20261013-i13-<phase>` (never `/tmp`) on branch
  `codex/bug-scrub-loop/20261013-i13-<phase>`, cut from the final reviewed plan commit (the integrator records its SHA;
  it differs from `20361d62b3` only under `tasks/`). Setup: root `npm ci` + `cd server && npx prisma generate` +
  `npm run build --workspace=shared`, nvm node on `PATH` (~810 `node_modules` entries). Every commit goes through
  `flock /home/nekoguntai/.i13-commit.lock git commit …` in the foreground; never while a coverage or Stryker run is
  active; no `git stash`. One commit per finding (test + fix). The integrator alone runs coverage, behind the bounded
  guard in the Verification block.
- **D-13.X3 hold rules.** No phase is holdable: A1 is P1, and every other phase is an independent P2 with a small,
  self-contained diff. If a worker's red test does not fail on the plan-commit base for the stated reason, the worker
  stops and the coordinator re-assesses before anything is cherry-picked.
- **D-13.X4 cross-phase couplings.** File ownership is disjoint (table below); the remaining couplings are ordering only:
  1. `scripts/ci/backend-integration-groups.sh` is edited only by A2 (one line in the flows list);
     `tests/install/run-all-tests.sh` and `config/resource-lifecycle-callsites.json` only by C.
  2. B2 and B3 both live under `src/components/WalletDetail/`: B3 owns `hooks/useWalletData.ts`; B2 owns exactly the
     b2 row's files; no B2 file is under `hooks/`. Neither edits the other's files.
  3. `docs/reference/changelog.md` `## [Unreleased]` (workers hand over bullet text) and `docs/architecture/generated/*`
     are integrator-owned.

### Phase file ownership (disjoint; one worktree and branch per phase)

| Phase | Production files | Test files |
|---|---|---|
| a | `server/src/services/bitcoin/transactions/feePolicy.ts`, `server/src/services/vaultPolicy/approvalService.ts`, `scripts/ci/backend-integration-groups.sh` (one line) | `server/tests/unit/services/bitcoin/transactionFeePolicy.test.ts`, new `server/tests/unit/services/bitcoin/estimation.slip132NestedSegwit.test.ts`, new `server/tests/unit/services/approvalService/approvalService.any-n-eligibility.contracts.ts` (+ its registration in `server/tests/unit/services/approvalService.test.ts`), the existing approval contracts listed in Phase A2 (`approvalService.cast-vote-resolution.contracts.ts`, `approvalService.concurrent-resolution.contracts.ts`, `approvalService.draft-status.contracts.ts`, `approvalService.cast-vote-guards.contracts.ts`, all under `server/tests/unit/services/approvalService/`), new `server/tests/integration/flows/approvalAnyNEligibility.integration.test.ts` |
| b1 | `src/hooks/useIntelligenceStatus.ts` | `tests/hooks/useIntelligenceStatus.test.ts` |
| b2 | `src/components/TransactionList/TransactionList.tsx`, `src/components/WalletDetail/tabs/TransactionsTab.tsx`, new `src/components/WalletDetail/tabs/TransactionsTab/filterScope.ts`, new `src/components/WalletDetail/tabs/TransactionsTab/ManualFilterPartialNotice.tsx` | `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx`, `tests/components/TransactionList/presentationContract.test.tsx`, new `tests/components/WalletDetail/tabs/TransactionsTab/filterScope.test.ts` (new directory) |
| b3 | `src/components/DeviceList/useDeviceListRecords.ts`, `src/components/Layout/useLayoutNotifications.ts`, `src/components/Layout/useLayoutChromeState.ts`, `src/components/WalletDetail/hooks/useWalletData.ts`, `src/components/DeviceDetail/hooks/useDeviceData.ts` | new `tests/contexts/UserContext.identityEffects.test.tsx`, new `tests/components/DeviceList/useDeviceListRecords.test.tsx`, new `tests/components/WalletDetail/hooks/useWalletData.userIdentity.test.ts`, `tests/components/DeviceDetail/hooks/useDeviceData.branches.test.tsx`, `tests/components/Layout/useLayoutChromeState.test.tsx`, `tests/components/Layout/useLayoutNotifications.test.tsx` |
| c | `scripts/reconcile-postgres-password.sh`, `scripts/setup.sh`, `start.sh`, `scripts/ownership/deployment-session.mjs`, `scripts/ownership/deployment-lifecycle.sh`, `tests/install/e2e/container-health.test.sh`, `tests/install/utils/helpers.sh`, `tests/install/run-all-tests.sh`, `config/resource-lifecycle-callsites.json` | `tests/install/unit/optional-stack-lifecycle.test.sh`, `tests/install/unit/install-script.test.sh` (new lookup test and the corrupt-BuildKit fake edit), `tests/install/unit/setup-upgrade-state.test.sh`, `tests/ownership/deployment-lifecycle.test.sh`, new `tests/install/unit/oneshot-container-rerun.test.sh` (mode 100755) |

## Phase A — funds-path and policy fixes (A1, A2)

Both phases are server-only. They add no Prisma migration, no new repository method, no new import edge
between collapsed `src/<dir>` groups, and no identifier that starts with `sign`, `finalize` or `broadcast`.
They can ship in one PR. A1 touches `server/src/services/bitcoin/**`, which is in
`config/wallet-safety-critical-paths.json:11`, so the PR also runs the verify-vectors workflow. Neither
file is in the workflow's `sourceManifest`.

### Phase A1 — Convert SLIP-132 signer xpubs before fee-policy derivation (P1 `nested-segwit-fee-policy--slip132-ypub-signer-xpub-rejected`)

**Evidence (re-verified at 20361d62b3).**
- `server/src/services/bitcoin/transactions/feePolicy.ts:30`: `let node = bip32.fromBase58(signingInfo.accountXpub, network);`.
  It does not call `convertToStandardXpub` first. The call is in `deriveSingleSigPubkey` (`:23-35`). The only
  caller is the `WalletScriptType.NESTED_SEGWIT` arm of `resolveTransactionSpendPolicy` (`:50-56`). The other
  single-sig arms (`:44-49`) derive no key, so only nested SegWit fails.
- Where the xpub comes from:
  - `transactions/psbtConstruction.ts:161` sets `accountXpub: link.signerXpub`;
  - `wallet/walletAccountSelection.ts:172` sets `signerXpub: account.xpub`, the stored device-account key,
    unchanged.
- The system accepts ypub/upub on purpose:
  - `descriptorParser/canonicalDescriptor.ts:64-65` allows `ypub`/`upub` for the `sh(wpkh)` wrapper;
  - `walletSafetyAudit/extendedKeyEvidence.ts:17-18` maps them to `single_sig`/`nested_segwit`;
  - the Coldcard parser keeps the ypub string (`tests/services/deviceParsers/deviceParsers.test.ts:72`).
- What a nested-SegWit wallet with a ypub/upub signer can and cannot do:
  - **Works:** receive. Address derivation converts the key (`addressDerivation/singleSigDerivation.ts:63-67`).
  - **Fails before the PSBT is built:** every spend path, because each resolves the spend policy first:
    - send: `transactions/createTransaction.ts:98`;
    - batch: `transactions/createBatchTransaction.ts:75`;
    - estimate: `estimation.ts:70`. `estimateTransaction` catches the error and returns `sufficient: false`
      with `error: 'Invalid network version'` (`estimation.ts:88-97`);
    - CPFP: `advancedTx/cpfp.ts:158`;
    - RBF: `advancedTx/rbf.ts:234`;
    - advanced batch: `advancedTx/batch.ts:109`.
- Library behaviour, checked with a scratch script against the repo's `bip32`, `tiny-secp256k1` and
  `bitcoinjs-lib`:
  - `bip32.fromBase58(<BIP49 ypub>, networks.bitcoin)` and `bip32.fromBase58(<BIP49 upub>, networks.testnet)`
    both throw `Invalid network version`;
  - after the version bytes are swapped to xpub/tpub, `m/…/0/0` gives redeem scripts
    `0014f990679acafe25c27615373b40bf22446d24ff44` (→ `37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf`) and
    `001438971f73930f6c141d977ac4fd4a727c854935b3` (→ `2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2`, the BIP49
    testnet vector).
- Tests miss it: `tests/unit/services/bitcoin/transactionFeePolicy.test.ts:23-27` builds the only nested-SegWit
  fixture with `node.neutered().toBase58()`, which is a tpub. `tests/unit/services/bitcoin/estimation.test.ts:24`
  mocks `transactions/feePolicy` entirely.

**Sweep of every raw `fromBase58` on an extended key in `server/src`.** Command:
`grep -rn "fromBase58" server/src --include=*.ts`.

| Site | Input | Verdict |
|---|---|---|
| `transactions/feePolicy.ts:30` | stored signer `accountXpub` | **BUG — fixed here** |
| `transactions/psbtConstruction.ts:190-191` (`parseAccountNode`) | `accountXpub` | converts first — OK |
| `psbtAccountBinding.ts:147` | `signer.accountXpub` | `convertToStandardXpub(...)` inline — OK |
| `addressDerivation/singleSigDerivation.ts:63-67` | descriptor xpub | converts at `:63` — OK |
| `addressDerivation/multisigDerivation.ts:100-101` (default reader `:62-64`) | multisig `keyInfo.xpub` | converts at `:100` before the reader — OK |
| `addressDerivation/descriptorDerivation.ts:168-171` | descriptor origin xpub | converts at `:169` — OK |
| `addressDerivation/utils.ts:40-41` (`validateXpub`) | user input | converts at `:40` — OK |
| `psbtBuilder/witnessScript.ts:42-43` | multisig `keyInfo.xpub` | converts — OK |
| `psbtBuilder/bip32Derivations.ts:61-62` | multisig `keyInfo.xpub` | converts — OK |
| `walletSafetyAudit/extendedKeyEvidence.ts:75` | audited xpub | converts inline — OK |
| `walletRemediation/proof.ts:127` (`bs58check.decode`) | xpub | converts inline — OK |
| `descriptorParser/canonicalDescriptor.ts:144` (`bs58check.decode`) | raw key | intentionally raw: checks the SLIP-132 version bytes against the prefix and wrapper (`:139-147`) — OK |
| `transactions/psbtInputConstruction.ts:26` | type alias only | n/a |

Outside `server/src`, for completeness: `src/services/hardwareWallet/adapters/jadeIdentity.ts:28` parses a key
Jade itself just returned (standard version), not a stored account xpub. `adapters/trezor/multisig.ts:108`
converts first. Neither is in scope. `feePolicy.ts:30` is the only unconverted site.

**Multisig signers (Ypub/Zpub/Upub/Vpub).** They also go through `resolveTransactionSpendPolicy`
(`feePolicy.ts:60-88`), but never reach `deriveSingleSigPubkey`. Their keys come from
`parseDescriptor(wallet.descriptor).keys` (`psbtConstruction.ts:103-130`) and are derived in
`buildMultisigWitnessScript` (`psbtBuilder/index.ts:18` → `witnessScript.ts:42-43`), which converts first. They
are not affected. A guard test (case 3 below) pins this.

**Fix design.**
- D-13.1: in `deriveSingleSigPubkey`, `feePolicy.ts:30` becomes
  `let node = bip32.fromBase58(convertToStandardXpub(signingInfo.accountXpub), network);`.
  - Import `convertToStandardXpub` straight from `'../addressDerivation/xpubConversion'`, the same import
    `psbtBuilder/witnessScript.ts:9` uses.
  - Do not import the `../addressDerivation` barrel. The create-transaction harness mocks that barrel's
    `convertToStandardXpub` as the identity function
    (`tests/unit/services/bitcoin/transactionServiceCreate/transactionServiceCreateTestHarness.ts:160-166`).
    Routing through it would let a future harness test pass for the wrong reason.
  - The change adds no branch: `convertToStandardXpub` returns xpub/tpub/unknown prefixes unchanged
    (`xpubConversion.ts:88-89`). Coverage stays at 100% with no new ignore.
  - Network checking is kept. A ypub on a testnet wallet becomes an xpub, and `fromBase58(xpub, testnet)`
    still throws `Invalid network version`. Case 1 asserts this.
- D-13.2 (rejected alternative): normalize `account.xpub` to xpub/tpub when it is written.
  - Rejected because stored SLIP-132 strings are load-bearing:
    - the canonical descriptor's version/wrapper check (`canonicalDescriptor.ts:139-147`);
    - the wallet-safety evidence policy map (`extendedKeyEvidence.ts:16-20`);
    - descriptor equality and exports.
  - It would also mean a data backfill. Under the RC10 digest, schema changes are off the table and data
    rewrites are out of scope.
- D-13.3 (rejected alternative): a shared `parseAccountNode` helper for all twelve sites. That is out of scope
  for a P1 fix, because every other site already converts. Revisit only if a scrub finds a second raw site.

**Failing-first tests.**
1. `server/tests/unit/services/bitcoin/transactionFeePolicy.test.ts` (144 lines now, about 190 after). Add
   imports:
   - `VERIFIED_SINGLESIG_VECTORS` from `'../../../fixtures/verified-address-vectors'`, which is read-only here.
     It is not in `scripts/verify-addresses/sourceManifest.ts`. Every vector is cross-implementation verified,
     with `mnemonic` "abandon ×11 about" and fingerprint `73c5da0a`.
   - `convertToStandardXpub` from `'../../../../src/services/bitcoin/addressDerivation/xpubConversion'`.

   New test:
   `it.each(SLIP132_NESTED)('derives nested SegWit evidence from SLIP-132 signer xpub $caseId', …)`, with
   `const SLIP132_NESTED = VERIFIED_SINGLESIG_VECTORS.filter(v => v.scriptType === 'nested_segwit' && /^[yu]pub/.test(v.xpub));`.
   - Today this selects 60 vectors:
     - 12 ypub, mainnet, accounts 0 and 7, branches 0 and 1, indexes 0, 1 and 2147483647;
     - 48 upub, across testnet3, testnet4, signet and regtest.
   - Add a separate `it('selects every SLIP-132 nested SegWit vector', () => expect(SLIP132_NESTED).toHaveLength(60))`
     so an empty filter cannot pass vacuously.
   - Per vector:
     - `network = v.network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet`;
     - `info = signingInfo({ scriptType: WalletScriptType.NESTED_SEGWIT, accountXpub: v.xpub, accountPath: v.path })`;
     - `evidence = resolveTransactionSpendPolicy(info, `${v.path}/${v.branch}/${v.index}`, network)`.
   - Assertions:
     - `evidence.spendPolicy.type === 'p2sh-p2wpkh'`;
     - `Buffer.from(bitcoin.payments.p2sh({ redeem: { output: evidence.redeemScript! } }).output!).toString('hex') === v.expectedScriptPubKey`;
     - `evidence` `toEqual` the evidence for `{ ...info, accountXpub: convertToStandardXpub(v.xpub) }`.
   - **Red on base:** all 60 throw `Invalid network version` (the length test passes).
2. Same file:
   `it('keeps the network check for a SLIP-132 nested SegWit xpub on the wrong network', …)`. It takes the
   mainnet `ypub` vector `ss:single-sig-nested-segwit-bip49-v1:mainnet:a0:b0:i0` and calls
   `resolveTransactionSpendPolicy` with `bitcoin.networks.testnet` and path `"m/49'/1'/0'/0/0"`. The account
   path is `"m/49'/1'/0'"`, so `childIndexes` passes and the parse is reached.
   - Expect `toThrow('Invalid network version')`.
   - **Green on base and after.** It shows the conversion did not bypass the network check.
3. Same file, guard: `it.each(['Vpub', 'Upub'] as const)('multisig %s signer keys produce the same witness evidence as tpub keys', …)`.
   - Map `testMultisigKeys` (`psbtBuilderTestFixtures.ts:4-23`) through
     `convertXpubToFormat(key.xpub, format)`, imported from `'…/addressDerivation/xpubConversion'`. Use
     `multisigScriptType` `'wsh-sortedmulti'` for Vpub and `'sh-wsh-sortedmulti'` for Upub.
   - Assert the result `toEqual` the evidence from the tpub keys at the same path (`"m/48'/1'/0'/2'/0/3"`).
   - **Green on base and after.** It pins that multisig never took the broken path.
4. New file `server/tests/unit/services/bitcoin/estimation.slip132NestedSegwit.test.ts`, about 110 lines.
   It exercises the estimate path through the real `feePolicy`, `psbtConstruction.resolveWalletSigningInfo`,
   `utxoSelection.selectUTXOsExact` and `transactionWeight`. The weight estimator checks that the redeem script
   commits to the UTXO's `scriptPubKey` (`transactionWeight.ts:225-227`), so it is a byte-exact end-to-end check
   of the derived key.
   - Setup:
     - mock only `'../../../../src/models/prisma'` with `mockPrismaClient` (the pattern from
       `transactionFeePolicy.test.ts:7-9`), and `resetPrismaMocks()` in `beforeEach`;
     - `mockPrismaClient.wallet.findUnique` resolves:
       `{ id: 'w1', type: 'single_sig', scriptType: 'nested_segwit', network, devices: [{ signerBindingVersion: 1, signerIndex: 0, deviceAccountId: 'acct-1', signerFingerprint: '73c5da0a', signerXpub, signerDerivationPath: v.path, deviceId: 'dev-1', device: { id: 'dev-1', fingerprint: '73c5da0a', xpub: signerXpub } }] }`;
     - `mockPrismaClient.uTXO.findMany` resolves one row
       `{ id: 'u1', txid: '11'.repeat(32), vout: 0, amount: 100_000n, scriptPubKey: v.expectedScriptPubKey, address: v.expectedAddress }`;
     - `mockPrismaClient.address.findMany` resolves `[{ address: v.expectedAddress, derivationPath: `${v.path}/0/0` }]`;
     - `systemSetting.findUnique` keeps its `null` default, so the default dust threshold and confirmation
       threshold apply.
   - Vectors: `mainnet:a0:b0:i0` (ypub, wallet `network: 'mainnet'`) and `testnet3:a0:b0:i0` (upub, wallet
     `network: 'testnet3'`).
   - Recipient: `bitcoin.payments.p2wpkh({ hash: Buffer.alloc(20, 1), network }).address!`.
   - Test `it.each(VECTORS)('estimates a nested SegWit spend from a SLIP-132 $prefix signer exactly like its standard-version twin', …)`:
     - `control = await estimateTransaction('w1', recipient, 50_000, 5)` with
       `signerXpub = convertToStandardXpub(v.xpub)`;
     - `actual = …` with `signerXpub = v.xpub`;
     - expect `control.sufficient === true` and `control.inputCount === 1` (a control that fails on base means
       the harness is wrong, not the bug);
     - expect `actual` `toEqual(control)`.
   - **Red on base:** `actual` is
     `{ fee: 0, totalCost: 50000, inputCount: 0, outputCount: 1, changeAmount: 0, sufficient: false, error: 'Invalid network version' }`.
   - This path uses `createTransactionSpendPolicyResolver`, the same resolver `createTransaction.ts:98` and
     `createBatchTransaction.ts:75` use. A create-transaction-level case is not added: that harness mocks
     `convertToStandardXpub` as the identity function (see D-13.1), so `parseAccountNode` would fail later for
     a harness reason.
   - If module collection fails on base (an unmocked import with side effects), fix the harness before the
     source change. A collection error is not an acceptable red.

Confirm red first (tests only, before the source change):
`cd server && npx vitest run tests/unit/services/bitcoin/transactionFeePolicy.test.ts tests/unit/services/bitcoin/estimation.slip132NestedSegwit.test.ts`

Expected red result:
- 60 failures from case 1, plus 2 from case 4;
- cases 2 and 3, the length test and every existing case pass.

After the source change, all of these pass, and so do:
`cd server && npx vitest run tests/unit/services/bitcoin/estimation.test.ts tests/unit/services/bitcoin/transactionService.create.test.ts tests/unit/services/bitcoin/transactionService.batch.test.ts tests/unit/services/bitcoin/advancedTx.test.ts tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts`

(The `transactionServiceCreate/` and `transactionServiceBatch/` dirs hold only `.contracts.ts` files and a harness; a
dir filter matches nothing, so the suites are named by their `transactionService.{create,batch}.test.ts` runners.)

**Existing tests the fix breaks.** None are expected: every current fixture passes a tpub, and the conversion
leaves it unchanged. The worker runs the command above after the source change and records any failure as a
plan deviation.

**Callers/contracts touched.** `resolveTransactionSpendPolicy` and `createTransactionSpendPolicyResolver` keep
their signatures. The six callers listed under Evidence are unchanged. No API or response shape changes.

**Mutation-pin / inventory impact (checked at 20361d62b3).**
- `config/wallet-safety-mutation-map.json`: **no**. `grep -n "transactions/feePolicy"` has no hits. The only
  fee-policy entries are `src/services/bitcoin/signingIntent/feePolicy.ts` (`:930`, `:942`), a different file.
  The `transactions/` entries (`:669`, `:673`, `:933-934`) are for `psbtConstruction.ts`,
  `psbtInputConstruction.ts`, `outputBuilder.ts` and `createBatchTransaction.ts`, none of which is edited.
- `server/stryker.*.config.mjs` mutate ranges: **no**. `stryker.fee-policy.config.mjs:6-17` mutates
  `signingIntent/feePolicy.ts`, `transactionWeight.ts`, `utxoSelection.ts:115-205`, `outputBuilder.ts:113-137`,
  `createBatchTransaction.ts:301-406,412-466`, `advancedTx/batch.ts:120-178,259-279`, `cpfp.ts:38-70` and
  `rbf.ts:232-242`. None is `transactions/feePolicy.ts`, and A1 edits none of them.
  `stryker.taproot-construction.config.mjs:7-8` lists other files. Critical shards
  (`server/scripts/mutation/shards.mjs:18-62`) cover `addressDerivation/**` (not edited) and not `transactions/feePolicy.ts`.
  The one-line import shift in `feePolicy.ts` moves no pinned range.
- `config/wallet-sync-mutation-boundaries.json`: **no**. No sync-path file and no repository call.
- verify-vectors `sourceManifest` (`scripts/verify-addresses/sourceManifest.ts`): **no**. The fixture is only
  imported.
- `config/wallet-safety-critical-paths.json:11` (`server/src/services/bitcoin/**`): **yes**. The PR runs the
  verify-vectors workflow. That is expected and needs no regeneration.
- Signer inventory: **no**. No new `sign*`/`finalize*`/`broadcast*` identifier.
- `arch:check`: **no** change. `server.md` collapses nodes to `src/<dir>` and services → services already
  exists. The integrator still runs it (Verification block).

**Verification.**
- Worker: `cd server && npx tsc --noEmit && npm run typecheck:tests`, the two targeted commands above, lizard on
  changed files, and `node scripts/quality/check-large-files.mjs`.
- Integrator-only (Verification block): backend unit coverage (`--coverage tests/unit`, stays at 100%) and
  `npm run arch:check`.

**Acceptance.**
- `resolveTransactionSpendPolicy` returns byte-exact `p2sh-p2wpkh` evidence for all 60 verified ypub/upub
  nested-SegWit vectors, identical to their xpub/tpub twins.
- `estimateTransaction` for a nested-SegWit wallet with a ypub (mainnet) or upub (testnet3) signer returns the
  same estimate as the standard-version wallet.
- A SLIP-132 key on the wrong network still fails closed.
- Multisig SLIP-132 evidence is unchanged.
- No raw unconverted `fromBase58` on a stored account xpub remains in `server/src` (sweep table above).

**Rollback.** Revert the one-line change and its import. Rollback needs no data or schema step. Wallets with
ypub/upub signers return to being unable to estimate or send. They do not become unsafe.

### Phase A2 — Re-check any_n votes against live approver eligibility (P2 `approval-any-n--stale-votes-count-after-access-loss`)

**Evidence (re-verified at 20361d62b3).**
- `server/src/services/vaultPolicy/approvalService.ts:666-669`: `case 'any_n': quorumMet = approveVotes.length >= request.requiredApprovals;`.
  It counts every stored approve vote, with no check of whether the voter can still approve.
- The other two quorum types re-check live state when the request resolves:
  - `'all'`: `checkAllQuorumMet` (`:560-576`) compares votes with `getEligibleApproverIds` (`:539-552`).
  - `'specific'`: `checkSpecificQuorumMet` (`:613-637`) filters votes against the live `specificApprovers`
    (`:635`). The comment at `:682-686` says a voter dropped after approving must not count.
- Who may vote on `any_n` (at cast time):
  - The route `POST /:walletId/drafts/:draftId/approvals/:requestId/vote` requires
    `requireWalletAccess('approve')` (`api/wallets/approvals.ts:69-71`). That is a role in
    `WALLET_APPROVE_ROLE_VALUES = ['owner', 'approver']` (`shared/constants/walletRoles.ts:30-33`).
  - The role is resolved by `getUserWalletRoleUncached` (`services/accessControl.ts:59-79`): a direct
    `walletUser` grant first, otherwise the group role.
  - `findEffectiveApproverIds` (`repositories/walletSharingRepository.ts:195-217`) computes the same set: direct
    grant with an approve role, or no direct grant and a group grant with an approve role.
  - `ensureEligibleToVote` (`approvalService.ts:235-239` → `isEligibleSpecificApprover` `:247-257`) is a no-op
    for `any_n`.
  - The self-approval guard (`getDraftForAllowedVote` `:297-308`) blocks the requester unless
    `allowSelfApproval`.
  - So the any_n eligible set is exactly `getEligibleApproverIds(draft.walletId, draft.userId, request.allowSelfApproval)`,
    the set `'all'` already uses. The design doc agrees: "`any_n` — Any N approvers from the eligible set"
    (`docs/plans/vault-policies-plan.md:150`).
- Votes survive loss of access. Nothing in `server/src` deletes `approvalVote` rows. `ApprovalVote` has
  `@@unique([approvalRequestId, userId])` (`prisma/schema.prisma:1755`), so a user can have at most one vote.
- Trigger: an any_n request with `requiredApprovals: 2`.
  1. Approver A votes approve.
  2. The owner removes A or downgrades A to viewer (for example, A's account is suspected compromised).
  3. Approver B votes approve.
  4. The request resolves `approved` on A's stale vote, and the vault-policy spend is unblocked.
- Tests miss it:
  - `tests/unit/services/approvalService/approvalService.cast-vote-resolution.contracts.ts:56` checks any_n
    counting with no revoked voter;
  - the harness defaults `findEffectiveApproverIds` to `[]` (`approvalServiceTestHarness.ts:107-110`), and
    any_n never reads it;
  - no integration spec votes on an any_n request.

**Fix design.**
- D-13.4: add `checkAnyNQuorumMet(request, approveVotes, draft)` next to `checkAllQuorumMet`, as a top-level
  `async function`. Its doc comment states the rule: only approve votes from currently eligible approvers count.

  ```ts
  async function checkAnyNQuorumMet(
    request: ApprovalRequest,
    approveVotes: ApprovalVote[],
    draft: ApprovalDraft
  ): Promise<boolean> {
    if (!draft || !isPositiveInteger(request.requiredApprovals)) {
      return false;
    }
    const eligibleIds = new Set(
      await getEligibleApproverIds(draft.walletId, draft.userId, request.allowSelfApproval)
    );
    const eligibleApproveVotes = approveVotes.filter(v => eligibleIds.has(v.userId));
    return eligibleApproveVotes.length >= request.requiredApprovals;
  }
  ```

  - `:667-669` becomes `quorumMet = await checkAnyNQuorumMet(request, approveVotes, draft);`, with a short
    comment pointing to `checkAllQuorumMet`.
  - CCN stays at or below 4. `approvalService.ts` grows from 802 to about 830 lines, under the 1000-line gate.
- D-13.5: the eligible set is the one `'all'` uses (direct grant overrides group; requester excluded unless
  `allowSelfApproval`).
  - Not a policy-specific roster: any_n has none.
  - Not a new repository query: no new data access, and no entry in the wallet-sync boundaries.
- D-13.6: the threshold stays `request.requiredApprovals`, the creation-time snapshot. It is not clamped to the
  eligible-set size.
  - Clamping would quietly turn a 2-of-N policy into 1-of-1 after a removal, which weakens a funds control.
  - If removals leave fewer eligible approvers than required, the request waits until expiry, owner override
    or a new approver. That is fail-closed, and it is the intended trade-off.
  - Fail closed on a missing draft (as `checkAllQuorumMet` does at `:565-567`) and on a non-positive or
    non-integer `requiredApprovals`, using the existing `isPositiveInteger` (`:293-295`). Policy writes enforce
    a positive integer (`vaultPolicyService.ts:448`, `api/schemas/vaultPolicy.ts:50`), so only legacy or
    corrupt rows hit this guard.
- D-13.7: reject and veto votes are not re-filtered. Any reject or veto resolves the request at cast time
  (`:647-661`), so a pending request never holds one that a later revocation could make stale. Their eligibility
  was checked when they were cast.
- D-13.8: removing access does not re-trigger resolution. This matches the `'all'` comment at `:671-678`. For
  any_n it is also never needed: losing eligibility can only lower the count, so a removal can never newly meet
  quorum. Restoring a user's access makes their earlier vote count again, the same as being re-listed under
  `'specific'` (see Open questions).
- D-13.9 (concurrency):
  - Two resolvers still race through `resolveApprovalRequestIfPending` (`:703-719`), which is unchanged; the
    loser leaves the draft alone.
  - If a revocation commits *after* the resolver reads the eligible set, the request still resolves. This is the
    same read-then-decide window `'all'` has, and it is accepted.
  - Closing it would need resolution and membership edits under one transaction or lock. That is out of scope
    and is recorded as an open question.
- D-13.10: owner override (`:387-464`) is unchanged. It skips quorum on purpose and is gated by
  `requireWalletAccess('owner')`, which is checked live.
- D-13.11 (display, out of scope): two counts still include every approve vote:
  - `logApprovalVoteEvent` `details.currentApprovals` (`:360`);
  - the vote route's `currentApprovals` (`api/wallets/approvals.ts:107`).

  `'specific'` and `'all'` already have the same display mismatch. Changing the response shape is a separate
  product decision (Open questions).

**Failing-first tests.**
1. New unit contracts file
   `server/tests/unit/services/approvalService/approvalService.any-n-eligibility.contracts.ts`, about 180 lines.
   - It exports `registerAnyNEligibilityContracts()`, with every `it` nested in it like the sibling files.
   - Register it in `server/tests/unit/services/approvalService.test.ts` as
     `describe('quorum membership (any_n)', () => { registerAnyNEligibilityContracts(); });`.
   - All cases use `makePendingRequest({ quorumType: 'any_n', requiredApprovals: 2 })`, the harness IDs and
     `mockVoteRequestReads`, with `mockDraftRepo.findById` resolving `{ userId: 'creator', walletId }`.
     `revokedId = faker.string.uuid()`. Every case also sets
     `mockPolicyRepo.findApprovalRequestsByDraftId.mockResolvedValue([{ ...afterVote, status: 'approved' }])` and
     `mockPolicyRepo.createVote.mockResolvedValue({ id: 'vx', decision: 'approve' })`, so on base the red is the
     `resolveApprovalRequestIfPending` / `updateApprovalStatus` assertion, not a TypeError from an unmocked repository
     read (`updateDraftApprovalFromRequests`, `approvalService.ts:736`; the harness `beforeEach` only
     `clearAllMocks()`s, so implementations can leak between contracts). Use
     `mockVoteRequestReads(initial, afterVote, 'pending')` for cases 1–4 and `'approved'` for cases 5 and 6.

   | # | Name | After-vote votes | `findEffectiveApproverIds` | Expect | On base |
   |---|---|---|---|---|---|
   | 1 | `any_n: an approve vote from a voter who has since lost approver access does not count` | `[{ userId: revokedId, decision: 'approve' }, { userId: otherUserId, decision: 'approve' }]`; caller `otherUserId` | `[otherUserId, userId]` | `resolveApprovalRequestIfPending` not called; `mockDraftRepo.updateApprovalStatus` not called; `findEffectiveApproverIds` called with `(walletId, undefined)` | **RED**: resolves `'approved'` |
   | 2 | `any_n: never counts the requester's own approve vote when self-approval is disallowed` (legacy row) | `[{ userId: 'creator', … }, { userId: otherUserId, … }]` | `['creator', otherUserId]`, filtered by `allowSelfApproval: false` | not resolved | **RED** |
   | 3 | `any_n: never resolves when the backing draft is missing` | two approve votes; `findById` → `null` | `[otherUserId, userId]` | not resolved | **RED** |
   | 4 | `any_n: never resolves on a non-positive requiredApprovals snapshot` | `requiredApprovals: 0`, one approve vote | `[otherUserId]` | not resolved | **RED** (`1 >= 0`) |
   | 5 | `any_n: resolves once enough currently eligible approvers vote, ignoring a revoked vote already on the request` | `[revokedId, otherUserId, userId]` approves | `[otherUserId, userId]` | `resolveApprovalRequestIfPending(requestId, 'approved')`; draft `'approved'` | green on both (stops over-filtering) |
   | 6 | `any_n: counts the requester's own approve vote when allowSelfApproval is true` | `allowSelfApproval: true`, `requiredApprovals: 1`, caller `'creator'`, `[{ userId: 'creator', decision: 'approve' }]` | `['creator']` | `resolveApprovalRequestIfPending(requestId, 'approved')` | green on both (pins the positive half of the D-13.5 self-approval rule) |

   The unit harness mocks `walletSharingRepository` wholesale, so group eligibility is proven only by integration
   cases (d) and (e) below, against the real `findEffectiveApproverIds` query (`walletSharingRepository.ts:195-217`).

2. New integration spec `server/tests/integration/flows/approvalAnyNEligibility.integration.test.ts`, about
   160 lines. It follows `approvalExpirySweep.integration.test.ts:1-70` (`describeWithDb`, `setupTestDatabase`,
   `cleanupTestData`, `createTestUser`) and calls `approvalService.castVote` directly against real PostgreSQL,
   so the real `findEffectiveApproverIds` query runs.
   - Seed:
     - users `owner`, `approverA`, `approverB`;
     - a wallet with `users: { create: [{ userId: owner.id, role: 'owner' }, { userId: approverA.id, role: 'approver' }, { userId: approverB.id, role: 'approver' }] }`
       (the nested-create shape from `tests/integration/api/walletApprovalsAudit.test.ts:109`);
     - a `vaultPolicy` with `config: { requiredApprovals: 2, quorumType: 'any_n', allowSelfApproval: false }`;
     - a draft by `owner` with `approvalStatus: 'pending'` (fields as `approvalExpirySweep.integration.test.ts:51-66`);
     - an `approvalRequest` `{ status: 'pending', requiredApprovals: 2, quorumType: 'any_n', allowSelfApproval: false, expiresAt: null }`.
   - Cases:
     - (a) `removing an approver after they approved keeps an any_n request pending`: A approves →
       `prisma.walletUser.deleteMany({ where: { walletId, userId: approverA.id } })` → B approves. Expect the
       request and the draft `approvalStatus` to stay `'pending'`. **RED on base:** both `'approved'`.
     - (b) `downgrading an approver to viewer after they approved keeps an any_n request pending`: same, with
       `prisma.walletUser.updateMany({ …, data: { role: 'viewer' } })`. **RED on base.**
     - (c) `an any_n request resolves when both voters still hold approver access` (control): A then B approve →
       `'approved'`. Green on both.
     - (d) `a group-only approver's earlier vote still counts`: a wallet with `groupId` set (a `group` with
       approverA as a `groupMember`) and `groupRole: 'approver'`, where approverA has **no** `walletUser` row. A
       approves, then B approves → `'approved'`. Green on both.
     - (e) `a direct viewer grant overrides a group approver role`: same seed as (d), but after A approves, give A a
       direct `walletUser` row with `role: 'viewer'`. B approves → request and draft stay `'pending'`. **RED on
       base.** This is the case where A2 and the route (`getUserWalletRoleUncached`, direct grant first) must agree.
     - (d) and (e) add about 40 lines; the spec stays under 250.
   - Register the spec in `scripts/ci/backend-integration-groups.sh`, `GROUP_FLOWS` list (`:31-56`), directly
     before `tests/integration/flows/approvalExpirySweep.integration.test.ts` (`:35`), in alphabetical order. The
     `--check` mode enforces no order (`check_groups`, `:163-183`, sorts both sides before comparing), so this one
     position is a readability choice; the spec must be listed exactly once. Without the line, the CI classifier
     lane fails.

Confirm red first (tests only, before the source change):
- `cd server && npx vitest run tests/unit/services/approvalService.test.ts`: cases 1–4 fail for the reasons
  above; cases 5–6 and every existing case pass. Each of cases 1–4 must fail on an assertion (`expected … not to be
  called`), not on a thrown error.
- `flock /home/nekoguntai/.i13-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/approvalAnyNEligibility.integration.test.ts`:
  (a), (b) and (e) fail; (c) and (d) pass.

After the source change, both pass in full.

**Existing tests the fix breaks (fixture migrations).** The harness default `findEffectiveApproverIds → []`
(`approvalServiceTestHarness.ts:110`) now makes every any_n approve vote ineligible. Keep the default; it is
fail-closed and the `'all'` contracts rely on it. In each case below that expects an any_n approval to resolve,
add `mockWalletSharingRepo.findEffectiveApproverIds.mockResolvedValue([otherUserId])`, importing
`mockWalletSharingRepo` where it is missing:
- `approvalService.cast-vote-resolution.contracts.ts`:
  - `:56` "resolves request when any_n quorum is met";
  - the `'approve'` row of `it.each` "returns the persisted %s resolution snapshot (%s)" (`:149-171`). Set the
    mock for every row: rows that resolve on reject or veto never read it;
  - the two `'approve'` rows of "returns the winner when %s loses its %s resolution to %s" (`:201-231`), same
    rule.
- `approvalService.concurrent-resolution.contracts.ts:19` "does not overwrite a concurrently committed rejection
  with an approval".
- `approvalService.draft-status.contracts.ts`:
  - `:55` "updates draft to approved and sends notification…";
  - `:81` "does not send notification when draft not found…" (its first `findById` (`:94`) is the vote's
    draft and the second (`:95`) is `null` for the notification, so only the eligibility mock is added);
  - `:134` "stays pending when requests have mixed pending/approved statuses";
  - `:163` "logs warning when notifyApprovalResolved fails after all approved".
- `approvalService.cast-vote-guards.contracts.ts:68` "allows self-approval when allowSelfApproval is true"
  asserts only `vote.decision`, so it does not fail. Still set
  `findEffectiveApproverIds.mockResolvedValue([creatorId])`, and add
  `expect(mockPolicyRepo.resolveApprovalRequestIfPending).toHaveBeenCalledWith(requestId, 'approved')` so the any_n
  self-approval-allowed path is asserted here as well as by new unit case 6.

The worker applies the source change alone, runs the unit command, and checks that the failing set is exactly
this list. Tests outside `approvalService/` mock the service wholesale and are unaffected:
- `mobileAgentDraftService.test.ts`, `draftCreate.test.ts`, `draftService.test.ts`;
- `api/wallets-approvals-routes.test.ts`, `api/approvals-routes.test.ts`;
- `assistant/readToolExecutors.test.ts`, `jobs/maintenanceDefinitions.behavior.test.ts`.

Integration specs `approvalExpirySweep` (no votes), `walletApprovalsAudit` (cross-wallet refusals only;
`:197-274` expects 4xx) and `payjoinTwoRound.policy.contracts.ts` (no vote route) are unaffected.

**Callers/contracts touched.** Only private `checkAndResolveRequest`. `castVote`, `ownerOverride`,
`isEligibleSpecificApprover` and the route responses keep their signatures and shapes. `castVote` makes one more
`findEffectiveApproverIds` read for any_n approve votes, an indexed query that `'all'` already makes.

**Mutation-pin / inventory impact (checked at 20361d62b3).**
- `config/wallet-safety-mutation-map.json`: **no** (`grep -n "approval\|vaultPolicy"` → no hits).
- `server/stryker.*.config.mjs` and `server/scripts/mutation/shards.mjs`: **no**. Neither mutates
  `src/services/vaultPolicy/**`.
- `config/wallet-sync-mutation-boundaries.json`: **no** (no hits; not a sync-path file).
- verify-vectors `sourceManifest` and `config/wallet-safety-critical-paths.json`: **no**. `vaultPolicy/` is not
  listed.
- Signer inventory: **no**. `checkAnyNQuorumMet` has none of the swept prefixes.
- `arch:check`: **no** new edge. `approvalService.ts:18` already imports `walletSharingRepository`.
- Backend integration registry: **yes**, the one new line above.

**Verification.**
- `cd server && npx tsc --noEmit && npm run typecheck:tests`
- `cd server && npx vitest run tests/unit/services/approvalService.test.ts`
- `flock /home/nekoguntai/.i13-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/approvalAnyNEligibility.integration.test.ts tests/integration/flows/approvalExpirySweep.integration.test.ts tests/integration/api/walletApprovalsAudit.test.ts`
- `bash scripts/ci/backend-integration-groups.sh --check` (`:185`) and `bash tests/ci/backend-integration-groups.test.sh`.
  The new spec must be listed exactly once.
- `node scripts/quality/check-large-files.mjs`, lizard on changed files.
- Integrator-only (Verification block): backend unit coverage (100% must hold: the `!draft` and
  `!isPositiveInteger` arms are covered by cases 3 and 4).

**Acceptance.**
- An any_n request resolves `approved` only when at least `requiredApprovals` approve votes come from users who
  are effective approvers at resolution time:
  - direct `owner`/`approver`, or a group approver with no direct grant;
  - the requester excluded unless `allowSelfApproval`.
- A removed or downgraded approver's earlier vote no longer satisfies quorum (integration (a), (b)), and a direct
  `viewer` grant overrides a group `approver` role (integration (e)).
- Eligible votes still resolve (unit 5–6, integration (c), and a group-only approver in (d)).
- A missing draft or a non-positive snapshot never resolves.
- Reject, veto, owner override, expiry and lost-race behaviour are unchanged; their existing contracts pass
  unmodified.

**Rollback.** Revert `checkAnyNQuorumMet`, the switch arm, the test-fixture eligibility lines, the two new test
files and the registry line. Rollback needs no data or schema step: votes were never deleted, so any_n goes back
to counting every stored approve vote.

### Phase A open questions

1. **Re-granted access revives an old vote (A2, D-13.8).** If A approves, loses access, and gets it back, A's
   original vote counts again. That matches `'specific'` re-listing. The only alternative is deleting or voiding
   votes on access loss. That needs a new write path in `walletSharingRepository` mutations and an audit-trail
   decision. *Recommendation:* accept this for now. Restoring access is an owner action, and the vote was cast
   by an approver who is eligible again. Revisit only if product wants "revocation voids pending votes".
2. **Revocation racing resolution (A2, D-13.9).** A revocation that commits between the eligible-set read and
   `resolveApprovalRequestIfPending` does not stop resolution. `'all'` has the same window. *Recommendation:*
   accept and document it. Closing it means running resolution and membership changes under one transaction or
   advisory lock across `walletSharingRepository` and `policyRepository`. That is a larger change, better as
   its own item if wanted.
3. **Displayed `currentApprovals` (A2, D-13.11).** The vote response and the policy event still count every
   approve vote, so the UI can show "2 of 2" on a request that is still pending. *Recommendation:* leave the
   API shape alone in this phase. If product wants it, add a separate `eligibleApprovals` field for all three
   quorum types in a follow-up. Changing `currentApprovals` in place would silently alter an existing audit
   field.

## Phase B — frontend fixes (B1–B3)

I re-read all evidence on `20361d62b3` in `/home/nekoguntai/sanctuary-bug-scrub-20261013-i13`. The decisions are
D-13.B1a–D-13.B3d (local numbering; the integrator renumbers them). B1, B2 and B3 touch disjoint files, so they can run
in three worktrees (`b1`–`b3`). The one shared surface is `docs/architecture/generated`: B2 adds a module, and B1 adds
an import edge. The integrator regenerates it once, in the integration worktree, which has a real `npm ci` `node_modules` (never a symlink: the arch:check worktree-symlink artifact drops `shared/*` edges).
None of the three phases adds an endpoint, a query parameter, a Prisma migration, or a server change.

All frontend test commands below use the repository config:
`npx vitest run --config config/tooling/vitest.config.ts <files>`.

### Phase B1 — A feature-disabled Treasury Intelligence stops the 1 Hz status poll (P2 `intelligence-status--disabled-feature-1hz-poll-forever`)

**Evidence (re-verified).**
- `server/src/api/intelligence.ts:67-68` runs `router.use(authenticate)` and then
  `router.use(requireAllFeatures(['aiAssistant', 'treasuryIntelligence']))`, ahead of `GET /status` (`:78-81`).
- `server/src/middleware/featureGate.ts:94-105`: when any flag is off, the gate logs
  `log.info('Feature gate blocked request (missing features)', …)` on every request. It then answers **403** with
  `{ error: 'Features not available', requiredFeatures, disabledFeatures, message }`. A flag-service failure answers
  **503** instead (`:27-34`, `:110-112`).
- Both flags default to `false` (`server/src/config/features.ts:55,59`), so a default install takes the 403 path.
- `src/api/intelligence.ts:80-82` is a plain `apiClient.get`. The client throws `ApiError(message, status, body)`
  (`src/api/client.ts:487-496`) and retries only status 0, retryable 5xx and `TypeError` internally (`:153-164`), so a
  403 reaches the hook immediately.
- `src/hooks/useIntelligenceStatus.ts:24` sets `RETRY_DELAY_MS = 1_000`. The `catch` at `:62-68` publishes
  `UNAVAILABLE_STATUS` and calls `scheduleRetry()` for any error. `scheduleRetry` (`:44-50`) stops only when
  `listeners.size === 0`. It has no status check, no backoff and no cap.
- The Layout keeps a listener mounted for the whole session: `src/components/Layout/useLayoutController.ts:41`,
  through `src/hooks/useAppCapabilities.ts:8`. `src/app/AppRoutes/AppRouteSwitch.tsx` (`CapabilityGatedRoute`,
  through `useAppCapabilityStates`) adds a second listener only while a capability-gated route is mounted
  (`routeDefinitions.tsx:103,173`).
- Result: each open tab sends about 60 requests per minute, and the server writes about 60 info log lines per minute,
  with no end. All of this counts against the shared per-IP `/api` limiter (`server/src/index.ts:115-121`).
- For contrast, `server/src/api/ai/status.ts:62-68` answers 200 with a disabled payload, so `useAIStatus` does not
  loop.
- Tests: `tests/hooks/useIntelligenceStatus.test.ts:72-98` asserts the endless 1 s retry with a generic `Error`. No
  test models a 403. Confirmed.

**E2E mock question (resolved: no change).** All 13 e2e mock sites answer
`200 { available: false, ollamaConfigured: false }` for `GET /intelligence/status`. One example is
`tests/e2e/adminOperationsApiState.ts:177`; the baseline key is in `tests/e2e/fixtures/apiBaseline.ts:20`. This is a
real server response: it is the payload when the flags are on but no provider is configured
(`server/src/services/intelligence/analysisService.ts:458-474`). The fix leaves the 200 path unchanged, so the mocks
stay valid. The 403 path is proven with deterministic fake timers in vitest. A Playwright case would have to wait out
wall-clock seconds to count requests, which adds flake risk and runtime and buys nothing extra. **No e2e mock map
changes. No new endpoint.**

**Decisions.**
- **D-13.B1a — a client 4xx is terminal for the session.** A status-check failure is terminal when it is an `ApiError`
  with `400 <= status < 500`, except 408 and 429. The feature-gate 403 is the case that matters. A 401 means
  refresh-and-logout has already run, and a 404 means an older server; neither changes on retry. On a terminal error,
  the hook publishes `UNAVAILABLE_STATUS` and sets `terminalSnapshot = true` and `failedSnapshot = false`. It does
  **not** schedule a retry.

  A terminal snapshot is rechecked only in two cases:
  - `invalidateIntelligenceStatus()` is called. Admin flag toggles already call it
    (`src/components/FeatureFlags/index.tsx:16-23`), and so do AI settings changes (`useAISettings.ts:86`,
    `useAIFeatureToggle.ts:75`).
  - A subscribe arrives while there are no listeners (`listeners.size === 0` before the add). This happens on a new
    session after logout/login, because the Layout unmounts.

  A second consumer that mounts while the first is still subscribed does not refetch.
- **D-13.B1b — transient failures back off exponentially, with a cap.** This covers non-`ApiError` failures,
  status 0, 408, 429 and 5xx/503. The delay is `min(1_000 * 2 ** retryAttempt, 60_000)` ms, so 1, 2, 4, 8, 16, 32,
  then 60 s. Retries continue at the cap with no attempt limit, so the tab recovers by itself after an outage.
  `retryAttempt` resets to 0 on a success, on `invalidateIntelligenceStatus()`, and when the last listener
  unsubscribes. There is no jitter: the hook state is module-wide (one timer per tab), and deterministic delays keep
  the tests exact.
- **D-13.B1c — no server change in this iteration.** Moving `GET /status` ahead of the gate so it answers 200 like
  `/ai/status` is OQ-B1. With D-13.B1a, a default install sends one 403 per session instead of one per second.

**Production changes.** `src/hooks/useIntelligenceStatus.ts` only:
- Import `{ ApiError } from '../api/client'`. This is a new `src/hooks → src/api/client` edge; hooks→api edges already
  exist through `../api/intelligence`.
- Replace `RETRY_DELAY_MS` with `RETRY_BASE_DELAY_MS = 1_000` and `RETRY_MAX_DELAY_MS = 60_000`. Add module state
  `let retryAttempt = 0;` and `let terminalSnapshot = false;`.
- Add `const isTerminalStatusError = (error: unknown): boolean => error instanceof ApiError && error.status >= 400 &&
  error.status < 500 && error.status !== 408 && error.status !== 429;`.
- `scheduleRetry`: compute the delay from `retryAttempt`, then `retryAttempt += 1`.
- `startStatusRequest`:
  - On success: also set `retryAttempt = 0` (defensive: unobservable today, because after a success no request
    starts until an invalidation, which resets it too) and `terminalSnapshot = false`.
  - In `catch (error)`: if `isTerminalStatusError(error)`, set `failedSnapshot = false` and `terminalSnapshot = true`,
    publish `UNAVAILABLE_STATUS`, and return without a retry. Otherwise keep today's path.
  - The generation guards stay first.
- `subscribe`: capture `const wasIdle = listeners.size === 0` before the add. Start a request when
  `(snapshot.loading || failedSnapshot || (terminalSnapshot && wasIdle)) && !retryTimer && activeGeneration !== generation`.
  The cleanup also resets `retryAttempt = 0` when the last listener leaves.
- `invalidateIntelligenceStatus`: also set `terminalSnapshot = false` and `retryAttempt = 0`.

Update the header comment (`:1-11`) to describe the terminal and backoff behaviour.

**Tests first.** All in `tests/hooks/useIntelligenceStatus.test.ts` (269 lines, about 380 after the edits). Import
`ApiError` from `../../src/api/client`; it is not mocked, so the real class is used. The `beforeEach` already calls
`invalidateIntelligenceStatus()`, which after the fix also resets the new module state.

Failing on base:
1. **"treats a feature-gate 403 as terminal and stops polling".** Use fake timers. `getIntelligenceStatus`
   always rejects with `new ApiError('Features not available', 403, { error: 'Features not available',
   disabledFeatures: ['aiAssistant', 'treasuryIntelligence'] })`. Render, flush one microtask, then
   `advanceTimersByTimeAsync(120_000)`. Assert `toHaveBeenCalledTimes(1)` and
   `result.current` equals `{ available: false, loading: false }`.
   **Red on base:** called 121 times.
   Extend it with `it.each([401, 403, 404])` (same shape, `ApiError(…, status)`): exactly 1 call after 120 s for
   each, so a regression that made 401 or 404 transient fails. All three rows are red on base.
2. **"backs off transient failures exponentially up to a one-minute cap".** Use fake timers and an always-rejecting
   `new Error('outage')`. After the first call, the call counts must be:
   - +1_000 ms → 2
   - +1_999 ms → still 2
   - +1 ms → 3
   - +4_000 → 4
   - +8_000 → 5
   - +16_000 → 6
   - +32_000 → 7
   - +60_000 → 8 (the 64 s step is capped)
   - +60_000 → 9

   **Red on base:** 3 calls already at the "+1_999" step.

Guards (they pass on base and must still pass). They must be cadence-neutral, because base retries every 1 s:
- reach N failures with `await act(async () => { await vi.advanceTimersToNextTimerAsync(); })` once per retry, not
  fixed `advanceTimersByTimeAsync` steps;
- assert counts as deltas from a count recorded after the invalidation or re-render;
- never advance past the first 1_000 ms retry before an absolute-count assertion.

3. **"rechecks a terminal status after invalidation".** After case 1's render and microtask flush (no timer advance), set
   `mockResolvedValue({ available: true, ollamaConfigured: true })`, then `act(() => invalidateIntelligenceStatus())`.
   Expect 2 calls and `available: true`.
4. **"rechecks a terminal status when a new session subscribes after every consumer unmounted".** Get a 403, unmount,
   render again. Expect 2 calls.
5. **"does not refetch a terminal status for an additional consumer".** Get a 403 with the first hook still mounted,
   then render a second hook. Expect 1 call.
6. **"treats status 0, 408, 429 and 503 ApiErrors as transient".** `it.each([0, 408, 429, 503])`: an
   `ApiError(…, status)` rejection, then a resolve. Expect a retry after 1_000 ms, ending at `available: true`. Status 0
   matters: after a network blip the client wraps the `TypeError` as `ApiError(<message>, 0)` and rethrows it once its
   retry budget is spent (`src/api/client.ts:197-205,232`; `:237` is the unreachable fallback), and treating it as terminal would stop all retries. Add one two-step row
   (`ApiError(…, 429)` then `ApiError(…, 503)`, then a resolve). Expect 2 calls at +1_000 ms and 3 calls after a
   further +2_000 ms. No "+1_999" assertion: base retries at +1_000.
7a. **"restarts the backoff at one second after an invalidation".** Fail ×3 (two `advanceTimersToNextTimerAsync`
   steps), so the next delay would be 8 s. Call `invalidateIntelligenceStatus()`; its request fails. Record
   `c = calls`; then `+999 ms → c`, `+1 ms → c + 1` (the next call comes after 1_000 ms, not 8_000).
7b. **"restarts the backoff when the last consumer leaves".** Fail ×3 (two `advanceTimersToNextTimerAsync` steps),
   unmount, render again; that request fails. Record `c = calls`; then `+999 ms → c`, `+1 ms → c + 1`. Each of 7a and 7b fails if its own `retryAttempt = 0` reset is removed.

Existing case to edit: **"keeps retrying failed capability requests until the shared snapshot recovers"**
(`:72-98`). Its second `advanceTimersByTimeAsync(1_000)` (`:92`) becomes `2_000`. Nothing else asserts the
1 s cadence (`grep -rn "RETRY_DELAY_MS\|useIntelligenceStatus" tests` lists only this file and consumer mocks).

Confirm red first:
`npx vitest run --config config/tooling/vitest.config.ts tests/hooks/useIntelligenceStatus.test.ts`. Record cases 1
(every `it.each` row) and 2 failing and every other case passing.

**E2E / snapshot impact.** None. There are no mock map edits, no route change and no visual change.

**Verification.** Worker: the targeted file above, `npm run typecheck:app && npm run typecheck:tests && npm run
typecheck:all`, `npm run lint:app`, lizard on changed files. Coverage (100% for `useIntelligenceStatus.ts`), the static
Playwright run and `docs/architecture/generated` are integrator-only (Verification block). Both sides of every
`isTerminalStatusError` operand are behaviourally pinned by cases 1 and 6.

**Acceptance.**
- With either flag off, a signed-in tab makes exactly one `GET /intelligence/status` per session, and the server logs
  one feature-gate line per session.
- Toggling the flags from Admin › Feature Flags in the same tab rechecks immediately.
- Logging out and back in rechecks.
- A 5xx or network outage is retried at 1, 2, 4 … 60 s and recovers on its own.

**Rollback.** Revert the single-file production change and the test edits. Nothing else depends on the new state.

### Phase B2 — Manual transaction filters say when they cover only the loaded pages (P2 `wallet-transactions--manual-filters-and-stats-loaded-page-only`)

**Evidence (re-verified).**
- `src/components/WalletDetail/hooks/walletDataLoaders.ts:115-125` (`loadTransactionPage`) sends only
  `{ limit, offset }`, with a page size of 50.
- The server list route does support `type`, `dateFrom` and `dateTo`
  (`server/src/api/transactions/walletTransactions/listTransactions.ts:41-67`; `GetTransactionsParams` in
  `src/api/transactions/types.ts:29-36`). It filters on the persisted `type` and on `blockTime`, so pending rows with a
  null `blockTime` drop out of any date filter. It has no label or confirmation filter.
- The stats route (`…/walletTransactions/stats.ts:26-110`) is wallet-wide, cached for 30 s, and takes no filter
  parameters. No filtered stats source exists.
- The client filters only the in-memory rows:
  - `useTransactionFilters.ts:215-231` (`filteredTransactions`);
  - the type test (`:246-260`) uses `isConsolidation(tx, walletAddresses)` and the sign of the amount, not the
    persisted type;
  - the date test (`:88-109`) uses `tx.timestamp`, so pending rows count;
  - the label test (`:134-140`) and the confirmation test (`:111-132`) have no server equivalent.
- Console "open in wallet" sends its type and date filters down the same client path
  (`src/components/WalletDetail/useWalletDetailController.ts:164-193`).
- `TransactionsTab/transactionStats.ts:9-11` drops the server-wide stats whenever a filter is active. The tiles are
  then computed from the filtered loaded rows (`src/components/TransactionList/hooks/useTransactionList.ts:171-219`)
  and labelled as totals (`src/components/TransactionList/TransactionList/TransactionStatsGrid.tsx:78-84`).
- The empty state reads `'No transactions found.'` (`TransactionList.tsx:256-263`) even when matches exist in pages
  that have not loaded.
- `AiFilterSummary.tsx:25-30,41-45` shows "Partial result" only for AI filters. `TransactionsTab.tsx:74-81` renders it,
  and nothing comparable exists for manual filters.
- "Load More" stays visible because `TransactionsTab.tsx:50` counts the unfiltered list.
- Tests: `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx:280-324` cover the partial notice for AI filters
  only. Confirmed.

**Decisions.**
- **D-13.B2a — the fix is an honest partial-result notice, not server-side filtering.** I considered moving the type
  and date filters to the server and rejected it for this iteration, for three reasons:
  1. The semantics differ. The server filters on the persisted type and `blockTime`, while the client uses
     wallet-address consolidation detection and `timestamp`, which includes pending rows. Moving the filter would
     silently change which rows match.
  2. Label and confirmation filters cannot be evaluated on the server, so the partial state remains for them anyway.
  3. The stats endpoint has no filter parameters, so filtered totals would still need a new query (OQ-B2).

  The loaded transaction list is also shared state: AI filter input, `selectionTransactions`, label editing, the
  highlight and the export entry point all read it. A filtered server page would need its own paging owner.
- **D-13.B2b — when a result is partial, and the exact text.** A filter result is *partial* when
  `hasMoreTx && loadedCount > 0 && (hasActiveFilters || aiQueryFilter !== null)`, with `loadedCount =
  transactions.length`. The `loadedCount > 0` term mirrors the Load More visibility rule
  (`LoadMoreTransactions.tsx:16` hides the button when `transactionsCount === 0`): `usePaginatedList` starts with
  `hasMore: true` (`src/hooks/usePaginatedList.ts:29`), and `useWalletData` clears `loading` after the core wallet read
  but before the auxiliary transaction pages arrive (`useWalletData.ts:417-429`), so a Console date-range handoff can
  apply its filter while `transactions = []` and `hasMoreTx = true`. Without the term the tab would say "0 of the 0
  loaded" and advise a Load More button that does not exist. When the result is partial:
  - If no AI filter is active, `TransactionsTab` renders a new notice above the list. It has
    `data-testid="manual-filter-partial-notice"` and the same container classes as `AiFilterSummary` (`:33`). Its
    exact text, with F = the count of matching rows the list actually renders
    (`filteredTransactions.filter(tx => tx.rbfStatus !== 'replaced').length`, because `TransactionList` drops
    RBF-replaced rows before it renders the rows and the Total tile, `hooks/useTransactionList.ts:77-79`) and
    N = `transactions.length`, is:
    **"Partial result: {F} of the {N} loaded transactions match these filters. Older transactions are not included,
    and the totals below count only these matches. Load more to extend."** ("are not included" is the verb the
    existing AI summary uses, `AiFilterSummary.tsx:43`.) `AiFilterSummary`'s own count is unchanged (it also counts
    RBF-replaced rows); that pre-existing mismatch is accepted and out of scope.
  - If an AI filter is active, `AiFilterSummary` already says "Partial result" or "…loaded transactions; more are not
    loaded", so the manual notice is suppressed to avoid two banners.
  - The list's empty state becomes **"No matches in the {N} loaded transactions. Load more to search older
    transactions."** This applies for manual and AI filters alike. "Transactions unavailable." keeps priority.

  When no pages remain unloaded (`hasMoreTx === false`), the filtered tiles are complete and nothing changes. Tile
  labels are unchanged; the notice sits directly above the stats grid and names the totals. This keeps the default
  render, and so every PNG baseline, identical.
- **D-13.B2c — the Console path needs no special handling.** A Console navigation that carries a date range now shows
  the notice and the load-more empty message whenever older pages are unloaded.

**Production changes.**
- `src/components/TransactionList/TransactionList.tsx`: add the optional prop `emptyMessage?: string`, with a doc
  comment, next to `unavailable` (`:39-44`), and destructure it (`:77`). The empty text (`:263`) becomes
  `unavailable ? 'Transactions unavailable.' : (emptyMessage ?? 'No transactions found.')`.
- New file `src/components/WalletDetail/tabs/TransactionsTab/filterScope.ts`, with two pure exports:
  - `isFilterResultPartial({ hasMoreTx, loadedCount, hasActiveFilters, aiQueryFilter }): boolean`;
  - `partialFilterEmptyMessage(loadedCount: number): string`.
- New file `src/components/WalletDetail/tabs/TransactionsTab/ManualFilterPartialNotice.tsx`. It takes
  `{ filteredCount, loadedCount }` and renders the D-13.B2b text; the caller passes `filteredCount` as the
  non-replaced count defined in D-13.B2b.
- `src/components/WalletDetail/tabs/TransactionsTab.tsx`: compute
  `const partial = isFilterResultPartial({ hasMoreTx, loadedCount: transactionsCount, hasActiveFilters, aiQueryFilter })`. Render
  `{partial && !aiQueryFilter && <ManualFilterPartialNotice … />}` after `<AiFilterSummary …/>` (`:74-81`), and pass
  `emptyMessage={partial ? partialFilterEmptyMessage(transactionsCount) : undefined}` to `<TransactionList>`
  (`:83-96`).
- `transactionStats.ts` and `useTransactionList.ts` are unchanged.

**Tests first.**
- `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx` (326 lines, about 420 after). This file mocks
  `TransactionList` and records its props in `mockRefs.txListProps`. `baseProps` has `hasMoreTx: true`, 2 loaded and
  1 filtered.

  Failing on base:
  1. **"marks manual filters as partial while older pages are unloaded"** (`hasActiveFilters={true}`).
     `getByTestId('manual-filter-partial-notice')` has the exact text "Partial result: 1 of the 2 loaded transactions
     match these filters. Older transactions are not included, and the totals below count only these matches. Load
     more to extend." Add a row variant where the filtered list also holds one `rbfStatus: 'replaced'` row and expect
     the same "1 of the 2" (F counts only rendered rows).
     **Red on base:** the test id is absent.
  2. **"passes a load-more empty message while a filtered result is partial"** (manual filter).
     `mockRefs.txListProps.emptyMessage` is "No matches in the 2 loaded transactions. Load more to search older
     transactions." Repeat with an AI filter only (`aiQueryFilter` set, `hasActiveFilters={false}`) and expect the
     same message.
     **Red on base:** `undefined`.

  Guards:
  3. **"shows no manual partial notice once every page is loaded"** (`hasActiveFilters`, `hasMoreTx={false}`): no
     notice, and `emptyMessage` is `undefined`.
  4. **"defers to the AI summary when both AI and manual filters are active"**: no manual notice, the AI "Showing … of
     … loaded transactions; more are not loaded" line is present, and `emptyMessage` is set.
  5. **"leaves the unfiltered list unchanged"** (no filters, `hasMoreTx` true): no notice, `emptyMessage` is
     `undefined`.
  5b. **"does not claim a partial result before any page has loaded"**: `transactions=[]`,
     `filteredTransactions=[]`, `hasActiveFilters`, `hasMoreTx`. Expect no notice and `emptyMessage` `undefined`.
- `tests/components/TransactionList/presentationContract.test.tsx` (172 lines). This file renders the real
  `TransactionList`; follow its existing empty-list case at `:129`.
  6. **"renders a supplied empty message instead of 'No transactions found.'"**, with `transactions={[]}` and
     `emptyMessage="No matches in the 50 loaded transactions. Load more to search older transactions."`.
     **Red on base:** the default text renders. The unknown prop is stripped at runtime and only `typecheck:tests`
     would flag it, so the case runs on base.
  7. Guard: **"keeps 'Transactions unavailable.' ahead of a supplied empty message"**.
- `tests/components/WalletDetail/tabs/TransactionsTab/filterScope.test.ts` (new, about 40 lines): the truth table of
  `isFilterResultPartial` (all 16 combinations: `hasMoreTx` × `loadedCount` 0 vs. > 0 × `hasActiveFilters` ×
`aiQueryFilter` null vs. set) and the exact message. **Red on base:** the module is missing.

Confirm red first:
`npx vitest run --config config/tooling/vitest.config.ts tests/components/WalletDetail/tabs/TransactionsTab.test.tsx tests/components/TransactionList/presentationContract.test.tsx tests/components/WalletDetail/tabs/TransactionsTab/filterScope.test.ts`.
Record cases 1, 2 and 6 failing, the `filterScope` import failure, and every other case passing.

**Existing tests.** No existing case needs editing:
- "omits transactionStats when hasActiveFilters is true" (`:229-238`) renders with `hasMoreTx: true` and will now also
  show the notice; its assertion on the stats prop still holds.
- The AI cases (`:280-324`) have no manual filter.
- `useTransactionFilters.test.ts` (726 lines) is untouched.

**E2E / snapshot impact.**
- The default render is byte-identical: the notice and the message appear only with an active filter and unloaded
  pages.
- No Playwright spec applies a filter on a wallet with `hasMoreTx`. `grep -rn "Load More" tests/e2e` finds nothing.
- The three e2e assertions on "No transactions found." use empty, unfiltered wallets and are unaffected:
  `error-recovery.spec.ts:428-429`, `user-journeys.spec.ts:110` and
  `render-regression/renderRegressionCore.contracts.ts:133`.
- No PNG under `tests/e2e/render-regression.spec.ts-snapshots/` changes, and there are no mock map edits.
- Even so, the integrator's static-server Playwright run (Verification block) covers the render-regression,
  user-journey and error-recovery specs.

**Verification.**
- Worker: the three files above plus `tests/components/TransactionList` and `tests/components/WalletDetail`,
  `npm run typecheck:app && npm run typecheck:tests && npm run typecheck:all`, `npm run lint:app`, lizard on changed
  files.
- Coverage (100%, including both sides of `partial && !aiQueryFilter`, every `isFilterResultPartial` operand and the
  `emptyMessage ??` fallback), the static Playwright run and `docs/architecture/generated` (the two new modules) are
  integrator-only (Verification block).

**Acceptance.**
- On a wallet with more than 50 transactions, a manual filter or a Console-provided date range states that it covers
  only the N loaded transactions, and that the totals cover only those matches.
- An empty filtered page says "No matches in the N loaded transactions. Load more to search older transactions."
  instead of "No transactions found."
- Once every page is loaded, and while no page has loaded yet, neither the notice nor the message is shown.
- Unfiltered and fully loaded views render exactly as before.

**Rollback.** Revert the four production files. The new prop is optional and has no other callers.

### Phase B3 — Preference writes no longer refetch identity-keyed data (P2 `user-preference-write--user-keyed-effects-refetch`)

**Evidence (re-verified).**

*How a write changes `user`:*
- `src/contexts/useUserPreferenceMutation.ts:347-352` calls `setUser({ ...currentUser, preferences })` synchronously
  on every write; only the PATCH is debounced (`:354-367`).
- `flushPreferenceBatch` sets a second new object when the request settles (`:208-224`, and `:234-251` on rollback).
- `src/contexts/UserContext.tsx:81-114` publishes `user` in the context value. So every write changes `user` identity
  once per call and once per settle, and every effect that depends on the whole object re-runs.

*Writers:*
- Settings › Appearance sliders: `VisualSettingsPanel.tsx:118-128` (step 5) → `useAppearanceTabController.ts:53-55`.
- Device list sort, layout and column preferences: `useDeviceListPreferences.ts:12-16`.
- The sidebar dark-mode toggle, available on every page: `useAppRoutesController.ts:38-40` → `Layout.tsx:10,24` →
  `SidebarContent.tsx:37,109`.
- The `selectedNetwork` preference (`ActiveNetworkContext.tsx:18`). Wallet detail writes it itself when it opens a
  wallet on another network (`useWalletDetailController.ts:102-111`).
- `CollapsibleSection`, `FeatureTable`, Dashboard timeframe and page size (`useUserPreference` consumers), and
  currency settings.

**Full enumeration.** I parsed every hook dependency array under `src/` for a bare `user`, `currentUser`, `authUser`,
`contextUser` or `me` (a multi-line-aware scan, plus `useCurrentUser()` consumers and hooks that take `user` as a
parameter). The complete list:

| # | Site | What re-runs on a preference write | Class | Action |
|---|------|------------------------------------|-------|--------|
| 1 | `src/components/Layout/useLayoutNotifications.ts:135-139` `[user, wallets, notificationActions]` | Serial `GET /wallets/:id/drafts` for every wallet (`:82-89`) | identity | key on `userId` |
| 2 | `useLayoutNotifications.ts:141-164` `[user, selectedNetwork, notificationActions]` | `GET /bitcoin/status`, and the 60 s interval restarts | identity + `isAdmin` | key on `userId`, `isAdmin` |
| 3 | `src/components/DeviceList/useDeviceListRecords.ts:32-36` `[user, loadDevices]` | `GET /devices` and `/devices/models`. `useLoadingState.execute` sets `loading` (`src/hooks/useLoadingState.ts:84-87`), so `DeviceList.tsx:72` replaces the page with "Loading devices..." and unmounts any inline rename. Called at `DeviceList.tsx:53`. | identity | key on `userId`, plus the stale-reload guard (D-13.B3c) |
| 4 | `src/components/WalletDetail/hooks/useWalletData.ts:466-468` `[id, user]` | **Not in the scrub finding; found by the enumeration.** A full non-refresh `fetchData()`: `setLoading(true)` (`:380`) makes `WalletDetail.tsx:9` render `<LoadingState/>`. All three paged lists are replaced (`:369-373`), losing loaded "Load more" pages. It refetches wallet, aux, groups and share info. Triggered by the sidebar theme toggle, by the wallet's own network alignment (`useWalletDetailController.ts:107-110`), and by any other preference write while a wallet is open. | identity + `isAdmin` (`loadGroups`, `walletDataLoaders.ts:252-266`) | key on `userId`, `isAdmin` |
| 5 | `useWalletData.ts:470-482` `[id, user]` (visibility listener) | Re-registers the listener. No I/O. | identity | key on `userId`, and call through `drainFetchRef` (`:457-458`) so the handler never holds a stale `fetchData` |
| 6 | `useWalletData.ts:441-449` (`fetchDataWithResult` `useCallback` deps include `user`) | New callback identity. Harmless once #4 and #5 no longer depend on it, and it must read the latest `user`. | needs fresh value | keep |
| 7 | `src/components/DeviceDetail/hooks/useDeviceData.ts:133-189` `[id, ownership, ownershipKey, reloadCount, selectedNetwork, user]` | **Not in the scrub finding; found by the enumeration.** `GET /devices/:id` and `/devices/models`, and `setEditLabel(deviceData.label)` (`:174`) overwrites an in-progress label edit. `ownershipKey` (`:63`) already encodes `user?.id`. | identity | gate on `userId`, drop `user` |
| 8 | `src/components/Layout/useLayoutChromeState.ts:106-118` `shortcutBindings` `[…, user]` | `useAppShortcuts` re-registers. No I/O and no state reset. | presence | use `isSignedIn = !!user` (one line; removes listener churn during slider drags) |
| 9 | `src/contexts/CurrencyPreferencesContext.tsx:117-130`, `:132-162`, `:172-185` | Callback identities, and the bootstrap-flush effect re-runs as a no-op when nothing is pending. No I/O. | presence | no change: it only rebuilds memoised setters |
| 10 | `src/contexts/useUserTheme.ts:43-51` `[user]` | Re-applies the theme. This is the intended reaction to theme preferences. | needs preferences | keep |
| 11 | `src/contexts/UserContext.tsx:98-114` (value memo) | It is the context itself. | — | keep |
| 12 | `src/components/UsersGroups/EditUserModal.tsx:37-45` `[user]` | `user` here is the admin-edited `AdminUser` prop (`:12`), not the context user. | n/a | keep |

`src/hooks/useUserPreference.ts:34` and `src/components/AgentManagement/index.tsx:114` read `useCurrentUser()` without
an effect dependency on it (they use `!!user` and `currentUser?.id`).

**Deleted-device resurrection race.** `useDeviceListRecords.loadDevices` (`:23-30`) applies `setDevices(deviceData)`
however old the request is. `handleDelete` (`:78-89`) filters local state after `deleteDevice` resolves, so a reload
that started before the delete and resolves after it puts the deleted row back. On base, any preference write during
the delete (for example a column sort click) starts such a reload. `handleSave` (`:67-77`) has the same race: it
reverts a just-saved label.

**Tests miss it.**
- `tests/components/DeviceList.test.tsx:56-61` and `tests/components/DeviceList/DeviceList.branches.test.tsx:43-45`
  mock `useUser` with a constant user and a `vi.fn()` `updatePreferences`.
- `tests/components/Layout/useLayoutNotifications.test.tsx` only re-renders with a new network.
- No `useWalletData` or `useDeviceData` test re-renders with a same-id user. Confirmed.

**Decisions.**
- **D-13.B3a — key identity effects on stable primitives, per site.** Use `user?.id` (and `user?.isAdmin` where the
  effect reads it), not the context object, at sites #1–#5, #7 and #8. The rejected alternative is splitting
  preferences out of `user` into their own context or state, so that preference writes stop changing `user` identity.
  That is the root-cause shape, but it changes the public `useUser()` contract read by every `user.preferences`
  consumer. It is far larger than a P2 fix and risks the coalescing and rollback invariants in
  `useUserPreferenceMutation.ts`. `UserContextType` gains nothing.
- **D-13.B3b — each changed hook derives its keys locally**, as `const userId = user?.id ?? null` and
  `const isAdmin = !!user?.isAdmin`. Bodies that need the full object keep reading the current render's `user` through
  the closure, or through `drainFetchRef` for the wallet visibility handler. `react-hooks/exhaustive-deps` is not
  enabled in `config/tooling/eslint.config.js:45-47` (only the plugin is registered), so no disable comments are
  needed.
- **D-13.B3c — `useDeviceListRecords` discards stale loads.** Add `const loadGenerationRef = useRef(0)`.
  `loadDevices` captures `const generation = ++loadGenerationRef.current` and returns before the `setDevices` and
  `setDeviceModels` calls if `generation !== loadGenerationRef.current`. `handleDelete` and `handleSave` run
  `loadGenerationRef.current += 1` after their API call succeeds, so an in-flight reload cannot overwrite the local
  mutation. The load's `loading` flag still settles through `useLoadingState`'s `finally`.
- **D-13.B3d — no static dependency-array scanner test.** A regex over hook dependency arrays is brittle. Each fixed
  site gets a behavioural same-id re-render test, and the two headline sites are also proven through a real
  `UserProvider`.

**Production changes.**
- `src/components/Layout/useLayoutNotifications.ts`:
  - `LayoutNotificationUser` (`:15-17`) gains `id: string`.
  - The drafts effect uses `[userId, wallets, notificationActions]` and guards on `!userId`.
  - The connection effect uses `[userId, isAdmin, selectedNetwork, notificationActions]` and passes `isAdmin`.
  - `useLayoutController.ts:67-72` already passes the context user, which has an `id`.
- `src/components/DeviceList/useDeviceListRecords.ts`: the effect uses `[userId, loadDevices]`, plus D-13.B3c. The
  signature stays `(user: User | null)`.
- `src/components/WalletDetail/hooks/useWalletData.ts`:
  - The `:466-468` effect becomes `[id, userId, isAdmin]`.
  - The `:470-482` visibility effect becomes `[id, userId]`, with the handler calling `void drainFetchRef.current(true)`.
  - `userId` already exists at `:459`; add `isAdmin` beside it.
- `src/components/DeviceDetail/hooks/useDeviceData.ts`: the `:133-189` effect guards on `!userId` and replaces `user`
  with `userId` in its dependencies. `ownershipKey` already changes with the id.
- `src/components/Layout/useLayoutChromeState.ts`: compute `const isSignedIn = !!user` and use it in
  `shortcutBindings` (`:108-118`).

**Tests first.**

*1. `tests/contexts/UserContext.identityEffects.test.tsx` (new, about 220 lines).* It renders the **real**
`UserProvider`, using the login harness pattern of `tests/contexts/UserContext.preferenceCoalescing.test.tsx:57-86`
(`vi.mock('../../src/api/auth')`, `login` resolving `{ user: mockUser }` from `UserContext.test.fixtures.tsx`).

Mocks:
- `authApi.requires2FA` → `false`; `authApi.getCurrentUser` → rejects `new Error('no session')` (in `beforeEach`, as
  `preferenceCoalescing.test.tsx:80-84`), so the bootstrap matches the cited pattern.
- `src/api/devices`: `getDevices` → `[d1, d2]`, `getDeviceModels` → `[]`, `deleteDevice`.
- `src/api/drafts`: `getDrafts` → `[]`.
- `src/api/bitcoin`: `getStatus` → `{ connected: true }`.
- The logger.
- `authApi.updatePreferences` echoes the patch:
  `async patch => ({ ...mockUser, preferences: { ...mockUser.preferences, ...patch } })`, installed after
  `vi.mocked(authApi.updatePreferences).mockReset()`.

Counts are baselined after the login settles: record each mock's call count, then assert deltas of 0 after the drag.
This keeps the test independent of how many `setUser` calls login makes.

The probe component is:
`const { user, updatePreferences } = useUser(); const records = useDeviceListRecords(user); useLayoutNotifications({ user, wallets: WALLETS /* 2 stable wallets */, selectedNetwork: 'mainnet', notificationActions: ACTIONS /* stable */ });`.
It records every `records.loading` value into an array, renders the device count, and has a button that calls
`updatePreferences({ patternOpacity: 55 })` three times, like a slider drag. The test uses real timers and waits
`PREFERENCE_WRITE_DEBOUNCE_MS + 50` ms inside `act` so that the settle `setUser` happens.

Failing on base:
- **"a preference drag neither refetches devices nor blanks the device list"**. After the initial load, the drag
  adds 0 calls to `getDevices` and `getDeviceModels` over the post-login baseline (1 each on a clean load), and no
  `true` is recorded in the loading history after the first `false`.
  **Red on base:** a delta of at least 2 (at least 1 for the batched optimistic `setUser`, 1 for the settle `setUser`)
  and `loading` goes back to `true`.
- **"a preference drag neither re-syncs draft notifications nor restarts the connection poll"**. `getDrafts` adds
  0 calls over its baseline (2, one per wallet) and `getStatus` 0 over its baseline (1).
  **Red on base:** deltas of at least 4 and at least 2.

Guard:
- **"signing in as a different user still loads that user's devices"**. Log out, re-mock `authApi.login` to resolve
  `{ user: { ...mockUser, id: 'user-2' } }` before the second login, log in, and expect `getDevices` to be called
  again.

*2. `tests/components/DeviceList/useDeviceListRecords.test.tsx` (new, about 140 lines).* This uses `renderHook` with
the `user` parameter.
- **"discards a reload that started before a delete resolved"**. After the initial load of `[d1, d2]`, start
  `reload()` with a deferred `getDevices`. Run `handleDelete(d1)`, with `deleteDevice` resolving, so devices are
  `[d2]`. Then resolve the deferred reload with `[d1, d2]`. Expect devices to equal `[d2]`.
  **Red on base:** `[d1, d2]`.
- **"discards a reload that started before a save resolved"**: the same shape with `handleSave` and a changed label.
  **Red on base:** the old label.
- **"re-renders with a same-id user object without reloading"**: rerender with `{ ...user, preferences: { x: 1 } }`
  and expect `getDevices` to stay at 1 call. **Red on base:** 2.
- Guard: **"reloads when the user id changes"**.

*3. `tests/components/WalletDetail/hooks/useWalletData.userIdentity.test.ts` (new, about 230 lines).* Copy the import
and mock prelude, fixtures and `beforeEach` of `useWalletData.supersession.test.ts:14-202`. The mocks end at `:114` and
include `api/auth` `getUserGroups` and `api/admin` `getGroups`. Also copy the `document.visibilityState` descriptor save
and restore (`:162`, `:227`). Use a local `{ id: 'user-1', isAdmin: false }` user where the case starts non-admin (the
copied `defaultUser` is admin). `useWalletData.test.ts` is 1,706 lines and must not grow.

Failing on base:
- **"keeps the loaded wallet and pages when only preferences change"**. Wait for `loading` to be false, then rerender
  `{ id: 'wallet-1', user: { ...user, preferences: { darkMode: true } } }`. Expect `walletsApi.getWallet` at 1 call and
  `result.current.loading` false on every render after the first load (collected through a render log).
  **Red on base:** 2 calls and `loading` true.

Guards:
- **"refetches when the signed-in user id changes"**.
- **"refetches groups when admin status changes for the same id"**: `isAdmin` false → true, and `adminApi.getGroups`
  is called.
- **"a visibility refresh uses the latest user after a same-id admin change"**. This is the case that detects a
  handler still calling the captured `fetchData(true)` (stale first-render `user`) instead of
  `drainFetchRef.current(true)`: a preferences-only change is not observable, but a stale `isAdmin` sends
  `loadGroups(oldUser)` to `authApi.getUserGroups` instead of `adminApi.getGroups` (`walletDataLoaders.ts:252-266`).
  1. Load as `isAdmin: false`.
  2. Rerender with `{ ...user, isAdmin: true }` and
     `await waitFor(() => expect(adminApi.getGroups).toHaveBeenCalledTimes(1))`.
  3. `vi.clearAllMocks()`.
  4. Make the document visible and dispatch `visibilitychange`.
  5. Expect `adminApi.getGroups` called once, `authApi.getUserGroups` not called, and `loading` never true in renders
     after step 4 (the step-2 refetch is a non-refresh fetch and does show loading).

*4. `tests/components/DeviceDetail/hooks/useDeviceData.branches.test.tsx` (359 lines, about 395 after).* This file
already uses `useUserMock` (`:10,18-20`).
- **"keeps an in-progress label edit when only preferences change"**. After the load, call
  `act(() => result.current.setEditLabel('Typed label'))`. Then
  `useUserMock.mockReturnValue({ user: { id: 'u1', isAdmin: true, preferences: { darkMode: false } } })` and
  rerender. Expect `devicesApi.getDevice` at 1 call and `result.current.editLabel` equal to `'Typed label'`. The setter is
  exported at `useDeviceData.ts:409`.
  **Red on base:** 2 calls and the label resets to `'Device One'`.

*5. `tests/components/Layout/useLayoutChromeState.test.tsx` (90 lines).*
- **"keeps shortcut bindings stable across a same-id user re-render"**. Import `useAppShortcuts` and read
  `vi.mocked(useAppShortcuts).mock.calls`; the module is already mocked at `:6`. Use
  `renderHook(({ user }) => useLayoutChromeState({ capabilities: {}, user }), { initialProps: { user: { id: 'user' } } })`,
  then rerender with `{ user: { id: 'user' } }` (a new object) and expect the last two calls' first argument to be
  `toBe`-identical.
  **Red on base:** a new array.

Confirm red first:
`npx vitest run --config config/tooling/vitest.config.ts tests/contexts/UserContext.identityEffects.test.tsx tests/components/DeviceList/useDeviceListRecords.test.tsx tests/components/WalletDetail/hooks/useWalletData.userIdentity.test.ts tests/components/DeviceDetail/hooks/useDeviceData.branches.test.tsx tests/components/Layout/useLayoutChromeState.test.tsx`.
Record each red case listed above, with the guards passing.

**Existing tests the fix touches.**
- `tests/components/Layout/useLayoutNotifications.test.tsx:30` has `const user = { isAdmin: false }`. Without an id,
  the `userId` gate would skip every effect, and `typecheck:tests` would reject the required `id`. Change it to
  `{ id: 'user-1', isAdmin: false }`.
- No other caller of `useLayoutNotifications` exists. `useLayoutController` passes the context user, and
  `tests/components/Layout.test.tsx:92-93` and `Layout.branches.test.tsx:143-146` fixtures already carry `id`.
- `Layout.branches.test.tsx:225-237` (null user → no calls) still holds.
- The DeviceList, `useWalletData*` and `useDeviceData*` fixtures all carry an `id`.
- Re-run `tests/components/Layout*`, `tests/components/DeviceList*`, `tests/components/WalletDetail`,
  `tests/components/DeviceDetail*` and `tests/contexts`.

**E2E / snapshot impact.**
- No endpoint, parameter or markup change. The e2e flows only lose redundant duplicate requests, and no spec asserts
  request counts for drafts, devices or wallet reloads.
- The mock maps answer by key, so fewer calls cannot create `unhandledRequests`. No PNG changes.
- The integrator's static-server Playwright run (Verification block) covers `tests/e2e/settings-persistence.spec.ts`
  (it drives preference writes) and the render-regression spec.

**Verification.**
- Worker: the five files above and the re-run set, `npm run typecheck:app && npm run typecheck:tests && npm run
  typecheck:all`, `npm run lint:app`, lizard on changed files. Expected: `useWalletData.ts` already carries one
  base warning (`fetchDataWithResult`, CCN 16, `:364-441`, one of the 84). It must stay exactly one warning with the same
  CCN; do not refactor that callback (out of scope). Any other warning on a B3 file is new and must be fixed.
- Coverage (100%: the new generation-guard early return is covered by the two race cases, and the `isAdmin` key by
  the groups guard), the static Playwright run and `docs/architecture/generated` are integrator-only (Verification
  block).

**Acceptance.**
- Dragging Pattern Visibility, toggling dark mode or sorting the device list sends **zero** extra `GET` requests for
  drafts, bitcoin status, devices, wallet or device detail.
- The Devices page never flashes "Loading devices...". An open wallet keeps its loaded pages and does not show its
  loading state. A device label edit in progress survives.
- A deleted device never reappears, and a saved label never reverts, because of an overlapping reload.
- Changing the signed-in user (or the admin flag) still reloads everything.

**Rollback.** Each site is an independent dependency-array change. Revert per file; the D-13.B3c guard is
self-contained in `useDeviceListRecords.ts`.

**Phase B notes.**
- None of these files is pinned by `config/wallet-safety-mutation-map.json` or by a `server/stryker.*.config.mjs`
  `mutate` range. None is in a sync path or in the verify-addresses source manifest.
- No new identifier starts with `sign`, `finalize` or `broadcast`. There is no new integration spec, no `rm -rf` or
  `kill`, and no new endpoint or query parameter, so there is no e2e mock map change.
- Every touched or new test file stays under 1,000 lines. The largest is
  `tests/components/WalletDetail/tabs/TransactionsTab.test.tsx` at about 420.
- New modules (B2's `filterScope.ts` and `ManualFilterPartialNotice.tsx`) and B1's new import edge require
  regenerating `docs/architecture/generated`; the integrator alone does it (D-13.X4.3, Verification block). No B
  worker commits generated docs.
- Changelog bullets for the integrator:
  - B1: "Treasury Intelligence no longer polls once per second when the feature is disabled".
  - B2: "Wallet transaction filters say when they cover only the loaded transactions".
  - B3: "Changing a display preference no longer reloads the device list, open wallet or layout data".

### Phase B open questions

- **OQ-B1 — answer `GET /intelligence/status` with 200 when the flags are off?** The server would register the status
  route ahead of `requireAllFeatures` and return `{ available: false, ollamaConfigured: false, reason:
  'feature_disabled' }`, matching `/ai/status`. **Recommendation: defer.** After D-13.B1a the cost is one 403 and one
  log line per session. The change alters a public API contract (OpenAPI, server route tests, and the gate's
  "All routes require both feature flags" invariant at `intelligence.ts:66-68`) for a cosmetic gain.
- **OQ-B2 — move the transaction filters to the server, with filtered paging and filtered stats?** Type and date
  filters would be sent to `GET /wallets/:id/transactions`, with a filter-aware `…/transactions/stats`. This would make
  Console date-range navigation and the tiles exact without loading more pages. **Recommendation: track as a
  follow-up, not this iteration.** It needs agreed semantics: persisted type vs. address-derived consolidation, and
  `blockTime` vs. timestamp for pending rows. It needs a separate paging owner for the shared transaction list, and a
  stats query change. Label and confirmation filters would stay client-side and partial anyway. The D-13.B2b notice
  makes today's behaviour honest in the meantime.
- **OQ-B3 — should open tabs notice an admin enabling Treasury Intelligence without a reload?** After D-13.B1a, a
  terminal tab rechecks only on invalidation in that tab or on a new session. **Recommendation: no.** Flag changes are
  rare admin actions, and reloading or signing in again picks them up. A slow (for example 5 min) recheck can be added
  later if users ask.

## Phase C — install and CI fixes (C1, C2)

Both subsections run in **one worktree and one branch** (`c`), as two commits (C1, then C2). Both edit files under
`tests/install/`, and both are on the release-surface path set
(`tests/install/utils/classify-install-scope.sh:483`). The PR therefore runs Install Stack Smoke, the baseline upgrade
lane and Release Candidate Validation on the PR head; that is the CI evidence both phases need. Line numbers were
re-read on `20361d62b3`. Decisions: D-13.C1–D-13.C7.

Shared rules for both phases:
- Tests first. Each new test must be confirmed RED on `20361d62b3` before the production edit.
- Never run `start.sh`, `install.sh`, `scripts/setup.sh` or `docker compose` against a real daemon on the host. Every
  test below drives these scripts with the repo's PATH-shimmed fake `docker`, or runs in the CI install E2E lanes.
- New `*.test.sh` code uses `if <cmd>; then …; return 1; fi`, never a bare leading `!`. The guard is
  `scripts/ci/check-negated-test-assertions.mjs` (#1413).
- A new `tests/install/unit/*.test.sh` needs three things in the same commit:
  - a `run_test_suite` line in `tests/install/run-all-tests.sh`
    (`tests/ci/ci-registration-completeness.test.sh:353-372`);
  - a `temporary_artifact`/`cleanup`/`exempt` entry in `config/resource-lifecycle-callsites.json` for its
    `trap 'rm -rf …' EXIT`, in path order between `offline-bundle-script` (`:2476`) and `optional-stack-lifecycle`
    (`:2483`);
  - `git add` the new suite before running `node scripts/ci/check-negated-test-assertions.mjs` (it scans only tracked
    `*.test.sh`, via `git ls-files '*.test.sh'`). `check-lifecycle-callsites.mjs` already lists untracked files
    (`--cached --others --exclude-standard`, `:138-146`); `git add` before it too does no harm.
- Run any `tests/install/unit` suite directly only with the `@runtime` lock-root env
  (`SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime`).
  `optional-stack-lifecycle.test.sh` does not set its own lock root (it relies on
  `scripts/ci/run-install-unit-tests.sh:38-39`); run bare, its locks go to the host-wide
  `/tmp/sanctuary-ownership-<uid>/project-locks/…` (`project-lock.mjs:20-23`), the same lock the real local stack
  uses, and the suite deliberately crashes controllers.
- `scripts/quality/check-large-files.mjs` scans only JS/TS (`:41`). The one JS file touched,
  `scripts/ownership/deployment-session.mjs`, is 415 lines; this change adds 2.

---

### Phase C1 — Postgres password reconciliation targets the deployment's own Compose project (P2 `postgres-password-reconcile--project-from-dir-basename`)

**Evidence (re-verified on `20361d62b3`).**
- **Compose's project.** Every deployment-managed Compose call passes `-p definition.composeProjectName`
  (`scripts/ownership/deployment-definition.mjs:195`). That value is `resolveProjectIdentity()`
  (`scripts/ownership/deployment-session.mjs:53`), which returns `COMPOSE_PROJECT_NAME || SANCTUARY_PROJECT`, throws if
  both are set and differ, and validates the format (`scripts/ownership/project-identity.mjs:3-15`).
  `SANCTUARY_PROJECT` defaults to `sanctuary` (`start.sh:30`, `scripts/setup.sh:56`) and is persisted in the env file
  (`scripts/setup.sh:887`). `docker-compose.yml:34` also says `name: sanctuary`.
- **What the reconcile script looks up.** `scripts/reconcile-postgres-password.sh:24-30` (`get_compose_project_name`)
  returns `$COMPOSE_PROJECT_NAME`, otherwise `basename "$PROJECT_DIR"`. `PROJECT_DIR` is `SANCTUARY_PROJECT_DIR`
  (`:10`), the checkout. `find_existing_postgres_container` (`:32-49`) filters `docker ps [-a]` on
  `label=com.docker.compose.project=<that>`. `scripts/setup.sh:410-435` is a byte-for-byte copy of both functions.
- **`COMPOSE_PROJECT_NAME` is never set on the operator path.** `install.sh:68-83` (`resolve_install_project_identity`)
  and `:301-304` resolve and export only `SANCTUARY_PROJECT`; `start.sh` and `setup.sh` never export
  `COMPOSE_PROJECT_NAME`. Only `scripts/ownership/run-compose.sh:35-44` (the test/dev entry point) sets it. So on a
  real install the basename branch is always the one that runs.
- **Failure mode 1: silent skip.** No container matches, so `reconcile_postgres_password_with_running_database` returns
  0 at `:183`. The callers then mark the stage done: `start.sh:446-449` and `scripts/setup.sh:1242-1245` run
  `deployment_transition password_reconciled`. The #118 auth-drift repair never runs.
- **Failure mode 2: wrong deployment.** The basename names another deployment's project, for example a `staging`
  deployment installed in a directory named `sanctuary` on a host whose primary deployment is `sanctuary`. Then
  `validate_postgres_password` fails against the other database, and `sync_postgres_password_to_runtime_env`
  (`:148-177`) runs `ALTER USER … WITH PASSWORD '<this deployment's password>'` inside **that** container. It uses the
  local-trust and `-u postgres` fallbacks (`:163-176`), which need no password.
- **Pre-start copy in setup.** `scripts/setup.sh:546-575` runs at `:1571-1573`, after `deployment_begin` (`:1561`), with
  the same lookup.
- **Related inconsistency.** `start.sh:359-361` (`detect_enabled_stacks`) uses `${COMPOSE_PROJECT_NAME:-sanctuary}`.
  With a non-default `SANCTUARY_PROJECT`, the monitoring/tor/mcp detection behind `--logs` (`:506`) and the start
  modes therefore reads the wrong project.
- **Reproduced read-only** with the `tests/install/unit/optional-stack-lifecycle.test.sh` fake docker, a scratch copy of
  the harness and `env -u COMPOSE_PROJECT_NAME SANCTUARY_PROJECT=staging-lane bash start.sh`:
  - Compose ran with `-p staging-lane` and the registry path `deploy-staging-lane`.
  - Detection ran `ps --filter label=com.docker.compose.project=sanctuary`.
  - The reconcile ran `ps -q --filter label=com.docker.compose.project=sanctuary-bug-scrub-20261013-i13 --filter
    label=com.docker.compose.service=postgres`, the checkout basename.
  - Exit 0 and "PostgreSQL password synchronized", because the fake answers every postgres query.
- **Why the tests miss it.**
  - Every Docker-backed install suite exports `COMPOSE_PROJECT_NAME`, for example
    `tests/install/e2e/upgrade-install.test.sh:153`.
  - `run_start` in `optional-stack-lifecycle.test.sh:161-192` always sets `COMPOSE_PROJECT_NAME` (`:179`).
  - Its fake `docker` returns `fake-postgres` for **any** `service=postgres` query, whatever the project label
    (`:104-107`).
  - `tests/install/unit/install-script.test.sh:1240-1249`, `:2151-2169` only grep for function and script names.
- **The single source of truth already exists.** `deployment_assert_lock` (`scripts/ownership/deployment-lifecycle.sh:69-72`
  → `deployment-session.mjs assert-lock`, `:333-337`) already runs inside the reconcile script (`:13`). It resolves
  the project through `projectForSession` (`:89-94`): the env identity via `resolveProjectIdentity`, or the deployment
  store's `composeProjectName` when no env identity is set. It then proves that this process holds the mutation lock
  **for that project** (`assertLocks`, `:153-160`). It just discards the answer: it prints `locked` (`:336`) to
  `/dev/null`. `start.sh` and `setup.sh` take that lock with `options.composeProjectName`, the same value passed to
  `-p` (`deployment-session.mjs:168`).
- **Callers of `deployment_assert_lock` / `assert-lock`:** `scripts/reconcile-postgres-password.sh:13`,
  `scripts/create-upgrade-backup.sh:225` (stdout discarded), the stub at
  `tests/install/unit/upgrade-backup-script.test.sh:111`, and the fixture at `install-script.test.sh:665`. Nothing
  parses the `locked` line.
- Sibling project lookups (sweep):

  | Site | Verdict |
  | --- | --- |
  | `scripts/create-upgrade-backup.sh:336` | Not the same bug: it keeps a `basename "$INSTALL_DIR"` fallback, but `initialize_backup_ownership` sets `COMPOSE_PROJECT_NAME="$SANCTUARY_PROJECT"` first (`:215-216`), so that fallback is unreachable. |
  | `scripts/offline/create-bundle.sh:533-568` (`resolve_compose_project_name`, in the generated offline installer) | **Same class**: it resolves `COMPOSE_PROJECT_NAME`, then the compose file's `name:` (always `sanctuary`), then `basename "$INSTALL_DIR"`, and never reads `SANCTUARY_PROJECT`. `has_existing_database` (`:561-568`) then decides whether `create_upgrade_backup_or_prompt` (`:571`) runs, so an offline upgrade of a non-default project skips the pre-upgrade backup prompt. **Recorded as a P3 follow-up in run state, not folded** (offline bundle path, separate tests in `offline-bundle-script.test.sh`; coordinator decision, review pass 1). |

**Fix design.**
- **D-13.C1 — Ask the lock which project it covers.**
  - `deployment-session.mjs`: `assertLocks(store, project)` returns `project`. `assertLock()` prints
    `output(['locked', project])`.
  - `scripts/ownership/deployment-lifecycle.sh` gets `deployment_locked_project()`, defined next to
    `deployment_assert_lock`:
    1. It calls `deployment_lifecycle_initialize`.
    2. It runs `node "$DEPLOYMENT_SESSION_SCRIPT" assert-lock` and reads the two tab-separated fields.
    3. It fails with "deployment lock does not name a Compose project" unless the first field is `locked` and the
       second is non-empty.
    4. It prints the project.
  - `deployment_assert_lock` itself is unchanged (stdout still discarded).
  - This reuses the resolver that `-p` comes from, including its mismatch and format checks. It adds no shell
    re-implementation of `project-identity.mjs`, and it adds no new failure mode: `assert-lock` already runs the same
    resolution in the script today.
- **D-13.C2 — The reconcile script never derives a project from a path.**
  - Delete `get_compose_project_name` (`:24-30`).
  - Replace `:13` with `RECONCILE_PROJECT="$(deployment_locked_project)"`. Under `set -e` (`:7`) a lock or identity
    failure exits non-zero before any Docker call.
  - `find_existing_postgres_container` filters on `com.docker.compose.project=${RECONCILE_PROJECT}`.
  - Nothing falls back to another project or to the basename.
- **D-13.C3 — Re-ensure postgres before reconciling; a missing or stopped container then fails loudly (coordinator
  decision, review pass 1; resolves OQ-C1/C-Q1).**
  - The script runs only at the `password_reconciled` stage (`start.sh:445-448`, `setup.sh:1242-1245`). A resumed run
    whose `postgres_started` stage is already done skips `up … postgres` (`deployment_stage_before`,
    `deployment-lifecycle.sh:123-129`), so postgres may have been removed (`start.sh --stop` →
    `run-operator-compose.sh down`, or a manual `docker compose down`/`rm`) or stopped (host reboot) between attempts.
  - **`start.sh`:** inside the `password_reconciled` block, immediately before the reconcile invocation, run
    `docker compose "${COMPOSE_FILE_ARGS[@]}" $profiles up $postgres_up_flags postgres`, the identical, idempotent
    command of the `postgres_started` stage (`:443`). On a fresh run it is a no-op `up` of an already-running
    service; on a resumed run it recreates or restarts postgres before reconciliation.
  - **Reconcile script:** with that guarantee, an absent **or** stopped postgres container for the lock-derived
    project is never "nothing to do":
    - `:183` (absent) becomes: print `Error: no PostgreSQL container found for Compose project '<project>'; refusing
      to mark the password reconciled.` to stderr, then `return 1`.
    - `:185-187` (found but not running) becomes: print `Error: PostgreSQL container <id> for Compose project
      '<project>' is not running; refusing to mark the password reconciled.` to stderr, then `return 1`.
    - In both cases the script exits non-zero, `start.sh` and `setup.sh` abort before
      `deployment_transition password_reconciled`, the stage stays pending, and the next run resumes at that stage
      (which, on `start.sh`, re-runs `up … postgres` first). The existing
      `test_interrupted_deployment_resumes_exact_pending_stage` already proves that resume path.
  - **`setup.sh` (coordinator decision, pass 2 prep):** its `password_reconciled` block (`:1242-1245`) has the same
    resume skip, so it gets the same re-ensure. Immediately before the reconcile invocation it repeats the
    `postgres_started` stage's own branch (`:1235-1239`): `docker compose "${COMPOSE_FILE_ARGS[@]}" up
    $(compose_up_no_build_args) postgres` when `OPT_OFFLINE=true`, else `up $(compose_up_after_build_args) postgres`.
    To avoid a third copy of that branch, extract it into one top-level function `start_postgres_service` (no new
    Docker verb; called from both blocks). A red-on-base unit test mirrors the `start.sh` one: a resumed `setup.sh`
    run at `password_reconciled` issues `up … postgres` before the reconcile invocation (line order in the fake docker
    log), in `tests/install/unit/setup-upgrade-state.test.sh`, as `resume_reensure_contract false` and
    `resume_reensure_contract true` (online and offline), appended to the contract loop (`:256`):
    - `PROJECT_DIR` is a `mktemp -d "$ROOT/.tmp/setup-resume.XXXXXX"` fixture whose
      `scripts/reconcile-postgres-password.sh` is a stub that appends `reconcile` to a shared log;
    - `stage=postgres_started`;
    - `deployment_stage_before` is true for `password_reconciled` and `stack_started`;
    - `start_compose_services() { :; }`;
    - `docker` answers `compose up --help` with `--pull` and logs every other call to the same log;
    - eval `compose_up_after_build_args`, `compose_up_no_build_args`, `start_postgres_service` and `start_services`
      via the suite's `extract` (`:7`).

    Assert that the first ` up .* postgres$` line precedes the first `reconcile` line, and, offline, that
    `up -d --no-build --pull never postgres` is present. **Red on base:** no `up` line, since the block skips straight
    to the stub. The `extract` of `start_postgres_service` must tolerate absence on base. The existing
    `startup_contract` cases stay green: their `stage=password_reconciled` skips the block. (Not
    `optional-stack-lifecycle.test.sh`: it runs `setup.sh` only with `--no-start` (`:268`, `:293`), so it never
    reaches `start_services`.)
- **D-13.C4 — The setup pre-start copy uses the same project and stays tolerant of absence.**
  - In `scripts/setup.sh`, delete `get_compose_project_name` (`:410-416`).
  - `find_existing_postgres_container` (`:418-435`) uses `project_name="$(deployment_locked_project)" || return 1`.
  - `reconcile_postgres_password_with_running_database` (`:546-551`) uses
    `container_id="$(find_existing_postgres_container)" || { echo "Error: …" >&2; return 1; }`.
  - Absence and a stopped container still return 0 here, exactly as before (`:550-554`). This path runs before
    `start_services` on fresh installs too, where no postgres exists yet. The post-start script (D-13.C3) is the loud
    check; D-13.C3's fatal rules do not apply to this copy.
  - The two copies are **not** merged in this phase. The setup copy validates through a pinned `docker run --rm`
    (`:480-484`), the only `docker run` in `setup.sh`. Removing it would orphan the `scripts/setup.sh`
    `compose_container`/`cleanup` registry entry (`config/resource-lifecycle-callsites.json:1397-1403`), so merging is
    a separate rationalization item.
- **D-13.C5 — Detection reads the same project.** `start.sh:361` becomes `local project_name="$SANCTUARY_PROJECT"`.
  That value was resolved at `:30` (`SANCTUARY_PROJECT || COMPOSE_PROJECT_NAME || sanctuary`) and possibly re-exported
  by the env file (`:66-70`), which is the same environment `deployment_begin` hands to `resolveProjectIdentity`.
  `--logs` and `--stop` run without the lock, so this does not call `deployment_locked_project`.
  **Folded at review pass 5 (P5C-1):** the `--logs` tail itself (`start.sh:508`, `docker compose
  "${COMPOSE_FILE_ARGS[@]}" $MCP_PROFILE logs -f`) passes no `-p`; `COMPOSE_FILE_ARGS` (`:344`) holds only
  `--project-directory`/`-f`, so Compose falls back to `docker-compose.yml:34` `name: sanctuary` and tails another
  deployment's logs after the fixed detection picked this project's files. `:508` becomes
  `docker compose -p "$SANCTUARY_PROJECT" "${COMPOSE_FILE_ARGS[@]}" $MCP_PROFILE logs -f`, matching `--stop`, which
  already passes `-p` (`scripts/ownership/run-operator-compose.sh:72-73`). Read-only verb, no lifecycle-registry change.
- No new `rm`, `kill` or Docker mutation verb (the D-13.C3 re-ensure repeats an existing `up … postgres` call). `start.sh`, `setup.sh` and `reconcile-postgres-password.sh` are already in
  the install-test and RC `pull_request` path filters (`.github/workflows/install-test.yml:99`,
  `release-candidate.yml:48`) and in the classifier (`classify-install-scope.sh:483,515`).

**Failing-first tests.**
1. `tests/ownership/deployment-lifecycle.test.sh`: after the first successful `deployment_begin no no no` at `:167`
   (env `SANCTUARY_PROJECT=lifecycle-test`, `:78`), add:
   - `[ "$(deployment_locked_project)" = lifecycle-test ]`;
   - the store fallback: `[ "$(env -u SANCTUARY_PROJECT -u COMPOSE_PROJECT_NAME bash -c '. "$1"; deployment_locked_project' _ "$ROOT_DIR/scripts/ownership/deployment-lifecycle.sh")" = lifecycle-test ]`;
   - a no-lock refusal: in a subshell with `SANCTUARY_DEPLOYMENT_LOCK_TOKEN` unset,
     `if deployment_locked_project >/dev/null 2>&1; then echo 'locked project resolved without the lock' >&2; exit 1; fi`.

   **Red on base:** `deployment_locked_project: command not found` (the suite aborts under `set -e`).
2. `tests/install/unit/optional-stack-lifecycle.test.sh`, fake `docker` (`:84-159`): when `FAKE_POSTGRES_PROJECT` is
   set, the `service=postgres` branch (`:105-107`) answers per project label. It prints `fake-postgres` only when the
   filter contains `com.docker.compose.project=$FAKE_POSTGRES_PROJECT`, prints `decoy-postgres` only when it contains
   `com.docker.compose.project=$FAKE_DECOY_PROJECT`, and prints nothing otherwise. With the knob unset, the behaviour is
   unchanged, so the existing tests are unaffected. Add `run_start_as_project PROJECT CASE_DIR [ARGS…]`, a copy of
   `run_start` that does `env -u COMPOSE_PROJECT_NAME … SANCTUARY_PROJECT="$PROJECT"` and sets
   `REQUIRE_DEPLOYMENT_LOCK=…/deploy-$PROJECT/mutation-lock`. **This is the first install test with
   `COMPOSE_PROJECT_NAME` unset.** Also add a second knob: when `FAKE_POSTGRES_RUNNING=false`, the
   `inspect … State.Running` branch prints `false` instead of `true` (unset: unchanged). Five tests:
   - `test_reconcile_targets_deployment_project_not_checkout_name`:
     - Setup: `FAKE_POSTGRES_PROJECT=staging-lane`, `run_start_as_project staging-lane`.
     - Assert exit 0.
     - Assert the log contains
       `ps -q --filter label=com.docker.compose.project=staging-lane --filter label=com.docker.compose.service=postgres`.
     - Assert it contains `exec -e PGPASSWORD=test-postgres-password fake-postgres psql -w -h postgres` and the
       `ALTER USER "sanctuary"` line.
     - Assert it does **not** contain `com.docker.compose.project=$(basename "$PROJECT_ROOT") --filter`.

     **Red on base:** the filter uses the checkout basename, finds nothing and silently skips, so the
     `ps -q … project=staging-lane` assertion fails first (and no `fake-postgres` exec or `ALTER USER` is logged).
     `staging-lane` is never a checkout basename, so this is red whatever the CI workspace is
     called.
   - `test_reconcile_refuses_other_projects_postgres`:
     - Setup: `FAKE_POSTGRES_PROJECT=absent-project`, `FAKE_DECOY_PROJECT="$(basename "$PROJECT_ROOT")"`,
       `run_start_as_project staging-lane`.
     - Assert non-zero exit.
     - Assert the output contains `no PostgreSQL container found for Compose project 'staging-lane'`.
     - `if grep -Fq decoy-postgres "$case_dir/docker.log"; then …; return 1; fi`.
     - Assert no `up -d --no-build` without ` postgres` (the full stack never started).
     - Assert `pending-revision.json` still exists (the stage is not marked done).

     **Red on base:** the decoy is validated and `ALTER USER` runs inside `decoy-postgres`, and the exit is 0.
   - `test_detection_reads_sanctuary_project_without_compose_project_name`:
     - Setup: `EXPECTED_PROJECT=staging-lane RUNNING_SERVICES=grafana run_start_as_project staging-lane CASE --logs`.
     - Assert the log contains `ps -a --filter label=com.docker.compose.project=staging-lane --format` (`--logs`
       calls `detect_enabled_stacks yes`, `start.sh:506`, which adds `-a`, `:365`) and
       `docker/compose/monitoring.yml`.
     - Assert the log does **not** contain `com.docker.compose.project=sanctuary --format`.
     - Assert the log contains `compose -p staging-lane` on the same line as `logs -f` (P5C-1; on base the `logs -f`
       call carries no `-p`).

     **Red on base:** detection queries `ps -a --filter label=com.docker.compose.project=sanctuary --format …`.
   - `test_resumed_reconcile_reensures_postgres_first` (D-13.C3, `start.sh`):
     - Setup: as one iteration of `test_interrupted_deployment_resumes_exact_pending_stage` —
       `FAKE_DOCKER_FAILURE_STAGE=postgres_started run_start "$case_dir"` fails at `ALTER USER` after the
       `postgres_started` stage is done; then `run_start "$case_dir"` again (`run_start` truncates `docker.log`, so
       the log holds only the resumed attempt).
     - Assert the resumed run exits 0.
     - Assert the resumed log contains `up -d postgres`, and that the line number of its first `up -d postgres` is
       lower than the line number of the first
       `ps -q --filter label=com.docker.compose.project=sanctuary --filter label=com.docker.compose.service=postgres`
       (`grep -nF … | head -n 1 | cut -d: -f1`; both must be non-empty).

     **Red on base:** the resumed run skips `up … postgres` entirely, so the `up -d postgres` assertion fails.
   - `test_reconcile_refuses_stopped_postgres` (D-13.C3, reconcile script):
     - Setup: `FAKE_POSTGRES_RUNNING=false run_start "$case_dir"` (the fake keeps the container stopped even after
       `up`).
     - Assert non-zero exit and that the output contains
       `is not running; refusing to mark the password reconciled`.
     - `if grep -Fq 'ALTER USER' "$case_dir/docker.log"; then …; return 1; fi`.
     - Assert no `up -d --no-build` without ` postgres` (the full stack never started) and that
       `pending-revision.json` still exists.

     **Red on base:** a stopped container returns 0 (`reconcile-postgres-password.sh:185-187`), the stage is marked
     done and the stack starts.

   Register them after `:482`.
3. `tests/install/unit/install-script.test.sh`: `test_setup_postgres_lookup_uses_locked_project`. It extracts
   `find_existing_postgres_container`, and `get_compose_project_name` while that still exists, from `scripts/setup.sh`
   with `extract_shell_function` (`:145-163`), then evals them in a subshell with:
   - `deployment_locked_project() { printf '%s\n' staging-lane; }`;
   - `COMPOSE_PROJECT_NAME` unset and `PROJECT_DIR="$TEST_TMP_DIR/sanctuary"`;
   - a PATH-shim `docker` that logs its arguments and prints `decoy-postgres` for `project=sanctuary`.

   Assertions: the result is empty, and the log has `com.docker.compose.project=staging-lane` and no
   `project=sanctuary`. **Red on base:** the basename `sanctuary` is queried and `decoy-postgres` is returned. Register
   it next to `:2972`. This needs no fixture directory beyond the suite's existing `$TEST_TMP_DIR`.
4. `tests/install/unit/setup-upgrade-state.test.sh`: `resume_reensure_contract false` and
   `resume_reensure_contract true`, as specified in the D-13.C3 `setup.sh` bullet. **Red on base:**
   `resume did not re-ensure postgres before reconcile: reconcile`, in both modes.

**Confirm red first (on `20361d62b3`, tests added, no production edit).**
```bash
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/optional-stack-lifecycle.test.sh   # red: the 5 new tests; the 14 existing pass
bash tests/ownership/deployment-lifecycle.test.sh            # red: deployment_locked_project not found
bash tests/install/unit/install-script.test.sh               # red: test_setup_postgres_lookup_uses_locked_project
bash tests/install/unit/setup-upgrade-state.test.sh          # red: resume_reensure_contract false/true
```
`test_setup_script_retries_corrupt_buildkit_cache_with_fake_docker` is green on base, both before and after its fake
edit (see "Existing tests the fix touches").

Then apply D-13.C1–C5. All four are GREEN, followed by the full set:
```bash
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/optional-stack-lifecycle.test.sh
bash tests/ownership/deployment-lifecycle.test.sh
bash tests/install/unit/install-script.test.sh
bash tests/install/unit/setup-upgrade-state.test.sh
npm run test:ownership
bash scripts/ci/run-install-unit-tests.sh
bash tests/install/unit/host-shell-portability.test.sh
bash tests/ci/ci-registration-completeness.test.sh
node scripts/ci/check-negated-test-assertions.mjs
node scripts/ownership/check-lifecycle-callsites.mjs
```

**Existing tests the fix touches.**
- `optional-stack-lifecycle.test.sh` `assert_postgres_start_and_reconciliation` (`:224-234`) still sees
  `project=sanctuary`, because `run_start` sets `COMPOSE_PROJECT_NAME=sanctuary`. `test_logs_honors_custom_project…`
  (`:385`) still passes, because `start.sh:30` folds `COMPOSE_PROJECT_NAME=private-sanctuary` into `SANCTUARY_PROJECT`.
- `test_interrupted_deployment_resumes_exact_pending_stage` is unchanged: the `postgres_started:ALTER USER` failure
  still aborts. Its resumed run for `postgres_started` now also logs `up -d postgres` (the
  D-13.C3 re-ensure; `password_reconciled` and `stack_started` resume at `stack_started` and skip it); it asserts only the absence of `up -d --no-build postgres` and ` build`, so it still passes.
  The fake's `password_reconciled:*"up -d --no-build"*` failure rule does not match `up -d postgres`.
- `install-script.test.sh` `test_setup_script_retries_corrupt_buildkit_cache_with_fake_docker` (`:1620`, registered at
  `:3007`) runs the full `setup.sh` (no `--no-start`, `:1748`) with a fake docker that has no postgres container.
  D-13.C3 makes that fatal (`no PostgreSQL container found for Compose project …`). In the C1 commit, make its fake
  stateful, replacing the top-level `ps` branch (`:1724-1726`) with:
  - `ps` prints `fake-postgres` for a `com.docker.compose.service=postgres` filter only once the log holds a
    `^compose up:.* postgres$` line, so the D-13.C4 pre-start copy still sees "absent", as on a fresh install;
  - `inspect … fake-postgres` prints `true` for `State.Running` and `healthy` for `State.Health`;
  - `exec … fake-postgres` prints `1` for `SELECT 1` and exits 0.

  The test's own assertions are unchanged.
- `setup-upgrade-state.test.sh` `startup_contract` cases use `stage=password_reconciled`, which skips the new
  re-ensure block, so they stay green.
- `upgrade-backup-script.test.sh:111` stubs only `deployment_assert_lock`, which is unchanged.
- `tests/ownership/deployment-cli.test.mjs` does not invoke `assert-lock`.
- No static grep in `install-script.test.sh` (`:1240-1249`, `:2151-2169`) names `get_compose_project_name`.

**CI lanes that exercise it.**
- `Install Script Unit Tests` (`install-test.yml` `unit-tests`, `:284`, via the `run-install-unit-tests.sh` glob).
- `CI classifier tests` (`quality.yml:673`, `npm run test:ownership`; selected by `scripts/ownership/*` in
  `classify-quality-scope.sh:107`).
- Release Candidate Validation's install unit step (`release-candidate.yml:291`).
- Install Stack Smoke and the baseline upgrade lane: real `start.sh`/`setup.sh` against a real daemon with
  `COMPOSE_PROJECT_NAME == SANCTUARY_PROJECT` set by the lane. These prove that the identity-equal path still reconciles
  end to end.

**Acceptance.**
- With `COMPOSE_PROJECT_NAME` unset and a checkout whose basename differs from `SANCTUARY_PROJECT`, `start.sh`
  reconciles the postgres of `SANCTUARY_PROJECT`.
- When that project has no postgres container, or a stopped one, after `up postgres`, `start.sh` exits non-zero with
  the named-project error, leaves the stage pending, and never touches another project's container.
- A resumed `start.sh` run at `password_reconciled` re-runs `up … postgres` before reconciling, so a postgres removed
  or stopped between attempts is brought back first.
- `--logs` detection reads `SANCTUARY_PROJECT`, and the `--logs` tail runs `docker compose -p "$SANCTUARY_PROJECT" … logs -f`.
- `grep -n 'basename "\$PROJECT_DIR"' scripts/reconcile-postgres-password.sh scripts/setup.sh` is empty.
- All the commands above pass. The PR's Install Stack Smoke, baseline upgrade and Release Candidate Validation are
  green.

**Rollback.** Revert the C1 commit. The behaviour returns to the basename lookup, with no data or state migration: the
`assert-lock` output gains a field that no one parses, and the deployment store format is unchanged.

---

### Phase C2 — The backup-volume-init idempotency check re-runs the one-shot without `start -a` (P2 `install-smoke--backup-volume-init-rerun-fails-on-podman-runner`)

**Evidence (re-verified on `20361d62b3`).**
- `tests/install/e2e/container-health.test.sh:443-473` (`test_backup_volume_init_idempotent`, registered at `:699`):
  - it checks that the first run exited 0 (`:453-458`);
  - it re-runs the container with `timeout 60 docker start -a "$container" >/dev/null 2>&1` (`:461`);
  - on failure it prints "backup-volume-init failed when re-run" and `docker logs --tail 50` (`:462-464`), but the
    attach output itself is discarded and the timeout's exit code is never shown.
- The repair is idempotent. `backup-volume-init` is a non-recursive `chown 1001:1001 /data/backups`, `restart: "no"`,
  `network_mode: none` (`docker-compose.yml:384-406`), and it finishes in about 20 ms.
- Packet diagnosis (i13 S7), from sora host evidence: on rootless Podman 5.4.2, `start -a` attaches and waits with
  `condition=next-exit`. In sora runs 21140 (job 264654) and 21170 (job 264958), the container died within 20 ms and
  the wait returned at exactly 60 s (the client `timeout`), followed by a kill 409 and 0-byte logs. sora run 21109 and
  kumo run 21098 returned immediately. That is a timing race in the test's re-run invocation, not a product defect.
  #1411's "passing" smoke (run 21155, runner `1e36ce6b`) ran no container tests (153-line log), so no passing
  evidence for this check exists on sora.
- The repo already avoids this pattern in product code:
  - `scripts/ops/grafana-quiescence-records.sh:101-128` (`complete_control_helper`): `docker container start` (detached),
    then `docker wait`, then `docker logs`, then a bounded convergence poll on inspected state
    (`await_terminal_control_helper_identity`, `:80-99`);
  - `scripts/ops/run-grafana-password-migration.sh:504-518` documents the Podman inspect lag after `wait`, and polls at
    `:530-543`.
  - The unit proof is `tests/install/unit/grafana-quiescence.test.sh:670-686`
    (`test_control_helpers_use_detached_start_wait_and_logs`, which forbids `container start -a`). Note: the brief cited
    `tests/install/e2e/grafana-quiescence.test.sh`; that file does not exist. The suite is under `unit/`, and #1413
    changed only its negated-assertion form there.
  - **That helper cannot be shared as-is.** It is bound to owner tokens, operation nonces and helper retirement. C2
    reuses its *pattern* in a test-only helper.
- Sweep of other non-interactive attach starts (`grep -rnE "start (-a|--attach)|'start', '--attach'"` over tests/ and
  scripts/):

  | Site | Verdict |
  | --- | --- |
  | `tests/install/e2e/container-health.test.sh:461` | **This finding.** Fixed here. |
  | `scripts/ci/run-jade-protocol-harness.sh:206` (`docker start --attach --interactive`, pinned by `tests/config/jadeProtocolHarness.test.ts:553,596`) | Legitimate. It streams a tar on stdin and the proof back on stdout. The container blocks on stdin until the attach is live, so it cannot exit before the wait registers. Out of scope. |
  | `scripts/perf/wallet-sync-high-fanout-replay.mjs:599` (`runRegisteredReplayContainer`, pinned by `tests/ci/wallet-sync-database-readiness.test.mjs:269`) | The same latent race class, but it runs `prisma migrate deploy` (seconds, not milliseconds), so exposure is low. The known separate P3. **Not digest-sealed:** `scripts/perf/wallet-sync-persistence-manifest.json:3-7` seals the driver, driver helpers, fixture builder, fixture definition and migration tree (checked at `wallet-sync-high-fanout-replay.mjs:993-994`), not this controller. A future fix needs no re-seal. It does need the readiness-test event pin and the controller's lifecycle registry entries (`config/resource-lifecycle-callsites.json:1251-1272`) kept consistent. Out of scope for C2. |
  | `tests/install/unit/grafana-quiescence.test.sh:676` | A negative assertion forbidding the pattern. Not a use. |

**Fix design.**
- **D-13.C6 — A shared test helper re-runs a one-shot detached and proves a fresh run.**
  `tests/install/utils/helpers.sh` gets `rerun_exited_oneshot_container CONTAINER [BUDGET_SECONDS=60]`, placed after
  `start_registered_install_container` (`:601-608`), outside the `# Test Assertion Functions` block. Its name does not
  start with `assert_`, so `install-assertion-tracking.test.sh:250-251`'s count of 8 is unchanged. Steps:
  1. `before="$(docker inspect -f '{{.State.FinishedAt}}' "$c")"`, else return 2.
  2. `docker start "$c" >/dev/null` (detached), else return 3.
  3. `wait_code="$(timeout "$budget" docker wait "$c")"`, else return 4. Docker's and Podman's default wait condition
     return at once for a container that has already exited, so the 20 ms run cannot be missed. A non-numeric
     `wait_code` returns 5.
  4. Poll `docker inspect -f '{{.State.Status}}|{{.State.FinishedAt}}|{{.State.ExitCode}}'` up to
     `${SANCTUARY_ONESHOT_SETTLE_ATTEMPTS:-20}` times, `sleep 0.5` apart. Stop when the status is `exited` **and**
     `FinishedAt` is different from `before`. This proves the re-run actually happened, and tolerates Podman's
     post-wait state lag, the same invariant as `run-grafana-password-migration.sh:504-518`. If it does not converge,
     return 6.
  5. If the inspected `ExitCode` differs from `wait_code`, return 7.
  6. Print the exit code.

  On every non-zero return it prints one `log_error` line with the step, `before`, the last observed
  status/FinishedAt/ExitCode and `wait_code`. Every diagnostic goes to stderr (`log_error … >&2`; `log_error` itself
  writes to stdout, `helpers.sh:57-59`); stdout carries only the exit code, so the caller's `code="$(…)"` stays
  clean and the state dump reaches the job log. It adds no `rm`, `kill` or `stop`: `timeout` is the only bound. The
  helper's comments must not contain the literal attach form (case 5's static grep would match it); say "attached
  start" instead.
- **D-13.C7 — `container-health.test.sh:460-469` uses the helper.**
  `code="$(rerun_exited_oneshot_container "$container" 60)" || status=$?`. On failure, it logs "backup-volume-init
  re-run did not complete (helper status N)" followed by `docker logs --tail 50`, and returns 1. Then
  `[ "$code" = 0 ]`, else "re-run exited with code $code" plus logs, and return 1. The `>/dev/null 2>&1` that hid the
  timeout goes away.

**Failing-first tests (deterministic, no host timing).**

New suite `tests/install/unit/oneshot-container-rerun.test.sh` (`set -euo pipefail`, `TEST_TMP_DIR="$(mktemp -d)"`,
`trap 'rm -rf "$TEST_TMP_DIR"' EXIT`, the `cleanup-containers-guard.test.sh` runner shape). Suite mechanics:
- commit it with mode 100755 (`chmod +x` before `git add`): `tests/install/run-all-tests.sh:116` runs
  `$script $VERBOSE $extra_args` directly;
- ignore positional arguments (it must accept a stray `--verbose`);
- `unset COMPOSE_PROJECT_NAME SANCTUARY_PROJECT` at the top, so `get_container_name` (`helpers.sh:200-213`,
  `${COMPOSE_PROJECT_NAME:-sanctuary}`) resolves the fake's fixed `sanctuary-backup-volume-init-1` even on a local
  run with `COMPOSE_PROJECT_NAME` exported. It sources
`tests/install/utils/helpers.sh` and loads the **real** e2e function with
`eval "$(awk '/^test_backup_volume_init_idempotent\(\)/{f=1} f{print} f&&/^}/{exit}' tests/install/e2e/container-health.test.sh)"`.

A PATH-shim `docker` keeps state in `$TEST_TMP_DIR/state` as `status|exit|finishedAt|runs` and models the Podman
semantics:
- `ps [-a] --format {{.Names}}` prints `sanctuary-backup-volume-init-1`.
- `start -a X` and `start --attach X` model the next-exit race: the run completes before the wait registers, so it
  exits 124, as `timeout` did on sora. It does not sleep, so the suite stays fast.
- `start X` increments `runs`, sets `finishedAt=t<runs>`, and sets the exit code to `$FAKE_RERUN_EXIT` (default 0).
  With `FAKE_START_NOOP=1` it changes nothing.
- `wait X` prints the current exit code.
- `inspect -f …` renders `.State.ExitCode`, `.State.FinishedAt` and `.State.Status`. The first `$FAKE_STATE_LAG`
  inspects after a start (default 2) return the pre-start FinishedAt, which models the Podman lag.
- `logs …` prints `chown ok`.

Cases, with `SANCTUARY_ONESHOT_SETTLE_ATTEMPTS=5` and no real sleep beyond 0.5 s steps:
1. `test_e2e_idempotency_check_survives_fast_exit`: the real `test_backup_volume_init_idempotent` returns 0, `runs`
   is 1, and the log has `^start sanctuary-backup-volume-init-1$` then `^wait sanctuary-backup-volume-init-1$`.
   **Red on base:** the function calls `start -a`, gets 124, and reports "failed when re-run". This was prototyped
   read-only against `20361d62b3`: `RESULT=fail`, and the log shows `start -a sanctuary-backup-volume-init-1`.
2. `test_rerun_failure_is_reported`: `FAKE_RERUN_EXIT=3`. The function returns non-zero and its output contains
   `exited with code 3` and `chown ok`. This guard catches a vacuous pass. It is red on base too, for the wrong reason
   (124); it becomes a meaningful guard once case 1 is green.
3. `test_stale_state_is_not_accepted_as_a_rerun`: `FAKE_START_NOOP=1`. The helper returns 6, and the e2e function
   fails; the e2e function's combined output (stdout + stderr) contains `step 6` (or the chosen step wording) and
   `before=`, proving the diagnostic is not swallowed by `$(…)`. **Red on base:** the helper does not exist.
4. `test_state_lag_converges`: `FAKE_STATE_LAG=3`. The helper prints 0. **Red on base.**
5. `test_e2e_suites_do_not_attach_to_one_shots`: a static guard. It fails if
   `grep -nE 'docker[[:space:]]+(container[[:space:]]+)?start[[:space:]]+(-[a-zA-Z]*a|--attach)' tests/install/e2e/*.sh tests/install/utils/*.sh`
   prints anything. **Red on base:** `container-health.test.sh:461`.

Registration in the same commit: `tests/install/run-all-tests.sh` gets a `run_test_suite "One-Shot Container Re-run
Unit Tests"` block, and `config/resource-lifecycle-callsites.json` gets the `temporary_artifact` entry (`git add`
first). `scripts/ci/run-install-unit-tests.sh` picks the suite up by glob.

**Confirm red first (on `20361d62b3`, suite added, no helper or e2e edit).**
```bash
bash tests/install/unit/oneshot-container-rerun.test.sh   # red: cases 1, 3, 4, 5 (and 2, for the wrong reason)
```
Then add the helper and edit `container-health.test.sh`. GREEN:
```bash
bash tests/install/unit/oneshot-container-rerun.test.sh
bash tests/install/unit/install-assertion-tracking.test.sh   # helpers.sh assertion-block count still 8
bash tests/install/unit/cleanup-containers-guard.test.sh     # also sources helpers.sh
bash scripts/ci/run-install-unit-tests.sh
bash tests/ci/ci-registration-completeness.test.sh
node scripts/ci/check-negated-test-assertions.mjs
node scripts/ownership/check-lifecycle-callsites.mjs
bash -n tests/install/e2e/container-health.test.sh
```

**CI lanes and the evidence required.**
- Deterministic proof: `Install Script Unit Tests` (`install-test.yml:284`) and Release Candidate Validation
  (`release-candidate.yml:291`) run the new suite on every runner. The suite does not depend on host timing, so it is
  the regression gate.
- Real-daemon proof: the PR's `Install Stack Smoke` (`install-test.yml:544`, container health via
  `scripts/ci/run-compose-e2e-subject.sh:112`). It is enabled on this PR by the `tests/install/*` release-surface
  carve-out.
- **Runner selection is not controllable** (`runs-on: [ubuntu-22.04, docker-socket]`, `:546`), so the acceptance is:
  1. **Required:** an Install Stack Smoke on the PR head that is green **and whose job log**, fetched via
     `$API/actions/jobs/<job_id>/logs`, **matches `grep -F 'PASSED: Backup Volume Init Idempotent'` and does not
     match `grep -F 'FAILED: Backup Volume Init Idempotent'`** (the literal pass line is
     `[SUCCESS] PASSED: Backup Volume Init Idempotent`, ANSI-wrapped, `container-health.test.sh:81`; `Running test:
     Backup Volume Init Idempotent`, `:72`, prints on failure too). A green run without the PASSED line does not
     count; run 21155 is the counter-example. Record the matching line, the runner `Name:` line, run ID and job ID in
     the PR body.
  2. **If that run landed on sora:** record it as direct proof of the Podman 5.4.2 path.
  3. **If not:** do not retrigger just to reach sora (CLAUDE.md retrigger discipline). The deterministic suite plus a
     green non-sora smoke suffice to merge. The first post-merge Install Stack Smoke or RC run that lands on sora,
     identified by its `Name:` line, is recorded in the implementation log as closing evidence; the integrator opens a
     run-state follow-up for it at merge time (Completion criteria). A sora failure there
     reopens the finding with the helper's step code (2–7) and the logged state, which the old check never printed.

**Acceptance.**
- `container-health.test.sh` no longer attaches to the one-shot.
- The re-run is proven by a new FinishedAt and ExitCode 0, with logs printed on any failure.
- The new unit suite is red on base, green after, and runs in every install-unit caller.
- The sweep table is recorded in the PR body.
- The Install Stack Smoke evidence rule above is met.

**Rollback.** Revert the C2 commit. It is test-only: no product, workflow or sealed file changes.

---

### Phase C open questions

- **C-Q1 (= OQ-C1) — Should a missing or stopped postgres container at the `password_reconciled` stage fail the
  deployment? RESOLVED (coordinator, review pass 1).**
  - A resumed deployment whose `postgres_started` stage already completed skips `up postgres` (`start.sh:437-444`), so
    making either case fatal on its own would wedge every rerun after postgres was removed or stopped between
    attempts.
  - **Decision:** `start.sh`'s `password_reconciled` block re-runs the idempotent `up $postgres_up_flags postgres`
    immediately before the reconcile script, and the script then treats both a missing and a stopped container as
    fatal (D-13.C3). Tests: `test_resumed_reconcile_reensures_postgres_first` and
    `test_reconcile_refuses_stopped_postgres`. No P3 follow-up.
  - `setup.sh`'s `password_reconciled` block gets the same re-ensure through the extracted `start_postgres_service`
    (D-13.C3, `setup.sh` bullet), with its own red-on-base resume-order test:
    `setup-upgrade-state.test.sh` `resume_reensure_contract false`/`true`.

## Implementation log (coordinator)

- Phase worktrees cut from plan commit `e83429c52` (reviewed, 6 passes). Workers: a, b1, b2, b3, c. Red runs on base and
  green runs recorded in the scratchpad (`i13-<phase>-red.txt` / `-green.txt`); every red failed on an assertion for the
  stated reason.
- **a:** `cf8bf9a55` (A1; 60 SLIP-132 vectors + both estimation cases red on base) and `d94d4ba7e` (A2; unit cases 1–4
  and integration (a)/(b)/(e) red on base; integration DB ran). Exactly the 9 planned fixture breakages. Pre-commit docs
  agent suggested an explanatory comment at `feePolicy.ts:31`; not added (one-line change kept as planned).
- **b1:** `a545fa13f`; case 1 (121 calls) and case 2 red on base; per-line deletion mutants each fail exactly one guard.
- **b2:** `d7eb0d17d`. Divergence: case 4 (planned as a guard) is also red on base, on an assertion — it checks the new
  `emptyMessage`, which does not exist on base. Accepted.
- **b3:** `db3f8dd88`. **Ownership divergence (coordinator-approved, D-13.X3 stop):** two existing tests in
  `tests/components/DeviceDetail/hooks/useDeviceData.ownership.test.tsx` (`:780`, `:794`) asserted the removed same-id
  new-user-object refetch; reassigned to b3 and switched to a different user id (same `setLoadErrorState(null)` paths).
- **c:** `8c0d96adc` (C1 incl. the pass-5 `--logs -p` fold) and `06c420c80` (C2); install unit 25/25, test:ownership green.
- Integrated by `git cherry-pick -x` as `544e6f1da`, `9ee5074e6`, `7d61b9ae1`, `145087f5d`, `e7d73b343`, `8b4cbd17d`,
  `264130370`; every phase branch proven upstream with `git cherry` (all `-`), then branches and worktrees removed.
- `/simplify` (reuse, quality, efficiency) + adversarial review: no P0–P2. Applied in `16f1d72a5` ("refactor: simplify
  iteration 13 fixes after review"): A2 early return before the eligibility query (+ case); A1 tests use `getNetwork`;
  B1 single `failure` state + shared `isRetryableStatus` (`src/api/retryPolicy.ts`); B2 shared
  `excludeReplacedTransactions`, M excludes replaced rows, `isFilterResultPartial` bounded by the stats `totalCount`
  (fixes a false "partial" on an exact multiple of 50), single-element notice sharing `FILTER_SUMMARY_PANEL_CLASS`;
  B3 `useLatestRequest` replaces the generation ref; C1 `start_postgres_service` in `start.sh`, test cleanups
  (`run_start_as_project` folded into `run_start`); C2 `timeout` on `docker start`/first `inspect`. Skipped:
  `deployment_assert_lock` delegating to `deployment_locked_project` (different failure semantics); the duplicate
  `up postgres` on fresh runs (seconds; complicates the stage machine).
- New P3 backlog recorded: `offline-bundle--compose-project-ignores-sanctuary-project`,
  `upgrade-backup-manifest--compose-project-from-basename`, `approval-display--current-approvals-counts-ineligible-votes`,
  `wallet-transactions--server-side-filtered-paging-and-stats`, `ai-filter-summary--partial-label-on-exact-page-multiple`.
- **Verification block.** Run 1 (`ac555b109`): backend coverage 2 timeouts in untouched files under host load ~16
  (`electrumPool.connections`, `hardwareSignedEvidenceProvenance`; both 134/134 in isolation) — rerun. Run 2: backend
  coverage 17649/17649, frontend coverage 9962/9962 at the 100% threshold, the three integration specs green, then
  Playwright failed 16 device toolbar/filter cases: the render-regression helper `changeDevicePreference` waited for the
  very `GET /devices` refetch B3 removes (plan miss). Fixed in `1275fca35` to assert no refetch and no loading state —
  red on a base `20361d62b3` static build (16 failed, "Expected: 0, Received: 2"), green on the integrated build (22/22).
  Run 3 (the block from the Playwright step on, plus `typecheck:tests`; the new commit touches only an e2e helper
  Vitest does not load): EXIT 0 — Playwright 392 expected, only the 7 known auth/login failures, PNG baselines unchanged;
  lizard 84 (base); every quality, ownership, install and CI gate green.

## Verification (before every push)

Workers run only their phase's typechecks and targeted tests (no coverage) and record red runs on the plan-commit
base. The integrator runs the whole block below, as written, as one script on the integrated PR branch in
`/home/nekoguntai/sanctuary-bug-scrub-20261013-i13` (every `cd server` is in a subshell), only after every phase branch
is cherry-picked, and is the only one who runs coverage (backend and frontend), the static Playwright run and the
`docs/architecture/generated` regeneration; the coverage branches each phase names are the integrator's checklist.
Any `tests/install/unit` suite run directly (outside `scripts/ci/run-install-unit-tests.sh`) needs the `@runtime`
project-lock-root env shown below. Write the block to `$SCRATCH/i13-verify.sh` and run
`bash "$SCRATCH/i13-verify.sh"` — never paste it into `bash -c` or the Bash tool: a `pgrep -f` guard would match the
integrator's own shell (the guard is anchored to `[n]ode_modules/.bin/...`).

**Integrator step before the block.** Set up the integration worktree like the phase worktrees (D-13.X2): a real root
`npm ci` (no symlinked `node_modules`), `cd server && npx prisma generate`, and `npm run build --workspace=shared`,
with nvm node on `PATH`. Then run `npm run arch:graphs` and `npm run arch:calls` and commit
`docs/architecture/generated` in the integrator commit (with the changelog bullets), so `arch:check` below is a pure
check. Re-use the Playwright scratch inputs from iteration 12 (`$SCRATCH/i12-playwright/playwright.static.config.mts`
and `known-auth-login-failures.txt`), copied to `$SCRATCH/i13-playwright/` with the wrapper's import path changed to
the i13 integration worktree.

```bash
export PATH="$HOME/.nvm/versions/node/v$(cat /home/nekoguntai/sanctuary-bug-scrub-20261013-i13/.nvmrc)/bin:$PATH"
set -euo pipefail
cd /home/nekoguntai/sanctuary-bug-scrub-20261013-i13
test "$(git rev-parse --abbrev-ref HEAD)" = codex/bug-scrub-loop/20261013-i13
test "$(npm --version | cut -d. -f1)" = 12   # devEngines requires npm 12; the system ~/.local/bin npm 11 fails EBADDEVENGINES
test -d node_modules && test ! -L node_modules   # real install; a symlink breaks arch:graphs (shared/* edges)
PINNED_LIZARD=/home/nekoguntai/sanctuary/.tmp/quality-tools/lizard-1.24.0/bin/lizard
test -x "$PINNED_LIZARD"   # D-13.X1 pinned binary
BASE=20361d62b302ea473a5ebe0ad735d1f37831c3cd
SCRATCH=/tmp/claude-1001/-home-nekoguntai-sanctuary/03f84a15-a621-4179-a832-71dcc24cbaff/scratchpad
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
# targeted backend: A1 (fee policy + estimation + every send-path suite that resolves spend policy), A2 (approvals)
# (the transactionServiceCreate/ and transactionServiceBatch/ dirs hold only .contracts.ts files; a dir filter matches nothing)
( cd server && npx vitest run tests/unit/services/bitcoin/transactionFeePolicy.test.ts \
  tests/unit/services/bitcoin/estimation.slip132NestedSegwit.test.ts tests/unit/services/bitcoin/estimation.test.ts \
  tests/unit/services/bitcoin/transactionService.create.test.ts tests/unit/services/bitcoin/transactionService.batch.test.ts \
  tests/unit/services/bitcoin/advancedTx.test.ts tests/unit/services/bitcoin/advancedTx.pubkeyBranch.test.ts \
  tests/unit/services/approvalService.test.ts \
  tests/unit/api/approvals-routes.test.ts tests/unit/api/wallets-approvals-routes.test.ts )
wait_for_no_coverage || exit 1
( cd server && npx vitest run --coverage tests/unit )   # integrator only; scoped as CI
# integration (real DB via the compose-backed runner; serialized host-wide)
flock /home/nekoguntai/.i13-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/approvalAnyNEligibility.integration.test.ts
flock /home/nekoguntai/.i13-integration.lock npm --prefix server run test:integration:db -- tests/integration/flows/approvalExpirySweep.integration.test.ts
flock /home/nekoguntai/.i13-integration.lock npm --prefix server run test:integration:db -- tests/integration/api/walletApprovalsAudit.test.ts
# mutation pins unchanged: within every mutation-pinned / Stryker / critical-shard surface, the only changed file is
# A1's transactions/feePolicy.ts, which no map entry, mutate range or shard names (Phase A1 pin table).
# Pinned surfaces (re-enumerated on 20361d62b3):
#   config/wallet-safety-mutation-map.json path/productionFile + server/stryker.*.config.mjs mutate (all under
#   server/src/services/bitcoin): advancedTx/{batch,cpfp,rbf}.ts, psbtAccountBinding.ts,
#   psbtSigningContextValidation.ts, rawTransactionEvidence.ts, signingIntent/{artifactValidation,feePolicy}.ts,
#   transactions/{createBatchTransaction,outputBuilder,psbtConstruction,psbtInputConstruction}.ts,
#   transactionWeight.ts, utxoSelection.ts; plus src/services/hardwareWallet/psbtAccountBinding.ts (frontend);
#   server/scripts/mutation/shards.mjs:18-62 additionally: addressDerivation.ts, addressDerivation/**, psbtValidation.ts,
#   psbtInfo.ts, validationEvidenceContracts.ts, transactions/{broadcastContracts,broadcasting}.ts,
#   blockchain/broadcastPreflight.ts, signingIntent/** (all under server/src/services/bitcoin), and
#   server/src/{repositories/transactionSigningIntentRepository,api/transactions/broadcasting,middleware/auth,services/accessControl}.ts
test "$(git diff --name-only "$BASE" -- server/src/services/bitcoin src/services/hardwareWallet/psbtAccountBinding.ts \
  server/src/services/accessControl.ts server/src/middleware/auth.ts server/src/api/transactions/broadcasting.ts \
  server/src/repositories/transactionSigningIntentRepository.ts config/wallet-safety-mutation-map.json \
  'server/stryker.*.config.mjs' server/scripts/mutation)" = server/src/services/bitcoin/transactions/feePolicy.ts
node --test tests/ci/check-wallet-safety-classifier.test.mjs tests/ci/check-wallet-safety-mutation-map.test.mjs
# frontend
npm run typecheck:app
npm run typecheck:tests
npm run typecheck:all
npm run typecheck:scripts
npx vitest run --config config/tooling/vitest.config.ts tests/hooks/useIntelligenceStatus.test.ts \
  tests/components/TransactionList tests/components/WalletDetail tests/contexts tests/components/DeviceList \
  tests/components/DeviceList.test.tsx tests/components/DeviceDetail tests/components/Layout tests/components/Layout.test.tsx
npm run test:run
wait_for_no_coverage || exit 1
npx vitest run --config config/tooling/vitest.config.ts --coverage   # integrator only; 100% threshold
# Playwright (CLAUDE.md static-build procedure; no host dev server). Known limitation: the static server cannot answer
# POST /auth/login, so the 7 known cases fail here; the exit status is recorded, not gated. Bounded and non-vacuous.
PW_DIR="$SCRATCH/i13-playwright"
npm run build
if curl -fsS -o /dev/null http://127.0.0.1:4173/ 2>/dev/null; then echo "port 4173 already serving; refusing to test another build" >&2; exit 1; fi
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist >/dev/null 2>&1 &
SRV=$!
trap 'kill "$SRV" 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:4173/ && break; sleep 1; done
curl -fsS -o /dev/null http://127.0.0.1:4173/
kill -0 "$SRV"   # our server (not another process) answered
PW_RC=0
npx playwright test --config "$PW_DIR/playwright.static.config.mts" --reporter=json >"$PW_DIR/results.json" || PW_RC=$?
echo "playwright exit $PW_RC (recorded)"
test -s "$PW_DIR/results.json"
test "$(jq '.stats.expected + .stats.unexpected + .stats.flaky' "$PW_DIR/results.json")" -ge 380
jq -r '[.. | objects | select(has("specs")) | .specs[] | select(.ok == false) | .file + " :: " + .title] | .[]' "$PW_DIR/results.json" | sort -u >"$PW_DIR/failing.txt"
comm -23 "$PW_DIR/failing.txt" "$PW_DIR/known-auth-login-failures.txt" >"$PW_DIR/unexpected.txt"
test "$(wc -l <"$PW_DIR/known-auth-login-failures.txt")" -eq 7
test ! -s "$PW_DIR/unexpected.txt" || { echo "Playwright failures beyond the 7 known auth/login cases:" >&2; cat "$PW_DIR/unexpected.txt" >&2; exit 1; }
# PNG baselines unchanged (B2 default render unchanged): nothing committed since BASE, and no new/modified/untracked
# file left by this run (Playwright's default updateSnapshots: 'missing' writes new baselines as untracked files)
git diff --exit-code "$BASE" HEAD -- tests/e2e/render-regression.spec.ts-snapshots
test -z "$(git status --porcelain -- tests/e2e/render-regression.spec.ts-snapshots)"
# quality gates
npm run lint
LIZARD_BIN="$PINNED_LIZARD" npm run quality:lizard 2>&1 | tee "$SCRATCH/i13-lizard.txt"   # cap 86; pinned 1.24.0, no PyPI fetch (scripts/quality.sh:210-211)
test "$(grep -c ': warning:' "$SCRATCH/i13-lizard.txt")" -le 84    # D-13.X1: no new warnings (base 20361d62b3 = 84)
node scripts/quality/check-large-files.mjs
QUALITY_JSCPD_OUTPUT_DIR="reports/jscpd-$(date +%s)" bash scripts/quality/jscpd-only.sh
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
node scripts/ci/check-negated-test-assertions.mjs
bash scripts/ci/backend-integration-groups.sh --check   # A2's new flows spec listed exactly once
bash tests/ci/backend-integration-groups.test.sh
# install, ownership and CI suites (C)
# optional-stack-lifecycle does not set its own project-lock root; run it only with the @runtime lock-root env
SANCTUARY_ALLOW_TEST_PROJECT_LOCK_ROOT=true SANCTUARY_TEST_PROJECT_LOCK_ROOT=@runtime \
  bash tests/install/unit/optional-stack-lifecycle.test.sh
bash tests/install/unit/install-script.test.sh
bash tests/install/unit/oneshot-container-rerun.test.sh
bash tests/ownership/deployment-lifecycle.test.sh
npm run test:ownership   # every tests/ownership suite incl. producer hooks, as the CI classifier lane (quality.yml:673)
bash scripts/ci/run-install-unit-tests.sh          # all tests/install/unit suites; installs tests/ci/lib
bash tests/ci/ci-registration-completeness.test.sh
bash tests/ci/classify-test-changes.test.sh
bash tests/ci/check-workflow-composition.test.sh
npx vitest run --config config/tooling/vitest.config.ts tests/ci/vitestRepoInputsClassified.test.ts   # last, over the final tree
echo "verification block: all gates passed"
```

If the integration DB cannot start, record the failure and rely on the CI integration groups; never skip silently.
`/simplify` and an adversarial review before committing; commits in the foreground through
`flock /home/nekoguntai/.i13-commit.lock git commit …`; never while a coverage run is active.

## Delivery, rollback, deployment

- **One PR** on `codex/bug-scrub-loop/20261013-i13` (integration worktree `/home/nekoguntai/sanctuary-bug-scrub-20261013-i13`),
  one commit per finding (test + fix), then the integrator commit (changelog `[Unreleased]` bullets, regenerated
  `docs/architecture/generated`).
- **Workers (D-13.X2):** phases `a`, `b1`, `b2`, `b3`, `c` in parallel. Workers edit only owned files, run typechecks and
  targeted tests, run lizard on changed files (zero new warnings), record red runs on the plan-commit base, and commit
  through the flock.
- **Integrator:** cherry-picks serially with `-x` (a, b1, b2, b3, c), never resolves a conflict by editing another
  phase's files (conflicts go back to the owner), then runs the block. Each phase branch is proven upstream with
  `git cherry codex/bug-scrub-loop/20261013-i13 <phase-branch>` (every line `-`), deleted with `git branch -D`, and
  its worktree removed by path.
- **Merge:** squash through protected `main`; no admin bypass; merges are serial and no other open PR is rebased; poll
  required contexts via `/commits/<sha>/statuses`. Expected lanes: verify-vectors (A1 touches
  `server/src/services/bitcoin/**`), backend unit + integration (the new flows spec registered in
  `backend-integration-groups.sh`), frontend unit + render e2e, install unit and Install Stack Smoke (C), Release
  Candidate Validation (PR head) and the PR-bounded upgrade baseline (latest-stable; `enable_pr_bounded_upgrade_baseline`),
  ownership and classifier suites. A missing expected lane is investigated, not assumed skipped. **C2 CI evidence:** a
  green Install Stack Smoke counts only if its job log (`$API/actions/jobs/<job_id>/logs`) matches
  `grep -F 'PASSED: Backup Volume Init Idempotent'` and does not match `grep -F 'FAILED: Backup Volume Init
  Idempotent'`; the matching line, runner `Name:`, run ID and job ID go in the PR body. The runner cannot be chosen,
  so no retrigger is made just to reach sora — a sora run is recorded if it happens, and otherwise a run-state
  follow-up tracks the first post-merge sora Install Stack Smoke/RC run, which closes the evidence. Any retrigger carries the CLAUDE.md
  four-part evidence. Verify the reported `merge_commit_sha` (not the head SHA) is an ancestor of `origin/main` before
  deleting the branch.
- **PR-body flags:** A1 P1, one-line conversion, the twelve-site sweep table, pins untouched; A2 escalated P2, eligibility
  re-filter matching `'all'`, threshold unchanged, accepted residuals OQ-A1/OQ-A2, `currentApprovals` unchanged
  (OQ-A3); B1 terminal 4xx + capped backoff, no contract change; B2 partial-result notice text and empty-state text,
  baselines unchanged; B3 the classified site table and the two extra sites the sweep found
  (`useWalletData.ts`, `useDeviceData.ts`), the load-generation guard; C1 lock-derived project, `start.sh` re-ensures postgres before
  reconciling, fail-loud on a missing or stopped container (OQ-C1 resolved), the offline-bundle sibling recorded as a
  P3; C2 detached re-run helper, the fake-Podman suite, the sweep verdicts; "no e2e
  mock-map change, no new endpoint, no migration, no version bump"; the P3 backlog stays outside this PR.
- **Rollback:** every phase is code/CI/test-only. No schema, migration or stored-shape change. Reverting A1 re-breaks
  sending for SLIP-132 nested-SegWit wallets; reverting A2 restores stale-vote counting; reverting C1 restores the
  basename lookup.
- **Deployment:** none until clean closeout (`--deploy final`); the local stack is rebuilt only after the loop closes.

## Completion criteria

- [ ] Every failing-first test in Phases A–C fails on `20361d62b3` code (red runs recorded per phase, with the failure
  reason the phase states) and passes on the PR head; honest-path guards stay green.
- [ ] Verification block run as written on the integrated branch with exit status 0 recorded; all three integration specs
  (`approvalAnyNEligibility`, `approvalExpirySweep`, `walletApprovalsAudit`) executed through the flock'd
  `test:integration:db`.
- [ ] Playwright static run recorded (exit status, ≥ 380 executed, only the 7 known auth/login failures, baselines
  unchanged); CI's browser lane is binding.
- [ ] PR merged; target-branch CI green on its merge commit; ancestry of `merge_commit_sha` verified; branches and
  worktrees cleaned (`git cherry` proof per phase branch).
- [ ] PR body carries every flag listed under Delivery.
- [ ] C2: Install Stack Smoke evidence recorded (PASSED line, runner `Name:`, run/job IDs); if not sora, a run-state
  follow-up opened to record the first post-merge sora Install Stack Smoke/RC run.
- [ ] Run state updated (seven findings resolved; the decided open questions and the P3 follow-ups — OQ-A3, OQ-B2,
  `offline-bundle--compose-project-ignores-sanctuary-project` — recorded).
- [ ] P3 backlog remains outside the blocking fix set.

## Review log

- Draft assembled 2026-10-21 from plan13-A/B/C and plan13-*-findings (source `20361d62b3`).
- Pass 1 (2026-10-21): 28 comments (A 7, B 10, C 11) — all accepted and applied; coordinator decisions: C-3 re-ensure postgres before reconcile, missing and stopped fatal (resolves OQ-C1); C-7 offline bundle as P3 follow-up; rejected: none.
- Between passes 1 and 2 (coordinator): the editor flagged that C-3 covered `start.sh` only; decided to give
  `setup.sh`'s `password_reconciled` block the same re-ensure via an extracted `start_postgres_service` (D-13.C3).
- Pass 2 (2026-10-21): 8 comments (A 1, B 4, C 3) — all accepted and applied (P2C-1 blocking: install-script corrupt-buildkit fake made postgres-stateful; P2C-2: setup resume contract in setup-upgrade-state.test.sh; P2B-1: B1 guards driven by advanceTimersToNextTimerAsync with delta assertions); rejected: none.
- Pass 3 (2026-10-21): 8 comments (A 3, B 3, C 2; none blocking) — all accepted and applied (lizard count gate at the 84 base; pinned-surface allow-list; nvm PATH + npm 12 assert; real npm ci in the integration worktree with a no-symlink guard; citation fixes); rejected: none. Phase C full prototype: every new test red on base for its stated reason, install unit 25/25 and test:ownership 561/0 green after the fix.
- Pass 4 (2026-10-21): 4 nits (A 1, B 2, C 1; none blocking) — all accepted and applied by the coordinator (pinned `LIZARD_BIN` + `test -x`; port-4173 pre-check and `kill -0 "$SRV"`; expected `useWalletData.ts` base lizard warning; `npm run test:ownership` in the block); rejected: none.
- Pass 5 (2026-10-21): A 0, B 0, C 1 — P5C-1 accepted and applied by the coordinator (folded into D-13.C5: `start.sh --logs` tail gets `-p "$SANCTUARY_PROJECT"`, with a test assertion and acceptance line); rejected: none. Pass 5 was not clean, so pass 6 follows.
- Pass 6 (2026-10-21): A 0, B 0, C 0 — **clean; review converged.** C prototyped the pass-5 `--logs -p` fold red→green and confirmed every other `start.sh` compose call runs after `deployment_begin` with `-p`.
