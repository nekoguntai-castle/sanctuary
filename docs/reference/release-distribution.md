# Release distribution

Forgejo is Sanctuary's source of truth and CI authority. GitHub is a passive
public mirror and distribution endpoint. GitHub Actions must remain disabled;
neither GitHub Actions nor Forgejo Actions publishes releases.
The branch mirror's credentials and tag boundary are documented separately in
[Repository mirroring](repository-mirroring.md).

The supported online installation path clones the immutable GitHub release tag
and builds the main Compose stack locally. Sanctuary does not publish a
supported prebuilt-registry deployment. Disconnected installations use signed
[offline bundles](offline-bundles.md), which carry their images inside the
verified bundle.

Operators still using a retired packaged deployment should follow
[Migrate From Umbrel Or Prebuilt GHCR Compose](../how-to/migrate-from-packaged-deployments.md).

## Operator credentials

Store release credentials outside the repository. By default the operator
command reads `~/.config/sanctuary/forge-tokens.env`; set
`SANCTUARY_RELEASE_CONFIG` to use a different secret-store projection.

Required values — the one endpoint and the two credentials that no default can
stand in for:

```dotenv
FORGEJO_URL=https://forgejo.example.invalid
FORGEJO_TOKEN=...
GITHUB_RELEASE_TOKEN=...
```

The remaining names already default to this project's coordinates in both
`release:publish` and `release:publish-assets`, so a clean checkout needs none
of them. Set one only to publish somewhere else — a fork, or an instance under a
different owner:

```dotenv
FORGEJO_OWNER=nekoguntai-castle
FORGEJO_REPO=sanctuary
GITHUB_API_URL=https://api.github.com
GITHUB_OWNER=nekoguntai-castle
GITHUB_REPO=sanctuary
```

An empty assignment counts as unset and falls back to the default, matching
`${VAR:-default}` in the shell half, and a config file named with `--config`
outranks a variable left exported in the shell. Both commands apply the same
five defaults in the same precedence order;
`tests/release/publish-release-assets.test.mjs` fails if the two sets, or the
order they report a missing value in, ever drift apart.

Two differences remain, both in how the config file itself is located rather
than in how these names resolve: `release:publish` falls back to
`SANCTUARY_RELEASE_CONFIG` (else `~/.config/sanctuary/forge-tokens.env`) and
tolerates the file being absent, whereas `release:publish-assets` requires an
explicit `--config` and reports `ENOENT` if that path does not exist.

Use separate credentials:

- `FORGEJO_TOKEN` is repository-scoped with `write:repository`; it needs Release
  attachment access but no package, Actions, organization, or administrator
  scope.
- `GITHUB_RELEASE_TOKEN` is repository-scoped with Contents write and
  Administration read. Administration read is used only to fail closed unless
  GitHub Actions is still disabled.

Do not store these values as GitHub Actions secrets. The Forgejo token reads the
authoritative tag and Actions evidence and creates the Forgejo Release object.
The GitHub token verifies the passive-mirror safety settings and creates the
matching tag or Release object when reconciliation is needed.

## Release sequence

1. Complete the normal version and tag preparation on Forgejo.
2. Wait for the tag's `install-test.yml` push run to finish successfully.
3. Check out the immutable tag in a clean worktree.
4. Rehearse without API writes:

   ```bash
   npm run release:publish -- v0.8.57 --dry-run
   ```

5. Prepare the complete signed release asset set outside the checkout. The
   output directory must be new and empty:

   ```bash
   npm run release:prepare-assets -- \
     --tag v0.8.57 \
     --output-dir /secure/release-assets/v0.8.57 \
     --signing-key /secure/sanctuary-offline-release-private.pem \
     --public-key scripts/offline/keys/sanctuary-offline-release-public.pem \
     --run-id operator-20260731-01
   ```

6. Publish the stable Release objects:

   ```bash
   npm run release:publish -- v0.8.57
   ```

7. Attach and byte-verify the exact signed asset inventory on both providers:

   ```bash
   COMMIT="$(git rev-parse 'v0.8.57^{commit}')"
   npm run release:publish-assets -- \
     --tag v0.8.57 \
     --commit "$COMMIT" \
     --asset-dir /secure/release-assets/v0.8.57 \
     --manifest /secure/release-assets/v0.8.57/release-manifest.json \
     --public-key scripts/offline/keys/sanctuary-offline-release-public.pem \
     --config ~/.config/sanctuary/forge-tokens.env \
     --receipt /secure/release-receipts/v0.8.57.json
   ```

The command fails closed unless the local tag, Forgejo tag commit, and exact
successful Forgejo tag run agree. It also rechecks that GitHub Actions is
disabled immediately before any GitHub mutation. For a real release it then:

- verifies the automatically mirrored GitHub tag, or idempotently creates it
  after its commit is mirrored if reconciliation lag left it missing;
- creates idempotent Forgejo and GitHub Release objects.

A failed or partial run is safe to repeat: tags are immutable, an existing
matching tag is reused, and release creation is idempotent. Stop rather than
rewriting a tag or silently accepting a mismatched Release object.

The asset publisher requires both matching Release objects to exist. It refuses
unlisted local files, unexpected or duplicate remote assets, symlinks, nested
paths, tag/commit drift, and same-name content conflicts. It never deletes or
overwrites an asset. A failed run is convergent: rerun it after investigating;
already-published bytes are downloaded and hashed before reuse. Signed checksums
are uploaded after payload evidence, and `release-manifest.json` is uploaded last
as the completion marker.

Use `--dry-run` on `release:publish-assets` only after matching Release objects
exist. It performs the complete local and remote preflight with no asset uploads.

## Publication gates

Before calling a release complete, confirm:

- GitHub Actions remains disabled.
- The GitHub tag and Forgejo tag resolve to the same commit.
- Forgejo and GitHub expose the matching Release object.
- The GitHub source installer resolves the published stable tag and builds the
  main Compose stack locally.
- The signed/checksummed offline asset set is present on both providers, every
  byte matches, and the publication receipt identifies both provider releases.

Never rewrite an already published stable tag. Stop and investigate any ref or
digest mismatch.
