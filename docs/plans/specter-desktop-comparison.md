# Specter Desktop Benchmark: Fund-Safety Lessons For Sanctuary

Date: 2026-05-09
Status: comparative assessment and action plan
Specter source: `cryptoadvance/specter-desktop` at `9e43afb` (`2026-04-23`)
Sanctuary source: local repository at `b3ba4a3e`
Follow-up closure plan: `docs/plans/fund-safety-gap-closure-plan.md`

## Executive Summary

Specter Desktop is strongest as a mature Bitcoin coordinator. It has years of domain learning embedded in Bitcoin Core integration, PSBT workflows, descriptor parsing, multisig UX, airgapped hardware-wallet flows, release checksums, and live `bitcoind`/`elementsd` test lanes. Its best lesson for Sanctuary is not its Flask MVC shape; it is its narrow focus on letting Bitcoin Core, descriptors, PSBTs, and hardware devices be the source of truth whenever funds can move.

Sanctuary is currently stronger on mechanical engineering controls: typed request boundaries, broad unit coverage, security gates, gitleaks, Semgrep, npm audit, lizard, duplicate-code checks, large-file checks, CI classification, cookie/CSRF browser auth, fail-closed deployment policy, and release-gate documentation. Those controls should stay stricter than Specter's. Sanctuary's biggest remaining gap is not day-to-day CI hygiene; it is release-grade physical hardware signing evidence and an explicit "no irreversible fund movement unless every invariant is server-canonical and independently checked" policy.

The practical target is:

- Keep Sanctuary's stricter engineering gates.
- Adopt Specter's domain maturity around Bitcoin Core/HWI/PSBT/descriptor evidence.
- Avoid Specter's weaker patterns: large high-complexity route/domain functions, broad exception swallowing in funds paths, conditional release signing, untriaged example secrets, and legacy authentication defaults that are acceptable only in narrow localhost threat models.

## Scope And Evidence

This assessment reviewed Specter source, CI, release workflow, docs, transaction creation, broadcast endpoints, key/descriptor validation, API auth, and local mechanical signals. It compared those against Sanctuary architecture docs, release gates, hardware-wallet validation docs, CI quality workflow, package scripts, and the current health report.

Primary Specter evidence:

- Purpose and hardware-wallet scope: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/README.md#L51-L69>
- Verifiable install path with checksums, GPG, and `--require-hashes`: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/README.md#L107-L122>
- Architecture notes: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/docs/architecture.md#L1-L35>
- Test workflow with `bitcoind`, `elementsd`, pytest, and Cypress: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/.github/workflows/test.yml#L21-L64> and <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/.github/workflows/test.yml#L72-L132>
- Release checksums/signing and draft release flow: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/.github/workflows/release.yml#L576-L704>
- PSBT creation: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/wallet/wallet.py#L1535-L1660>
- Broadcast preflight: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/server_endpoints/wallets/wallets_api.py#L175-L249>
- Xpub parsing: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/key.py#L65-L156>
- Descriptor parsing: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/util/descriptor.py#L125-L266>
- Authentication code reviewed: <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/server_endpoints/auth.py#L26-L137>, <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/user.py#L32-L55>, and <https://github.com/cryptoadvance/specter-desktop/blob/9e43afb/src/cryptoadvance/specter/api/security.py#L36-L72>

Primary Sanctuary evidence:

- `docs/reference/frontend-architecture.md`: watch-only coordinator model; private keys never leave hardware wallets; frontend builds and exports PSBTs.
- `docs/reference/release-gates.md`: required gates for typecheck, coverage, build, mutation, browser auth/CSRF, dependency audit, install/upgrade, operations, and AI/MCP boundaries.
- `docs/reference/hardware-wallet-validation.md`: release-grade physical device matrix, signed artifact manifest, negative controls, and the current admission that physical-device signing fixtures are still missing.
- `.github/workflows/quality.yml`: blocking quality gates for lint, npm audit, gitleaks, Semgrep, actionlint, lizard, jscpd, large files, and CI classifier tests.
- `docs/plans/codebase-health-assessment.md`: current health score and remediated bug-scrub findings.

## What Specter Does Well

### Bitcoin-Domain Correctness Is Central

Specter's architecture is organized around Bitcoin Core, wallets, devices, nodes, descriptors, and PSBT objects. The README frames the product as a UI around Bitcoin Core with a focus on multisig and airgapped signing devices, and it explicitly does not recommend its hot-wallet mode. That is the right trust posture for a coordinator: reduce custody surface, make the node and hardware signer central, and keep hot-key behavior second-class.

