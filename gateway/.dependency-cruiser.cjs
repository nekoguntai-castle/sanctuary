/**
 * dependency-cruiser config — gateway package.
 *
 * Used by `npm run arch:graphs` to regenerate the Mermaid module graph at
 * `docs/architecture/generated/gateway.mmd`. CI fails the PR if the regenerated
 * file differs from what is committed.
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
      ],
    },
    includeOnly: '^src/',
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
