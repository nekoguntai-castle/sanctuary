# Dependency Dashboard #721: next upgrade batch

The dashboard remains active. Upgrade compatible dependencies, including majors; retain a version only for a demonstrated compatibility, support-lifecycle, release-age, or deployment constraint. This follows the user's explicit preference to reduce dependency debt. The starting dashboard snapshot after PR #1247 contains 56 entries (37 rate-limited, 18 pending, one open update PR).

## Execution plan

1. Upgrade the Node/npm/TypeScript tooling and migrate affected source/configuration. Keep Node 24 LTS while updating npm to 12 and the native TypeScript compiler to 7; retain Microsoft's TypeScript 6 compatibility API alongside the native CLI for tools that consume it.
2. Upgrade runtime and docs consumers, then check their actual behavior, strict peer installation, typechecking, builds, lint and tests. Cross-major overrides require caller validation.
3. Upgrade independent Bitcoin verifiers and signing dependencies. Regenerate actual Core-backed proofs; compare data and verify fresh-chain repeatability. Never hand-edit provenance hashes.
4. Prove retained-data upgrades in isolated services before changing stateful defaults. Queue format changes require a supported, restart-safe migration and a controlled deployment transition.
5. Have a fresh agent review the combined changes and evidence; address major findings and repeat review. Run protected CI, merge normally, rerun real Renovate, reconcile superseded update PRs, and clean only task-owned resources.

## Implemented or in active verification

| Dashboard entries | Candidate change / required evidence |
| --- | --- |
| esbuild; React minor; Node types; React Vite plugin; dependency-cruiser; jest-dom; jsdom | esbuild 0.28.2, React 19.3, Node types 24.13.5, plugin 6.1.1, dependency-cruiser 18, jest-dom 7, jsdom 30; clean Linux install, native typecheck, build, lint and component tests |
| npm; TypeScript; Stryker | npm 12.0.2; native TS 7.0.2 plus official compatibility API; Stryker 10; toolchain policy and mutation gates |
| cookie; proxy middleware; Nodemailer; open PR #1248 | cookie 2, http-proxy-middleware 4, Nodemailer 10 and types 8.0.2; cookie authentication, proxy and email tests |
| docs React 19; webpack; Joi; SVGO; nanoid | React 19, webpack 5.111.0, Joi 18, SVGO 4, nanoid 6; actual consumer regressions, docs build and browser hydration |
| Go directive; btcd; btcutil; Core | Go 1.27.1, split btcsuite v2 modules, Core 31.1; 480 addresses, five unsigned and six signed PSBT cases, real acceptance and repeatability |
| Hono node-server; TOML; Undici; root nanoid; Pygments | Implemented; PostCSS, Stellar TOML, Hono/MCP and Linux build/typechecking verified |
| bitcoinerlab secp256k1; bs58check | Implemented; signing, descriptor and remediation checks pass. Fresh Core 31 generation using secp256k1 2 passes all 67 replay checks with unchanged PSBT bytes. |
| Grafana | 13.2.2 accepted after isolated Grafana 10→13 upgrade, migration CLI, retained dashboard, actual repository provisioning and byte-identical backup restoration to Grafana 10. |
| protobufjs | 8.8.0; actual Trezor malformed/round-trip, gRPC int64/enums/maps/bytes, and Firestore Document binary serialization validated. Linux gateway, build and typechecking pass. |
| lock maintenance | npm-generated lockfiles; audit changed package publication times and script/override policies; no manual lock edits |

These are candidate changes, not a claim that the dashboard entries have disappeared. Only the post-merge Renovate run determines the remaining count.

## Demonstrated holds and follow-up work

| Entry | Evidence / release condition |
| --- | --- |
| Vitest 5 | Stryker 10's test-name collection joins suite segments with spaces, while Vitest 5 matches `testNamePattern` against ` > `-joined names. Real wallet-policy runs with Vitest 5.0.1 produced 0 killed / 225 survived / 1 uncovered; both `perTest` and `all` modes failed the unchanged 85% threshold. With Vitest 4.1.11 and Stryker 10, the same 226 mutants produced 204 killed / 21 survived / 1 uncovered, score 90.27%, passing. Keep 4.1.11 until the runner supports Vitest 5; do not weaken the gate or carry an unmaintained dependency patch. |
| js-yaml 5 | Actual gray-matter consumer changes YAML merge-key semantics and throws on empty documents. Upgrade 3 to compatible 4 now; move to 5 after the consumer adapts. |
| Mermaid layout 0.2 / 1 | Docusaurus 3.10.2 requires layout ^0.1.9; layout 1 additionally requires Mermaid 12 while this supported Docusaurus stack uses 11. Upgrade the owning stack when compatible. |
| Node 26 | Node 24 is Active LTS; Node 26 is still Current until its scheduled October LTS transition. Keep a consistent supported LTS runtime across application, builders and verifiers. |
| BullMQ 6 / ioredis 6 | Legacy repeatable jobs need conversion through BullMQ 5 APIs before BullMQ 6 removes them. An isolated staged transition was explored, but the proposed helper has not yet passed primary review for interruption recovery and operational invocation. Do not ship an uninvoked helper or silently lose existing schedules. |

