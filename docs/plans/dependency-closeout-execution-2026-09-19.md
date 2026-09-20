# Dependency closeout execution evidence

Implementation branch: `codex/dependency-closeout`; [Sanctuary PR #1247](http://10.14.23.20:3000/nekoguntai-castle/sanctuary/pulls/1247).
The [reviewed plan](open-issue-dependency-closeout-2026-09-19.md) and [disposition ledger](open-issue-dependency-closeout-2026-09-19-ledger.csv) define the scope. This report records completed local/isolated checks and the gates required before merge. The linked PR is the authoritative record of final CI results, reviewed head and merge commit; post-merge monitor/Renovate run links are recorded there.

## Baseline refresh

The initial main commit was `9c81f62fe9372c226740e8dfb10e947524a87c89`, with three open issues and no open PRs. The [fresh light monitor run 250](http://10.14.23.20:3000/nekoguntai-castle/security-monitoring-infra/actions/runs/250) completed against that exact commit. It reports 98 active findings: 0 critical, 30 high, 45 medium, 17 low and 6 unknown. Its 23 secret candidates overlap those severity counts; 17 suppressed findings are separate. This supersedes the older 96-finding report analyzed during planning.

The refreshed OSV results confirm removal of the old qs, esbuild, Pygments and Valibot findings. Remaining dependency paths include elliptic, optional gaxios/uuid and the Go SSH/openpgp advisories. The Go batch clears the two fixed SSH advisories. OpenPGP remains reported because the module contains it, but both OSV call analysis and `go list -deps` show the verifier does not use it; see [Go evidence](go-security-upgrade-2026-09-19.md).

## Implemented and tested batches

- Routine maintenance updates compression, Hono, nanoid, Valibot and YAML; aligns already-resolved Stryker, APNs, tsx and type declaration floors. Gateway build and all 571 tests passed. The npm audit gate passed all eight targets with zero exceptions. Supply-chain, install-script and npm-ci callsite policies passed.
- Documentation updates webpack, serialize-javascript, colord, Joi, uuid and TypeScript, with Docusaurus/MDX/clsx floor alignment. Strict clean install, typecheck, production build, full peer validation and a zero-vulnerability audit passed. Chrome rendered four architecture routes and five Mermaid SVGs without JavaScript errors. The new webpack minimizer is pinned to mature 5.10.1 because 5.11.0 was published on the execution date.
- `vite-plugin-node-polyfills` 0.28 returns multiple plugins; the wrapper preserves them and removes only the deprecated top-level esbuild option. Vitest retains native Node globals rather than injecting browser process/Buffer shims into filesystem and cryptographic test helpers. Linux build and typecheck passed. The full test run found two version assertions (Hono lock resolution and YAML expectation); those were corrected and the 76 focused tests passed. A later combined Linux run passed all 648 files and 8,705 tests, all-project frontend typechecks and production build under Node 24.21.0/npm 11.19.1. Server test typecheck and production build also passed.
- Lizard 1.24.0 is pinned in both requirements and the bootstrap cache version. The existing complexity gate passed on Linux without raising the warning baseline.
- The deprecated metrics client was replaced with `@prometheus-io/client` 0.16.1. The server build and 52 metrics/MCP/middleware tests passed after integration. All 78 existing metric definitions and existing sample series/buckets retain their names, labels, types and content type; two default event-loop utilization metric families are added. The actual candidate HTTP handler was scraped by pinned Prometheus, the unchanged production wallet-sync rule fired, and pinned Alertmanager received the alert. All 17 production rules pass promtool. The isolated stack was coordinator-cleaned; see [metrics evidence](metrics-client-upgrade-2026-09-19.md).
- The coordinated Go 1.27.1 / x/crypto 0.56 batch rebuilt and published a real runner image, verified its registry digest by pulling it back, and generated then independently verified all 480 address vectors without changing derived address data. See the dedicated Go evidence report.
- Node 24.21.0 and npm 11.19.1 were coordinated across runtime pins, tooling checksums, workflow consumers and the new runner image. Repeatable vector generation/verification passed again; see [runtime evidence](runtime-maintenance-2026-09-19.md).

- Prisma CLI/client/adapter-pg 7.10 passed fresh offline migration, repeated deployment, a real main-branch Prisma 7.8 retained-data dump/restore upgrade, and invalid-migration startup blocking. Application images exclude the migration CLI. See [Prisma evidence](prisma-upgrade-2026-09-19.md).
- btcec 2.5 and btcutil 1.2 compile with btcd 0.25; final generation and independent verification reproduce all 480 addresses unchanged. The address verifier also updates tsx/Valibot and aligns TypeScript 6.0.3. See [verifier evidence](verifier-maintenance-2026-09-19.md).
- Documentation now declares the same supported Node 24 line as the root; the final nanoid update and engine policy passed a clean install, typecheck and production build. The final eight-target npm audit gate passes with no exceptions.

- Bitcoin Core 29.4 passes the complete 480-case address corpus and all 5 unsigned / 6 signed PSBT vectors without derived payload changes. Shared image, workflow and proof manifests are coordinated; see [Core evidence](bitcoin-core-verifier-2026-09-19.md).
- cbor-x 1.6.6, Ledger WebUSB 6.35 and Keystone registry 0.8 have coordinated integrity/compatibility updates. The helper passed 18 Linux regressions, 104 configuration tests passed, and the combined UR suite passed 78 assertions. Eight live Ledger emulator tests passed. Jade readiness and canonical CI receipts remain final gates; see [signing evidence](signing-upgrade-evidence-2026-09-19.md).

## Compatibility and release-age holds

- `@grpc/grpc-js` 1.14.5 and ESLint 10.11.0 were published September 17 and September 18 respectively and have not completed the three-day release age at execution. Retain current pins until eligible.
- Node/nginx/PostgreSQL 16/Redis 7/Debian candidate image digests were published September 18–19 and are also on cooldown. Exact digest/timestamp evidence is in the runtime report. This is consistent with their pending dashboard category; it is not proof of every Renovate branch's status context.
- Mermaid layout 0.2.3 conflicts with Docusaurus theme-mermaid 3.10.2's optional peer range `^0.1.9`. Retain 0.1.9 until a compatible Docusaurus peer graph is available.
- Vite React plugin 6.1.1 fails npm's normal resolver on both npm 11.19.0 and 11.19.1: its optional Rolldown/Babel graph selects Babel runtime transform 8.0.6 against the existing Babel 7 graph. Retain the existing plugin until that graph can be upgraded coherently; do not force or ignore peer dependencies.
- The remaining root uuid 9.0.1 comes through optional `@google-cloud/storage` 8.2.0 → gaxios 6.7.1. Live publisher metadata shows storage 8.2.0 and firebase-admin 14.4.0 are already latest, and storage still declares gaxios `^6.0.2`. The docs uuid 14 update does not fix this path. A cross-major transitive override is not an established compatibility fix.
- Trezor connect/connect-web 9.7.3 and utxo-lib 2.5.0 remain latest and retain tiny-secp256k1 v1/elliptic 6.6.1. #537 remains upstream-blocked. No signing dependency override or audit exception hides this finding.
- Dedicated read-only Nexus and GitHub lookup credentials remain absent from the monitoring automation. The publishing credential used for the reviewed runner image is not installed into Renovate. Independent repository work continued while this external provisioning remains blocked.

## Security triage

The 23 new gitleaks candidates were inspected without copying their values into this report: two Jade source/protocol hash declarations; sixteen canonical BIP32 invalid serialized-key vectors; two local operations-proof constants; two generated deterministic regtest PSBT vector fields; and one fixed browser-test encryption fixture. Their exact locations and provenance were independently checked for 23 narrow, expiring fingerprint suppressions in [monitoring PR #28](http://10.14.23.20:3000/nekoguntai-castle/security-monitoring-infra/pulls/28). A test-directory-wide allowlist is not appropriate.

The high Semgrep websocket findings refer to documentation/comments, an internal Docker gateway URL with edge TLS, and a local performance-proof URL. The child-process finding is the local Bitcoin Core regtest vector generator. These match the historical issue triage; they do not justify claiming a production exploit from the scanner label alone.

Production sinks were inspected directly:

- The webhook mapping/signing findings point at reads along event paths, not assignments to prototypes. Preference paths reject `__proto__`, `prototype` and `constructor` before traversal.
- Backup paths combine the configured backup directory with names returned by `readdir`; the collector reads file metadata, not backup contents. It has no user-supplied path segment.
- Wallet export writes a registered format under its declared MIME type and an attachment disposition. The scanner's HTML-response warning does not establish an HTML rendering sink.
- Cache patterns escape regex metacharacters and introduce only wildcard matching. Gateway proxy patterns derive from the static route whitelist. Any future exposure of arbitrary pattern structure needs fresh analysis.
- The two Renovate release-age warnings overlook the global three-day setting. Monitor changes should correct report quality without weakening that policy.

Other tooling-only regex/formatting and transport findings remain visible for their specific owner to review; this report does not broadly suppress them or claim they are all remediated. Exact duplicate report entries and `moderate` severity normalization were merged with the narrow host rules and fingerprint triage in monitoring PR #28, commit `58c645a0a7fdc37751fa6a0eef41d21b1b57ca73`. Its required CI passed. A real Renovate dry run confirms internal-host warnings are gone; missing Nexus authentication and GitHub rate limiting remain visible. The five-repository run was still running at this checkpoint.

## Independent review and release-age verification

The fresh independent implementation review through `581a5b22` reported no major findings, including the repaired path-aware/snapshot-specific helper. The reviewer independently reran all 18 helper regressions. Final coupled Core/PSBT and Keystone changes receive a final delta review before merge. Publisher metadata confirmed all 85 newly resolved npm package/version pairs at that checkpoint were at least three days old; Keystone 0.8.0 was subsequently confirmed published June 4. Lint and the peer-resolution guard pass. Final Core integration found stale workflow and synthetic-test version expectations; they were corrected without altering recorded signed artifacts. The address/PSBT replay run passed 1,189 assertions before the synthetic metadata correction, and the corrected hardware/evidence suites then passed all 87 assertions.

## Completion gates

All 85 captured entries have an explicit disposition: 30 implemented/verified entries, 10 already-resolved or floor-only no-ops, and 45 compatibility, release-age, credential/evidence or separately scheduled migration holds. “Verified” records the entry-level evidence and does not replace its listed final merge gate. Before merge, the canonical Jade proof and every required branch-protection check must pass on the final integrated head, and the final delta review must have no unresolved major findings. Do not override protected checks.

After merge: verify the merged main SHA, run the final monitor/Renovate reconciliation, and remove only this task's branches, worktrees and owned temporary resources. Keep the rolling dashboards and unresolved upstream tracker open. Stateful major migrations stay separately scheduled under the plan with retained-data/restore proofs; they are not counted as completed upgrades.
