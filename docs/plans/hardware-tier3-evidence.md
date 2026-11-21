# Trezor Tier 3 physical evidence

Status: draft 2026-11-13, reviewed 2026-11-20 (recursive plan review, §10).
Nothing implemented. Phase 0 is a go/no-go gate: its decisions are the
user's, and later phases do not start until they are recorded here.

Written to be executed from a fresh context. Source references are to `main`
at `914bbc5a9`.

## 1. Goal and why

Enable the Trezor hardware-wallet capability rows on the evidence path the
repository already defines ("Tier 3": a physical device, an operator, an
independent reviewer, three Ed25519 receipts). Once that ships, prod can drop
its per-instance operator attestation, and the generated compatibility
statement reports those Trezor rows as verified instead of disabled.

Today prod signs with Trezor only because of the attestation
(`HARDWARE_WALLET_OPERATOR_ATTESTED_VENDORS=trezor`, enabled 2026-11-10). That
is an honest "the operator vouches for it" state. Tier 3 replaces the
operator's word with reviewed, replayable evidence.

**Non-goals.**

- Ledger, Jade and BitBox rows. The tooling built here should be
  vendor-neutral where it costs nothing, but only Trezor gets captured.
- Mainnet evidence. The intake rejects it.
- Changing Tier 1/Tier 2 gates or the Trezor emulator proof.
- Reinstating the suspended wallet-safety audit gate.
- Removing the attestation feature. It stays as the fallback (§9).

## 2. What exists today

The evidence *verifier* is complete and fail-closed. Everything around it is
missing.

| Piece | State | Where |
| --- | --- | --- |
| Fixture schema v5 and intake validation | Done | `server/tests/helpers/hardwareSignedFixtureIntake.ts` |
| Receipt payloads and Ed25519 verification | Done | `server/tests/helpers/hardwareSignedEvidenceProvenance.ts` (`coreReceiptPayload`, `applicationReceiptPayload`, `reviewerReceiptPayload`) |
| Cryptographic replay of a fixture | Done | `server/tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` |
| Release evaluation | Done | `scripts/ci/hardware-compatibility-report.ts` (`classifyHardwareReleaseDecision`), job "Hardware Compatibility Evidence" in `release-candidate.yml` |
| Trust root | Empty by design | `config/hardware-physical-evidence-trust.json`; repo variable `HARDWARE_EVIDENCE_TRUST_SHA256` unset |
| Committed physical fixtures | None | `HARDWARE_SIGNED_PSBT_VECTORS = []` in `server/tests/fixtures/hardware-signed-psbt-vectors.ts` |
| Capture tooling (address matrix, signing capture, negative controls) | **Missing** | — |
| Receipt-signing tooling and key custody | **Missing** | — |
| Regtest lab with the pinned Core image | **Missing** | Core pin: `scripts/verify-psbt/proof-manifest.json` (`bitcoin/bitcoin:31.1@sha256:da25…`) |
| Runtime path that honours an enabled row | **Missing** | see F2 |

Required Trezor rows: P2WPKH, P2SH-P2WPKH, P2TR, P2WSH, P2SH-P2WSH (five
fixtures per model). Per fixture: receive paths `/0/0`, `/0/1`, `/0/19`,
`/0/999` and change paths `/1/0`, `/1/1`, `/1/19`, with Sanctuary, device and
Core agreeing on every one; the negative controls (wrong network/path,
tampered recipient, tampered amount/fee, missing change metadata, plus wrong
cosigner and below-quorum for multisig); software-gate results; a
sanitization review; and the Core `testmempoolaccept` transcript.

## 3. Findings that block Tier 3 regardless of the device

These were found by reading the verifier, the capability manifest and the
runtime resolver. Each is a code problem, not a lab problem.

**F1. Evidence goes stale on almost every merge.** A fixture is valid only
while all of these equal the current tree
(`applicationIdentityMatches`, `validateSdkAndSourceProvenance`):

- `appVersion` equals the root `package.json` version, so every release
  bump invalidates it.
- `packageLockSha256` equals the SHA-256 of the whole `package-lock.json`.
  `package-lock.json` is also a `PROOF_SOURCE_ROOTS` entry of the source
  manifest.
- The source manifest is the hash of every file in the TypeScript import
  closure of the 20 `PROOF_SOURCE_ROOTS`, the `server/tests/helpers/hardwareSigned*.ts`
  helpers (`hardwareSignedHelperFiles`) and the Trezor adapter directory.

