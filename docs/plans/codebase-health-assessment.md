# Software Quality Report

Date: 2026-05-01
Owner: TBD
Status: Complete

**Overall Score**: 97/100
**Raw Domain Score**: 97/100
**Grade**: A
**Confidence**: High
**Mode**: software-grade-recovery
**Commit**: working-tree-after-ebcd6b89

The previous full-repository grade was capped at 69/D by two hard failures: `npm run typecheck:scripts` failed and the docs website lockfile had high-severity Docusaurus/webpack-chain advisories. Those hard caps are now removed. The remaining score loss is not from the deterministic wallet software tests; it is from the still-unfinished physical hardware-in-loop wallet evidence and known large test-file warnings that remain under the enforced limit. Follow-up splits reduced warning-sized test files from 10 to 4 without changing behavior.

Previous local report: 2026-05-01, `full`, 69/D at `e0fa1661`.

---

## Hard-Fail Blockers

None currently found in the software-only gates that were remediated.

Not hard-fail blockers: the docs website still has moderate `uuid` advisories through Docusaurus/Mermaid dev/build tooling with no non-breaking fix available from npm audit, and physical hardware-signed PSBT fixtures are still intentionally absent.

---

## Domain Scores

| Domain                |      Score | Notes                                                                                                                                                                                                                                                                                  |
| --------------------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correctness           |      18/20 | Full root/frontend/backend focused gates are green, script typecheck is fixed, and wallet software vectors are strong. The remaining loss is functional completeness: physical hardware validation is not complete.                                                                    |
| Reliability           |      15/15 | Request timeouts, async handlers, circuit breakers, retries/backoff, health checks, typed errors, and structured failure handling remain strong.                                                                                                                                       |
| Maintainability       |      14/15 | Lizard is green, and the previous PSBT, price-route, Trezor, Ledger, address repository, agent route, and admin agent route warning-sized test files were split along clean boundaries. Large-file policy passes, but there are still 4 warning-sized test files below the hard limit. |
| Security              |      15/15 | High/critical npm audit findings are cleared for the docs website, PSBT verifier, and other package scopes checked. Gitleaks was already clean in the previous full audit.                                                                                                             |
| Performance           |      10/10 | Sampled hot paths retain bounded async I/O, batching, concurrency limits, request timeouts, caching, and DB aggregation patterns.                                                                                                                                                      |
| Test Quality          |      15/15 | Frontend and backend strict coverage gates now pass at 100%; wallet address/PSBT software proofs are repeatable.                                                                                                                                                                       |
| Operational Readiness |      10/10 | Docker/Compose, GitHub Actions, health and metrics endpoints, OpenTelemetry/Prometheus hooks, structured logs, and config validation are present.                                                                                                                                      |
| **TOTAL**             | **97/100** | No software hard cap remains; hardware-in-loop evidence is the remaining wallet release-confidence gap.                                                                                                                                                                                |

---

## Trend

- vs 2026-05-01 (`e0fa1661`, mode `full`): overall `+28` after cap removal (`69 -> 97`), grade `D -> A`, confidence `High -> High`.
- The improvement came from fixing the PSBT script typecheck, clearing website high advisories, restoring strict frontend/backend coverage gates, making address verification repeatable, adding a PSBT verifier lockfile/audit path, and clearing lizard/large-file blockers.

---

## Evidence

### Mechanical

