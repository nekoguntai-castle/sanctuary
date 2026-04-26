/**
 * dependency-cruiser config — frontend (monorepo root).
 *
 * The browser app lives at the monorepo root across multiple top-level dirs
 * (`components/`, `contexts/`, `hooks/`, `services/`, `src/`, `themes/`,
 * `utils/`). Per-package configs live under `server/.dependency-cruiser.cjs`
 * and `gateway/.dependency-cruiser.cjs`.
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
        '/ai-proxy/',
        '/scripts/',
        '/playwright-report/',
        '/test-results/',
      ],
    },
    includeOnly:
      '^(App\\.tsx|components/|contexts/|hooks/|services/|src/|themes/|utils/|shared/)',
    tsConfig: { fileName: 'tsconfig.app.json' },
  },
};