Measured over the last 180 days on `main`: `package-lock.json` changed in 90
commits, and the funds-safety roots plus the Trezor adapter directory
(before closure, excluding the lockfile) in 49. A fixture
would therefore go stale every two days or so. A stale committed fixture is
not "disabled", it is invalid: `classifyHardwareReleaseDecision` adds
`invalid-physical-fixture-set`, so the RC's Hardware Compatibility Evidence
job fails and **the release is blocked**. That is the v0.8.70 latest-stable
time bomb again, in a new place. Committing the first fixture before F1 is
fixed would block the next release.

It is not only the RC. Ordinary PR and `main` CI would go red too:

- "replays every committed physical-device fixture" in
  `psbt.hardware-signed-vectors.test.ts` calls `replayHardwareSignedVector(vector)`
  with the default (empty) trust context and the live clock. Replay calls
  `assertHardwareSignedFixtureIntake`, which throws on any intake issue
  (`hardwareSignedPsbtReplay.ts`). A real fixture fails it until the test
  reads the committed trust file, and a stale one fails it forever.
- The same file asserts 16 missing rows (5 for Trezor), and
  `hardwareWalletCompatibility.test.ts` asserts
  `HARDWARE_SIGNED_PSBT_VECTORS` equals `[]`.
- `tests/ci/hardwareCompatibilityReport.test.ts` compares the regenerated
  statement with the checked-in one.

**F2. The runtime never reads `row.enabled`.**
`resolveHardwareWalletCapability`
(`shared/constants/hardwareWalletCapabilities.ts:336`) returns
`enabled: true` only for operator attestation. The row type pins
`enabled: false`, `evidenceTier: "unverified"` and `evidenceIds: []` as
literal types. Flipping a row does nothing at runtime until this changes.

**F3. Capability rows have no policy dimension.** Row IDs are
`vendor.model.capability` (`trezor.trezor-safe-3.sign`), with
`policy: "unverified"`. Evidence is per policy, though:
`single-sig-native-segwit-bip84-v1` and the others in `EXPECTED_POLICY_ID`.
`evidenceMatchesCapability` compares `evidence.policy === row.policy`, so a
row as shaped today can never match any fixture. And if it could, enabling
`sign` on the strength of a P2WPKH fixture would also enable P2TR and
multisig signing, which have no evidence.

**F4. Application image subjects need registry digests.** The capture
receipt binds exactly one frontend and one backend OCI subject. Each needs a
`manifestDigest` and `configDigest` (`sha256:…`) and a `gitRevision` equal
to the tested commit. Images built locally by `install.sh`/`./start.sh` have
a config digest but no registry manifest digest. The plan has to say which
images a capture runs against (§4, decision D4).

**F5. The doc and the code disagree.** The intake checklist in
`docs/reference/hardware-wallet-validation.md` says
`fixtureSchemaVersion: 4`; the code requires 5. The PR that fixes F1 should
correct it to whatever version that PR sets (D3 bumps it).

**F6. Only one Trezor model can ever hold evidence.** Fixture rows are keyed
`vendor:scriptType` (`rowKey` in the intake, replay and report modules), and
`validateHardwareSignedFixtureSet` rejects a duplicate row. Five Trezor
fixtures fill all five rows, so a second model has nowhere to go. That is
fine for one device. Supporting two models would need the row key to gain a
model dimension (out of scope unless D2 names two).

## 4. Phase 0: decisions (user) and go/no-go

Record each answer here before Phase 1 starts.

**D1. Who is the independent reviewer?** The intake requires distinct
operator and reviewer names and distinct capture/reviewer keys
(`validateReviewerReceipt`). This repository has one maintainer, and that is
exactly why the wallet-safety audit gate was suspended
(`docs/reference/wallet-safety-audit-review-runbook.md`). Options:

1. A second person reviews the sanitized artifacts and holds the reviewer
   key. This is the only option where the receipt means what the runbook
   says it means. **Recommended if such a person exists.**
2. The maintainer holds both keys and self-reviews after a delay, documented
   as such in the runbook and the statement. This passes the schema but is
   ceremonial. Choose it only knowing that.
3. No reviewer available, so no-go: stay on attestation (§9).

**D2. Which Trezor model or models?** Evidence is per model (Model One,
Model T, Safe 3, Safe 5, Safe 7). Rows are enabled only for the captured
model; other Trezor models stay attestation-only. Because of F6, plan on
exactly **one** model. Name it, and confirm the device can be wiped and
dedicated to testing. If prod's device is a different model, Phase 7 keeps
the attestation.

**D3. Evidence binding (fixes F1).** Recommended: bind a fixture to what
determines signing behaviour, not to the release number.

- **Drop `appVersion` equality.** Keep the captured version inside the
  signed payload as a recorded fact, but don't compare it with the tree.