The strongest funds-safety pattern is the PSBT flow in `Wallet.createpsbt()`. It delegates coin selection and PSBT construction to Bitcoin Core via `walletcreatefundedpsbt`, sets watch-only inputs, sets a wallet-owned change address, checks available balance and selected coin sufficiency, fills missing PSBT metadata, and persists pending PSBTs only after construction. This gives Specter a mature domain foundation even where the implementation is complex.

### Broadcast Has A Core Policy Preflight

Specter runs `testmempoolaccept` before local broadcast and before block-explorer broadcast. That is a concrete safety check Sanctuary should preserve in all broadcast paths: every final transaction should be decoded and policy-checked by the configured node before any network propagation attempt. The preflight is not a substitute for Sanctuary policy checks, but it is a required last-mile guard.

### Hardware-Wallet Breadth Is Mature

Specter supports a wide hardware and airgapped signing matrix: SeedSigner, Specter DIY, Jade, ColdCard, BitBox02, Passport, Electrum airgapped, Keystone, Trezor, Ledger, KeepKey, and Keycard Shell. The lesson is not to chase every vendor at once. The lesson is that high-trust wallet software needs explicit device classes, transport-specific flows, and signed artifact evidence. Sanctuary's current runbook has the right shape, but it still needs physical signed PSBT/raw transaction fixtures before claiming full hardware-in-loop funds-loss-grade confidence.

### Key And Descriptor Import Is Defensive

Specter's `parse_xpub()` validates origin syntax, fingerprint hex/length, path indexes, SLIP-132 prefixes, xpub depth versus derivation path, and inferred root/child metadata. Its descriptor parser checks checksum shape and content, supported wrapper types, multisig threshold, sorted multisig ordering, and origin/key suffix extraction. The functions are too complex, but the domain checks are exactly the kind of checks Sanctuary should enforce at every import boundary.

### Release Artifacts Are User-Verifiable

Specter documents a verification path using release tarballs, `SHA256SUMS`, detached GPG signatures, and hash-pinned Python requirements. Its release workflow generates checksums, conditionally GPG-signs them, publishes PyPI through trusted publishing, and creates a draft GitHub release. Sanctuary should exceed this by making signing/provenance mandatory for release artifacts, not conditional.

### CI Exercises Real Bitcoin Infrastructure

Specter's test workflow installs pinned `bitcoind` and `elementsd`, installs Python requirements with `--require-hashes`, runs pytest with coverage, and runs Cypress in a pinned container digest. This is one of Specter's strongest maturity signals. Sanctuary already has broad tests and release gates, but any fund-moving path should keep adding fixture-backed Core replay, `testmempoolaccept`, and device artifact verification.

## Specter Deficiencies And Risks

These are not reasons to dismiss Specter. They are places where Sanctuary should set a higher bar.

### High Complexity In Funds And Auth Paths

A local `lizard -l python` run over Specter production/test Python reported 38 warnings. Examples include:

| File/function | Local signal |
| --- | ---: |
| `wallet/wallet.py:createpsbt` | CCN 20 |
| `wallet/wallet.py:fill_psbt` | CCN 18 |
| `util/descriptor.py:parse` | CCN 35 |
| `util/descriptor.py:derive` | CCN 24 |
| `server_endpoints/wallets/wallets.py:new_wallet` | CCN 33 |
| `server_endpoints/wallets/wallets.py:send_new` | CCN 30 |
| `server_endpoints/settings.py:auth` | CCN 38 |
| `devices/hwi/jade.py:sign_tx` | CCN 67 |
| `key.py:parse_xpub` | CCN 27 |

The largest Specter source files are also large for safety-critical code: `wallet/wallet.py` is 1,942 lines, `specter.py` is 817 lines, `node.py` is 783 lines, and `settings.py` is 756 lines. Large functions and route handlers make it harder to review every irreversible branch. Sanctuary should keep its `CCN <= 15` standard for touched production logic and split funds paths before they become "expert-only" review surfaces.

### Broad Exception Handling In Funds Paths

Specter often catches broad `Exception` or bare `except`, including in transaction and PSBT handling. In `createpsbt()`, failure to read chain tips falls back to `locktime = 0`. In broadcast/explorer endpoints, broad exceptions are converted to UI errors. In PSBT utility code reviewed locally, there is at least one latent issue where a broad exception hides an undefined variable while building output address metadata.

