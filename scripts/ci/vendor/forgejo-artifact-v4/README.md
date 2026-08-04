# Forgejo artifact v4 Node 24 vendor pipeline

This pipeline rebuilds the exact Forgejo-patched v4 upload and download actions
used by Sanctuary, while retaining their proven Forgejo 16 artifact protocol.
It changes only three deprecated runtime boundaries:

- the bundled Node `punycode` import resolves to the already-locked userland
  package (`2.1.1` for upload and `2.3.1` for download);
- node-fetch 2 derives its legacy request-option shape from WHATWG `URL` instead
  of calling `url.parse()`;
- the artifact unzip stack uses `Buffer.alloc()` / `Buffer.from()`.

It also reapplies the signed Forgejo compatibility commits' sole protocol
boundary change: `@actions/artifact` must treat the Forgejo-provided results
service as supported rather than rejecting the server as unsupported GHES.

The upstream action lockfiles remain unchanged. The patcher verifies the exact
protocol dependency versions before building. `build.sh` verifies immutable
Forgejo archive hashes, installs the upstream locks without lifecycle scripts,
applies the reviewed transforms, runs boundary checks with deprecations promoted
to exceptions, rebuilds with each action's upstream-locked `@vercel/ncc`, copies
upstream and generated dependency licenses, and writes per-file SHA-256
provenance.

Run from any directory with Node 24:

```bash
bash scripts/ci/vendor/forgejo-artifact-v4/build.sh
node scripts/ci/vendor/forgejo-artifact-v4/verify-vendor.mjs \
  .github/actions/vendor/forgejo-artifact-v4
```

The build intentionally uses and retains the stable
`/tmp/sanctuary-forgejo-artifact-v4-node24-build-v1` directory. Stable absolute
source paths make ncc's path-derived module identifiers reproducible, while
archive extraction and `npm ci` restore the immutable inputs on every run. The
pipeline performs no destructive directory cleanup.
The wrapper change must not merge until a live Forgejo upload/download canary
proves the checked-in actions against the target server.
