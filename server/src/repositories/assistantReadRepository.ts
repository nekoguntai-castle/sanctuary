/**
 * Assistant Read Repository
 *
 * Compatibility entrypoint for read-only AI-facing repository helpers. The
 * implementation is split by read domain under `assistantRead/` so future MCP
 * and Console parity batches can extend the surface without growing a monolith.
 */

export * from './assistantRead';
export {
  assistantReadRepository,
  assistantReadRepository as default,
} from './assistantRead';