| PostgreSQL 18 / Redis 8 | Stateful defaults need retained-data migration and restore proof before users with existing volumes receive the new major. Latest proposed image digests are also below the three-day age threshold. |
| Ubuntu 26 | Renovate detects workflow runner labels, but the actual host is Debian 13 and the configured ubuntu labels select a pinned container. No Ubuntu 26 runner label exists; renaming it would strand jobs rather than upgrade an OS. |
| pending digest / package releases | Preserve the repository's three-day release-age policy. Recheck eligible dates on the next Renovate run; never force an immature release simply to clear the dashboard. |
| private-image lookups / GitHub rate limit | Renovate lacks dedicated registry and GitHub lookup credentials. Do not reuse signing or publishing credentials for monitoring. Credential provisioning is an external configuration follow-up. |

## Verification record

Initial combined Linux checks passed strict peer installation, frontend production build, all lint checks, all 571 gateway tests, frontend native typechecking and full backend test typechecking. The Vitest 5 exploratory frontend run passed 8,704 tests with the sole remaining failure requiring the planned address provenance regeneration. The backend exploratory run exposed a real source-provenance resolver gap for Prisma's emitted `.js` specifiers after Node-style module resolution; the fix preserves generated source binding and its focused 89-test validation passed.

The first combined publication audit checked 235 changed package versions against npm timestamps and found none younger than three days. Re-audit final lockfiles after integrating the remaining implementations. Final full checks and protected CI remain required; exploratory runs do not substitute for final-head evidence.


Primary integration checks subsequently passed all 16,371 backend tests with literal 100% lines, statements, functions and branches (database-dependent cases remain in their separate CI lane). Wallet-policy mutation scored 90.27%; browser PSBT account-binding mutation scored 89.18%, both above the unchanged 85% thresholds. Primary reran docs strict npm 12 installation, native TypeScript check, compatibility tests and production build successfully.

Fresh independent review found a missing update to the second tracked address output. Both outputs were corrected from the actual generated proof artifact, are byte-identical, and their material-input hash is `96eb97deec4e0ddd57179d64d3b2e0d66ed5c09202c48bbae0b61c679bf98925`. The reviewer confirmed the fix and found no remaining major issues, including the subsequent protobuf and Grafana changes. Final-head frontend checks and protected CI are still pending.

Grafana rollback evidence uses an isolated database backup, not a claim about live production: backup archive SHA-256 `e285822b94ac1ed4d6502827978410eee1499549e1284e68fdd18a9efe1f8515`; original and restored database SHA-256 `c71e276291948f0c83aefa45e17e711295b2c93e30c9039c166c7baaf84dd03f`. Grafana 13.2.2 and restored 10.4.19 both return the seeded retained dashboard. The actual 15-panel Sanctuary Overview dashboard and Prometheus datasource provisioned under 13.2.2. Continue to use the deployment backup/quiescence guards; downgrading the migrated database without restoring its backup is not supported.

CI follow-up corrected the Go runner pin to the registry manifest rather than Podman’s local uncompressed manifest. The actual failing runner pulled and ran the corrected digest with Node 24.21.0, npm 12.0.2 and Go 1.27.1; a fresh 480-case address generation changed provenance only. The exact-Go helper now accepts the canonical go-only module directive, with 13 regression checks. The architecture resolver handles emitted relative JavaScript extensions while retaining target/symbol checks, and Linux graph regeneration produces no unexpected changes. npm-generated descriptors 3.2.0 / descriptors-core 3.2.0 / varuint-bitcoin 2.0.1 resolve the crypto peer conflict without suppression; all three releases meet the age cutoff. Final protected CI remains required.

The final lockfile age audit checked 241 changed package versions against the conservative 2026-09-17 06:00 UTC cutoff; all were eligible. After the peer correction, primary Linux checks passed clean npm 12 installation, the peer guard, all 100 focused Ledger/hardware-report tests, and the release-distribution suite. Fresh Core 31 verification on the corrected root lock passed all 11 PSBT vectors and 67 replay checks with unchanged fixtures and lockfiles. Workflow composition passed 718 checks.

The installation and wallet-sync runtime failures exposed Prisma inferring ESM initialization under the new TypeScript module setting while the server emits CommonJS. The generator now explicitly selects `cjs`; the production image build natively loads the emitted client and checks its export. Primary Linux verification passed the server build, plain Node client load, three guard regressions, and 32 provenance/hardware-report tests. The compiled application proceeds through service initialization to the deliberately unavailable isolated Redis endpoint without the previous module-loading error. Full installation/replay CI must still pass before merge.
