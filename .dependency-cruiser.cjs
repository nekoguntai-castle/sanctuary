/**
 * dependency-cruiser config — frontend (monorepo root).
 *
 * The browser app has one source root (`src/`). Per-package configs live under
 * `server/.dependency-cruiser.cjs` and `gateway/.dependency-cruiser.cjs`.
 *
 * Used by `npm run arch:graphs` to regenerate the Mermaid module graph at
 * `docs/architecture/generated/frontend.mmd`. CI fails the PR if the
 * regenerated file differs from what is committed.
 */
module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: [
        'node_modules',
        '\\.(test|spec)\\.(ts|tsx|js)$',
        '/tests/',
        '/__tests__/',
        '/dist/',
        '/coverage/',
        '/server/',
        '/gateway/',
        '/llm-egress-proxy/',
        '/scripts/',
        '/playwright-report/',
        '/test-results/',
      ],
    },
    includeOnly: '^(src/|shared/)',
    tsConfig: { fileName: 'tsconfig.app.json' },
  },
};
