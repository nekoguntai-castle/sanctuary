# Address Receive/Send Accuracy Assurance Plan — 2026-08-12

## Decision, Baseline, And Scope

This is an analysis and execution plan only. It makes no application, database,
device, CI, or deployment changes.

The implementation on `origin/main` at `60d89bef4` has a strong funds-safety
core, but it is not ready for an unqualified end-to-end funds-safe claim. Address
derivation agrees on the covered matrix, new receive/change addresses are bound
to immutable canonical policy evidence, and signed transactions are exact-matched
to server-issued intent. Remaining work is concentrated in send fee/amount
accuracy, a legacy account-path API that can report false account coordinates,
incomplete upstream negative-vector provenance, hardware default-deny coverage,
and physical-device proof.

The local `main` checkout was cleaned of a stale, redundant cherry-pick and
fast-forwarded to `origin/main` at `60d89bef4` before this plan was finalized.
Unrelated modified and untracked files remain preserved. Implementation must use
a dedicated clean worktree at the same or a newer target-branch commit and must
re-confirm every line reference and finding before changing production code.

This plan supersedes `tasks/wallet-address-hardware-safety-plan-2026-08-09.md` as
the remaining-work plan. PRs #781–#810 delivered most of that plan; use its
historical risk analysis and hardware procedures as reference, not as an open
backlog.

### Non-goals

- Do not enable a hardware capability, add a script policy, or widen network
  support while closing assurance gaps.
- Do not rewrite existing descriptors, xpubs, addresses, signer snapshots, or
  derivation metadata automatically.
- Do not treat address text, mock adapters, self-generated fixtures, or an
  emulator as proof that a physical device controls funds.
- Do not add legacy P2SH multisig, ordered multisig, or Taproot multisig support.

## Evidence That Currently Lines Up

- The checked-in address verifier requires exact address and `scriptPubKey`
  agreement across pinned Bitcoin Core 29.0, bitcoinjs-lib, bip_utils, and
  btcd/btcutil. Missing implementations fail the run.
- Its locked 480-case matrix covers BIP44/49/84/86 single-sig and BIP48 nested/
  native SegWit multisig; five chain environments; accounts 0 and 7; receive and
  change; indices 0, 1, and `2^31-1`; and 2-of-3/3-of-5 multisig.
- Literal BIP49, BIP84, and BIP86 vectors match the checked-in expected account
  key, path, address, and script. BIP380 descriptor checksum tests match the
  published examples. BIP44 does not publish an equivalent address vector.
- Production canonical address derivation re-derives `{policy, descriptor pair,
  branch, index}` and compares address, path, script, and policy identity before
  unused display or change use. Allocation is transactionally serialized.
- Broadcast requires a server-issued signing intent, re-authenticates prevouts,
  exact-compares transaction structure and output scripts/amounts, preserves
  immutable PSBT maps, verifies signatures, finalizes, and rejects raw-only
  artifacts. These close the old plan's fail-open signed-intent findings.
- Ledger, Jade Plus, and Trezor capabilities remain disabled because Tier 3
  physical fixtures are empty. This is an honest fail-closed state.

Primary standards checked: BIP32, BIP44, BIP49, BIP84, BIP86, BIP173, BIP350,
BIP371, BIP380, BIP383, and BIP389, plus Bitcoin Core's descriptor and key-I/O
corpora.

## Confirmed Findings And Assurance Gaps

### P1 — Standard send paths use the wrong script-family fee model

`server/src/services/bitcoin/utxoSelection.ts`,
`server/src/services/bitcoin/transactions/utxoModes.ts`, and
`server/src/services/bitcoin/transactions/createBatchTransaction.ts` hard-code
native-SegWit sizing for ordinary selection, explicit coins, send-max,
subtract-fee, and batch sends. Legacy and multisig sends can underpay the chosen
feerate; send-max/subtract-fee can overstate the recipient amount; other families
can overpay. Signed-intent validation faithfully preserves the wrongly
constructed transaction and therefore cannot repair this defect.