- **Replace the whole-lockfile hash.** Use the existing scoped digest that
  `config/signing-dependency-scope.json` defines: `signingDependencySha256`,
  computed by `computeSigningDependencySha256` in
  `scripts/ci/hardware-compatibility-report.ts` and used by the statement
  since #1224. Remove `package-lock.json` from `PROOF_SOURCE_ROOTS`.
  - Removing it changes every vendor's `sourceManifestSha256`. That is
    harmless while there are no fixtures.
  - The report imports the intake, so move the digest function and its
    scope reader into a shared helper under `server/tests/helpers/`, which
    both import. Calling the report from the intake would create a cycle.
- **Bump the schema.** `packageLockSha256` is part of the signed application
  receipt payload and of each image subject (`applicationImageMatches`), so
  this is a schema change. Bump `fixtureSchemaVersion` to 6 and replace the
  field with `signingDependencySha256` in the application block, the
  receipt payload and the image subjects.
- **Keep the source-manifest check.** Changing funds-safety code genuinely
  should demand recapture.
- **Split "stale" from "invalid".** A fixture whose binding no longer
  matches becomes **stale**: its row is reported "physical-evidence-stale"
  and is not eligible for enablement. Release is blocked only if an
  *enabled* row points at stale evidence (the existing
  `enabled-row-lacks-exact-fresh-tier3-proof` path). A stale fixture is no
  longer `invalid-physical-fixture-set`. Signature, replay and sanitization
  failures stay hard failures. Today nothing distinguishes the two, so all
  of these change:
  - The intake returns free-form `{field, message}` issues, and replay
    throws on any of them. The intake/replay API must return issues
    classified as stale (binding fields) or invalid (everything else), and
    replay must not throw on stale ones.
  - The report adds `replayIssueCount` into `strictFixtureIssueCount`, so a
    stale fixture would count twice. Split it.
  - `ReleasePhysicalEvidenceRow.fresh` tracks expiry only, and
    `hardwareRows` has no stale status. Add one.
  - The RC's `node -e` check in `release-candidate.yml` requires
    `validationIssues.length === 0` and
    `validatedPhysicalFixtureCount === physicalFixtureCount`. Since
    `validatedPhysicalFixtureCount` is 0 whenever any issue exists, a stale
    fixture fails the RC even if the release decision is fine. Count stale
    separately there.

Even with this, the funds-safety closure changed about once a week this half
year. With rows enabled, most releases would need either a recapture of all
five fixtures or a PR that disables the rows again. **This is the main cost
of Tier 3 for a one-maintainer deployment.** It is the core of the go/no-go.

**D4. Which images a capture runs against (fixes F4).** Options:

No Sanctuary image is published anywhere today, so there are no registry
digests to reuse:

