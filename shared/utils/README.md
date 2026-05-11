# shared/utils

Cross-package runtime utilities consumed by the **server**, **gateway**, and
**frontend** packages via the `@sanctuary/shared` npm workspace package.
The **ai-proxy** package is intentionally isolated from `shared/` and does
not consume this directory — see _Isolation boundary_ below.

## Convention: import via `@sanctuary/shared/...`

Files here are imported by consumers using the workspace specifier
`@sanctuary/shared/utils/<name>`. The previous per-package re-export shim
convention (`<package>/src/utils/<name>.ts` containing
`export * from '../../../shared/utils/<name>';`) was retired by Phase D
of the workspace migration; cross-package shared imports now go through
the workspace package directly.

Verify with:

```sh
# 0 hits expected — relative-path or @shared aliases must not appear
grep -rn "from ['\"]\.\./.*shared/" server/src gateway/src
grep -rn "from ['\"]@shared/" --include='*.ts' --include='*.tsx' .
```

The ESLint rule `no-restricted-imports` (Phase F) enforces this in CI:
relative-path `../shared/**` patterns are banned in production source so
contributors cannot accidentally re-introduce the legacy convention.
A small handful of legacy re-export shims (`server/src/utils/fatalProcessHandlers.ts`,
`server/src/utils/processExit.ts`, and the gateway equivalents) remain
purely for backward compatibility with intra-package imports; new shared
utilities should NOT add new shims.

## Isolation boundary: ai-proxy

`ai-proxy/tsconfig.json` sets `rootDir: "./src"` and
`include: ["src/**/*"]`; `ai-proxy/Dockerfile` does NOT `COPY ../shared`
(compare server/gateway Dockerfiles which build via the workspace);
`ai-proxy/src/utils.ts` documents the boundary inline.

This is a **security isolation boundary**, not an oversight. The AI proxy
process is the network-isolation enforcement point for outbound LLM traffic
and intentionally does not share runtime dependencies with the main app.

**Importing from `@sanctuary/shared` (or relative `../shared/...`) into
ai-proxy is a boundary-breaking architectural change requiring its own
decision, not a silent consolidation.** When ai-proxy needs the same
utility as server/gateway, it re-implements a standalone copy under
`ai-proxy/src/`.

Phase F enforcement:

- ESLint `no-restricted-imports` rule scoped to `ai-proxy/**/*.ts` bans
  both `@sanctuary/shared/**` and `../shared/**` patterns
- `scripts/ci/check-ai-proxy-shared-isolation.sh` belt-and-suspenders
  grep gate runs in CI even when ESLint is skipped
- The Per-tool resolution table in the v3.1 plan specifies a Docker
  acceptance probe: `docker exec ai-proxy node -e "require('@sanctuary/shared/...')"`
  MUST exit non-zero

## Status of cross-package utilities

Audit performed 2026-05-10 across `server/src/utils/`, `gateway/src/utils/`,
and `ai-proxy/src/`:

| Utility | Status | Notes |
| --- | --- | --- |
| `errors.ts` (`extractErrorMessage`, `getErrorMessage`, `isAbortError`, `isNetworkError`, `isTimeoutError`) | **Consolidated** | Imported via `@sanctuary/shared/utils/errors`. ai-proxy keeps its own `extractErrorMessage` in `ai-proxy/src/utils.ts`. |
| `fatalProcessHandlers.ts` | **Consolidated** | Lives at `shared/utils/fatalProcessHandlers.ts`; consumed via `@sanctuary/shared/utils/fatalProcessHandlers`. ai-proxy keeps its own copy per the isolation boundary. |
| `logger.ts` | **Intentional divergence** | server (~390 LOC) is the rich production logger with redaction and request context; gateway (~55 LOC) is a minimal proxy logger; ai-proxy (~99 LOC) is the isolated copy. All three implement the shared `Logger` interface from `shared/types/logger.ts`. |
| `processExit.ts` | **Consolidated** | Lives at `shared/utils/processExit.ts`; consumed via `@sanctuary/shared/utils/processExit`. ai-proxy keeps its own copy per the isolation boundary. |

## Adding a new shared utility

1. Place the implementation at `shared/utils/<name>.ts`. Use single-quote
   string style and keep dependencies inside `shared/`. External deps
   must be declared in `shared/package.json` `dependencies` (CI gate
   `scripts/quality/check-shared-deps.mjs` enforces this).
2. Import from consumers as `@sanctuary/shared/utils/<name>` — no shims
   needed.
3. Decide explicitly whether ai-proxy should consume the new utility. Default
   answer is **no** — re-implement under `ai-proxy/src/` instead. Importing
   `@sanctuary/shared` into ai-proxy requires editing the ESLint scope, the
   `check-ai-proxy-shared-isolation.sh` allowlist, `ai-proxy/Dockerfile`,
   and updating the `ai-proxy/src/utils.ts` boundary comment.
4. Add tests under `tests/shared/<name>.test.ts` (flat layout — match the
   existing `tests/shared/errors.test.ts`, `tests/shared/redact.test.ts`
   siblings).
5. Run `cd shared && npm run build` (or just `npm install` at root, which
   triggers shared's `prepare` script automatically) so consumers can
   resolve the new export at runtime.