### P1 — Non-target hardware signers can bypass the capability manifest

`server/src/services/hardwareWalletCapabilities.ts` explicitly allows BitBox,
Coldcard, Keystone, Passport, SeedSigner, and Specter types outside the manifest.
BitBox has a live runtime adapter and no physical fixtures; its adapter contains
fallback paths, zero-value fallback, prefix-based change classification, and
positional signature handling. Current identity checks constrain exposure, but a
future integration change can expose it without a reviewed capability row.
Unknown and new funds-controlling devices must default-deny.

### P2 — A public single-sig derivation API can report account 0 for account >0

`server/src/services/bitcoin/addressDerivation/singleSigDerivation.ts` derives
correct address bytes from the supplied account xpub, but obtains the reported
origin from `getAccountPath()` in `addressDerivation/utils.ts`, which hard-codes
account 0. Canonical descriptor-pair production paths preserve descriptor origin,
so this is not evidence that current deposit display is wrong. It remains a
dangerous divergent API: any caller that trusts its path can bind correct address
bytes to false signing/recovery metadata.

### P1 assurance gap — Published invalid-vector corpora are incomplete or copied

The local Bitcoin Core key-I/O fixture contains a selected subset rather than the
complete applicable upstream corpus. Official BIP32 invalid serialization vector
5 is omitted. BIP173/BIP350 vectors are manually copied without a machine-checked
source commit/digest and completeness contract. This weakens protection against
checksum, version, depth, parent fingerprint, child number, key encoding,
Bech32/Bech32m, witness version, and network drift.

### P1 assurance gap — No physical hardware receive/change proof exists

Tier 3 physical fixture arrays are empty. The product truthfully blocks Ledger,
Jade, and Trezor, but non-target devices are inconsistent and no hardware support
claim can yet prove the device screen, selected seed/passphrase/account, or
physical transport.

### P2 — Receive-side chain evidence is not re-authenticated at UTXO ingestion

`server/src/services/bitcoin/blockchain/syncAddress.ts` stores the Electrum/node
reported UTXO amount and transaction output `scriptPubKey` against the requested
address without explicitly checking that the output at the claimed vout has the
same canonical script/address. Later spending re-authenticates prevouts and fails
closed, so this is not a confirmed spend bypass. It can still persist misleading
receive/balance state and should be proven or corrected at ingestion.

## Non-Negotiable Safety Contract

- Address bytes are never sufficient evidence by themselves. Exact network,
  policy, descriptor origin, account, branch, index, script, and signer identity
  must agree.
- Recipient validation is server-side, checksum-aware, and network-scoped. The
  exact recipient script and amount authorized by the user must survive PSBT
  creation, signing, finalization, and broadcast unchanged.
- Change is wallet-owned only when an exact canonical branch-1 script and every
  signer origin match; membership in an address table or path prefix is not proof.
- Requested fee policy is part of transaction intent. Construction uses exact
  input/output script weights, and finalized actual fee/vsize is checked against
  the declared policy before broadcast.
- All funds-controlling hardware/import/airgap implementations are enumerated in
  one default-deny manifest. Missing, stale, unknown, or unproven rows are blocked.
- Existing wallet evidence is never silently repaired. Any migration requires a
  read-only impact report, exact unchanged-script proof, explicit approval, and
  recoverable pre-change evidence.

## Delivery Plan

### PR 0 — Emergency signer-manifest containment

Before broader remediation, build and commit a baseline mechanical inventory of
every hardware implementation currently reachable from signer selection,
persisted device types, capability tables, adapter factories, import/airgap
paths, and device registries. Replace the explicit non-target hardware allowlist
with default-deny decisions for BitBox, Coldcard, Keystone, Passport, SeedSigner,
Specter, and every other row in that inventory. This containment change does not
claim those devices are defective or supported; it prevents an unreviewed
identity change from implicitly exposing funds-controlling behavior. Preserve
view/export/recovery access and add product-visible blocked reasons.

