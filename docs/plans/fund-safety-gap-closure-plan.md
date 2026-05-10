# Fund-Safety Gap Closure Plan

Date: 2026-05-09
Status: implementation-grade plan; reviewed until no open plan findings remain
Source assessment: `docs/plans/specter-desktop-comparison.md`
Related runbooks: `docs/reference/hardware-wallet-validation.md`, `docs/reference/release-gates.md`, `docs/reference/offline-bundles.md`

## Goal

Close the gaps identified in the Specter Desktop benchmark by converting each trust claim into release-blocking evidence. The target state is not "we believe Sanctuary is safe"; it is "Sanctuary can prove, with repeatable tests and artifacts, that every exposed fund-moving path is canonical, node-checked, hardware-evidenced where claimed, release-verifiable, and small enough to review."

## Non-Negotiable Rules

- No private-key custody is introduced while closing these gaps.
- No mainnet funds are used for hardware or broadcast validation.
- No release notes may claim hardware signing, broadcast safety, artifact integrity, or AI/MCP safety unless the matching gate is green or explicitly marked pending with owner, date, and user-visible limitation.
- Any uncertain fund-moving state fails closed. "Warn and continue" is not acceptable for recipient classification, change detection, input ownership, fee calculation, signing, finalization, or broadcast.
- Manual evidence is acceptable only when it is captured in a sanitized manifest and replayed through automated tests.
- The plan is complete only when every workstream has implementation steps, corner cases, acceptance criteria, verification commands, and release-gate impact.

## Workstream Map

| ID | Gap | Target Outcome | Release Impact |
| --- | --- | --- | --- |
| S0 | Current mechanical drift from the benchmark grade run | Restore strict coverage/lizard expectations or record accepted temporary drift before deeper wallet claims | Blocks claiming all quality gates are green |
| S1 | Broadcast invariants | Every broadcast path derives intent from decoded PSBT/raw transaction data and runs policy plus node preflight before propagation | Required for any release with transaction broadcast |
| S2 | Physical hardware evidence | Ledger, Trezor, and BitBox signing claims are backed by sanitized device-signed fixtures replayed through Sanctuary and Bitcoin Core | Required for hardware signing claims |
| S3 | Release artifact verification | Every release artifact has checksums, signatures/attestations, SBOM/provenance, and an operator verification path | Required for stable release publication |
| S4 | Descriptor/xpub/domain validation | Imports and wallet policy inputs reject malformed, wrong-network, or unsupported descriptors before they can produce wallet state | Required when import/wallet policy surfaces change |
| S5 | Fail-closed safety code and complexity gates | Safety modules stay reviewable and broad exceptions are converted to typed failures | Required when safety modules are touched; main/nightly guard after ratchet |
| S6 | Threat model and external review package | Product trust boundaries, non-goals, and evidence are ready for external review | Required before public "high trust" claims |

## Phase 0 - Stabilize The Baseline

Purpose: start gap closure from a clean mechanical baseline so later failures are attributable to the new work.

Steps:

1. Fix or explicitly triage the current strict coverage drift reported by the elevated grade run: aggregate coverage was 99.98% lines/statements/functions and 99.95% branches, below the strict 100% target.
2. Fix or explicitly triage the two lizard warnings reported by the elevated grade run:
   - `tests/components/send/SendTransactionPage.test.tsx` `SendTransactionWizard` CCN 16.
   - `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` CCN 17.
3. Re-run the local grade or the smallest equivalent gate that proves the drift is closed.
4. Update `docs/plans/codebase-health-assessment.md` with measured status only.

Acceptance criteria:

- Coverage policy is either back to target or has a dated, owned exception that does not cover production fund-safety code.
- Safety-relevant lizard warnings are zero, or any remaining warning has a local refactor plan and is not in a funds path.

Verification:

```bash
CI=true GRADE_TIMEOUT=180 bash /home/nekoguntai/.codex/skills/grade/grade.sh
git diff --check
```

Implementation note, 2026-05-09: PR A baseline cleanup closed this phase's mechanical drift. `npm run coverage` now reports frontend, server, and gateway at 100% lines/statements/functions/branches; focused touched-file lizard checks pass for the refactored send UI test/component and API-client/server fatal-handler files. The remaining workstreams can proceed from a clean strict-gate baseline.

