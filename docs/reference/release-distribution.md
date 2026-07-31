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

Required values:

```dotenv
FORGEJO_URL=https://forgejo.example.invalid
FORGEJO_OWNER=nekoguntai-castle
FORGEJO_REPO=sanctuary
FORGEJO_TOKEN=...

GITHUB_API_URL=https://api.github.com
GITHUB_OWNER=nekoguntai-castle
GITHUB_REPO=sanctuary
GITHUB_RELEASE_TOKEN=...
```

Use separate credentials:

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

5. Publish the stable release:

   ```bash
   npm run release:publish -- v0.8.57
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

Signed offline bundles are a separate distribution artifact. Build, sign,
attach, and verify them using the offline-bundle runbook; their images are local
bundle contents, not registry dependencies.

## Publication gates

Before calling a release complete, confirm:

- GitHub Actions remains disabled.
- The GitHub tag and Forgejo tag resolve to the same commit.
- Forgejo and GitHub expose the matching Release object.
- The GitHub source installer resolves the published stable tag and builds the
  main Compose stack locally.
- Signed/checksummed offline assets pass the offline verification contract when
  they are included in the release.

Never rewrite an already published stable tag. Stop and investigate any ref or
digest mismatch.