| Signal                                       | Value                                                                                                                                                           | Tool                                                                                                           | Scoring criterion                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| script typecheck                             | pass                                                                                                                                                            | `npm run typecheck:scripts`                                                                                    | Correctness 1.2                          |
| root test typecheck                          | pass                                                                                                                                                            | `npm run typecheck:tests`                                                                                      | Correctness 1.2                          |
| server test typecheck                        | pass                                                                                                                                                            | `npm --prefix server run typecheck:tests`                                                                      | Correctness 1.2                          |
| focused wallet tests                         | pass; 163 address tests plus 101 PSBT/repository tests in focused reruns                                                                                        | `npm --prefix server run test -- ...addressDerivation...`; `npm --prefix server run test -- ...psbtBuilder...` | Correctness/Test Quality context         |
| backend unit coverage                        | pass; 422 files / 9505 tests; 100% statements, branches, functions, lines                                                                                       | `npm --prefix server run test:unit -- --coverage`                                                              | Test Quality 6.1                         |
| frontend coverage shards                     | pass; shard 1: 220 files / 2960 tests; shard 2: 219 files / 2940 tests                                                                                          | `npm run test:coverage:shard -- 1 2`; `npm run test:coverage:shard -- 2 2`                                     | Test Quality 6.1                         |
| frontend coverage merge                      | pass; 439 files / 5900 tests; 100% statements, branches, functions, lines                                                                                       | `npm run test:coverage:merge -- .vitest-reports`                                                               | Test Quality 6.1                         |
| address cross-implementation verifier        | pass; 122 vectors, 0 disagreements; Bitcoin Core 27.0.0, bitcoinjs-lib 7.0.1, Caravan 0.4.5, Python `bip_utils` 2.12.1                                          | `npm --prefix scripts/verify-addresses run verify:repeatable`                                                  | Wallet correctness context               |
| PSBT verifier                                | pass; 5 generated Core-backed vectors and 4 Core-accepted signed vectors                                                                                        | `npm --prefix scripts/verify-psbt run verify`                                                                  | Wallet correctness context               |
| PSBT verifier audit                          | pass; 0 vulnerabilities                                                                                                                                         | `npm --prefix scripts/verify-psbt audit --audit-level=high`                                                    | Security supply-chain context            |
| docs website audit                           | pass at high threshold; 21 moderate advisories remain                                                                                                           | `npm --prefix website audit --audit-level=high`                                                                | Security 4.1                             |
| docs website install/build                   | pass                                                                                                                                                            | `npm --prefix website ci`; `npm --prefix website run typecheck`; `npm --prefix website run build`              | Build readiness context                  |
| lizard                                       | pass                                                                                                                                                            | `npm run quality:lizard`                                                                                       | Maintainability 3.1                      |
| large-file policy                            | pass; largest source 795 lines; largest test 984 lines; 4 warning-sized test files; 0 over-limit files                                                          | `node scripts/quality/check-large-files.mjs --json`                                                            | Maintainability 3.3                      |
| previous full audit signals still applicable | root tests/lint/builds, gitleaks, architecture boundaries, API validation, OpenAPI route coverage, browser auth contract were green in the baseline full report | prior 2026-05-01 grade evidence                                                                                | Operational/security/correctness context |

### Judged Findings

- **[1.5] Functional completeness - Medium -> +1**: deterministic wallet software proof is strong, but `server/tests/fixtures/hardware-signed-psbt-vectors.ts` still has no real Ledger/Trezor/BitBox signed artifact rows.
- **[3.3] Large-file hygiene - High but not perfect**: no file exceeds the 1000-line gate, but 4 test files remain in the warning band and should be split only when a real ownership boundary appears.
- **[4.1] Dependency security - High**: high/critical advisories are cleared. Remaining docs-site moderate advisories are in Docusaurus/Mermaid dev/build transitive dependencies and npm currently reports no non-breaking fix.
- **[6.3] Edge cases covered - High**: wallet tests cover receive/change, high index, descriptor routing, BIP vectors, PSBT finalization, signature corruption, below-quorum multisig, wrong metadata, tampering, network mismatch, and no-device hardware payload/address verification behavior.

### Missing Or Blocked

- Physical hardware-in-loop proof is not complete: `HARDWARE_SIGNED_PSBT_VECTORS` is empty, `UNSUPPORTED_HARDWARE_SIGNED_ROWS` is empty, and the 15-row Ledger/Trezor/BitBox matrix has not been captured.
- `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 npm --prefix server run test -- --run tests/unit/services/bitcoin/psbt.hardware-signed-vectors.test.ts` is intentionally not green until hardware fixtures or explicit unsupported decisions are committed.
- Website audit still reports moderate `uuid` findings through `mermaid`, `@mermaid-js/layout-elk`, `sockjs`, and `webpack-dev-server`; `npm audit --audit-level=high` passes.

---

## Top Risks

1. Hardware wallet confidence is not yet funds-loss-grade: the repo has the replay contract and runbook, but no real Ledger/Trezor/BitBox signed artifacts.
2. Docs-site moderate advisories remain in dev/build tooling. They no longer cap the grade, but should be tracked for future Docusaurus/Mermaid releases.
3. Four test files remain near the large-file warning threshold. They pass policy, but future additions should avoid pushing them over 1000 lines.

## Fastest Improvements

1. Capture hardware-signed fixtures or explicit unsupported decisions for all 15 required Ledger/Trezor/BitBox rows.
2. Re-run `npm --prefix website audit --audit-level=moderate` after future Docusaurus/Mermaid releases and remove the remaining moderate advisories when a compatible fix exists.
3. Split the remaining 4 warning-sized test files only when touching them for real behavior changes.

## Roadmap To A Grade

| Phase | Target             | Work                                                                                                                       | Exit Criteria                                                                                         | Expected Score Movement                                          |
| ----- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1     | Software hard caps | Fix script typecheck, website high advisories, coverage, lizard, large-file, repeatable vector gates.                      | Complete.                                                                                             | 69/D -> 97/A                                                     |
| 2     | Hardware evidence  | Capture Ledger/Trezor/BitBox address display and signed PSBT/raw transaction artifacts, or explicit unsupported decisions. | `REQUIRE_HARDWARE_SIGNED_FIXTURES=1 ...psbt.hardware-signed-vectors.test.ts` passes.                  | Wallet-specific release confidence; likely +2 correctness points |
| 3     | Dependency hygiene | Clear remaining website moderate advisories when upstream compatible releases exist.                                       | `npm --prefix website audit --audit-level=moderate` passes without forced downgrade/major workaround. | Risk reduction, likely no grade cap movement                     |