## Phase 1 - Broadcast Canonicality And Node Preflight

Purpose: protect the final irreversible step. An authenticated caller must not be able to broadcast a transaction whose decoded outputs, fee, network, or wallet ownership differ from caller-supplied metadata.

Primary files to inventory:

- `server/src/api/transactions/broadcasting.ts`
- `server/src/services/bitcoin/transactions/broadcasting.ts`
- `server/src/services/bitcoin/transactions/broadcastContracts.ts`
- `server/src/services/bitcoin/psbtValidation.ts`
- `server/tests/unit/services/bitcoin/transactionServiceBroadcast/*`
- `server/tests/unit/services/bitcoin/industry/broadcastSafety.test.ts`
- `server/tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.broadcast.contracts.ts`

Implementation plan:

1. Write a broadcast invariant spec before editing production code. Define one canonical `BroadcastIntent` shape derived from decoded payload data, not request metadata.
2. Inventory every broadcast source and route it through the same canonical decode path:
   - raw transaction hex
   - signed PSBT
   - draft-backed PSBT
   - hardware-returned raw transaction, especially Trezor
   - mobile/API signature submission
   - agent funding approval flows, if they can submit signed artifacts
3. Decode the payload server-side and derive:
   - txid/wtxid where available
   - wallet id and network
   - all outputs with address/script type/value
   - external recipient outputs
   - internal change outputs and derivation evidence
   - input outpoints and wallet-owned input classification
   - total input value, total output value, fee, vsize, and fee rate
   - draft id or PSBT id if present
   - canonical audit fields
4. Reject before broadcast when request metadata conflicts with decoded intent. Conflicts include recipient, amount, fee, UTXO set, network, draft id, or wallet id.
5. Run Sanctuary policy checks from decoded data:
   - wrong network
   - unsupported script
   - unknown change
   - non-wallet input
   - unknown input value
   - dust output
   - excessive fee or fee rate
   - below-quorum multisig or incomplete signature data
   - policy limits for multi-recipient spends
6. Run configured-node preflight before propagation without expanding the supported runtime:
   - Electrum production runtime checks must verify that each final input's previous transaction is fetchable, the referenced output exists, the output decodes to a standard address, and the configured Electrum backend still reports that outpoint as unspent.
   - Bitcoin Core `testmempoolaccept` remains valuable release-lab evidence for fixtures and external validation, but it must not become a production dependency unless Sanctuary explicitly supports a Core backend.
   - Address-vector, PSBT-fixture, hardware-lab, and broadcast evidence scopes must declare their runtime requirements separately from lab-only tools so future benchmark checks cannot add implicit operator dependencies.
   - deterministic fail-closed behavior if the configured production backend cannot provide the preflight evidence required by the release claim.
7. Persist audit and transaction records from canonical decoded data, not request metadata.
8. Define post-broadcast reconciliation:
   - If broadcast succeeds and persistence fails, write a durable recovery/audit record containing txid and raw transaction before returning.
   - If node returns "already known" or equivalent, treat as idempotent only if the txid matches the decoded payload and policy passed.
   - If mempool rejection occurs, return a typed rejection without changing local transaction state.
9. Extend critical mutation coverage for canonical broadcast policy once the invariant suite is green.

Corner cases to test:

- Caller says recipient A, decoded transaction pays recipient B.
- Caller omits recipient or amount for raw hex.
- Multiple external recipients, including one valid and one wrong-network output.
- OP_RETURN-only outputs, unknown scripts, and unspendable outputs.
- Wallet-owned change missing derivation metadata.
- Change address belongs to a different wallet/account.
- Non-wallet input mixed with wallet input.
- Missing previous-output value, zero-input, negative fee, and unknown fee cases.
- Dust outputs, fee above policy, fee below relay minimum, and transaction too large.
- RBF replacement with same wallet input set and higher fee.
- CPFP-like transactions with extra inputs or outputs.
- Taproot, native SegWit, nested SegWit, native multisig, and nested multisig.
- Broadcast succeeds but local persistence fails.
- Duplicate broadcast or node "already known" response.
- Node unavailable, wrong node network, stale chain state, and reorg around spent inputs.

Acceptance criteria:

- Every broadcast entrypoint converges on one canonical decoded intent.
- No broadcast path trusts client metadata over decoded payload data.
- Mismatched, ambiguous, or unpreflighted transactions fail closed.
- Audit, notifications, and persistence use canonical decoded values.
- Electrum prevout/unspent preflight is part of the production release gate; Bitcoin Core `testmempoolaccept` proof is release-lab fixture evidence, not a runtime requirement while Sanctuary is Electrum-only.
- Bitcoin validation evidence contracts keep external witnesses lab-scoped unless a runtime feature explicitly supports them.

Verification:

```bash
npm --prefix server run test -- --run \
  tests/unit/services/bitcoin/transactionServiceBroadcast \
  tests/unit/services/bitcoin/industry/broadcastSafety.test.ts \
  tests/unit/api/transactionsHttpRoutes/transactionsHttpRoutes.broadcast.contracts.ts
npm --prefix server run test:mutation:critical:gate
npm --prefix server run typecheck:tests
npm run quality:lizard
git diff --check
```

Rollback rule:

- If canonical parsing cannot safely classify a transaction, block broadcast for that path until classification is implemented. Do not re-enable metadata-trusting broadcast as a compatibility fallback.

## Phase 2 - Physical Hardware Signing Evidence

Purpose: move Sanctuary from software-vector-grade confidence to hardware-in-loop funds-loss-grade confidence for each device/script row the product exposes.

Primary files and runbooks:

- `docs/reference/hardware-wallet-validation.md`
- `server/tests/fixtures/hardware-signed-psbt-vectors.ts`
- `server/tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts`
- `server/tests/helpers/hardwareSignedPsbtReplay.ts`
- `tests/services/hardwareWallet.*`
- `docs/reference/hardware-wallet-integration.md`

Implementation plan:

1. Create a hardware evidence intake issue or task per required device family:
   - Ledger P2WPKH, P2SH-P2WPKH, P2TR.
   - Trezor P2WPKH, P2SH-P2WPKH, P2TR, P2WSH, P2SH-P2WSH.
   - BitBox02 P2WPKH, P2SH-P2WPKH, P2TR.
2. Lock fixture environment rules:
   - Use regtest, signet, or testnet only.
   - Use wipeable test devices or dedicated test accounts.
   - Never record seed words, passphrases, PINs, pairing secrets, local auth tokens, or browser session material.
   - Record only sanitized xpubs, fingerprints, paths, unsigned PSBTs, signed PSBTs/raw txs, decoded summaries, device versions, and Core replay results.
3. Run required software gates before connecting hardware:

```bash
npm --prefix scripts/verify-addresses run verify
server/node_modules/.bin/tsx scripts/verify-psbt/verify.ts
npx vitest run \
  tests/services/hardwareWallet.trezorAdapter.test.ts \
  tests/services/hardwareWallet.ledgerAdapter.test.ts \
  tests/services/hardwareWallet.jadeAdapter.test.ts \
  tests/services/hardwareWallet.bitboxAdapter.test.ts
npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
npm run typecheck:app
npm run typecheck:tests
npm --prefix server run typecheck:tests
npm run quality:lizard
```

4. Capture address evidence for receive and change paths:
   - `/0/0`, `/0/1`, `/0/19`, `/0/999`
   - `/1/0`, `/1/1`, `/1/19`
   - Compare Sanctuary expected address, device-returned/displayed address, and Bitcoin Core-derived descriptor address.
5. Capture signing evidence:
   - one external recipient
   - one internal change output
   - expected input values, fee, vsize, txid, recipient, change, device/app versions
   - returned signed PSBT or raw transaction
   - Core `decodepsbt`, `decoderawtransaction`, and `testmempoolaccept` result
6. Run negative controls:
   - wrong network/account path
   - wrong cosigner/fingerprint
   - tampered recipient
   - tampered amount or fee
   - missing change metadata
   - below-quorum multisig
7. Add the sanitized artifacts to `server/tests/fixtures/hardware-signed-psbt-vectors.ts`.
8. Make `REQUIRE_HARDWARE_SIGNED_FIXTURES=1` part of release validation once all exposed required rows are present or product-blocked.
9. Update UI/product support flags so unsupported rows are impossible to select, not just documented as unsupported.

Corner cases to test or record:

- Trezor returns raw transactions rather than signed PSBTs.
- Ledger may require policy/template registration and may not expose all change details in the same way as other devices.
- BitBox multisig rows are unsupported and must remain product-blocked until supported.
- Firmware/app versions can change behavior; fixture rows must record versions and trigger rerun on major/minor updates.
- Device display may truncate long addresses or policy names; acceptance must be based on returned/displayed values plus Core derivation, not visual memory.
- Passphrase-enabled wallets must not leak passphrases; if tested, record only the resulting fingerprint/path/xpub metadata.
- Taproot support may vary by firmware and app version.
- Multisig partial signatures must be attributed to the correct cosigner fingerprint/pubkey.
- Sanitized screenshots/photos are optional and must not include secrets.

Acceptance criteria:

- Every exposed required device/script row has a replayable artifact or is product-blocked as unsupported.
- Address evidence proves Sanctuary/device/Core agreement.
- Signing evidence proves the device signed the transaction Sanctuary expected.
- Negative controls fail closed.
- The release gate fails when required physical artifacts are missing.

Verification:

```bash
REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts
npm --prefix server run test -- --run \
  tests/unit/services/bitcoin/psbt.signed-vectors.test.ts \
  tests/unit/services/bitcoin/hardwareWalletCompatibility.test.ts
npx vitest run tests/services/hardwareWallet*.test.ts tests/services/hardwareWalletBitbox/*.contracts.ts
git diff --check
```

Rollback rule:

- If a fixture row fails after a vendor library or firmware update, block that device/script combination in the product until the fixture is regenerated or the bug is fixed.

## Phase 3 - Release Artifact Verification And Supply Chain

Purpose: make installing compromised or unverifiable software harder. Release trust is funds safety.

Primary files and workflows:

- `.github/workflows/release.yml`
- `.github/workflows/create-release.yml`
- `.github/workflows/release-offline-bundle.yml`
- `scripts/create-forge-release.sh`
- `docs/reference/offline-bundles.md`
- `docs/reference/release-gates.md`

Implementation plan:

1. Inventory release artifacts:
   - GHCR multi-arch images and manifests.
   - Offline bundles and `.sha256` sidecars.
   - Forgejo/GitHub release assets.
   - Umbrel app metadata and image digests.
   - Source archives, release notes, and any install scripts presented to operators.
2. Define a required release manifest format:
   - artifact name
   - version tag
   - commit SHA
   - digest/checksum
   - image digest for containers
   - builder workflow run id
   - SBOM path
   - signature or attestation reference
3. Generate and publish:
   - `SHA256SUMS`
   - detached signature or Sigstore/cosign signature for `SHA256SUMS`
   - SBOMs for images and bundles, preferably SPDX or CycloneDX
   - provenance/attestation for image builds and bundle builds
4. Make release jobs fail when required signing/provenance material is missing.
5. Keep current offline bundle signature rules, but integrate them into the common release manifest rather than treating offline bundles as a separate trust island.
6. Add a clean-machine verification script, for example `scripts/release/verify-release-artifacts.sh`, that verifies:
   - tag format and commit SHA
   - checksums
   - signatures/attestations
   - image digests
   - offline bundle signature
   - install script integrity
7. Update release notes to include the verification commands and the expected trust anchors.
8. Document key custody:
   - who can publish
   - where public keys live
   - rotation process
   - lost/compromised key process
   - whether GitHub OIDC/Sigstore or long-lived signing keys are used

Corner cases to handle:

- GitHub and Forgejo have different release APIs and token behavior.
- A release object may exist before all assets are uploaded.
- Re-running release jobs should replace assets idempotently without losing old auditability.
- Multi-arch image manifests need both per-platform digests and manifest-list digest.
- Offline public key rotation must not strand existing offline operators.
- Stable tags and prerelease/RC tags need different publication rules.
- Signing should fail closed if secrets or OIDC identity are unavailable.
- Generated SBOMs must not include secrets or local paths that leak build environment details.

Acceptance criteria:

- Stable release publication fails without checksums, signatures/attestations, SBOMs, and provenance for required artifacts.
- Operators have a documented verification path that works from a clean checkout or trusted public key.
- The release manifest links every artifact to commit, workflow run, digest, and signature.

Verification:

```bash
bash -n scripts/create-forge-release.sh
bash -n scripts/release/verify-release-artifacts.sh
npm run test:release-artifacts
actionlint .github/workflows/release.yml .github/workflows/create-release.yml .github/workflows/release-offline-bundle.yml
npm run check:github-action-runtimes
git diff --check
```