Acceptance:

- Every known funds-controlling implementation has an explicit disabled row, and
  missing/new identities are denied at all server capability boundaries.
- Tests prove no blocked row can import, add an account, display a new deposit
  address, sign, finalize, or broadcast.
- The change is reversible only by a reviewed manifest/evidence update, never by
  restoring the allowlist.

### PR 1 — Correct script-aware send amounts and fee invariants

Write failing regression tests first for each confirmed fee path. Introduce one
canonical transaction-weight model that receives the exact input script family,
multisig quorum/shape where relevant, recipient output scripts, change presence,
and transaction overhead. Make normal auto-selection, explicit coin control,
send-max, subtract-fee, decoys, batch, RBF, and CPFP consume it; remove generic
native-SegWit defaults from funds-controlling paths.

After finalization and before network broadcast, calculate actual fee and vsize
from authenticated prevouts and the final transaction. Require nonnegative exact
fee, no unintended recipient-amount change, and an actual feerate consistent with
the user-selected policy under an explicitly documented rounding tolerance.
Reject rather than silently adjust after authorization. Bind the requested fee
policy and tolerance into the signing-intent snapshot.

Acceptance:

- Table tests cover every enabled policy and input/output combination, including
  exact funds, change/no-change, dust transition, max input count, send-max,
  subtract-fee, decoys, batch, and mixed recipient output types.
- Core-funded regtest transactions confirm expected fee, vsize, acceptance, and
  recipient/change amounts for every enabled policy.
- Mutating script family, quorum, output count, change decision, vsize, fee, or
  requested tolerance fails tests and the wallet-safety mutation gate.

### PR 2 — Eliminate derivation-coordinate ambiguity

Make account origin an explicit required input to single-sig derivation, or split
the API so account-xpub derivation returns only relative `{branch,index}` and only
descriptor-bound code can construct a full origin. Remove `getAccountPath()` from
funds-controlling use. Add one shared coordinate validator requiring branch 0/1
and integer index/account in `0..2^31-1`; use it in single-sig, multisig,
descriptor, range, allocation, import, and PSBT paths.

Bind full origin to xpub depth, child number, parent fingerprint, network/version,
and descriptor key origin. Inventory every caller before changing the API and
prove no compatibility path reintroduces account 0 defaults.

Acceptance:

- Account 0 and 7 vectors return the exact full origin for all enabled policies,
  networks, and both branches; relative APIs cannot manufacture a master origin.
- `-1`, fractional, `2^31`, overflow, `NaN`, strings, hardened terminal children,
  wrong branch, wrong account, and wrong descriptor suffix fail before derivation.
- A repository-wide call-site test or static rule prevents new implicit account
  defaults in production address/signing code.

### PR 3 — Lock complete primary-source address and key corpora

Vendor exact upstream Bitcoin Core `key_io_valid.json` and
`key_io_invalid.json` from a pinned Core commit with source URL and SHA-256.
Generate the TypeScript projection and require every applicable public-address
row and every invalid row to be consumed or explicitly waived with a narrowly
reviewed reason. Add all BIP32 invalid serialization vectors and CKD boundary
cases. Apply the same pinned-source/digest/completeness approach to BIP173 and
BIP350 vectors. Store immutable, commit-qualified source URLs wherever the
upstream supports them; moving `master` or `main` links are discovery references,
not provenance.

Keep higher witness versions valid at the generic recipient-address boundary as
BIP350 requires, while keeping unsupported wallet creation policies blocked.
Record evidence tier on every fixture: literal official vector, independently
executed implementation consensus, self-generated integration fixture,
emulator/protocol proof, or physical-device proof.

Acceptance:

- Changing an upstream fixture, digest, projection, waiver, or unconsumed row
  fails CI; regeneration is deterministic and produces no diff.
- Production server address validation consumes the complete applicable valid and
  invalid corpus for mainnet, test-family, and regtest HRPs.