For Sanctuary, a broad catch in a funds path should be treated as a design smell unless it maps to a typed, fail-closed outcome. "Log and continue" is not acceptable when address classification, change detection, input ownership, fee policy, or broadcast state is uncertain.

### Authentication Is Localhost-Oriented And Legacy-Tolerant

Specter sets `SESSION_COOKIE_SAMESITE = "Strict"` and uses Flask-Login session protection, which is good. But the auth model also has weaker legacy choices:

- Login can be disabled through auth method `none`, which logs in as `admin`.
- If no users file exists, the default admin user is created as `admin` / `admin`.
- Password hashing uses PBKDF2-HMAC-SHA256 with 10,000 iterations and a direct byte equality comparison.
- The RPC-password-as-PIN flow logs the submitted password in one success path when the node is not reachable.
- API JWT verification decodes an HS256 token and checks that the username exists, but the reviewed verifier does not appear to check token presence against the stored `jwt_tokens` map before accepting it.

Those choices may be mitigated by Specter's default localhost desktop orientation. Sanctuary's threat model is broader: Umbrel app, browser, gateway, AI/MCP surfaces, backups, mobile/API flows, and operator networks. Sanctuary should stay stricter: no default credentials, no auth-none production mode, revocation-aware access tokens, modern password hashing, no secret-bearing logs, HttpOnly cookies, CSRF, and fail-closed deployment defaults.

### Security Tooling Is Thinner

Specter's visible workflows include pytest, Cypress, extension smoke tests, Black formatting, and release builds. I did not find visible CI gates for gitleaks, Semgrep, Bandit, pip-audit/Safety, actionlint, lizard, jscpd, or large-file limits.

Local checks also found:

- `npm audit --audit-level=high --omit=dev --json` reported 1 high and 1 moderate production npm advisory in the current clone.
- `gitleaks detect --source /tmp/specter-desktop --no-git --redact` reported 17 findings. Most appear to be docs/example JWT/API keys, commented migration example passwords, or vendored source-map material, but they would still require explicit triage/allowlisting in Sanctuary's gate model.

Sanctuary's current quality workflow already gates high/critical npm audits, gitleaks, Semgrep baseline, actionlint, lizard, jscpd, and large files. Keep those stricter gates and add equivalents for any future non-npm language stack.

### Release Signing Is Not Uniformly Mandatory

Specter's release workflow generates checksums and signs them only when `GPG_PRIVATE_KEY` is present. The generated release text says signed hash files are available, and also states that the macOS app is not code-signed or notarized. A high-trust Sanctuary release should avoid optional signing language: release publication should fail when required signatures, provenance, SBOMs, checksums, or notarization expectations are missing.

### Input Validation Is Often Hand-Rolled

Specter has many mature domain validations, but much of the web boundary parsing is free-form Flask `request.form` handling plus ad hoc checks. Sanctuary's schema-first API validation is stronger. Keep using typed schemas at network boundaries, then domain-specific parsers inside the service layer.

## Comparison Matrix

| Area | Specter Desktop | Sanctuary | Recommendation |
| --- | --- | --- | --- |
| Custody model | Strong coordinator posture; hardware/airgapped focus; hot wallet marked experimental. | Watch-only coordinator; private keys stay on hardware wallets; frontend builds/exports PSBTs. | Preserve watch-only as a non-negotiable product invariant. |
| PSBT creation | Delegates core construction to Bitcoin Core and fills PSBT metadata. | Uses TypeScript/Bitcoin libraries and server-side transaction services with focused tests. | Keep server-canonical PSBT validation and add more Core replay fixtures. |
| Broadcast safety | Uses `testmempoolaccept` before broadcast. | Recent health report says raw broadcast canonical validation was fixed; release gates cover PSBT validation. | Require decode, policy, audit, ownership, fee, and `testmempoolaccept` before broadcast. |
| Descriptor/key import | Mature xpub/descriptor checks, but complex functions. | Has verification scripts and network-boundary checks; should keep imports schema/domain validated. | Copy the check coverage, not the monolithic implementation style. |
| Hardware proof | Broad vendor support and mature UX patterns. | Runbook is strong, but 11 required physical signing fixture rows are still missing. | Make hardware-signed fixtures a release-blocking gate before broad trust claims. |
| Auth/session security | Localhost-oriented, legacy modes, weaker password hash settings, questionable JWT revocation. | HttpOnly cookies, CSRF, refresh flow, token/session revocation fixes, gateway hardening. | Keep Sanctuary stricter; do not import Specter auth defaults. |
| Static/security gates | Good tests; less visible SAST/secrets/dependency/complexity gating. | Blocking npm audit, gitleaks, Semgrep, actionlint, lizard, jscpd, large-file gates. | Maintain and expand gates; add language-specific gates if the stack grows. |
| Complexity | Several high-CCN funds/auth/device functions and large source files. | Current quality workflow enforces lower complexity expectations. | Keep CCN thresholds and split funds logic early. |
| Release trust | Checksums, GPG signing path, PyPI trusted publishing, draft releases; macOS unsigned. | Release gates exist; artifact signing/provenance should become explicit. | Make checksums, signatures, SBOM/provenance, and verification docs mandatory. |
| Operational model | Desktop/localhost first, optional SSL/Tor. | Umbrel/server/gateway/browser/mobile/API surfaces. | Sanctuary needs the stricter network-exposed threat model. |