If `actionlint` is unavailable locally, use the existing workflow lint CI path and record that local limitation.

Rollback rule:

- If a release artifact cannot be verified, keep the release as draft/prerelease and do not promote it to stable.

Implementation note, 2026-05-09: PR F started the release-provenance gate with `scripts/release/verify-release-artifacts.sh` and a dependency-free Node verifier. Stable manifest verification now requires release identity, builder evidence, signed `SHA256SUMS`, checksum coverage for local artifacts and evidence files, offline bundle SBOM/provenance, source archive/install script/release notes coverage, frontend/backend container digests, and local SBOM/provenance or attestation references. Registry digest comparison remains an explicit `--verify-image-digests` operator/release-lab option so the verifier does not add runtime dependencies to Sanctuary.

## Phase 4 - Descriptor, Xpub, And Wallet Policy Validation

Purpose: copy Specter's domain-check coverage while preserving Sanctuary's schema-first, small-function style.

Primary files:

- `server/src/services/bitcoin/descriptorParser/descriptorParser.ts`
- `server/src/services/bitcoin/descriptorParser/descriptorUtils.ts`
- `server/src/services/walletImport/descriptorImport.ts`
- `server/src/services/scriptTypes/handlers/descriptorHelpers.ts`
- `server/src/services/bitcoin/addressDerivation/descriptorDerivation.ts`
- `server/tests/unit/services/bitcoin/descriptorParser.test.ts`
- `server/tests/unit/services/bitcoin/industry/descriptorSafety.test.ts`
- `server/tests/unit/services/walletImportImports/walletImportImports.descriptor.contracts.ts`

Implementation plan:

1. Define a domain validation checklist for every descriptor/xpub import:
   - descriptor checksum where applicable
   - supported wrappers only
   - network and xpub/tpub/vpub/upub/zpub prefix consistency
   - SLIP-132 normalization to standard extended keys where needed
   - origin fingerprint hex and length
   - BIP32 path syntax and hardened marker normalization
   - xpub depth vs derivation path depth
   - account path and branch/index rules
   - sortedmulti vs multi behavior
   - multisig threshold `M <= N`
   - duplicate cosigner keys
   - unsupported script family
   - taproot key-path vs script-path support boundary
2. Ensure API/request schemas validate shape first, then domain parsers validate Bitcoin semantics.
3. Normalize all error results into typed import errors with user-safe messages and internal diagnostic codes.
4. Add cross-implementation checks against Bitcoin Core `getdescriptorinfo` and `deriveaddresses` for representative descriptors.
5. Add negative fixtures for malformed descriptors and wrong-network imports.
6. Thread the same validation through UI import, API import, hardware account import, and backup restore/import paths.

Corner cases to test:

- Empty descriptor, whitespace, invisible characters, extra checksum separators, wrong checksum length, and wrong checksum value.
- Mixed mainnet/testnet extended key prefixes.
- `xpub` with testnet network metadata or `tpub` with mainnet wallet.
- Depth-0 root xpub, depth-1 xpub, account-level xpub, and mismatched derivation depth.
- `h`, `H`, and `'` hardened markers.
- Derivation paths with negative, non-integer, overflowing, or empty path components.
- Duplicate keys in multisig.
- Threshold zero, threshold greater than key count, and missing cosigner origin.
- `sortedmulti` ordering with origin metadata.
- Unsupported legacy P2PKH if not exposed.
- Taproot descriptors on firmware or script paths not supported by Sanctuary.

Acceptance criteria:

- Every import path uses schema validation plus the same domain parser.
- Wrong-network or malformed descriptors cannot create wallet state.
- Error messages are actionable without leaking secrets.
- Domain parser complexity remains below `CCN <= 15` per function or is split before merge.

Verification:

```bash
npm --prefix server run test -- --run \
  tests/unit/services/bitcoin/descriptorParser.test.ts \
  tests/unit/services/bitcoin/industry/descriptorSafety.test.ts \
  tests/unit/services/walletImportImports/walletImportImports.descriptor.contracts.ts
npm --prefix scripts/verify-addresses run verify
npm run quality:lizard
git diff --check
```

Rollback rule:

- If a legacy import is rejected by the new parser, ship a one-time migration or explicit compatibility parser only when it produces the same canonical descriptor and has regression tests.

