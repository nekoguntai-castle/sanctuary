# shared/utils

Cross-package runtime utilities consumed by the **server** and **gateway**
packages. The **ai-proxy** package is intentionally isolated from `shared/`
and does not consume this directory — see _Isolation boundary_ below.

## Convention: per-package re-export shims

Files here are imported by server/gateway through thin re-export shims at
`<package>/src/utils/<name>.ts`, not by direct relative imports from runtime
call sites. Verify with `grep -rn "from ['\"]\.\./\.\./shared" server/src
gateway/src` — direct cross-package imports return zero hits.

The pattern: a shim at `server/src/utils/foo.ts` containing only
`export * from '../../../shared/utils/foo';` lets every server runtime call
site keep importing from `./utils/foo`. The same shim exists at
`gateway/src/utils/foo.ts` for gateway. Both shim files are listed in their
package's `vitest.config.ts` `coverage.exclude` block alongside other
re-export shims (e.g. `src/services/aiService.ts`, `src/services/eventService.ts`).

This convention insulates entry-points from path churn, lets each package
control which shared utilities it adopts, and keeps coverage gates accurate
(shims add no logic, so they are not counted toward coverage).

## Isolation boundary: ai-proxy

`ai-proxy/tsconfig.json` sets `rootDir: "./src"` and `include: ["src/**/*"]`;
`ai-proxy/Dockerfile` does NOT `COPY ../shared` (compare server/gateway
Dockerfiles which do); `ai-proxy/src/utils.ts` documents the boundary inline.

This is a **security isolation boundary**, not an oversight. The AI proxy
process is the network-isolation enforcement point for outbound LLM traffic
and intentionally does not share runtime dependencies with the main app.

**Importing from `shared/` into ai-proxy is a boundary-breaking architectural
change requiring its own decision, not a silent consolidation.** When ai-proxy
needs the same utility as server/gateway, it re-implements a standalone copy
under `ai-proxy/src/`. Maintain the divergence intentionally.

The ESLint rule banning local re-definitions of `getErrorMessage` /
`extractErrorMessage` exempts both `shared/utils/errors.ts` (the source of
truth) and `ai-proxy/src/utils.ts` (the intentional ai-proxy copy).

## Status of cross-package utilities

Audit performed 2026-05-10 across `server/src/utils/`, `gateway/src/utils/`,
and `ai-proxy/src/`:

| Utility | Status | Notes |
| --- | --- | --- |
| `errors.ts` (`extractErrorMessage`, `getErrorMessage`, `isAbortError`, `isNetworkError`, `isTimeoutError`) | **Consolidated** | Server re-exports from shared; gateway/frontend imports directly via the same shared path. ai-proxy isolates with its own `extractErrorMessage` in `ai-proxy/src/utils.ts`. |
| `fatalProcessHandlers.ts` | **Consolidated** | Lives at `shared/utils/fatalProcessHandlers.ts`; server and gateway use re-export shims. ai-proxy keeps `ai-proxy/src/fatalProcessHandlers.ts` per the isolation boundary. |
| `logger.ts` | **Intentional divergence** | server (~390 LOC) is the rich production logger with redaction and request context; gateway (~55 LOC) is a minimal proxy logger; ai-proxy (~99 LOC) is the isolated copy. All three implement the shared `Logger` interface from `shared/types/logger.ts`. |
| `processExit.ts` | **Consolidated** | Lives at `shared/utils/processExit.ts`; server and gateway use re-export shims. ai-proxy keeps its own copy per the isolation boundary. |

## Adding a new shared utility

1. Place the implementation at `shared/utils/<name>.ts`. Use single-quote
   string style and keep dependencies inside `shared/` (no Node-specific
   imports beyond `NodeJS.*` types).
2. Add a re-export shim at `server/src/utils/<name>.ts` and
   `gateway/src/utils/<name>.ts`, each containing only
   `export * from '../../../shared/utils/<name>';`.
3. Add both shim paths to `coverage.exclude` in `server/vitest.config.ts` and
   `gateway/vitest.config.ts` alongside the other re-export shim entries.
4. Decide explicitly whether ai-proxy should consume the new utility. Default
   answer is **no** — re-implement under `ai-proxy/src/` instead. Importing
   from `shared/` into ai-proxy requires editing `ai-proxy/tsconfig.json`,
   `ai-proxy/Dockerfile`, and updating the `ai-proxy/src/utils.ts` boundary
   comment.
5. Add tests under `tests/shared/<name>.test.ts` (flat layout, not under a
   nested `utils/` directory — match the existing `tests/shared/errors.test.ts`,
   `tests/shared/redact.test.ts` siblings).