- `docker-build.yml` builds without pushing ("No image was pushed and no
  registry credentials were used").
- `release-candidate.yml` builds images and moves them as `docker save`
  archives.
- `scripts/ci/check-workflows-test-only.sh` fails any workflow that runs
  `docker login`, `docker push`, `buildx --push` or `skopeo copy`.
- `release-artifact-verifier.mjs` no longer supports live registry digest
  verification.

Options:

1. **Push from the lab host, by hand.** The operator builds the tested
   commit's images in the lab and pushes them to the private registry the
   CI Playwright image already uses (`nexus.tabineko.dev/nekoguntai-castle`,
   `docs/reference/ci-cd-strategy.md`). Record the **registry-served**
   manifest and config digests. The digest a builder prints can differ, and
   that doc warns about exactly that trap. No workflow ever pushes, so the
   test-only workflow gate is untouched. **Recommended.** It needs the
   registry path and credentials named here.
2. **Reuse the replay-image archives.** `wallet-sync-replay-image.sh`
   already records a `manifestDigest` for its `docker save` archives in a
   receipt. Spike whether the same mechanism can mint digests for the
   capture's frontend and backend images without a registry. Choose this
   only if option 1's registry is unwanted.
3. **Relax the schema** to accept config digests only. Not recommended: it
   weakens the binding.

**Go/no-go.** Go only if D1 is option 1 or 2 and the user accepts the D3
recapture cost. Otherwise close this plan as "parked, attestation is the
supported mode" and record why in the runbook's attestation section.

**D5. Which capabilities the evidence covers.** `coveredCapabilities` is
inside the signed application receipt, so it is fixed at capture (Phase 5),
not chosen at enablement. Decide before Phase 3 whether the fixtures cover
`display`, `sign`, `finalize` and `broadcast` only, or also `import` and
`account_add`. Phase 6 enables exactly that set, and widening it later means
recapturing.

## 5. Phases and delivery groups

Each phase below is its own PR unless noted. Rows stay disabled until Phase 6,
so every earlier PR is behaviour-neutral for operators and safe to release.
Merge serially (CLAUDE.md, branch protection rule 6).

### Phase 1: survivable evidence binding (PR 1)

Implements D3.

- Write the non-regression tests first, in
  `server/tests/unit/services/bitcoin/hardwareSignedEvidenceProvenance.test.ts`
  plus the intake/report tests. Build a synthetic Trezor fixture signed with
  throwaway test keys injected through `HardwareEvidenceVerificationContext`
  (never the committed trust file), then check:
  - a version bump and an unrelated lockfile change leave it valid;
  - a change inside the signing-dependency scope or the funds-safety
    manifest makes it stale, not invalid;
  - a bad signature or replay mismatch is still `invalid-physical-fixture-set`;
  - an enabled row on stale evidence still blocks release.
- Change the intake, provenance, replay and report code, and the RC
  workflow's `node -e` check, as listed under D3. Add the "stale" status to
  the generated statement schema and the Markdown renderer.
- Make the committed-fixture tests ready for real fixtures, all still
  passing with zero fixtures:
  - The "replays every committed physical-device fixture" case reads
    `config/hardware-physical-evidence-trust.json` and the live clock, and
    treats stale as a reported state, not a throw.
  - The `missing` counts (16 / 5) and `HARDWARE_SIGNED_PSBT_VECTORS === []`
    assertions are derived from the fixture list, not hard-coded.
- Fix the F5 doc mismatch.
- Add the expiry early warning from §6: the statement reports the earliest
  `expiresAt`, and a test warns when it is less than 30 days away.
- Regenerate `docs/reference/generated/hardware-wallet-compatibility.{json,md}`
  if the schema changes them. That needs a signing-scope re-pin only if the
  scope file changes; it should not.
- The schema-version literal (in the fixtures file, before the vectors
  marker) and the intake check are both source-manifest bytes. That is fine
  before capture, but the schema must not change again between Phase 5 and
  Phase 6.

**Acceptance.**

- New tests pass, and the fixture schema is version 6.
- `npx tsx scripts/ci/hardware-compatibility-report.ts …` still returns
  `safe-fail-closed` with zero fixtures.
- End to end through the RC check: run the report and the
  `release-candidate.yml` `node -e` assertions locally against a stale
  synthetic fixture with rows disabled (must pass), and against an invalid
  one (must fail).
- A test shows a fixture expiring in under 30 days produces the warning.
- Backend unit coverage (`tests/unit` scope) has no new uncovered branches.

### Phase 2: policy-scoped enablement plumbing (PR 2)

Fixes F2 and F3. All rows stay disabled.

- **Row shape.** Give each row a policy: one row per vendor × model ×
  capability × canonical policy, with the policy taken from
  `WALLET_POLICY_REGISTRY`. Policy-independent capabilities (`import`,
  `account_add`) keep a single row. The alternative is a policy set on the
  existing row; choose whichever keeps the signer-inventory and generated
  docs simpler, and record why.
- **Move enablement data out of the source manifest.** The rows are
  generated in `shared/constants/hardwareWalletCapabilities.ts`, which is a
  `PROOF_SOURCE_ROOTS` entry. If Phase 6 edited `enabled`, `evidenceIds` or
  `freshness` there, every Phase 5 fixture would go stale and the enabled
  rows would point at stale evidence. The capture IDs and expiry are only
  known after capture, so it would be circular. Instead:
  - Put the per-row enablement (`enabled`, `evidenceTier`, `evidenceIds`,
    `freshness`) in its own data-only module,
    `shared/constants/hardwareWalletEnablement.ts`, and statically import it
    from the rows module.
  - Keep it a `.ts` file under `shared/`, not `config/*.json`. Server and
    gateway consume `shared/dist`, `shared/tsconfig.json` compiles only
    `rootDir: "./"`, and `server/Dockerfile` copies `shared` but only one
    named `config/` file. A `config/` JSON would fail to build or be
    missing at boot.
  - That static import puts the module in the closure
    (`repositoryDependencyClosure` follows static specifiers). Add an
    explicit, single-entry exclusion set to the provenance helper, filtered
    in both `repositoryDependencyClosure` and
    `currentHardwareEvidenceSourceManifest`. `canonicalSourceBytes` can't do
    it: it only trims bytes of a file already in the closure. The exclusion
    is justified because the module holds only enablement claims, which the
    release evaluator re-verifies against the evidence. It holds no
    signing logic, and a test keeps it import-free (data only).
  - A test asserts the module is absent from
    `currentHardwareEvidenceSourceManifest` for every vendor, and that
    nothing else is excluded.
  - Acceptance also covers the build: the server image build and
    `npm run build` (frontend bundle) both resolve the module.

  Phase 6 then touches only that file.
- **Types.** Widen the row type so `enabled: true` is representable only
  together with `evidenceTier: "physical-device"`, non-empty `evidenceIds`
  and concrete `freshness`. Use a discriminated union, so a half-enabled row
  fails typecheck.
- **Resolver.** `resolveHardwareWalletCapability` returns
  `enabled: true, evidence: "physical-device"` for an enabled row *and the
  wallet's policy*. Its own doc comment already says the first Tier 3
  enablement must do this (`shared/constants/hardwareWalletCapabilities.ts`,
  above the function). Its direct callers are:
  - `server/src/services/hardwareWalletCapabilities.ts`
    (`getHardwareWalletCapabilityDecision`);
  - `src/components/send/steps/review/deviceCapabilities.ts`;
  - `src/services/hardwareWallet/service.ts`;
  - `src/services/hardwareWallet/operatorAttestation.ts`.
- **Where the policy comes from.**
  - Wallet-scoped checks go through one choke point,
    `assertWalletHardwareCapabilityById`. It has about 25 callers:
    drafting, broadcasting, addresses, `artifactValidation`, payjoin, the
    agent API, export, MCP resources and assistant tools. It already loads
    the wallet with `findByIdWithDevices`, so derive the canonical policy
    there and pass it down. Confirm the wallet's script type maps one-to-one
    onto a `WALLET_POLICY_REGISTRY` id.
  - For a multi-device wallet, the all-devices loop must require the
    policy-scoped row on every device.
  - Device-scoped checks (`assertHardwareWalletCapability`: device
    registration, account add, wallet create and import, about 15 call
    sites) run before a wallet exists. They stay on the policy-less
    `import` and `account_add` rows.
  - Client checks (`deviceCapabilities.ts`, `service.ts`) need the same
    policy argument.
- **Attestation.** Operator attestation keeps working as today, and Tier 3
  wins when both apply.
- **Generated artifacts.** Regenerate the signer inventory
  (`tests/ci/signerInventoryGeneration.test.ts`) and the compatibility
  statement.
- **Tests that assert all rows disabled.** Update them to assert "no row
  enabled in the manifest", and add positive tests that use a test-only
  enabled manifest. The tests are:
  - `server/tests/unit/services/bitcoin/hardwareWalletCompatibility.test.ts`
  - `tests/ci/hardwareCompatibilityReport.test.ts`
  - `tests/ci/signerInventoryGeneration.test.ts`
  - `tests/shared/hardwareWalletOperatorAttestation.test.ts`
  - `server/tests/unit/services/hardwareWalletCapabilities.test.ts` and
    `hardwareWalletCapabilities.operatorAttestation.test.ts`
  - `tests/components/send/steps/review/deviceCapabilities.{attestation,branches,enabled}.test.ts`.
    `enabled` may already stub an enabled row; reuse it.
- **Wallet-safety maps.** This touches funds-safety files, so check:
  - the wallet-safety mutation map and Stryker ranges (memory:
    `wallet-safety-mutation-map-line-pins`,
    `stryker-profile-configs-pin-mutate-ranges`);
  - `config/wallet-safety-critical-paths.json`;
  - architecture graphs (`arch:check` in the primary checkout).

**Acceptance.**

- With the production manifest, every decision is byte-identical to today,
  shown by a snapshot test over all vendor × model × capability × policy
  combinations, with and without attestation.
- With a test manifest that enables `trezor.<model>.sign.<p2wpkh-policy>`,
  P2WPKH signing is allowed while P2TR and multisig are denied.
- Full root and server typecheck, test and coverage gates pass locally.
- The enablement data file is not in any vendor's source manifest.

**Backout.** Revert PR 2. That is safe while no row is enabled; after
Phase 6, revert PR 6 first.

### Phase 3: lab and capture tooling (PR 3)

No keys and no fixtures yet. Deliverables live under `scripts/hardware-evidence/`
plus one how-to doc.

1. **Lab stack.** A dedicated Compose project, never `sanctuary`, never the
   local demo stack, never prod. Its images come from the tested commit,
   per D4. Reuse what exists rather than writing a new lifecycle:
   - `start.sh` already honours `SANCTUARY_PROJECT`/`COMPOSE_PROJECT_NAME`,
     and the RC canary (`docs/how-to/release-candidate-canary.md`) shows an
     isolated project with its own runtime env and ports.
   - `scripts/ci/run-psbt-core-subject.sh` already runs the pinned Core
     image from `scripts/verify-psbt/proof-manifest.json` with
     `-regtest=1`, labelled ownership and exact cleanup.
   - **Spike first: chain backend.** The backend talks to an Electrum
     server (`ELECTRUM_HOST`, defaulting to a public mainnet server), and
     `BITCOIN_NETWORK=regtest` is accepted by the config. No Compose
     service runs a regtest Electrum server today, so the lab needs one
     (for example electrs against the regtest node). Prove that the app can
     create a wallet, sync and draft on regtest before building the rest.
   - Include a funding helper for the five script families, plus
     deterministic software cosigner keys for the 2-of-N multisig rows.
     Software keys are allowed by the signing procedure, step 6.
   - Unsigned PSBTs must carry the full previous transaction
     (`nonWitnessUtxo`) or a consistent `witnessUtxo`. Replay checks the
     previous txid and value (`hardwareSignedPsbtReplay.ts`).
2. **Capture harness.**
   - **Spike first:** where do the device-returned addresses and the Connect
     signature array get recorded? The candidate is a lab-only build flag
     that exposes a capture panel. The panel calls the *production* Trezor
     adapter (`createConnectClient`, `getAddress` with `showOnTrezor`,
     `signTransaction`) and writes a JSON capture.
   - The harness must not add a code path to the production bundle. Prove
     it with a bundle check: the capture panel module is absent when the
     flag is off.
   - The panel's mount point (the flag check or lazy import) lands in PR 3
     and nowhere later. Prefer a file outside the closure, such as the app
     shell or router, not `useUsbSigning.ts` or `service.ts`.
   - The panel source must sit outside the source-manifest closure. The
     evidence then binds the same funds-safety source that prod runs, even
     though the lab images (D4) are a flag-on build and not the shipped
     image bytes. Accept and document that: the image subjects prove which
     commit was tested, and the source manifest proves what code signed.
   - It records:
     - the full address matrix (Sanctuary-expected and device-returned);
     - the unsigned PSBT;
     - the Connect signature array and serialized transaction;
     - device, firmware and Suite/Bridge versions;
     - the host OS and browser;
     - each negative control's observed outcome.
3. **Core derivation and acceptance.** A script that derives every matrix
   address with `deriveaddresses` on the lab node and runs
   `testmempoolaccept` on the final transaction. It saves the exact JSON-RPC
   request and response bytes the Core receipt hashes.
4. **Fixture assembler.** It turns a capture, the Core transcript and the
   software-gate results into a `HardwareSignedPsbtVector` at the Phase 1
   schema version. It then runs `validateHardwareSignedFixtureIntake`
   locally, refuses to emit anything the intake rejects, and runs the
   secret scan before writing. It verifies against the committed trust file
   by default. A `--trust-file` override exists only for the dry run, and
   any fixture verified that way is written to the scratch output, never
   into `hardware-signed-psbt-vectors.ts`. Its how-to doc carries
   a field-by-field source table, so no field is hand-typed:

   | Field group | Source |
   | --- | --- |
   | `account` (fingerprint, path, xpub, canonical policy id/version, multisig threshold and cosigner xpubs) | capture panel, plus the lab's software cosigner set |
   | `signedBy[]` (fingerprint, path, pubkey) | the Connect signature array, origin-bound |
   | `expectedOutputs[]`, input value, fee, vsize, txid | the drafted PSBT and the final transaction |
   | `addressEvidence` | capture panel (Sanctuary and device) plus Core `deriveaddresses` |
   | `negativeControls` (the exact enum of cases) | capture panel |
   | `evidence.sdkPackages[]` (version and SRI) and `sourceManifest[]` | the lockfile and the provenance helper at the tested commit |
   | `evidence` capture fields (id, times, operator, `changeRecognizedOnDevice`, Core version and image) | operator input and the proof manifest |
   | `application` and image subjects | D4 |
   | `coveredCapabilities` | decision D5 |
   | `softwareGates`, `sanitization` | the gate run and the reviewer |
5. **Receipt signer.**
   - A CLI that builds the payload by importing the *same*
     `coreReceiptPayload`, `applicationReceiptPayload` and
     `reviewerReceiptPayload` functions the verifier uses, so the bytes
     cannot diverge.
   - It signs with a private key read from a path outside the repo. It never
     accepts a key on the command line and never writes one.
   - It refuses a key whose public half is not in the trust file under the
     role being signed.

**Acceptance.** An end-to-end dry run in CI or on a local regtest:

- Run the whole pipeline with a *software* stand-in signer and throwaway
  keys. It must produce a fixture that passes intake and replay, using a
  test-only trust context.
- The same fixture fails against the committed (empty) trust file.
- The lab stack starts and stops without touching any other Compose
  project. Snapshot container IDs before and after, as the release skill's
  canary does.

### Phase 4: key ceremony (PR 4, the "PR12 ceremony" the runbook names)

1. **Generate keys.** Three Ed25519 key pairs:
   - **Core:** held by the lab, used only by the Core-acceptance script.
   - **Capture:** held by the operator.
   - **Reviewer:** held by the D1 reviewer, on their own machine if D1 is
     option 1.
   Private keys never touch the repo, CI or the Sanctuary host. Record the
   custody and backup location of each key outside the repo.
2. **Commit the public keys.** Add them to
   `config/hardware-physical-evidence-trust.json`. The file is in the source
   manifest, so this must merge **before** any capture.
3. **Pin the trust root.** Set the protected Forgejo repository variable
   `HARDWARE_EVIDENCE_TRUST_SHA256` to the SHA-256 of the merged file. This
   is an operator action, so confirm it with the user. It is a repo
   variable, not a branch-protection setting.
4. **Verify the pin.** Dispatch `release-candidate.yml` on `main` and
   confirm the Hardware Compatibility Evidence job still passes
   (`safe-fail-closed`). The pin is only enforced once a fixture exists, so
   also run the report locally against a Phase 3 dry-run fixture: it must
   pass with the correct digest and fail with a wrong one.

**Rollback.** Revert the trust file and clear the variable. No fixtures
depend on them yet.

### Phase 5: capture and commit fixtures (PR 5, rows still disabled)

1. Pick the tested commit: current `main` after PRs 1–4. Build the lab
   images from it (D4). Wipe the device, and load a dedicated test seed on
   the device only.
2. For each of the five script rows, follow the address, signing and
   negative-control procedures in `docs/reference/hardware-wallet-validation.md`.
3. Assemble, intake, and sign the Core and capture receipts.
4. The reviewer reviews the sanitized artifacts (not the device) and signs
   the reviewer receipt.
5. Add the five vectors to `HARDWARE_SIGNED_PSBT_VECTORS`, plus a sanitized
   manifest at `tasks/hardware-wallet-validation-YYYY-MM-DD.md`.

**Acceptance.**

- `REQUIRE_TREZOR_PHYSICAL_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts`
  passes. That flag only checks completeness (no Trezor row missing); the
  replay and intake checks are the other cases in the same run, which must
  also pass.
- Ordinary backend unit CI is green with the fixtures committed (Phase 1
  made it read the real trust file).
- The report shows five "physical-evidence-present" rows and
  `validatedPhysicalFixtureCount == physicalFixtureCount`, and the release
  decision is still `safe-fail-closed`.
- An RC dispatch of `release-candidate.yml` on `main`, after PR 5 merges,
  passes with the pinned trust root.
- The tested commit is an ancestor of the PR head, *and*
  `sourceManifestMatches` holds at the PR head. PR 5 may touch only:
  - the vectors region after the `HARDWARE_SIGNED_PSBT_VECTORS` marker,
    which `canonicalSourceBytes` strips;
  - `tasks/` and docs, which are outside the closure.

  Check it directly: every vendor's source manifest at the PR 5 head equals
  the one at the tested commit.
- If `main` moved during the capture and touched the binding, the evidence
  is stale (D3): recapture rather than merge it. Merge PR 5 straight after
  the capture. Under serial merges, hold other PRs that touch the closure
  until PRs 5 and 6 are in.

### Phase 6: enable the rows (PR 6)

- In the enablement data file from Phase 2 (and nowhere else), set
  `enabled: true`, `evidenceTier: "physical-device"`, `evidenceIds` and
  `freshness` on the rows of the captured model × the five policies for
  exactly the D5 capability set. The enablement file is
  `shared/constants/hardwareWalletEnablement.ts`.
- `finalize` and `broadcast` are server-side steps
  (`artifactValidation.ts`, `broadcasting.ts`), not device behaviour. They
  are justified by the fixture's replay (Sanctuary finalizes the
  device-signed artifact) and by the Core `testmempoolaccept` transcript.
  Say so in the row reason.
