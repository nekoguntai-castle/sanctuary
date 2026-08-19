# Legacy wallet descriptor-policy recovery — breaking the remediation closed loop

**Status:** plan, not implemented. Awaiting operator decisions (see final section).
**Date:** 2026-08-18
**Base:** `main` @ `d8a6cc0758` (immediately after PR #829 restored legacy wallet sync)
**Related:** incident report `reports/incident-wallet-sync-v0.8.63-2026-08-18.md`, PR #829, issue #830

## The defect

PR #829 restored *syncing* for wallets that predate the v0.8.63 canonical-evidence
migrations. Those wallets still cannot **receive**: `addressDisplaySafety.ts:33,50`
requires canonical evidence (correctly — it confers ownership), and the remediation flow
that is supposed to supply that evidence rejects exactly these wallets at
`walletRemediation/proof.ts:126-130` for the `changeDescriptor`/`sourceDescriptor` they
lack. The only writer of those columns, `walletRepository.assignMissingDescriptor`, has an
`addresses: { none: {} }` CAS that no existing wallet can satisfy. Closed loop, no exit.

## How this plan was produced

18 agents: 5 investigation lanes, 3 independent designs from different premises, 9
adversarial reviews (funds-safety / provenance-honesty / implementation-risk), then
synthesis. Design ranking: `new-source-kind` 7.3 (safe), `extend-remediation` 7.0 (flagged
unsafe), `relax-cas` 5.0 (flagged unsafe). The plan below synthesises the winner's
provenance model onto the existing remediation lifecycle. Load-bearing claims were
re-verified directly against source before this document was written.

---

# Legacy Wallet Descriptor-Policy Recovery — Implementation Plan

*Verified against `/home/nekoguntai/sanctuary` @ `d8a6cc0758`. Every load-bearing claim below was re-read in source or executed as a probe; findings that contradict the panel are marked **[CORRECTION]**.*

---

## Recommendation

Extend the **existing** wallet-remediation lifecycle with a fourth, explicitly-labelled provenance class — `descriptorSourceKind = 'recovered_legacy'` — and a fourth remediation change kind `wallet_policy_recovery` that assigns a legacy-null wallet's complete descriptor policy *and* its address coordinates in the one already-serializable, owner-approved, hash-chained transaction. The recovered policy records exactly what is true: the stored receive descriptor is the token this wallet has always held, its origin was never recorded, and the change descriptor was derived from it by canonical branch substitution and then **proven by re-deriving every stored address, including the wallet's real branch-1 change addresses**. We deliberately do **not** write `generated_pair` (it asserts an origin we cannot evidence, and it would make recovered wallets permanently indistinguishable from natively-created ones); we do **not** build a bespoke recovery endpoint or repository writer (the remediation flow already holds the correct `FOR UPDATE` lock graph over `wallets → wallet_users → group_members → wallet_devices → devices → device_accounts → addresses`, `walletRemediationRepository.ts:124-153`, which two competing designs would have had to re-derive and one got wrong); we do **not** touch `addressDisplaySafety.ts:33,50`; we do **not** rewrite `addresses.derivationPath` in this PR; and we do **not** admit the new audit finding into `UNSUPPORTED_FINDINGS`.

---

## Why the alternatives lose

**`generated_pair` regenerate-and-prove (no migration).** Three independent problems, all confirmed in source:

1. **The proof is circular.** `signerMatchesKey` (`server/src/services/walletRemediation/proof.ts:308-329`) already requires `signer.accountXpub === key.xpub`, `signer.accountDerivationPath === key.accountPath`, `signer.deviceFingerprint === key.fingerprint`, and `underlyingXpubBytes(...) === key.underlyingKeyId`. Rebuilding a descriptor from those same three fields via `buildSingleSigDescriptor` (`descriptorBuilder.ts:110-121`) and asserting byte-equality cannot fail once the round-trip gate has passed. It proves reproducibility, not origin.
2. **The premise is forgeable.** `addDeviceAccountWithEvidence` (`server/src/services/deviceAccountRegistration.ts:24-56`) writes `xpub: input.xpub` verbatim from the POST body; its only gate is `connectedFingerprint === storedFingerprint`, and that fingerprint is printed inside the descriptor itself (`[aabbccdd/84h/…]xpub…`). A wallet owner blocked on `signer.binding_ambiguous` can manufacture eligibility by pasting the descriptor's own key expression back through `POST /api/v1/devices/:id/accounts`. Under `generated_pair` that laundering *changes the recorded provenance*. Under `recovered_legacy` it cannot, because the record never claimed an origin.
3. **It destroys the ability to re-triage.** `prepareDescriptorPolicy` writes `sourceDescriptor = receive.body` (`descriptorPolicy.ts:71-77`) and native creation feeds it builder output (`walletCreate.ts:148-153`), so a `generated_pair` recovery is byte-identical to a natively-created wallet. `sourceTokensMatchRuntime` (`walletSafetyAudit/descriptorEvidence.ts:70-77`) collapses to `removeChecksum(d) === d`, and `classificationFor([])` returns `proven_safe` (`analyzer.ts:22-27`). No column anywhere marks the wallet as recovered. That is a permanent, irreversible loss.

**Bespoke `walletDescriptorRecoveryRepository` + relaxed CAS.** Rejected on two verified grounds. Its proposed `lockWalletRecoveryGraph` locks only wallet + addresses, while the `generated_pair` proof it depends on reads `wallet_devices`/`devices`/`device_accounts` — which the existing `lockApprovalGraph` locks precisely because of that dependency. And it discards the content-addressed proposal, the append-only `wallet_remediation_events` chain (`onDelete: Restrict`, `schema.prisma:943-963`), the owner-approval gate, and the post-apply convergence check (`walletRemediation/index.ts:163-167`) — for a write the database makes **permanently irreversible**.

**Two-phase (fix the wallet CAS, remediate addresses later).** Structurally impossible. `hasCanonicalPolicyIdentity` (`canonicalPolicy.ts:113-118`) returns `true` the moment `canonicalPolicyId` is non-null, and `pipeline.ts:98` then runs `assertCanonicalAddressesMatchWallet` over every address — all of which are still coordinate-null and fail `hasCompleteCanonicalAddressEvidence`. Wallet sync stops for that wallet: a direct regression of PR #829, three days old.

**Widening the existing `wallet_policy` allowlist in place.** Would force re-pointing the two deliberate negative-control tests (`schema.test.ts:55`, `walletRemediationRepository.test.ts:246-261`) and weakens the write boundary for every wallet, not just legacy ones. A fourth kind costs one union member and keeps both guards byte-identical.

---

## Provenance contract

### What a recovered wallet records

| column | value | why it is true |
|---|---|---|
| `descriptorPolicyVersion` | `1` | complete v1 contract |
| `descriptor` | **untouched** | frozen by `protect_wallet_descriptor_policy` (20260811000000:126) |
| `fingerprint`, `type`, `scriptType`, `network`, `quorum`, `totalSigners` | **untouched** | same trigger arm |
| `changeDescriptor` | `replaceCanonicalDescriptorBranch(descriptor, 0, 1)` | the *exact* function that produced `changeDescriptor` at creation (`descriptorBuilder.ts:177-179`) |
| `descriptorSourceKind` | `'recovered_legacy'` | new, and it names the operation |
| `sourceDescriptor` | `= descriptor`, byte-for-byte | pinned by the new CHECK arm, so it can only ever mean "the exact stored token the policy was reconstructed from" |
| `sourceChangeDescriptor` | `NULL` | **no second token was ever supplied.** Inventing one is the fabrication the brief forbids — and the current CHECK would *force* that lie under either pair kind (`20260810010000/migration.sql:71-83`) |
| `sourceDescriptorChecksum`, `sourceChangeDescriptorChecksum` | `NULL` | a recovered token is checksum-free by construction (round-trip gate below) |
| `canonicalPolicyId` / `canonicalPolicyVersion` | from `requireCanonicalWalletPolicy` | registry-derived |

**The recorded sentence:** *"This is the receive descriptor Sanctuary had stored for this wallet before descriptor policies existed; who produced that token was never recorded. The change descriptor was derived from it by canonical branch substitution and proven by re-deriving every address the wallet has ever held."*

**Why `generated_pair` would be a lie.** `prepareImport.ts:86-89` fixes the meaning authoritatively: *"Mark the materialized pair as generated so `sourceDescriptor` is not misrepresented as verbatim imported descriptor evidence"* — i.e. *Sanctuary materialized these bytes from key material it holds*. Pre-policy `walletCreate` had a signer-less branch that stored `descriptor: input.descriptor` verbatim (`git 1bfbaaf9a0^:server/src/services/wallet/walletCreate.ts:100-125`). We cannot tell, per row, which population a legacy wallet is in. `imported_pair` is worse still: it would additionally require writing the *derived* token into `sourceChangeDescriptor`, encoding the lie in a column.

**What stops the label being a rubber stamp.** Three mechanical gates, none relaxed: byte-equality + fingerprint-order (`proof.ts:161-172`), one-unique-DeviceAccount per descriptor key (`proof.ts:308-329`), and exact one-branch address re-derivation (`proof.ts:349-361`) — plus display-time re-derivation on every read forever (`canonicalAddressValidation.ts:76-104`), which never consults `descriptorSourceKind`.

### The migration (the only SQL change)

`server/prisma/migrations/20260818000000_add_recovered_legacy_descriptor_policy/migration.sql`

```sql
-- Adds an explicit recovered-provenance class for wallets that predate descriptor
-- policies. Constraint relaxation ONLY: no row is rewritten, no wallet is
-- remediated by this migration, and no wallet becomes usable because of it. A
-- recovered policy records the exact stored receive descriptor as its own source
-- evidence and derives the change branch; it can never be read as imported or
-- generated. There is no down migration: once any wallet carries this kind the
-- prior constraint cannot be restored, and a server binary that predates this
-- migration cannot restore a backup containing such a wallet.
ALTER TABLE "wallets" DROP CONSTRAINT "wallets_descriptor_policy_complete_check";

ALTER TABLE "wallets"
ADD CONSTRAINT "wallets_descriptor_policy_complete_check"
CHECK (
  -- Arms 1 and 2 reproduced clause-for-clause from
  -- 20260810010000_add_wallet_descriptor_policy/migration.sql:17-86, with:
  --   (a) the source-kind IN list (:56-60) gaining 'recovered_legacy'
  --   (b) the pairing block (:71-83) gaining this THIRD arm:
  --
  --   OR (
  --     "descriptorSourceKind" = 'recovered_legacy'
  --     AND "sourceChangeDescriptor" IS NULL
  --     AND "sourceChangeDescriptorChecksum" IS NULL
  --     AND "sourceDescriptorChecksum" IS NULL
  --     AND "sourceDescriptor" = "descriptor"
  --   )
);
```

**Nothing else in the database moves.** Verified by reading the SQL, not by inference:

- **No trigger change.** `protect_wallet_descriptor_policy` was already rewritten at `20260811000000_add_wallet_remediation_evidence/migration.sql:122-190`; its first arm fires exactly on `OLD."descriptorPolicyVersion" IS NULL AND NEW... IS NOT NULL AND OLD."descriptor" IS NOT NULL` and rejects only identity drift plus *already-non-null* evidence. Filling from NULL in one statement is explicitly permitted. `protect_wallet_canonical_policy_identity` (:196-231) and `protect_address_canonical_evidence` (:302-347) are gated identically.
- **No `schema.prisma` structural change** — `descriptorSourceKind` is `String?`, not a Prisma enum. Doc comment only.
- **No `COMPLETE_TABLE_POLICY_HASH` rev** — those hash table *names* (`backupService/constants.ts:106-119`).
- **No new columns**, so `walletSafetyAuditRepository.ts:22-59`'s SELECT lists and the `z.strictObject` schemas at `validation/walletSafetyAudit.ts:41-72` are untouched.
- Precedent for `DROP CONSTRAINT` in a later migration: `20260812000000_add_signing_intent_fee_policy_v2/migration.sql:3`.

---

## The proof obligation

Everything below must pass, in this order, before a single byte is written. The output is a *proposal*; the same computation is re-run from a fresh snapshot under the serializable lock at approval, and the digests must match (`index.ts:156-159`).

**P0 — the row is genuinely legacy-null.** `descriptor` non-null and `fingerprint` non-blank, while `changeDescriptor`, `sourceDescriptor`, `sourceChangeDescriptor`, `descriptorPolicyVersion`, `descriptorSourceKind` and both checksums are **all** NULL. A partially-populated row is DB-impossible under the CHECK's first arm, so it indicates tampering → stays blocked on `descriptor.provenance_missing`.

**P1 — the stored descriptor is already canonical.** `parseCanonicalDescriptor(d)` succeeds **and** `renderCanonicalDescriptor(parsed) === d` **and** `parsed.checksum === undefined`.
*Probe result:* an `h`-form descriptor round-trips byte-identically (`renderCanonicalDescriptor(parse(d)) === d` → `true`, `parsed.body === d` → `true`); an apostrophe-form descriptor renders back as `h`-form → `false`. This is exact and cheap: it guarantees `prepared.descriptor === wallet.descriptor` (which `proof.ts:161` demands and the trigger makes unfixable), and it makes the `"sourceDescriptor" = "descriptor"` DB pin meaningful. → blocker `descriptor.not_canonical`.

**P2 — the wallet's declared shape matches the descriptor. [CORRECTION — no panel design has this, and it is required].** `proveDescriptorPolicy` binds only the wrapper and the ordered fingerprint join. The **audit** additionally asserts `(parsed.quorum ?? null) === wallet.quorum` and the same for `totalSigners` (`walletSafetyAudit/descriptorEvidence.ts:174-175`). For `generated_pair`/`imported_pair` those columns were validated at creation; for a legacy row they are unvalidated data that the 20260811 trigger then freezes **forever**. Worse, pre-policy `walletCreate` passed `quorum` through for `single_sig` too, and the CHECK's identity arm requires `single_sig ⇒ quorum IS NULL AND totalSigners IS NULL` (`20260810010000:39-43`) — so without this gate an eligible proposal detonates as a raw Postgres `23514` at approval, *after* the owner clicked approve. Assert: `single_sig ⇒ quorum === null && totalSigners === null`; `multi_sig ⇒ quorum === parsed.threshold && totalSigners === parsed.keys.length && quorum >= 1 && totalSigners >= quorum`; `network ∈ ('mainnet','testnet3','testnet4','signet','regtest')`. → blocker `policy.identity_incomplete`.

**P3 — every descriptor key binds to exactly one linked DeviceAccount.** Reuse `signerMatchesKey`/`uniqueSignerMatch` unchanged (`proof.ts:254-329`), including the `new Set(signers.map(s => s.id))` de-dup — `loadSnapshot` LEFT-JOINs `device_accounts` on `deviceId` (`walletRemediationRepository.ts:55`), so the signer rows are a link × account cross-product and a naive count is wrong. This is a *safety* gate (the wallet has plausible signing material), explicitly **not** a provenance gate — see the forgeability finding above.

**P4 — the derived pair is structurally valid.** `changeDescriptor := replaceCanonicalDescriptorBranch(d, 0, 1)`, then `validateCanonicalDescriptorPair(d, changeDescriptor)`.
*Probe result:* a wrong change descriptor (a different account's xpub at branch 1) is rejected here with `Receive/change descriptors must differ only by branch`.

**P5 — every stored address re-derives, with exactly one branch match.** The existing engine at `proof.ts:349-361`: recompute `scriptPubKey` from the stored address string, derive both branches at the stored index, and require exactly one candidate matching `address` **and** `scriptPubKey` **and** `derivationPath`.

**This is what converts a guess into a proof, and I verified it empirically rather than taking it on faith.** Two facts combine:

- Pre-policy `generateInitialAddresses` looped `for (const change of [false, true])` (`git 1bfbaaf9a0^:server/src/services/wallet/addressGeneration.ts:24-38`), so **every** legacy wallet persisted real branch-1 change addresses.
- A `tsx` probe against the live modules confirmed that `deriveCanonicalAddress(branch 1)` over the *derived* change descriptor reproduces byte-for-byte the addresses legacy code produced via `node.derive(1).derive(i)` — for `wpkh`, and for 2-of-2 `wsh(sortedmulti)`. The same probe confirmed a wrong change descriptor does **not** reproduce them.

So the derived change descriptor is not merely deterministic — it is re-proven against real persisted data the wallet has been using since creation. **This is the single strongest funds-safety argument in the design and it must be stated in the PR body.**

**P6 — coordinate uniqueness. [CORRECTION — unaddressed by every panel design].** Before emitting any coordinate patch, check the proven `(branch, index)` set and the address-string set for duplicates. `addresses_walletId_branch_index_key` is `UNIQUE (walletId, branch, index) WHERE "branch" IS NOT NULL` (`20260810020000:64-66`) — legacy rows are exempt, and pre-policy `generateAddress` computed `nextIndex` as `max(index)+1` across **both** branches with no uniqueness guard. Two colliding rows each prove independently, then the second `updateMany` aborts the whole transaction with a raw `23505` and no diagnostic, leaving the wallet permanently unremediable. → blocker `address.duplicate_coordinate`, naming the colliding row ids.

**Failure semantics.** Any blocker ⇒ `eligible: false`, `changes: []`, `recoveryEvidenceDigest: null` (enforced by `schema.ts:98-102`, re-parsed on every read). The proposal is a permanent evidence record; `approveAttempt` refuses it with `ConflictError('Remediation proposal is blocked')` (`index.ts:149-151`). The wallet stays exactly as fail-closed as it is today — no receive address, no new derivation.

---

## Implementation steps

### STEP 0 — Failing tests first (all RED before any `src/` edit)

**`server/tests/unit/services/walletRemediation/proof.test.ts`** — add `legacyNullSnapshot()`. **The existing `legacySnapshot()` at :12-21 is DB-impossible**: it nulls `descriptorPolicyVersion` while keeping `changeDescriptor`, `sourceDescriptor` and `descriptorSourceKind: 'imported_multipath'`, which violates the CHECK's first arm (`20260810010000:18-26`). The integration fixture `createLegacyWallet` (`walletRemediation.integration.test.ts:50-98`) writes a full `imported_multipath` policy. **No existing test builds the production shape.**

```
descriptor: AUDIT_FIXTURE_RECEIVE, fingerprint: 'aabbccdd',
changeDescriptor / descriptorPolicyVersion / descriptorSourceKind /
sourceDescriptor / sourceChangeDescriptor / both checksums /
canonicalPolicyId / canonicalPolicyVersion: null,
addresses: all five coordinate columns null
```

**The assertion that must fail:**

```ts
const doc = buildWalletRemediationDocument(legacyNullSnapshot());
expect(doc.eligible).toBe(true);                                    // today: false
expect(doc.blockers).toEqual([]);                                   // today: [{ code: 'descriptor.provenance_missing', … }]
expect(doc.changes[0]).toMatchObject({
  kind: 'wallet_policy_recovery',
  proposed: {
    descriptorPolicyVersion: 1,
    descriptorSourceKind: 'recovered_legacy',
    changeDescriptor: AUDIT_FIXTURE_CHANGE,
    sourceDescriptor: AUDIT_FIXTURE_RECEIVE,
    canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
    canonicalPolicyVersion: 1,
  },
});
expect(doc.proof.recoveryEvidenceDigest).toMatch(/^[0-9a-f]{64}$/);  // today: null — and see STEP 4(f)
```

Plus, in the same commit: `descriptorPolicy.test.ts` (recovered preparation shape), `schema.test.ts` (recovery patch parses; `descriptor`/`fingerprint` still rejected; the existing `wallet_policy` negative control at :55 untouched), `walletRemediationRepository.test.ts` (recovery CAS applies; throws when `descriptorPolicyVersion` already set; **fails schema parse when `sourceDescriptor` is omitted**), `descriptorEvidence.test.ts` + analyzer test (recovered wallet reconstructs cleanly yet still reports `descriptor.provenance_recovered` and classifies `manual_investigation`), `descriptorPolicyRestore.test.ts` (recovered wallet passes restore validation; a doctored `changeDescriptor` fails).

**`server/tests/integration/flows/walletRemediation.integration.test.ts`** — `createLegacyNullWallet()` seeded via `$executeRaw` (the canonical repositories now refuse such writes), then: propose → eligible; approve → applied; `assertUnusedAddressesSafeForDisplay` resolves; `generateAddress` allocates `max(index)+1` (not 0). Negative controls: a second approval attempt is refused; the DB rejects `recovered_legacy` with a non-null `sourceChangeDescriptor`; reversing the wallet/address write order raises `Address canonical policy identity does not match its wallet`.

### STEP 1 — Migration

Write `20260818000000_add_recovered_legacy_descriptor_policy/migration.sql` exactly as specified above. Add `server/tests/unit/prisma/recoveredLegacyDescriptorPolicyMigration.test.ts` in the style of `walletDescriptorPolicyMigration.test.ts:28-70`.

**[CORRECTION] Do not pin the re-added constraint with `toContain`.** That 70-line CHECK is the outermost completeness guard for *every* wallet, and STEP 4(c) depends on one of its clauses. `toContain` cannot detect a dropped `AND` by construction. Instead: extract the clause list from `20260810010000/migration.sql:29-84` and assert **every** term is present in the new file, plus assert the recovered arm's four requirements. Add an integration assertion comparing `pg_get_constraintdef('wallets_descriptor_policy_complete_check'::regclass)` against a stored expected definition, with a negative control proving a mutated clause fails it.

### STEP 2 — `server/src/services/wallet/descriptorPolicy.ts`

Extend `DescriptorSourceKind` (:13-16) and `PrepareDescriptorPolicyInput.sourceKind` (:29-33) with `'recovered_legacy'`. Add a branch **before** the `changeDescriptor` branch:

- reject a supplied `changeDescriptor` (`InvalidInputError`, "Recovered legacy policy is derived, not supplied");
- P1 gates: `parsed.checksum === undefined`; `renderCanonicalDescriptor(parsed) === input.receiveDescriptor`;
- derive via `replaceCanonicalDescriptorBranch(input.receiveDescriptor, 0, 1)` (which itself enforces branch 0), then `validateCanonicalDescriptorPair`;
- return `{ descriptor: parsed.body, changeDescriptor: derived, descriptorPolicyVersion: 1, descriptorSourceKind: 'recovered_legacy', sourceDescriptor: input.receiveDescriptor, sourceChangeDescriptor: null, sourceDescriptorChecksum: null, sourceChangeDescriptorChecksum: null }`.

Leave `WalletDescriptorAssignment` at `walletRepository.ts:589` on the original three values **on purpose** — `recovered_legacy` must never be reachable from the create/link path. Add a doc comment on `DescriptorSourceKind` spelling out what each value asserts; nothing in `docs/` or `shared/` currently defines this vocabulary.

### STEP 3 — `server/src/services/walletRemediation/types.ts`

Add `'wallet_policy_recovery'` to `RemediationChange.kind` (:11). **Keep** `WALLET_REMEDIATION_SCHEMA_VERSION` at `sanctuary.wallet-remediation.v1` — the document shape is unchanged and the string plus the `wallet-remediation-v1:` id prefix are pinned in four places.

### STEP 4 — `server/src/services/walletRemediation/proof.ts`

- **(a)** Split `validateWalletPolicyCandidate` (:123-143) into `isCompletePolicyRow` / `isLegacyNullPolicyRow` predicates plus the unchanged type/multisig arms. Widen `SupportedWalletRow` (:45-51) so `changeDescriptor`/`sourceDescriptor` are nullable with a discriminant. Extract rather than grow — `lizard` fails above 9 `CCN>15` warnings (`scripts/quality/lizard-only.sh:15`).
- **(b)** New `assertVersionedIdentityShape` implementing **P2**, evaluated only on the legacy branch.
- **(c)** `prepareWalletDescriptors` (:146-155): branch on kind **first** — `recovered_legacy` or a legacy-null row routes to `prepareDescriptorPolicy({ receiveDescriptor: wallet.sourceDescriptor ?? wallet.descriptor, sourceKind: 'recovered_legacy' })`; then the existing multipath and pair paths.
- **(d)** `proveDescriptorPolicy` (:157-174): keep `prepared.descriptor !== wallet.descriptor` unconditional; make the `changeDescriptor` comparison conditional on `wallet.changeDescriptor !== null`; call `validateCanonicalDescriptorPair(prepared.descriptor, prepared.changeDescriptor)`. Fingerprint check unchanged.
- **(e)** `walletPolicyPatch` (:176-197): add `changeDescriptor` and `sourceDescriptor` to the `values` map. Both still pass through `exactNullable` (:97-104), so for an already-versioned wallet they are equal-and-omitted and the patch is byte-identical to today's. `walletPolicyChange` sets `kind = wallet.descriptorPolicyVersion === null ? 'wallet_policy_recovery' : 'wallet_policy'`, evidence id `wallet:<id>:descriptor-policy-recovery`. Ordering at :399-403 is untouched, so the wallet write still precedes every address write — required by `enforce_address_wallet_policy_identity` (`20260810020000:95-125`).
- **(f) [BLOCKING — CONFIRMED CRASH]** `proof.ts:414,416` do `changes.find(change => change.kind === 'wallet_policy')`. With the new kind that returns `undefined`, both `?? …` fall through to `undefined`, and `canonicalize` (`walletRemediationCanonicalDocument.ts:3-16`) has **no `undefined` arm** — it reaches `throw new Error('Remediation evidence contains a non-JSON value')` outside any `try`. `POST /remediation/proposals` would 500 for exactly the target population. Make the lookup kind-agnostic, **and** source `changeDescriptor` from the proven prepared pair rather than `snapshot.wallet.changeDescriptor` (which is NULL here), **and** add `descriptorSourceKind` to the digest — a digest named "recovery evidence" must bind what was recovered. Apply the same fallback to `preservedPolicyDigest` (:442-451) or rename it for this kind; it currently hashes `changeDescriptor` under a name asserting nothing moved. Then run `grep -rn "kind === 'wallet_policy'" server/src src` and put the resulting complete reader list in the PR body.
- **(g)** `addressChanges` (:331-391): add **P6** duplicate detection before the loop. Add a diagnostic-only refinement — when address + scriptPubKey match exactly one branch but `derivationPath` does not, emit `address.path_label_mismatch` naming both paths instead of the opaque `address.proof_ambiguous`. **No acceptance criterion changes.**

### STEP 5 — `server/src/services/walletRemediation/schema.ts`

Add `walletPolicyRecoveryPatchSchema`: `.strict()`, the six existing fields **plus** `changeDescriptor` and `sourceDescriptor`, and **no** `descriptor`/`fingerprint` key ever. **[CORRECTION] Make `descriptorPolicyVersion`, `descriptorSourceKind`, `changeDescriptor` and `sourceDescriptor` REQUIRED together, not four independent `.optional()`s** — for a legacy-null row `exactNullable` always returns the proposed value, so a recovery patch missing any of them is malformed by definition, and requiredness is what makes STEP 6's CAS real. `superRefine` that `descriptorSourceKind === 'recovered_legacy'`. Add the fourth member to `remediationChangeSchema` (:82-86). Leave `walletPolicyPatchSchema` untouched.

### STEP 6 — `server/src/repositories/walletRemediationRepository.ts`

Add `wallet_policy_recovery` to `REMEDIATION_PATCH_FIELDS` (:12-16) as the six existing fields plus `changeDescriptor`, `sourceDescriptor`. Extend `assertExactPatch` with a per-kind `REQUIRED_PATCH_FIELDS` set so the allowlist also proves requiredness. In `applyChanges` (:157-171), add a branch keeping the one-`updateMany`-per-change shape with a **value-based CAS**:

```ts
where: { id: walletId, descriptorPolicyVersion: null, canonicalPolicyId: null,
         descriptor: change.proposed.sourceDescriptor }
```

**No `as string` cast** — the required-field schema makes the type sound, and the cast is exactly what hides Prisma silently dropping an `undefined` predicate. Exact because the new CHECK arm pins `sourceDescriptor = descriptor`. The existing `count === 1` assertion supplies the failure. **Do not touch `assignMissingDescriptor`'s CAS** at `walletRepository.ts:606-611`.

### STEP 7 — `server/src/services/walletSafetyAudit/`

`descriptorEvidence.ts` `reconstructPolicy` (:99-124): add a `recovered_legacy` branch, else every remediated wallet reports `descriptor.provenance_unproven` forever (:206). Also push a **new** finding `descriptor.provenance_recovered` unconditionally whenever `descriptorSourceKind === 'recovered_legacy'`, so such a wallet can never reach `proven_safe`. Register the id in `walletAuditFindingIdSchema` (`validation/walletSafetyAudit.ts:13-34`).

**[CORRECTION vs the winning design] Do NOT add it to `UNSUPPORTED_FINDINGS` (`analyzer.ts:16-20`).** That set means "known, bounded, not a defect" and its members are all *structural* limitations. A wallet whose provenance is by admission unrecorded belongs in `manual_investigation`. Two adversarial reviewers reached this independently and I agree: burying a deliberately weaker provenance class in a benign bucket is the erosion the design is trying to prevent. Cost: a reviewed `findings_reviewed` audit at every RC once any wallet is recovered. That is the correct price. **Do not add a fourth classification** — `walletAuditClassificationSchema` is a closed enum backed by a 3-counter `strictObject` (:127-132), printed verbatim by `cli.ts:22-33`, with the release gate pinning `sanctuary.wallet-safety-audit.v2`.

### STEP 8 — `server/src/services/backupService/validation.ts`

**Mandatory, not optional.** In `validateVersionedDescriptorPolicy` (:116-143), replace the two inline ternaries with an explicit mapping: `changeDescriptor` is `undefined` for both `imported_multipath` and `recovered_legacy`; `sourceKind` passes through as `'generated_pair' | 'imported' | 'recovered_legacy'`. **Traced failure if skipped:** `recovered_legacy` maps to `'imported'` with `changeDescriptor: undefined`, routes into `expandCanonicalMultipathDescriptor`, throws on a fixed-branch token, and lands in `issues` (not `warnings`) at :138-142 — **every backup containing a remediated wallet becomes unrestorable**. Keep the legacy-null path a warning (:150-172); blocking would make existing backups unrestorable and the correct sequence is restore-then-remediate. Update the warning text to name the remediation flow. Backup **export** (`creation.ts:65-73`) is a generic `findMany` and needs no change; do **not** rev `COMPLETE_TABLE_POLICY_HASH`.

### STEP 9 — `server/src/api/wallets/export.ts`

Replace the implicit `||` fallback in `recoveryDescriptorSet` (:73-81) with an explicit `recovered_legacy` branch returning `{ descriptor: wallet.sourceDescriptor, changeDescriptor: wallet.changeDescriptor }`. Payload shape unchanged; the point is that a NULL `sourceChangeDescriptor` must not silently fall through as if the derived token were source evidence. **State the limit honestly in the PR:** `WalletExportData` (`services/export/types.ts:15-27`) has no provenance field, so a recovered wallet's Sparrow/descriptor export is byte-identical to a generated one and re-importing it yields a fresh `imported_pair` row. Provenance is durable in the database, the full backup, and the audit — not in third-party interop formats.

### STEP 10 — API surface + frontend

`server/src/api/openapi/schemas/wallet.ts`: fourth `oneOf` member mirroring the `wallet_policy` block at :419-437 (`additionalProperties: false`) with the two extra string fields. No new route ⇒ `check:openapi-route-coverage` and the `tests/e2e/helpers.ts:24-35` fail-closed default need no change. `src/api/walletRemediation.ts`: fourth member of the `.strict()` discriminated union at :13-45 — **omitting this makes the panel fail to parse an otherwise-correct response**. `WalletRemediationPanel.tsx`: render `wallet_policy_recovery` as a distinct, higher-emphasis review block showing the receive descriptor and the derived change descriptor in full, with the recovered-provenance copy. Frontend coverage is 100% and includes `src/api/**`, so component tests and an extension to `tests/e2e/wallet-remediation.spec.ts` ship in the same PR.

### STEP 11 — Message fix (no contract change)

`server/src/services/wallet/addressGeneration.ts:129-134` currently advises "Please import wallet with xpub or descriptor." That is now actively harmful: `walletImportService.ts:291` is `tx.wallet.create`, so re-import always makes a *new* wallet and loses id, labels, transaction history, agents, policies and sharing. Point it at the remediation flow instead. **Do not touch `addressDisplaySafety.ts:33,50`.**

### STEP 12 — Verification

`cd server && npx tsc --noEmit && npx vitest run --coverage tests/unit` (scoped — CI passes `tests/unit` positionally, so an integration-only branch reads as uncovered against the literal 100% threshold), then the frontend pair. No new `src/` module is created (recovery preparation lives in the existing `descriptorPolicy.ts`), so `docs/architecture/generated/**` does not move. Do not edit `bitcoin/transactions/outputBuilder.ts` (the `serverFeePolicy` canaries are pinned at lines 116-119 / 129-140). Never add a `paths:` filter to `verify-vectors.yml`.

---

## Blast radius

| Surface | Change | Consequence if missed |
|---|---|---|
| `prisma/migrations/20260818000000_…` + pin test | new | — |
| `services/wallet/descriptorPolicy.ts` | new kind + branch | nothing can produce the policy |
| `walletRemediation/{types,proof,schema}.ts` | new change kind, gates, patch fields | **`proof.ts:414/416` 500s on the target population** |
| `repositories/walletRemediationRepository.ts` | allowlist + required fields + CAS | `Unsafe remediation patch` throw |
| `walletSafetyAudit/descriptorEvidence.ts` + `validation/walletSafetyAudit.ts` | reconstruct branch + new finding id | every recovered wallet permanently `descriptor.provenance_unproven` |
| `backupService/validation.ts` | explicit kind mapping | **every backup containing a recovered wallet becomes unrestorable (hard `issues` failure)** |
| `api/wallets/export.ts` | explicit `recovered_legacy` branch | derived token silently emitted as source evidence |
| `api/openapi/schemas/wallet.ts` | fourth `oneOf` member | contract drift |
| `src/api/walletRemediation.ts` | fourth union member | **panel zod-parse fails on a correct response** |
| `WalletRemediationPanel.tsx` + tests | distinct review block | user approves a descriptor write labelled "canonical policy metadata" |
| `tests/e2e/wallet-remediation.spec.ts` | recovery path | — |
| Evidence artifacts | `recoveryEvidenceDigest` + `preservedPolicyDigest` fallbacks | crash / mislabelled digest |
| **Not touched:** `COMPLETE_TABLE_POLICY_HASH`, `walletSafetyAuditRepository` SELECT lists, audit classification enum, `sanctuary.wallet-remediation.v1`, `sanctuary.wallet-safety-audit.v2`, `assignMissingDescriptor`, `addressDisplaySafety.ts`, e2e mock maps (no new route), `docs/architecture/generated/**` | | |

---

## Gates to satisfy

- **Coverage.** Server is literal 100% on all four metrics (`server/vitest.config.ts:58-63`), scoped to `tests/unit` in CI (`test.yml:1229`). Every new branch belongs in `proof.ts`, `schema.ts`, `descriptorPolicy.ts`, `walletRemediationRepository.ts`, `descriptorEvidence.ts` or `backupService/validation.ts` — all fully gated. `walletRemediation/index.ts` and `types.ts` are exempt via `**/index.ts` / `**/types.ts` (`:33-34`); **do not park untested branches there**. Budget realistically: V8 counts each `||`/`??` operand, so P2's arms plus the round-trip gate plus the new `exactNullable` fields put this at **18-25 focused unit cases**, not 7. Bar any new `/* v8 ignore */`: an unreachable branch is evidence the branch should not exist. Frontend is also 100% and includes `src/api/**` and `shared/**`.
- **Mutation shards.** Confirmed non-issue: `is_critical_mutation_file` (`scripts/ci/classify-files-lib.sh:66-73`) matches none of these paths, and no profile in `config/wallet-safety-mutation-map.json` covers `walletRemediation/**`, `services/wallet/**`, `repositories/**` or `walletSafetyAudit/**`. The lanes are *skipped*, which `test.yml:1046` accepts.
- **verify-vectors.** Runs on every PR, no path filters (structurally enforced by `check-wallet-safety-classifier.mjs:47-53`). **No evidence regeneration is required** for a `walletRemediation/**` / `prisma/**` change: the proof manifest pins only Bitcoin Core, and the generated PSBT vectors are rebuilt in-job from live Core and diffed. **[CORRECTION to the panel's "12-19 min"]** the `summary` job hard-requires `verify-trezor-emulator` (48 m cap), `verify-ledger-emulator` (20 m) and `verify-jade-emulator` (70 m), all unconditional on `pull_request`. Plan for hours, not minutes — run the complete local gate before the first push.
- **Migration reversibility.** **There is none, and it must be stated in the migration header and the release notes.** Prisma has no down migrations; once any wallet carries `recovered_legacy` the prior CHECK cannot be restored, and a server binary predating STEP 8 cannot restore a backup containing such a wallet. Make the restore-failure message name `descriptorSourceKind` so an operator on an old build gets a diagnosable error.
- **Release gate.** Every touched path is in `config/wallet-safety-critical-paths.json`, so the next RC fails at `verify-wallet-safety-audit-review.mjs:138-140` without fresh evidence: run `npm run audit:wallet-safety -- --output <file>` against a real database, have a **second** person approve it (`operatorId !== reviewerId` at :65), and load it into `WALLET_SAFETY_AUDIT_REVIEW_JSON` with `sourceCommit == RC HEAD` inside 7 days. Once any wallet is recovered, expect `findings_reviewed` / exitCode 2 at every wallet-safety-relevant RC (accepted at :69-78). **No runbook for producing the report SHA-256 exists in the repo — write it in this PR.**

---

## What stays blocked (and why that is correct)

| Population | Blocker | Why blocking is right |
|---|---|---|
| **Legacy multisig** (all of it) | `address.path_label_mismatch` | *Probe-confirmed:* addresses re-derive **exactly** on both branches, but legacy `multisigDerivation.ts:49` stored `m/${firstKey.accountPath}/…` verbatim in `h`-form (`m/48h/0h/0h/2h/0/0`) while canonical emits `m/48'/0'/0'/2'/0/0`. Rewriting `derivationPath` is **forbidden in the same statement**: the address transition arm freezes it *unconditionally* (`20260811000000:302-314`). It is possible as a *separate* statement while `coordinateVersion` is still NULL — but that turns a coordinate backfill into a rewrite of a user-visible, funds-adjacent label and needs its own evidence story. **Follow-up PR.** |
| **Non-account-0 single-sig** | same | *Probe-confirmed:* legacy `getAccountPath` hardcoded account `0'` from the xpub prefix, so an account-1 wallet stored `m/84'/0'/0'/0/0` while canonical yields `m/84'/0'/1'/0/0`. **[CORRECTION]** one panel design attributed this to `accountPathMatchesWalletPolicy`; that function deliberately ignores the account index (`shared/constants/walletPolicy.ts:229-244`). Same follow-up. |
| **Descriptor-only wallets** (no linked device accounts) | `signer.binding_ambiguous` (`proof.ts:279-281`) | Nothing binds the descriptor to any signing material. Fail-closed is correct; the honest answer is export-and-re-import with real provenance. |
| **Checksummed / apostrophe-form descriptors** | `descriptor.not_canonical` | The trigger forbids normalising `descriptor`, and `proveDescriptorPolicy` compares byte-for-byte. Normalising instead of blocking would be the exact class of silent rewrite this subsystem exists to prevent. |
| **`quorum`/`totalSigners` disagreeing with the descriptor** | `policy.identity_incomplete` | Frozen by the trigger and absent from every allowlist ⇒ permanently unremediable. Blocking converts a post-approval `23514` into a legible diagnosis. |
| **Ordered `multi(`, legacy `sh(sortedmulti)`, taproot multisig** | existing blockers | The legacy parser silently *sorted* ordered keys, so stored addresses may not mean what the descriptor says. Do not add tolerance. |
| **Zero-address wallets** | `address.zero_addresses` | Pre-policy creation always wrote an initial window, so this is a partial-restore artifact — but it is a **permanent brick**: no addresses to prove, and `generateAddress` needs `changeDescriptor`. Measure it before merging (see below). |
| **Wallets with duplicate `(branch, index)`** | `address.duplicate_coordinate` | A dedupe decision is a data-loss decision. It belongs to a human. |

---

## Open questions for the operator

1. **Measure the populations before writing the migration.** Two read-only queries decide whether this PR closes the incident or is a prerequisite to the PR that does:
   ```sql
   SELECT w.type,
          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_devices wd WHERE wd."walletId"=w.id)) AS with_links,
          count(*) FILTER (WHERE w.type='single_sig' AND w.quorum IS NOT NULL)                       AS stranded_quorum,
          count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM addresses a WHERE a."walletId"=w.id))     AS zero_address
   FROM wallets w
   WHERE w."descriptorPolicyVersion" IS NULL AND w.descriptor IS NOT NULL
   GROUP BY w.type;
   ```
   plus a partition by whether each wallet's stored `derivationPath` prefix already equals its descriptor's normalised origin. **If multisig or non-account-0 dominates, the `derivationPath`-normalisation work is the fix that closes the incident and this PR should follow it, not precede it.**
2. **`descriptor.provenance_recovered` and `UNSUPPORTED_FINDINGS`.** I recommend leaving it out (recovered wallets stay `manual_investigation`), which means a reviewed audit at every wallet-safety RC forever. Confirm you accept that operational cost, or overrule.
3. **Who is the independent RC reviewer?** `verify-wallet-safety-audit-review.mjs:65` rejects `operatorId === reviewerId`, so the first release after this lands cannot be completed by one person.
4. **Owner-visible provenance.** `descriptorSourceKind` currently reaches the frontend only inside the remediation snapshot. Should the wallet detail view carry a persistent "recovered provenance" marker? Without it, the claim "can never be read as imported or generated" holds for a DB reader and an auditor, but not for the person whose money it is.
5. **The forgeability residual.** `POST /devices/:id/accounts` accepts a client-asserted xpub gated only on a client-asserted fingerprint. This is **pre-existing** and already gates the shipped remediation flow — this design does not widen it, and choosing `recovered_legacy` over `generated_pair` means it can no longer launder *provenance*. But it does mean P3 is a plausibility gate, not a possession proof. Do you want a follow-up requiring a live device address-confirmation round-trip before recovery, or is the existing bar acceptable?
6. **Should `descriptor.provenance_recovered` also appear as a new blocker-free signal in the remediation panel's post-apply state**, so an owner who recovers a wallet sees what class it now sits in?

---

## CORRECTION (verified 2026-08-18, after operator said "mostly multisig, account 0")

**The plan's multisig blocker is overstated, and the recommended re-sequencing is unnecessary.**

The plan treats legacy multisig as permanently blocked on `address.path_label_mismatch`,
requiring a separate `derivationPath`-rewrite PR with its own evidence story. A direct probe
against the live modules shows the mismatch is **purely notational**, and only for wallets
whose stored descriptor uses `h` hardened markers:

| descriptor form | legacy stored path | canonical path | byte-equal | equal after `h`→`'` | derived address |
|---|---|---|---|---|---|
| apostrophe | `m/48'/0'/0'/2'/0/0` | `m/48'/0'/0'/2'/0/0` | yes | yes | `bc1qe22zh…` |
| `h`-form | `m/48h/0h/0h/2h/0/0` | `m/48'/0'/0'/2'/0/0` | **no** | **yes** | `bc1qe22zh…` (identical) |

Cause: `normalizeAccountPath` (`addressDerivation/descriptorDerivation.ts:41-44`) does
`path.replace(/h/gi, "'")`, so canonical output is always apostrophe-form, while legacy
`multisigDerivation.ts:49` stored `firstKey.accountPath` verbatim in whatever notation the
descriptor used. `m/48h/…` and `m/48'/…` are the identical BIP32 path by definition.

**Consequence for the design.** `proof.ts:359` should compare *normalized* derivation paths
rather than bytes:

```ts
&& normalizeHardenedNotation(derived.derivationPath) === normalizeHardenedNotation(address.derivationPath)
```

This is not a relaxation of the proof. `derived.address === address.address` and
`derived.scriptPubKey === storedScript` remain byte-exact, and those are the cryptographic
ownership binding; the derivation path is a human-facing label. The repo already normalizes
these two notations in two places (`descriptorDerivation.ts:43`,
`shared/utils/bitcoin.ts:377`), so this makes the proof consistent with the rest of the
codebase rather than introducing a new tolerance.

Crucially it requires **no data rewrite**: stored `derivationPath` is untouched, so the
`protect_address_canonical_evidence` immutability arm is satisfied and nothing user-visible
changes. Multisig recovery therefore lands in THIS PR, not a follow-up.

**Still correctly blocked:** non-account-0 single-sig. Legacy `getAccountPath` hardcoded
account `0'`, so an account-1 wallet stored a path naming the *wrong account* — a semantic
error, not a notation artifact, and normalization must not paper over it. The operator has
confirmed their wallets are account 0, so this population is out of scope here.

**Supersedes:** the "Legacy multisig (all of it)" row of *What stays blocked*, and Open
Question 1's recommendation to sequence the `derivationPath` work first.