Implementation note, 2026-05-09: PR G started the descriptor/xpub hardening gate with a shared descriptor-domain validator used by raw descriptors plus JSON, BlueWallet, and Coldcard parsed imports. The gate now rejects private extended keys, wrong-network key/path/declaration combinations, mixed-network multisig cosigners, unsupported receive/change branches, fixed child indexes, quorum overflow, duplicate cosigner keys, malformed cosigner suffixes, raw descriptor script/path mismatches, and unsafe first-hardened-index network inference. This is intentionally runtime-local parser validation; Bitcoin Core descriptor cross-checks remain release-lab evidence, not a production requirement. Remaining follow-up items are typed import error normalization, xpub depth/path-depth validation, broader import-surface threading if new import paths are added, and optional Core `getdescriptorinfo`/`deriveaddresses` fixture evidence for release drills.

## Phase 5 - Fail-Closed Errors And Safety Complexity Gates

Purpose: make safety-critical code easy to audit and prevent broad exception handlers from silently continuing after partial transaction knowledge.

Safety module set:

- `server/src/services/bitcoin/**`
- `server/src/api/transactions/**`
- `server/src/services/walletImport/**`
- `server/src/services/import/**`
- `server/src/services/export/**`
- hardware wallet adapters under frontend services
- auth/session middleware and token services
- backup/restore services
- release scripts and workflow-generating scripts

Implementation plan:

1. Define a typed error taxonomy:
   - invalid user input
   - unsupported network/script/device
   - policy denial
   - signer rejection
   - node preflight rejection
   - transient external dependency failure
   - persistence failure after irreversible action
   - internal invariant violation
2. Convert broad `catch` blocks in safety modules to typed outcomes:
   - deterministic invalid input -> reject with safe user message
   - transient dependency failure -> no state mutation, retry policy if safe
   - unknown invariant failure -> fail closed and log structured internal detail
3. Add a quality guard that flags broad `catch`/`except` style handlers in safety modules unless they call an approved fail-closed helper or have a documented allowlist entry.
4. Add a safety-only lizard target with stricter zero-regression expectations.
5. Add mutation coverage for broadcast, descriptor, PSBT, address derivation, and auth/session checks.
6. Update `docs/reference/release-gates.md` to make the safety gate required when safety modules change and required for main/nightly once stable.

Corner cases to handle:

- Hardware user cancel is not an error that should dirty wallet state.
- Device disconnect mid-signing should not leave a partially trusted signature.
- Bitcoin node timeout should not degrade into blind broadcast.
- Persistence failure after successful broadcast needs reconciliation, not retrying a new transaction.
- Logger failures or serialization failures should not mask the original safety decision.
- Redaction must remove PSBTs, raw txs, xpubs, addresses, and tokens according to sensitivity policy where needed; sanitized fixture data is the exception.

Acceptance criteria:

- No unreviewed broad catch remains in safety modules.
- Safety functions touched by the work stay below `CCN <= 15`.
- Mutation tests catch removal of critical checks.
- All safety exceptions have deterministic, tested outcomes.

Verification:

```bash
npm run quality:lizard
npm --prefix server run test:mutation:critical:gate
npm run lint
git diff --check
```

Rollback rule:

- If the guard is too noisy, keep it advisory for one PR while producing a reviewed allowlist, then make it blocking. Do not permanently suppress the safety module set.

## Phase 6 - Threat Model, Trust Page, And External Review Package

Purpose: make trust claims auditable by users and independent reviewers.

Implementation plan:

1. Create `docs/reference/wallet-threat-model.md` covering:
   - assets: funds, xpubs, labels, policies, backups, auth tokens, release keys
   - actors: local operator, browser attacker, network attacker, malicious API client, compromised dependency, compromised release pipeline, malicious AI tool/provider, hardware signer mismatch, insider with release access
   - trust boundaries: browser/backend, gateway/mobile, AI proxy, MCP, Bitcoin node, hardware wallet, backup restore, release pipeline
   - non-goals: hot-wallet custody, AI signing authority, public unauthenticated operation, unverified release installs
2. Create or update user-facing trust documentation:
   - what Sanctuary will not do
   - what each release gate proves
   - what is still pending
   - how to verify releases
   - how hardware signing evidence is captured