## Strengths To Preserve

- The wallet safety software suite is strong: BIP/address vectors, descriptor routing, receive/change checks, high-index coverage, signed PSBT replay, Core-backed PSBT vectors, and negative finalization cases.
- Strict frontend and backend coverage gates pass at 100%.
- Cross-implementation address verification is now repeatable from a single wrapper command.
- Runtime boundaries have validation, rate limits, auth, observability, health checks, structured logging, request IDs, and redaction.

## Work To Defer Or Avoid

- Do not use mainnet funds or production seed material for hardware validation.
- Do not force a Docusaurus/Mermaid downgrade solely to suppress moderate advisories if it breaks docs rendering or peer dependencies.
- Do not split cohesive production modules purely for line count; current source files pass policy.
- Do not count synthetic hardware replay fixtures as real hardware evidence.

## Verification Notes

- `npm run typecheck:scripts` - passed.
- `npm run typecheck:tests` - passed.
- `npm --prefix server run typecheck:tests` - passed.
- `npm --prefix scripts/verify-addresses run typecheck` - passed.
- `bash -n scripts/verify-addresses/verify-repeatable.sh` - passed.
- `npm --prefix scripts/verify-addresses run verify:repeatable` - passed with 122 vectors and 0 disagreements.
- `npm --prefix scripts/verify-psbt ci` - passed.
- `npm --prefix scripts/verify-psbt audit --audit-level=high` - passed, 0 vulnerabilities.
- `npm --prefix scripts/verify-psbt run verify` - passed after non-sandbox rerun due sandbox-only `tsx` IPC `EPERM`.
- `npm --prefix website ci` - passed.
- `npm --prefix website audit --audit-level=high` - passed; moderate findings remain.
- `npm --prefix website audit --audit-level=moderate` - failed as expected with 21 moderate `uuid` advisories through Docusaurus/Mermaid dev/build dependencies; current upstream package metadata still does not provide a compatible non-forced fix.
- `npm --prefix website run typecheck` - passed.
- `npm --prefix website run build` - passed; Docusaurus emitted a known update-check config-store warning after successful build.
- `npm run test:run -- tests/services/hardwareWallet.trezorAdapter.test.ts` - passed, 44 tests.
- `npm run test:run -- tests/services/hardwareWallet.trezorAdapter.test.ts tests/services/hardwareWallet.trezorAdapter.helpers.test.ts` - passed, 44 tests after splitting helper coverage into its own file.
- `npm run test:run -- tests/services/hardwareWallet.ledgerAdapter.test.ts tests/services/hardwareWallet.ledgerSignPsbt.test.ts` - passed, 23 tests after splitting direct Ledger signing-helper coverage into its own file.
- `npm --prefix server run test -- tests/unit/repositories/addressRepository.test.ts tests/unit/repositories/addressRepository.labels.test.ts` - passed, 37 tests after splitting address label-hydration coverage into its own file.
- `npm --prefix server run test -- tests/unit/api/agent-routes.test.ts tests/unit/api/agent-routes.funding.test.ts` - passed, 31 tests after splitting agent funding-draft route coverage into its own file.
- `npm --prefix server run test -- tests/unit/api/admin-agents-routes.test.ts tests/unit/api/admin-agents-routes.controls.test.ts` - passed, 18 tests after splitting admin owner override/API key route coverage into its own file.
- `npm --prefix server run test -- tests/unit/api/price.test.ts tests/unit/api/price.admin.test.ts tests/unit/api/price.history.test.ts` - passed, 63 tests after splitting public/admin/history price route coverage.
- `npm run test:coverage:shard -- 1 2` - passed, 220 files / 2960 tests.
- `npm run test:coverage:shard -- 2 2` - passed, 219 files / 2940 tests.
- `npm run test:coverage:merge -- .vitest-reports` - passed, 439 files / 5900 tests and 100% coverage.
- `npm --prefix server run test -- tests/unit/services/bitcoin/addressDerivation.verified.test.ts tests/unit/services/bitcoin/addressDerivation.branches.test.ts` - passed, 163 tests.
- `npm --prefix server run test -- tests/unit/repositories/addressRepository.test.ts tests/unit/services/bitcoin/psbtBuilder.test.ts tests/unit/services/bitcoin/psbtBuilder.finalization.test.ts tests/unit/services/bitcoin/psbtInputConstruction.branches.test.ts` - passed, 101 tests.
- `npm --prefix server run test:unit -- --coverage` - passed, 422 files / 9505 tests and 100% coverage.
- `npm run quality:lizard` - passed.
- `node scripts/quality/check-large-files.mjs --json` - passed.