- Verifier documentation and release output cannot call self-generated or
  emulator evidence external/physical proof.

### PR 4 — Default-deny every signer and close BitBox fallbacks

Replace PR 0's baseline containment inventory with one CI-generated exhaustive
inventory derived from persisted device types, device parsers, import/export
handlers, runtime adapter registration, QR/airgap signing methods, UI choices,
and server capability enforcement. Mature the coarse disabled rows into exact
vendor/model/policy/capability rows and enforce permanent completeness. Missing
rows continue to fail closed.

Keep BitBox and every other unproven signer disabled. Before any BitBox row can be
considered for enablement, remove all implicit account/input/change/value/signature
fallbacks; prove exact connected identity, every prevout and origin, exact change
script, complete signature mapping, signed-intent preservation, deterministic
finalization, and Core acceptance. Handle each other vendor in a separate scoped
conformance PR rather than treating manifest inclusion as support.

Acceptance:

- A new adapter, device enum, parser, import route, or UI signing method without a
  manifest row makes CI fail.
- Unknown, generic hardware, stale, and incomplete identities are denied at
  import, account add, display, sign, finalize, and broadcast server boundaries.
- Blocked rows retain view/export/recovery access but cannot display a new deposit
  address or produce a broadcast artifact.

### PR 5 — Re-authenticate receive ingestion and ownership

At sync/UTXO ingestion, obtain the raw transaction or independently authenticated
transaction output and require txid, vout, amount, and `scriptPubKey` to agree.
Require that output script to equal the canonical re-derived script for the
wallet address coordinate before persisting a receive/UTXO or marking the address
used. Treat Electrum address history and UTXO responses as discovery hints, not
ownership proof. Fail the affected item closed with redacted diagnostics and a
retryable sync state; do not corrupt existing balances or delete prior evidence.

Acceptance:

- Wrong txid/vout, missing output, amount drift, script drift, address drift,
  cross-wallet collision, and adversarial Electrum disagreement persist nothing.
- Core and at least one Electrum-compatible fixture agree on normal receive,
  change receive, reorg, RBF, and duplicate/retry behavior.
- Existing legacy/noncanonical wallet rows remain quarantined according to the
  wallet-safety audit rather than being silently upgraded.

### PR 6 — Capture physical proof and enable rows one at a time

Keep all rows blocked until a dedicated, wipeable device and two-person procedure
captures current model, firmware/app/SDK/transport, exact seed/passphrase policy,
fingerprint, account xpub/origin, Sanctuary/Core/device receive and change
addresses, unsigned/signed artifact hashes, screen/export receipt hash, negative
controls, finalization, and Core `testmempoolaccept`. Use non-mainnet funds only.

Capture account 0 and a nonzero account, receive/change indices 0/1/19 and a
higher index, and every policy proposed for that exact row. Expire evidence when
firmware, app, SDK, adapter, policy, fixture schema, or proof-critical source
changes. Enable one exact row in its own reviewed PR; there is no family-wide
enable switch.

Acceptance:

- Tier 3 arrays are nonempty only with machine-validated provenance, sanitization,
  independent review, freshness, and negative controls.
- The device display address, Sanctuary canonical address, and Bitcoin Core
  derived address/script agree byte-for-byte for every enabled row.
- Release fails if an enabled row lacks fresh physical proof or any required case
  is skipped, empty, warning-only, or replaced with software/emulator evidence.

## CI, Release, Rollout, And Backout

- Extend the no-path-filter wallet-safety workflow and critical-path classifier
  to the fee model, derivation coordinate API, recipient validator, sync
  ingestion, all device registries, and capability decisions.
- Add mutation canaries for fee script family, actual vsize/fee, recipient amount,
  account/branch/index, address checksum/network, canonical receive script,
  hardware default-deny, and evidence-tier/freshness checks.