3. Prepare external review materials:
   - architecture overview
   - threat model
   - release gate list
   - broadcast invariant test evidence
   - hardware fixture manifest
   - release artifact verification output
   - dependency/security triage
   - known limitations and unsupported device rows
4. Define a bug bounty or responsible disclosure process before public high-trust claims.

Corner cases to document:

- AI/MCP/Console paths are read-only and must never sign, create arbitrary drafts, approve policies, or broadcast.
- Watch-only does not mean metadata-private; xpubs, labels, and transaction history are sensitive.
- Hardware wallet display mismatch is a release blocker.
- Backup restore can destroy availability and confidentiality if mishandled.
- Release compromise is a funds-loss vector.
- A malicious or wrong-network Bitcoin node can mislead availability and policy checks; Sanctuary should still validate decoded transaction semantics locally.

Acceptance criteria:

- The threat model maps each high-risk boundary to at least one gate or explicit limitation.
- User-facing trust docs do not overclaim hardware, release, AI, or broadcast safety.
- External reviewers can reproduce the main evidence without private secrets.

Verification:

```bash
npm run test:docs
npm run lint:app
git diff --check
```

If `npm run test:docs` is unavailable or scoped differently, run the repository's existing docs tests and record the exact command.

## Suggested PR Sequence

1. **PR A: Baseline drift cleanup.** Completed 2026-05-09: restored strict coverage/lizard expectations from the benchmark grade run.
2. **PR B: Broadcast invariant spec and failing tests.** Add canonical intent contract tests without broad production rewrites.
3. **PR C: Broadcast canonical parser and policy enforcement.** Implement canonical decode, policy, audit, and node preflight.
4. **PR D: Broadcast release/mutation gate.** Add mutation coverage and release-gate documentation for broadcast invariants.
5. **PR E: Hardware fixture intake schema and lab checklist.** Ensure artifacts can be safely captured and reviewed.
6. **PR F: Release manifest and verification script.** Checksums, signatures/attestations, SBOM/provenance, clean-machine verification.
7. **PR G: Descriptor/xpub validation hardening.** Schema-first plus domain parser coverage.
8. **PR H: Safety error/complexity guard.** Typed fail-closed errors, safety lizard subset, broad-catch guard.
9. **PR I: Threat model and external review package.** Public trust docs and reviewer bundle.
10. **PR J: Physical hardware fixture capture batch 1.** Ledger/Trezor/BitBox single-sig rows.
11. **PR K: Physical hardware fixture capture batch 2.** Multisig Trezor rows and unsupported-row product blocks.

Each PR must update `tasks/todo.md`, add or update focused tests first, run touched-file lizard where non-trivial logic changes, and update release-gate docs only with measured evidence.

## Release Gate Changes To Make After Implementation

Add these rows to `docs/reference/release-gates.md` when the matching implementation lands:

| Area | Gate | Evidence | Status |
| --- | --- | --- | --- |
| Broadcast safety | Canonical decoded intent plus Electrum prevout preflight | Focused broadcast invariant tests, critical mutation gate, Electrum prevout/unspent preflight tests, and optional Bitcoin Core `testmempoolaccept` fixture proof as lab evidence | Required for releases with broadcast enabled |
| Physical hardware signing | Real device signed fixtures | `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` | Required for claimed device/script rows |
| Release provenance | Checksums, signatures/attestations, SBOM, provenance, verification script | Release manifest and clean-machine verification output | Required for stable releases |
| Domain import safety | Descriptor/xpub domain validation | Descriptor/import safety suites and address verification scripts | Required when wallet import surfaces change |
| Safety code quality | Fail-closed errors and low complexity | Safety lizard subset, broad-catch guard, critical mutation gate | Required when safety modules change |

Until implementation lands, list these as pending gates with owner/date rather than required gates, so release policy stays honest and does not block unrelated maintenance without an executable gate.

## Review Loop

This section records the requested iterative review of the plan itself. A finding is closed only when the plan text above contains concrete steps, acceptance criteria, and verification for it.

### Review Pass 1 - Completeness Against Identified Gaps

Findings:

1. The initial plan needed to include current mechanical drift from the benchmark grade run, not only future wallet work.
2. Release trust needed to cover all artifacts, not only offline bundles.
3. AI/MCP non-authority needed to appear in the threat model because it is part of Sanctuary's trust surface.
4. Unsupported hardware rows needed a product-blocking path, not just documentation.