- Regenerate the statement and the signer inventory, and update the
  runbook's "Current Fixture Classification" table.
- Changelog entry: Trezor `<model>` rows are Tier 3 verified, and on which
  evidence.

**Acceptance.**

- The report says `enabled-rows-verified` with zero issues.
- The runtime snapshot test shows exactly the intended allow-set.
- The rows still deny for other Trezor models and for `trezor-unresolved`.
- Every vendor's source manifest at the PR 6 head equals the one recorded
  in the fixtures, so the fixtures are still fresh and not stale.

**Backout.** A PR that sets the rows back to disabled in the enablement
file. The attestation fallback is unaffected.

### Phase 7: release and prod

1. Release through the normal RC → promote → publish flow. The RC's Hardware
   Compatibility Evidence job must report `enabled-rows-verified`.
2. Upgrade prod using the backup-then-`install.sh` flow from memory
   `prod-host-deploy-facts`.
3. **Only if** the prod device's model is one of the enabled models:
   - Back up the env file, then comment out (do not delete) the two
     attestation keys in `~/.config/sanctuary/sanctuary.env`. Keep them
     there for at least one later release cycle with the rows verified: if
     the evidence goes stale and the rows are disabled again, uncommenting
     them is prod's signing path.
   - Recreate the containers with `./start.sh`.
   - Confirm the boot log no longer prints the attestation warning.
   - Confirm the UI no longer says "Operator-attested".
   - Have the user run a smoke check on prod: connect, check an address,
     then cancel at the signing prompt. Don't sign a mainnet transaction
     just to prove this.

   Otherwise, keep the attestation for the other model.
