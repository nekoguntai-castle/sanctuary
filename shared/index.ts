// Sparse barrel for the `.` exports root entry — consumers should prefer
// subpath imports (e.g. `@sanctuary/shared/utils/errors`) for tree-shaking.
// Re-exports here exist so that `import x from '@sanctuary/shared'` resolves
// without ERR_PACKAGE_PATH_NOT_EXPORTED at runtime.

export * from './utils/errors';