- Produce one release ledger containing vector counts, upstream commits/digests,
  independent implementations, enabled/blocked hardware rows, evidence tiers,
  physical freshness, and skipped cases. A skipped required case blocks release.
- Keep migrations additive and capability defaults disabled. Backout by disabling
  the affected capability or rolling forward with stricter validation; never
  restore a fallback, reinterpret a descriptor, or delete recovery evidence.
- Before deployment, run the existing read-only wallet-safety audit and preserve
  its protected hash. After each phase affecting persisted interpretation, rerun
  it and investigate any classification regression before rollout.

## Required Verification

Each PR must run the smallest focused red/green suite first, then the repository's
required package typechecks and full tests. Funds-safety PRs additionally require:

- `npm --prefix scripts/verify-addresses run typecheck`
- `npm --prefix scripts/verify-addresses run verify:repeatable`
- `npm --prefix scripts/verify-psbt run verify`
- focused server tests for address derivation/validation, canonical display and
  change, transaction construction, signing intent, broadcast, and sync ingestion
- applicable wallet-safety mutation shards and manifest/classifier checks
- Core regtest construction/finalization/`testmempoolaccept` proof
- applicable pinned vendor emulator/protocol proof; Tier 3 only when enabling a row

The generated fixture diff must be empty unless the PR intentionally updates a
pinned oracle with documented provenance. A green aggregate test run is not a
substitute for nonempty matrix counts and exact invariant assertions.

## Final Exit Criteria

- Every enabled receive address is reproduced from its immutable policy by
  Sanctuary, pinned Core, three independent seed-based implementations, and the
  named physical device when hardware-controlled.
- Every recipient checksum/network/script is validated server-side; every final
  transaction preserves authorized inputs, outputs, amounts, change, fee policy,
  and signer identity and passes Core acceptance.
- No full derivation origin is inferred from script type or xpub prefix; account,
  branch, and index are explicit and bounded everywhere.
- Complete pinned upstream valid/invalid corpora protect address and extended-key
  boundaries with machine-checked provenance and completeness.
- Every funds-controlling device path is in a default-deny manifest, and every
  enabled row has fresh Tier 3 proof. Empty, skipped, fallback, warning-only, or
  self-generated evidence cannot satisfy a stronger tier.
- Receive ingestion treats remote chain data as untrusted and persists ownership
  only after exact transaction-output and canonical-script authentication.

## Standards References

- BIP32: https://bips.dev/32/
- BIP44: https://bips.dev/44/
- BIP49: https://bips.dev/49/
- BIP84: https://bips.dev/84/
- BIP86: https://bips.dev/86/
- BIP173: https://bips.dev/173/
- BIP350: https://bips.dev/350/
- BIP371: https://bips.dev/371/
- BIP380: https://bips.dev/380/
- BIP383: https://bips.dev/383/
- BIP389: https://bips.dev/389/
- Bitcoin Core descriptors: https://github.com/bitcoin/bitcoin/blob/master/doc/descriptors.md
- Bitcoin Core key-I/O vectors: https://github.com/bitcoin/bitcoin/tree/master/src/test/data

## Planning Verification Record

Recursive review pass 1 accepted two corrections: move default-deny containment
ahead of all remediation, and classify the legacy account-path API as P2 because
the current canonical deposit/change path does not use its inferred origin. Pass
2 removed a circular dependency by making PR 0 produce its own baseline signer
inventory while PR 4 replaces it with a permanent CI generator, required
immutable upstream provenance URLs, and refreshed the plan after cleaning and
fast-forwarding local `main`. Pass 3 found no further evidence-backed actionable
comments. Final verification confirmed local `HEAD` equals `origin/main` at
`60d89bef4`, re-read the cited production paths, passed
`npm --prefix scripts/verify-addresses run typecheck`, and found no trailing
whitespace or conflict markers in the planning artifacts. The repeatable Docker
oracle, root tests, and server tests were not run for this plan-only task; the
shared checkout does not currently have the updated root/server Vitest binaries
installed, and no dependency install was performed.
