# Release distribution

Forgejo is Sanctuary's source of truth and CI authority. GitHub is a passive
public mirror and distribution endpoint. GitHub Actions must remain disabled;
neither GitHub Actions nor Forgejo Actions publishes releases.
The branch mirror's credentials and tag boundary are documented separately in
[Repository mirroring](repository-mirroring.md).

This document is the authoritative release and recovery policy. Command files,
contributor guidance, and script output must link here and may not define a
different tag-recovery procedure.

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

1. Complete version preparation through a protected Forgejo pull request.
   Confirm the PR-reported merge commit is an ancestor of freshly fetched
   `origin/main` before deleting its branch or selecting an RC commit.
2. Create the next unused RC tag on that exact commit and wait for its Forgejo
   release-candidate and `install-test.yml` runs to finish successfully. If it
   fails, follow the recovery state machine below and use a new RC number.
3. Run the affected-fleet
   [release-candidate canary](../how-to/release-candidate-canary.md) against the
   exact accepted RC tag and commit. Keep its receipt outside the checkout.
4. Validate that receipt and complete credential, signing-key, and new external
   output-directory readiness checks. Create the stable tag on the exact accepted
   RC commit only after every pre-tag check succeeds, then wait for the stable
   tag's own `install-test.yml` run.
5. Check out the immutable stable tag in a clean worktree.
6. Rehearse without API writes:

   ```bash
   npm run release:publish -- v0.8.57 --dry-run
   ```

7. Prepare the complete signed release asset set outside the checkout. The
   output directory must be new and empty:

   ```bash
   npm run release:prepare-assets -- \
     --tag v0.8.57 \
     --output-dir /secure/release-assets/v0.8.57 \
     --signing-key /secure/sanctuary-offline-release-private.pem \
     --public-key scripts/offline/keys/sanctuary-offline-release-public.pem \
     --run-id operator-20260731-01
   ```

8. Publish the stable Release objects:

   ```bash
   npm run release:publish -- v0.8.57
   ```

9. Attach and byte-verify the exact signed asset inventory on both providers:

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

## Version preparation and prepared resume

The release command accepts exactly one of two modes: a bare next-version bump,
or `--prepared-version <X.Y.Z> --commit <40-lowercase-hex-sha>`. Never combine
the modes or accept missing, reordered, abbreviated, duplicate, or unknown
arguments.

Prepared mode is the safe handoff from an already merged version-preparation
pull request. Start by freshly fetching `origin/main` and all tags. Require the
supplied commit to be an ancestor of `origin/main`, create a detached worktree at
that exact commit, and prove all of the following before selecting a tag:

- every package and lockfile version identity matches the requested version;
- the changelog contains one dated stable heading for that version;
- generated hardware JSON/Markdown are the canonical matching pair, with the
  requested application version and current root-lock digest;
- the worktree has no unrelated or uncommitted release evidence.

Prepared mode skips the bump and protected-PR delivery steps completely. It
resumes at first-unused-RC selection, so it cannot create a duplicate version PR
or accidentally advance to the next patch. A newly prepared release must use a
protected Forgejo pull request, read the PR-reported merge commit, freshly fetch
`origin/main`, prove that exact commit is its ancestor, and only then delete the
preparation branch.

Version preparation may stage only these release-evidence paths:

```text
package.json
package-lock.json
server/package.json
gateway/package.json
llm-egress-proxy/package.json
llm-egress-proxy/package-lock.json
docs/reference/changelog.md
docs/reference/generated/hardware-wallet-compatibility.json
docs/reference/generated/hardware-wallet-compatibility.md
```

Compare both the unstaged and staged path sets with that allowlist. Stop if an
expected changed path is omitted or any unrelated path is staged. Run
`./scripts/bump-version.sh --check` before delivery and again from the exact
merged commit.

From the detached worktree at that merge commit, run the tracked verifier before
creating an RC:

```bash
node scripts/release/verify-prepared-release.mjs \
  --prepared-version X.Y.Z \
  --commit 0123456789abcdef0123456789abcdef01234567
```

It accepts no other argument shape, fetches authoritative refs and tags, proves
the clean worktree/HEAD/`origin/main` identity and all version evidence, and
reports the first unused RC without creating or moving any ref.

## Recovery state machine

Release refs are immutable once pushed. Choose recovery from the observed state:

| State | Required action |
| --- | --- |
| An RC fails validation or contains a code/configuration defect | Fix through a protected PR, wait for landed-main CI, and create the next unused RC number. Never delete, move, or reuse the failed RC. |
| Publication stopped for a transient reason | Rerun only when every existing tag, commit, manifest, digest, and remote byte is identical to the intended release. The publishers are designed to converge on identical state. |
| A local/remote ref, digest, manifest, or same-name asset differs | Stop. Preserve the evidence and investigate; never overwrite, retarget, or silently accept the conflict. |
| A pushed stable tag has a code or configuration defect | Leave the tag and Release objects immutable. Fix through a protected PR and ship a new patch version through a new RC sequence. |

Stable tagging additionally requires credential, signing-key, canary-receipt,
and new external output-directory readiness to succeed before the tag is created.
The asset output path must be absolute, its existing parent must canonicalize
outside every repository worktree, and the target itself must not exist yet.
The canary receipt must validate against the exact accepted RC tag and commit.
For v0.8.69 and later, the v2 receipt also binds the safely opened private raw
evidence sidecar by SHA-256 and byte length; pass both external paths to the
validator. Neither file is a repository artifact.

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
- The external affected-fleet canary receipt names the exact accepted RC tag and
  commit and contains complete outcome, diagnostics, metric, bounded-error, and
  operator-signoff evidence.

Never rewrite any pushed RC or stable tag. Apply the recovery state machine above
for every validation, publication, ref, digest, or content failure.
