# Sanctuary Release Gates

Date: 2026-04-11 (Pacific/Honolulu)
Status: Phase 4 release-gate baseline

This document records the checks that should protect the A-grade engineering goals in `docs/plans/codebase-health-assessment.md`. A release should not claim an A grade in a domain unless the matching gate has passed or the plan explicitly marks the gate as pending with an owner and date.

## Policy

- Required gates block a release when they fail.
- Pending gates do not prove an A-grade claim yet. They are tracked here so skipped data-dependent work is visible instead of silently ignored.
- Area-specific gates are required when the release touches that area or when the release notes claim an improvement in that area.
- Accepted dependency findings must remain documented in `docs/DEPENDENCY_AUDIT_TRIAGE.md`; new high or critical production advisories require a fix or explicit risk acceptance before release.

## Required Gates

| Area | Gate | Evidence | Status |
| --- | --- | --- | --- |
| Frontend correctness | Strict app typecheck | `npm run typecheck:app` | Required |
| Frontend tests | Threshold-enforced coverage | `npm run test:coverage` or the `full-frontend-tests` CI job | Required for main/release |
| Backend build | TypeScript build and Prisma generation | `cd server && npm run build` | Required |
| Backend tests | Unit and integration coverage | `cd server && npm run test:unit -- --coverage` and `cd server && npm run test:integration`, or the `full-backend-tests` CI job | Required for main/release |
| Gateway build | TypeScript build | `cd gateway && npm run build` | Required |
| Gateway tests | Threshold-enforced coverage | `cd gateway && npm run test:coverage` or the `full-gateway-tests` CI job | Required for main/release |
| Critical security logic | Mutation gate for auth, access control, address derivation, and PSBT validation | `cd server && npm run test:mutation:critical:gate` or the `full-critical-mutation` CI job | Required when touched; required for main/nightly |
| API/gateway contracts | Contract and drift-prone boundary tests | Targeted tests for gateway HMAC, WebSocket auth, mobile permission, request logging, body parsing, gateway whitelist, and new/touched schemas | Required when touched |
| Dependency security | Production advisory review | `npm audit --omit=dev` in root and `server/`; `cd gateway && npm audit --omit=dev --omit=optional`; plus documented accepted findings | Required before release |
| Container/install validation | Fresh install, install script, container health, auth flow | `.github/workflows/install-test.yml` release gate | Required for release candidates/releases |
| Operations supportability | Runbook coverage and proof for backup/restore, gateway audit persistence, and monitoring stack behavior | `docs/OPERATIONS_RUNBOOKS.md` updated when alerts or operational flows change; `npm run test:ops:phase2` when backup/restore or in-process gateway audit paths are touched; `npm run ops:gateway-audit:phase2` when backend/gateway containers or gateway audit delivery paths are touched; `npm run ops:monitoring:phase2` when monitoring Compose, Prometheus/Loki/Grafana/Jaeger/Alertmanager, or Promtail paths are touched | Required when touched |
| Performance and scale | Phase 3 benchmark harness in strict mode | `SANCTUARY_BENCHMARK_STRICT=true npm run perf:phase3` with required scenario inputs | Pending operator evidence |

## Phase 3 Pending Evidence

These gates are required before the scalability/performance domain can move to A:

- Authenticated wallet list, large-wallet transaction history, and wallet sync queue benchmarks with `SANCTUARY_TOKEN` and `SANCTUARY_WALLET_ID`.
- Local auto-provisioned smoke runs with `SANCTUARY_BENCHMARK_PROVISION=true` are useful for endpoint coverage, but they do not replace representative large-wallet evidence.
- Backup validation, and restore only in a restore-safe environment, with `SANCTUARY_ADMIN_TOKEN`, `SANCTUARY_BACKUP_FILE`, and `SANCTUARY_ALLOW_RESTORE=true`.
- WebSocket fanout with real subscriptions/events.
- Worker queue processing under representative sync, notification, maintenance, autopilot, and intelligence jobs.
- Backend scale-out smoke test with at least two backend/WebSocket endpoints sharing Redis.
- Worker scale-out smoke test in non-production, or an explicit release note that production worker scale-out remains unsupported.

Record benchmark output under `docs/plans/` and link it from `docs/plans/codebase-health-assessment.md`.

## Non-Blocking Advisory

`npm run typecheck:tests` is useful, but it is not a release gate until the current unused-symbol test baseline is cleaned up. Do not add it to the required gate list without first making it pass consistently.