## Lessons Learned For Sanctuary

1. **The configured backend must be an independent witness.** Any transaction that may reach the Bitcoin network should be decoded by Sanctuary and checked by the configured production backend before broadcast. While Sanctuary is Electrum-only, that means Electrum-visible prevout and unspent checks at runtime; Bitcoin Core `testmempoolaccept` remains release-lab evidence rather than an added operator requirement. The same boundary applies to address vectors, PSBT fixtures, and hardware-lab evidence: external witnesses improve confidence but do not become runtime requirements unless Sanctuary explicitly supports that feature.

2. **Domain checks beat UI confidence.** The UI can help users understand outputs, but the server must re-derive recipient outputs, change outputs, fees, input ownership, network, script policy, and wallet membership from canonical PSBT/raw transaction data.

3. **Hardware-wallet trust requires physical artifacts.** Mocks and deterministic software vectors are necessary but insufficient. Release-grade confidence needs sanitized signed PSBT/raw transaction fixtures from real devices, replayed through Sanctuary and Bitcoin Core.

4. **Complexity is a security risk in funds paths.** Specter contains valuable domain checks inside functions that are too large. Sanctuary should split parsing, validation, policy, signing, finalization, and broadcast into named units with focused tests.

5. **Every broad catch needs a safety decision.** In wallet software, an exception handler either preserves a typed degraded state or fails closed. It should not silently downgrade locktime, change classification, address extraction, input metadata, or signing confidence without a test and a product decision.

6. **Release trust is part of funds safety.** Users can lose funds by installing compromised software as easily as by approving a bad transaction. Sanctuary needs signed artifacts, checksums, provenance, SBOMs, dependency audits, and clear verification instructions.

7. **Localhost assumptions age badly.** Specter can tolerate some legacy choices because its primary model is desktop/localhost. Sanctuary should assume browser, LAN, gateway, API, backup, and AI/MCP exposure unless a surface is proven loopback-only.

8. **Example secrets still matter.** Gitleaks findings in docs may be harmless examples, but a high-trust project should intentionally mark examples as non-secrets, avoid realistic tokens where possible, and keep the scanner baseline reviewed.

## Prioritized Action Items

### P0: Release-Blocking Fund-Safety Gates

1. **Promote physical hardware signing fixtures to a release gate.** Complete the Ledger, Trezor, and BitBox rows in `docs/reference/hardware-wallet-validation.md`, commit sanitized signed PSBT/raw transaction fixtures, and require `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` for releases that claim hardware signing support.

2. **Codify a broadcast safety invariant.** Add or preserve one release-blocking test suite that proves every broadcast path derives policy inputs from decoded PSBT/raw transaction data, rejects mismatched caller metadata, checks wallet-owned inputs/change, checks network/script family, bounds fee/dust behavior, writes audit records from canonical data, and runs node policy preflight before propagation.

3. **Make release artifact verification mandatory.** For every release artifact and container image, publish checksums, signatures or Sigstore/cosign attestations, SBOMs, provenance, and operator verification instructions. Release creation should fail when signing/provenance material is absent.

4. **Keep security gates blocking and expand by stack.** Sanctuary already has npm audit, gitleaks, Semgrep, actionlint, lizard, jscpd, and large-file gates. If Python, Go, Rust, or other stacks enter production, add equivalent dependency, SAST, secret, and complexity gates before the code ships.

### P1: Hardening Work That Should Follow

1. **Add fund-safety property and mutation tests.** Cover wrong-network recipients, mixed-script policies, missing/tampered change metadata, mismatched output metadata, selected UTXO ownership, excessive fee rate, dust outputs, RBF replacement/cancel behavior, below-quorum multisig, and hardware-signer mismatch cases.