4. Update memory `prod-host-deploy-facts`.

## 6. Maintenance (written into the runbook in PR 6)

- **Expiry.** Evidence expires 180 days after capture, at the latest. An
  enabled row on expired or stale evidence blocks the release. The escape is
  always available: either recapture, or a PR that disables the rows. The
  attestation then covers prod in the meantime.
- **Recapture triggers.** Any change to:
  - the funds-safety source manifest;
  - the signing-dependency scope packages (a Connect bump is one);
  - the Core image pin;
  - the Trezor firmware the lab device runs.
- **Early warning.** Phase 1 adds a statement field and test that warn 30
  days before the earliest `expiresAt`, so expiry is seen on a PR rather
  than on an RC.

## 7. Risks

- **Recapture burden** (D3). It is mitigated only by the disable-rows escape
  hatch. If recapture happens less often than releases, expect rows to
  toggle.
- **Capture harness leaking into production.** Mitigated by the build-flag
  bundle check in Phase 3.
- **Key compromise.** A leaked capture or reviewer key lets someone forge
  evidence for enabled rows. Rotation means: new keys, a trust-file PR, a
  new `HARDWARE_EVIDENCE_TRUST_SHA256`, and recapture, because the old
  receipts no longer verify.
- **Phase 2 regressions.** It edits the gate every hardware signing path
  goes through. The byte-identical decision snapshot is the guard.
