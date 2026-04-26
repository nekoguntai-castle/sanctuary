/**
 * dependency-cruiser config — server package.
 *
 * Used by `npm run arch:graphs` to regenerate the Mermaid module graph at
 * `docs/architecture/generated/server.mmd`. CI fails the PR if the regenerated
 * file differs from what is committed.
 *
 * Architectural enforcement (forbidden/required imports) lives in
 * `scripts/check-architecture-boundaries.mjs`, not here. This config is for
 * graph generation only.
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
        '/generated/',
        'prisma/seed',
      ],
    },
    includeOnly: '^src/',
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      mainFields: ['main', 'types'],
    },
  },
};
