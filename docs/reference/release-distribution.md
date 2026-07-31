# Release distribution

Forgejo is Sanctuary's source of truth and CI authority. GitHub is a passive
public mirror and distribution endpoint. GitHub Actions must remain disabled;
neither GitHub Actions nor Forgejo Actions publishes releases or images.
The branch mirror's credentials and tag boundary are documented separately in
[Repository mirroring](repository-mirroring.md).

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

GHCR_USER=release-operator
GHCR_TOKEN=...
UMBREL_DISPATCH_TOKEN=...
```

Use separate credentials:

- `GITHUB_RELEASE_TOKEN` is repository-scoped with Contents write and
  Administration read. Administration read is used only to fail closed unless
  GitHub Actions is still disabled.
- `GHCR_TOKEN` is a classic PAT limited to package publication.
- `UMBREL_DISPATCH_TOKEN` may dispatch only the local
  `sanctuary-umbrel` updater.

Do not store these values as GitHub Actions secrets. The Forgejo token reads
this repository's tag and Actions evidence and creates its Release object; the
Umbrel token is used only for the final local workflow dispatch.

## Release sequence

1. Complete the normal version and tag preparation on Forgejo.
2. Wait for the tag's `install-test.yml` push run to finish successfully.
3. Check out the immutable tag in a clean worktree.
4. Rehearse without registry or API writes:

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
- logs in to GHCR through an isolated temporary Docker configuration;
- publishes amd64/arm64 frontend and backend images;
- verifies manifest and per-platform digest evidence against GHCR, including
  source, version, and release-commit OCI labels on both architectures;
- creates idempotent Forgejo and GitHub Release objects; and
- dispatches `sanctuary-umbrel` only after digest verification succeeds.

Logout, buildx-builder removal, and temporary credential cleanup run on every
exit path. A failed or partial run is safe to repeat: tags are immutable,
release creation is idempotent, and an already-published image is inspected and
reused instead of being overwritten. A partial retry builds only the missing
frontend or backend image.

## Publication gates

Before calling a release complete, confirm:

- GitHub Actions remains disabled.
- The GitHub tag and Forgejo tag resolve to the same commit.
- Forgejo and GitHub expose the matching Release object.
- Both GHCR packages are public and anonymously pullable.
- Each image index contains `linux/amd64` and `linux/arm64`.
- The local `sanctuary-umbrel` update workflow succeeded.

Never rewrite an already published stable tag. Stop and investigate any ref or
digest mismatch.