Resolutions:

- Added Phase 0 for coverage/lizard drift.
- Expanded Phase 3 to all release artifacts, manifests, SBOM/provenance, and verification.
- Added AI/MCP trust boundaries and non-goals to Phase 6.
- Added product support flags and unsupported-row blocking to Phase 2.

Status: no open findings from pass 1.

### Review Pass 2 - Broadcast And Transaction Corner Cases

Findings:

1. The plan needed explicit behavior for broadcast success followed by persistence failure.
2. Duplicate broadcast and node "already known" responses needed idempotency rules.
3. Multi-recipient, OP_RETURN, RBF, CPFP-like, unknown-input, and reorg cases needed explicit coverage.
4. Trezor raw transaction returns needed to be routed through the same canonical path as signed PSBTs.

Resolutions:

- Added durable audit/reconciliation requirements to Phase 1.
- Added idempotency rules for duplicate broadcast.
- Added the missing transaction edge cases to the Phase 1 test matrix.
- Added hardware-returned raw transactions to the broadcast source inventory.

Status: no open findings from pass 2.

### Review Pass 3 - Hardware Evidence Corner Cases

Findings:

1. Hardware fixture capture needed explicit no-secret handling beyond "sanitized artifacts".
2. Firmware/app version drift needed rerun triggers and fixture metadata.
3. Ledger policy registration, BitBox unsupported multisig, and Trezor raw tx behavior needed device-specific treatment.
4. Device display truncation and optional screenshots could create false confidence.

Resolutions:

- Added strict capture rules excluding seeds, passphrases, PINs, pairing secrets, and local tokens.
- Added device/app version metadata and rerun requirements.
- Added device-specific cases and unsupported product-blocking.
- Required Sanctuary/device/Core agreement rather than relying on screenshots or visual memory.

Status: no open findings from pass 3.

### Review Pass 4 - Sequencing, Release Policy, And Operability

Findings:

1. Release-gate rows should not become hard-required before the executable gates exist.
2. GitHub and Forgejo release differences needed explicit handling.
3. Signing/provenance work needed key custody and rotation details.
4. Each phase needed rollback or fail-closed behavior.

Resolutions:

- Added "pending until implemented" guidance for release-gate rows.
- Added Forgejo/GitHub API and token differences in Phase 3.
- Added key custody and rotation requirements.
- Added rollback rules to each implementation phase.

Status: no open findings from pass 4.

### Review Pass 5 - Testability And Definition Of Done

Findings:

1. Manual hardware work needed automated replay as the real acceptance gate.
2. Threat model documentation needed a verification path and should not overclaim.
3. Safety-code broad-catch prevention needed a staged guard in case the first scan is noisy.
4. PR sequencing needed to avoid mixing broad safety rewrites with fixture capture.

Resolutions:

- Made hardware fixture replay the release gate, not the manual runbook alone.
- Added external review package and user-facing trust doc acceptance criteria.
- Added an advisory-to-blocking path for the broad-catch guard.
- Split the suggested PR sequence into spec/tests, implementation, gates, fixture batches, release provenance, validation hardening, and review package.

Status: no open findings from pass 5.

### Review Pass 6 - User Sequencing Correction

Findings:

1. Physical wallet verification should not block non-hardware fund-safety controls after the intake schema is in place.
2. Benchmark-inspired test work must keep lab evidence separate from Sanctuary's production runtime requirements.

Resolutions:

- Moved physical hardware fixture capture batches to the final two PR slots.
- Kept release provenance, descriptor/xpub validation, safety fail-closed guards, and trust documentation ahead of physical capture.
- Reaffirmed that Bitcoin Core, hardware devices, and third-party witnesses are lab/release evidence unless Sanctuary explicitly supports them as runtime features.

Status: no open findings from pass 6.

## Final Plan Review Result

No open plan findings remain after six review passes. The remaining unknowns are execution inputs, not plan gaps:

- exact owners and target dates for each PR
- physical access to the listed hardware devices and firmware versions
- final signing technology choice for release artifacts
- exact CI provider constraints when implementing provenance across GitHub and Forgejo

Those inputs should be filled during PR kickoff. They do not change the required controls, acceptance criteria, or verification gates above.