- **Suite-hosted transport variance.** Evidence records the Suite or Bridge
  version. A different companion on prod is not covered by the evidence;
  the runbook should say so.

## 8. Effort

| Phase | Rough size |
| --- | --- |
| 0 | A conversation |
| 1 | Small to medium |
| 2 | Medium; the riskiest code PR |
| 3 | Large; the bulk of the work, including the capture-panel spike |
| 4 | Small, plus the operator steps |
| 5 | One or two lab sessions, plus the reviewer's time |
| 6 | Small |
| 7 | One release and one prod upgrade |

Phases 1 and 2 are worth doing even on a no-go *if* Tier 3 is likely
someday, but they are not needed for anything else. On a no-go, skip them.

## 9. Fallback

Per-instance operator attestation (`docs/reference/hardware-wallet-validation.md`,
"Per-Instance Operator Attestation") remains the supported way to sign with
Trezor without Tier 3. A no-go at Phase 0, or any later phase stalling,
leaves prod exactly as it is today.

## 10. Review record

Recursive plan review, 2026-11-20, against `main` at `914bbc5a9`. Four
passes; the fourth found no actionable comments. Every accepted comment was
checked against source before it was applied.

- **Pass 1 (facts and feasibility).**
  - F1 now covers PR and `main` CI breakage, not only the RC.
  - D3 lists every place the stale/invalid split touches: intake, replay,
    the report counts and the RC `node -e` check. It also covers the
    schema-v6 bump and moving the signing digest helper.
  - D4 is corrected: nothing publishes Sanctuary images, and the
    test-only workflow gate forbids pushes.
  - Phase 2 call sites and test paths are corrected.
  - Phase 3 now reuses the isolation and pinned-Core tooling, adds the
    regtest Electrum spike, the previous-transaction requirement and the
    assembler field table.
  - Added F6 (one Trezor model only) and the `finalize`/`broadcast`
    justification.
- **Pass 2 (consistency and sequencing).**
  - Blocker fixed: Phase 6 would have edited a manifest root and staled
    the Phase 5 fixtures, so enablement data moved out of the manifest.
  - Added D5, because `coveredCapabilities` is fixed at capture.
  - Added the assembler's trust-file handling and the capture-image
    caveat.
  - Added backout for Phases 2 and 6 and a softer attestation removal in
    Phase 7.
  - Early warning now has an owning phase, and Phase 5 has
    merge-timing and manifest-equality checks.
- **Pass 3 (loading mechanics).** The enablement data is a `shared/` TS
  module with an explicit closure exclusion. A `config/` JSON file would
  not build into `shared/dist` or reach the server image. The capture-panel
  mount point is pinned to PR 3, outside the closure.
- **Rejected:** none. Every candidate was source-backed and in scope.
