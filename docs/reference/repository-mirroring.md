# Repository mirroring

Forgejo is Sanctuary's source repository and CI authority. GitHub is a passive,
read-only public mirror. Forgejo automatically mirrors only the `main` branch
plus all release tags.

## Mirror contract

- Direction: Forgejo to GitHub only.
- Automatic branch allowlist: exactly `main`, expressed as `main`.
- Schedule: sync on commit plus an eight-hour reconciliation interval.
- GitHub Actions: disabled before every mirror or release mutation.
- GitHub development surfaces: issues, projects, wiki, and discussions disabled.
- Tags: Forgejo 16 always mirrors all tags, even when a branch filter is present.
  All Sanctuary tags are public release/RC tags and must pass the pre-cutover
  parity review.
- Release objects: published by the trusted operator command, never CI.

Forgejo 16 branch filters are comma-separated literal branch names or glob
patterns, not regular expressions. Do not remove the filter: an empty filter
can expose every private branch.

## Authentication

Use one credential dedicated to git mirroring. Never reuse the release
credential.

### Preferred: write deploy key

When GitHub organization policy permits deploy keys:

1. Create the Forgejo push mirror with SSH authentication.
2. Copy the generated Ed25519 public key.
3. Add it to only `nekoguntai-castle/sanctuary` as a write-enabled deploy key.
4. Force a sync and verify the exact `main` commit before enabling normal work.

GitHub can disable deploy keys at organization or enterprise level. Do not
weaken that organization-wide policy solely as an undocumented repository
workaround.

### Supported fallback: repository-scoped HTTPS token

If deploy keys are disabled, use a dedicated fine-grained GitHub personal access
token over HTTPS:

- resource owner: `nekoguntai-castle`;
- repository access: only `sanctuary`;
- repository permissions: Contents read/write and Workflows read/write;
- explicit expiry and an operator-owned rotation reminder.

The Workflows permission is required because the mirrored branch contains
`.github/workflows/**`, even though GitHub Actions execution is disabled.

Create the Forgejo mirror with:

- remote address: `https://github.com/nekoguntai-castle/sanctuary.git`;
- username: the token owner's GitHub login;
- password: the fine-grained token;
- branch filter: `main`;
- sync on commit: enabled;
- interval: `8h`.

Enter the token through Forgejo's credential field. Do not embed it in the URL,
command history, repository files, or logs.

GitHub App installation tokens expire too quickly for Forgejo's static mirror
credential field. A machine-user SSH key is a last resort because it adds
account lifecycle and broader account-key risk.

## Initial cutover

Before the first sync:

1. Verify GitHub Actions returns `enabled: false`.
2. Verify GitHub Pages is absent and automated security updates are disabled.
3. Record sorted Forgejo and GitHub heads and dereferenced tags.
4. Verify the pre-mirror GitHub bundle and recovery clone.
5. Confirm every shared tag resolves to the same commit.
6. Confirm every Forgejo-only tag is an intended public release/RC tag and no
   GitHub-only tag exists.
7. Approve Forgejo `main` as the winner for the force replacement.

After the first sync:

1. `git ls-remote --heads` must show only GitHub `main`.
2. GitHub `main` must equal Forgejo `main`.
3. All Forgejo release tags must resolve to the same dereferenced commits on
   GitHub.
4. A non-allowlisted Forgejo branch must not appear on GitHub.
5. A subsequent harmless Forgejo PR must reach GitHub at the exact merge commit.
6. A disposable Forgejo tag must appear, then disappear after normal tag
   deletion and the next mirror sync.
7. No GitHub Actions or Dependabot run may be created.
8. Anonymous raw, clone, and archive endpoints must work.

## Rotation and recovery

Forgejo 16 does not expose an update operation for push-mirror credentials.
Rotate an HTTPS mirror token with a controlled recreate:

1. Create the replacement token while the old token remains valid.
2. Record the existing remote, `main` filter, sync-on-commit setting, and
   eight-hour interval.
3. Delete only the GitHub mirror through Forgejo's repository-settings UI, then
   immediately recreate it.
4. Force sync and repeat the parity checks.
5. Revoke the old token only after parity succeeds.

Do not use Forgejo 16.0.1's
`DELETE /repos/{owner}/{repo}/push_mirrors/{name}` endpoint for cleanup. That
endpoint deletes the database row but leaves the Git remote/refspec in the bare
repository, where it can break later mirror operations. If it was used, an
administrator must remove the orphaned remote from both the repository and wiki
bare repositories before another mirror is configured.

If a sync changes unexpected refs, disable/delete only the GitHub mirror,
restore from the pre-cutover GitHub bundle as needed, and investigate before
recreating it. A stale `last_update` or non-empty `last_error` is an operational
alert.

## References

- [Forgejo repository mirrors](https://forgejo.org/docs/v15.0/user/repo-mirror/)
- [GitHub deploy-key restrictions](https://docs.github.com/en/enterprise-cloud@latest/organizations/managing-organization-settings/restricting-deploy-keys-in-your-organization)
- [GitHub fine-grained personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [GitHub fine-grained token permissions](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