2. **Require typed fail-closed errors in funds paths.** Ban broad `catch`/`except` in transaction creation, PSBT parsing, signing, finalization, and broadcast unless the handler maps to a typed user-visible failure and a test proves no unsafe continuation.

3. **Keep imports schema-first and domain-second.** Validate request shape with schemas, then validate descriptor/xpub/key origin/network/script rules with domain parsers. Do not let free-form UI parsing become the source of truth.

4. **Document an explicit wallet threat model.** Include irreversible transaction risks, compromised browser risks, malicious backend/API client risks, hardware display mismatch risks, supply-chain risks, backup/restore risks, and AI/MCP non-authority boundaries.

5. **Add reproducible release drills.** Before each release candidate, have a clean machine verify artifacts, start the app, restore a representative backup, import fixture descriptors, build/sign/finalize a regtest PSBT, and prove `testmempoolaccept`.

### P2: Maturity Improvements

1. **Maintain a "what we refuse to do" list.** Examples: no hot-wallet private key custody by default, no unauthenticated production mode, no default credentials, no blind raw broadcast, no AI-initiated transaction signing, no unsigned release artifacts.

2. **Track complexity budgets for safety modules separately.** Keep the global lizard gate, but also create a named safety-module subset for transaction, PSBT, descriptor, hardware-wallet, auth, backup, and release scripts with a stricter zero-regression policy.

3. **Run periodic external benchmark reviews.** Re-run this comparison against Specter, Sparrow, Electrum, Bitcoin Core GUI/HWI, and other relevant projects before major wallet releases. Record gaps as release-blocking, release-target, or backlog.

4. **Prepare for external review.** Once P0/P1 gates are green, package the threat model, test evidence, release verification, and hardware artifact matrix for an independent security review or bug bounty.

## What Not To Copy From Specter

- Do not adopt a monolithic MVC route-handler style for fund movement.
- Do not put high-complexity descriptor, wallet, signing, or auth decisions in single large functions.
- Do not allow broad exception handlers to continue with partial transaction knowledge.
- Do not expose auth-none/default-admin behavior outside a deliberate local development mode.
- Do not rely on docs examples that trip secret scanners without an explicit reviewed allowlist.
- Do not make artifact signing conditional for releases.
- Do not let UI form data become authoritative for irreversible broadcast decisions.

## Verification Notes

Commands and checks run for this assessment:

- `git clone --depth=1 https://github.com/cryptoadvance/specter-desktop.git /tmp/specter-desktop`
- `git -C /tmp/specter-desktop rev-parse --short HEAD` -> `9e43afb`
- Source inspection with `rg`, `sed`, and `nl` across Specter README, docs, workflows, PSBT creation, broadcast, auth, user, key, and descriptor code.
- `lizard -l python /tmp/specter-desktop/src/cryptoadvance/specter /tmp/specter-desktop/tests` -> 38 warnings, average CCN 2.9, 2,198 functions.
- `npm audit --audit-level=high --omit=dev --json` in `/tmp/specter-desktop` -> 1 high and 1 moderate production npm advisory at assessment time.
- `gitleaks detect --source /tmp/specter-desktop --no-git --redact --report-format json --report-path /tmp/specter-gitleaks.json` -> 17 findings, mostly docs/examples or vendored source-map material requiring triage.
- Sanctuary evidence inspection across `docs/reference/frontend-architecture.md`, `docs/reference/release-gates.md`, `docs/reference/hardware-wallet-validation.md`, `.github/workflows/quality.yml`, package scripts, and the current health assessment.
- `CI=true GRADE_TIMEOUT=180 bash /home/nekoguntai/.codex/skills/grade/grade.sh` was started in the sandbox and hit environmental `spawnSync ... EPERM` and DNS failures; it was rerun outside the sandbox for a useful local verification signal.
- Elevated Sanctuary grade run result: root Vitest passed 6,063/6,063 tests; aggregate coverage was 99.98% lines/statements/functions and 99.95% branches, below the strict 100% coverage threshold; high-severity npm audit signal was 0; gitleaks found 0 tracked-tree secrets; lizard reported 2 warnings (`tests/components/send/SendTransactionPage.test.tsx` CCN 16 and `components/send/steps/OutputsStep/sections/RecipientsSection.tsx` CCN 17).

Specter's full pytest/Cypress suite was not run locally because it requires heavier Python, `bitcoind`, `elementsd`, and Cypress setup. This report uses source/workflow inspection plus lightweight static/security checks, not a full Specter CI reproduction.
