# Codeberg Packages Image Hosting Migration

Status: planned; converged after 3 review passes; not started
Owner: nekoguntai (operator) + AI assistant (implementation)
Target validation release: v0.8.53

## Why this exists

GHCR (`ghcr.io/nekoguntai-castle/sanctuary-{frontend,backend}`) is the
current image registry. The release flow that publishes there lives in
`.github/workflows/release.yml` and runs on the GitHub side via Forgejo
push-mirror. The push-mirror was retired around v0.8.50 (last GitHub
commit 2026-05-03; v0.8.50 / v0.8.51 / v0.8.52 were never pushed
there). New images therefore have not been published since v0.8.49,
and the `sanctuary-umbrel` app store still pins
`ghcr.io/.../sanctuary-frontend:v0.8.49@sha256:6ac13c…` —
**Umbrel users are stuck four stable releases behind**.

We migrate image hosting to Codeberg Packages — public OCI registry
already paired with the Codeberg git mirror — so Sanctuary releases
produce installable images again with no return to GitHub.

## Decided constraints (locked)

- **Registry**: Codeberg Packages
  (`codeberg.org/nekoguntai-castle/sanctuary-<image>:<tag>`).
- **Visibility**: public — no auth required for `docker pull`.
- **Architectures**: `linux/amd64` + `linux/arm64`
  (multi-arch manifest list, so `docker pull` auto-selects).
- **Image signing**: out of scope for v1.
  Codeberg-over-HTTPS is the trust anchor. The existing
  `OFFLINE_SIGNING_KEY` already signs the offline tarball
  separately. We can layer cosign on top later as a transparent
  enhancement.
- **Operator-experience target**: an Umbrel user installing or
  upgrading Sanctuary should not have to log in to any registry,
  switch arches by hand, or run any new commands. `docker pull` works
  on Pi and x86 the same way.
- **Tag policy**: only **immutable** versioned tags published
  (`v0.8.53`, etc). **Do not publish `:latest`** — Umbrel pins by
  digest, but a mutable `:latest` invites foot-guns for self-host
  operators who forget to specify a tag.
- **Pre-release tags**: not published. RC images would clutter the
  registry and bypass the deliberate "stable images only" promise.
  RC validation runs locally in `install-test.yml` against
  locally-built images, not pulled.

## Current image inventory (verified against repo)

| Image | Built from | Currently published to GHCR? | Used by Umbrel? |
|---|---|---|---|
| `frontend` | `Dockerfile` (root) | ✅ yes | ✅ yes — `web` service |
| `backend` | `server/Dockerfile` | ✅ yes | ✅ yes — `server` service (also reused by `worker` and `migrate` containers via `image: <backend>` + different command) |
| `gateway` | `gateway/Dockerfile` | ❌ no — local-build only | ❌ no |
| `llm-egress-proxy` | `llm-egress-proxy/Dockerfile` | ❌ no — local-build only | ❌ no |

Verified by reading `docker-compose.yml`, `docker-compose.ghcr.yml`,
and the live `sanctuary-umbrel/sanctuary/docker-compose.yml`.

**Decision (locked)**: publish only `frontend` and `backend`.
`gateway` and `llm-egress-proxy` stay local-build for self-host
deployments. This matches the current Umbrel manifest exactly and
avoids scope creep. Re-evaluate after Phase D ships clean.

## sanctuary-umbrel side: scaffolding exists, needs Forgejo refit

`sanctuary-umbrel/.github/workflows/update-on-dispatch.yml`
**already exists** and accepts the right `workflow_dispatch` input
shape (`{ version, frontend_digest, backend_digest }`). It updates
`sanctuary/umbrel-app.yml` + `sanctuary/docker-compose.yml`, commits
to main, tags, and creates a release.

**However, pass 2 read the file fully and found GitHub-coupled
internals that prevent it from running on Forgejo Actions
unmodified:**

- Uses `gh release create` (api.github.com).
- Sed regex assumes literal `ghcr.io/...` prefix.
- Commit messages and release notes hardcode github.com URLs.
- Git author identity is `github-actions[bot]@users.noreply.github.com`.

So Phase E is two coordinated PRs (E.1 in sanctuary-umbrel, E.2 in
this repo) — see Phase E.

The Forgejo dispatch surface I verified (curl probes against the live
instance):

- ✅ `POST /api/v1/repos/{owner}/{repo}/actions/workflows/{file}/dispatches`
  with body `{"ref":"main","inputs":{...}}` — accepted (returns 400
  "ref is empty" on missing body, indicating the route is wired).
- ❌ `POST /api/v1/repos/{owner}/{repo}/dispatches` — 404; Forgejo does
  not expose GitHub-style `repository_dispatch` over the API.

**Decision (locked)**: fire the umbrel update via **`workflow_dispatch`**
(the working endpoint).

## Phases

### Phase A — Registry setup (operator-driven, ~30 min)

You do this; I cannot.

1. Codeberg → Settings → Applications → "Generate New Token":
   - Name: `sanctuary-package-write`
   - Scope: **`write:package`** only
   - Save token securely.
2. Append to `~/.config/sanctuary/forge-tokens.env`:
   ```
   CODEBERG_USER=nekoguntai-castle
   CODEBERG_PACKAGE_TOKEN=<paste>
   ```
3. Forgejo Actions secrets (repo-level, on `nekoguntai-castle/sanctuary`):
   - `CODEBERG_USER` = `nekoguntai-castle`
   - `CODEBERG_PACKAGE_TOKEN` = same token
4. Create a separate Forgejo PAT for firing umbrel dispatches:
   - Scope: `write:repository` on `sanctuary-umbrel` (or whatever
     scope Forgejo requires to call workflow_dispatch — verify
     during smoke test in step 6).
   - Save as Forgejo Actions secret `UMBREL_DISPATCH_TOKEN` on
     `nekoguntai-castle/sanctuary`.
5. ~~Forgejo Actions repository variable for FORGEJO_URL~~ —
   **dropped during Phase A execution**. Forgejo's variables API
   surface was awkward (PUT 404, POST 405) and the URL is already
   exposed as `${{ github.server_url }}` on the runner. Workflows
   reference it directly; no secret/variable needed.

6. Create a separate Forgejo PAT for sanctuary-umbrel's release-API
   call (the gh-release replacement in Phase E.1):
   - Scope: `write:repository` on `sanctuary-umbrel` itself.
   - Save as Forgejo Actions secret `UMBREL_RELEASE_TOKEN` on
     `nekoguntai-castle/sanctuary-umbrel` (NOT on the Sanctuary
     repo). **Note**: Forgejo rejects secret names starting with
     `FORGEJO_` as "invalid secret name" (reserved prefix). Use a
     non-reserved prefix like `UMBREL_*` instead.
7. Manual smoke push (I drive this from your shell once secrets land):
   ```bash
   docker login codeberg.org -u "$CODEBERG_USER" -p "$CODEBERG_PACKAGE_TOKEN"
   docker pull --platform linux/amd64 hello-world:latest
   docker tag hello-world:latest codeberg.org/nekoguntai-castle/sanctuary-test:0.0.1
   docker push codeberg.org/nekoguntai-castle/sanctuary-test:0.0.1
   ```
8. Verify visibility — open
   `https://codeberg.org/nekoguntai-castle/-/packages` in a browser and
   confirm `sanctuary-test` appears as **public**.
9. Smoke-test the workflow_dispatch token while we're here:
   ```bash
   curl -fsSL -X POST \
     -H "Authorization: token $UMBREL_DISPATCH_TOKEN" \
     -H "Content-Type: application/json" \
     "$FORGEJO_URL/api/v1/repos/nekoguntai-castle/sanctuary-umbrel/actions/workflows/update-on-dispatch.yml/dispatches" \
     -d '{"ref":"main","inputs":{"version":"0.0.0-smoke","frontend_digest":"sha256:0","backend_digest":"sha256:0"}}'
   ```
   Expected: HTTP 204. The receiving workflow will run, hit its
   pre-release skip (since it sees `0.0.0-smoke` as not stable... or
   actually, may treat it as stable since the pattern only excludes
   `-rc/-alpha/-beta`. Use `0.0.0-smoke-rc` to guarantee skip).
   Check via Forgejo Actions UI that the dispatch was received.
10. Delete the smoke image afterward (UI or API).

**Exit criteria**:
- A public `sanctuary-test` image appears in Codeberg Packages.
- `docker pull codeberg.org/.../sanctuary-test:0.0.1` from a clean
  machine succeeds without auth.
- Step 9's curl returns HTTP 204 and a workflow run for
  `update-on-dispatch.yml` appears in sanctuary-umbrel's Forgejo
  Actions tab (proving the dispatch token + endpoint work).
- All Forgejo secrets (`CODEBERG_USER`, `CODEBERG_PACKAGE_TOKEN`,
  `UMBREL_DISPATCH_TOKEN` on Sanctuary; `UMBREL_RELEASE_TOKEN` on
  sanctuary-umbrel) and var (`FORGEJO_URL` on Sanctuary) are
  visible in their respective settings UIs.

### Phase B — Build + push pipeline (PR ~250 lines)

New `scripts/ci/build-and-push-images.sh`:

```bash
#!/usr/bin/env bash
# Build and push Sanctuary container images to Codeberg Packages.
#
# Inputs (env):
#   IMAGE_REGISTRY     default codeberg.org/nekoguntai-castle
#   IMAGE_TAG          required (e.g. v0.8.53). MUST start with 'v'.
#   IMAGE_PLATFORMS    default linux/amd64,linux/arm64
#   IMAGES             default "frontend backend"
#   PUSH               default "true"; set "false" for build-only dry-run
#   PER_IMAGE_TIMEOUT  default 1800 (seconds, per image build)
#
# Outputs:
#   dist/image-digests-<tag>.json — { "frontend": "sha256:...", "backend": "sha256:..." }
#   dist/image-build-summary-<tag>.txt — human log
#
# Auth: caller must have already run `docker login` against the registry.
#
# Failure semantics:
#   - First image failure aborts the run; later images are NOT
#     attempted.
#   - The partial-publish state (e.g. frontend pushed but backend
#     failed) is logged and the digest manifest reflects only the
#     successful images. The downstream notify-umbrel job MUST NOT fire
#     on partial state — the workflow's `if: needs.publish-images.result == 'success'`
#     gates this.
#   - Re-running the workflow on the same tag re-pushes the same
#     content (same Dockerfiles + same source), so partial recovery is
#     idempotent.
set -euo pipefail
```

Image-to-Dockerfile mapping (locked):

| Image | Dockerfile | Build context |
|---|---|---|
| `frontend` | `Dockerfile` | `.` |
| `backend` | `server/Dockerfile` | `.` (root, so the build can copy `shared/`) |

For each image, sequentially (single bash loop, **no matrix** — see
memory: `feedback_forgejo_runner_concurrency.md`):

1. `docker buildx build --platform "$IMAGE_PLATFORMS" --tag "$IMAGE_REGISTRY/sanctuary-<image>:$IMAGE_TAG" --push -f <dockerfile> <context>`
2. Read pushed manifest-list digest:
   `docker buildx imagetools inspect --format '{{.Manifest.Digest}}' "$IMAGE_REGISTRY/sanctuary-<image>:$IMAGE_TAG"`
3. Append `{ "<image>": "<digest>" }` to
   `dist/image-digests-<tag>.json` (use `jq` to update atomically).

New job in `release-candidate.yml` (after `validation-summary`):

```yaml
publish-images:
  name: Publish images to Codeberg Packages
  runs-on: ubuntu-latest
  needs: validation-summary
  if: |
    github.event_name == 'push'
    && github.ref_type == 'tag'
    && !contains(github.ref_name, '-rc')
    && !contains(github.ref_name, '-alpha')
    && !contains(github.ref_name, '-beta')
    && !contains(github.ref_name, '-dev')
    && needs.validation-summary.result == 'success'
  timeout-minutes: 90  # arm64 cross-build via QEMU is ~3-5x slower than amd64-only
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@<pinned>
    - name: Set up QEMU (arm64 cross-build)
      uses: docker/setup-qemu-action@<pinned>
      with: { platforms: arm64 }
    - name: Set up buildx
      uses: docker/setup-buildx-action@<pinned>
    - name: Login to Codeberg
      run: |
        echo "${{ secrets.CODEBERG_PACKAGE_TOKEN }}" \
          | docker login codeberg.org -u "${{ secrets.CODEBERG_USER }}" --password-stdin
    - name: Build and push
      env:
        IMAGE_TAG: ${{ github.ref_name }}
      run: bash scripts/ci/build-and-push-images.sh
    - name: Upload digest manifest
      if: always()
      uses: ./.github/actions/upload-artifact
      with:
        name: image-digests-${{ github.ref_name }}
        path: |
          dist/image-digests-*.json
          dist/image-build-summary-*.txt
        retention-days: 90
```

**Why gated on `validation-summary == 'success'`**: never publish
images for a tag whose install/upgrade tests failed.

**Why a 90-minute timeout**: cross-arch buildx + QEMU is CPU-heavy.
Empirically a single arm64 frontend build via QEMU on a typical x86
host takes 8-15 min; backend takes 10-20 min (Prisma generates
native engines per arch). 4 builds × ~15 min = 60 min worst-case
with headroom for retries.

### Phase C — Repo wiring updates (PR ~150 lines)

1. **`docker-compose.ghcr.yml`** — keep filename (avoid breaking
   existing operator scripts and the
   `docs/plans/deep-bug-scrub-remediation-plan.md` P2-02 reference).
   Replace registry default:
   ```yaml
   # before
   image: ghcr.io/${GITHUB_REPOSITORY:-nekoguntai-castle/sanctuary}-backend:${IMAGE_TAG:-latest}
   # after
   image: ${IMAGE_REGISTRY:-codeberg.org/nekoguntai-castle}/sanctuary-backend:${IMAGE_TAG:?IMAGE_TAG must be set, e.g. v0.8.53}
   ```
   - The `IMAGE_REGISTRY` env override stays so operators can repoint
     at a private mirror.
   - Drop `:latest` default — force operators to pin an explicit tag.
     Matches the immutable-tag policy.
   - Add a deprecation header comment noting the file used to point at
     GHCR; eventual rename deferred to Phase F.
2. **`docker-compose.yml`** — no change. The local-build path stays
   intact for `./start.sh` workflows.
3. **`install.sh`** — already defaults to Codeberg for the git source
   (verified). Add an `IMAGE_REGISTRY=codeberg.org/nekoguntai-castle`
   default export so any subsequent `docker compose -f
   docker-compose.ghcr.yml` call inherits it. Keep the env var
   override-able.
4. **`scripts/setup.sh`** — verify it does not hard-code a registry;
   pass through `IMAGE_REGISTRY` if set. (Audit during PR.)
5. **`README.md`** — update the "Pre-built images" section.
6. **`runner-infra/scripts/ops/bootstrap-forgejo-runner-host.sh`** — update
   the runner host image cache references there; the runner bootstrap script
   lives outside this repository.
7. **`.github/workflows/docker-build.yml`** — currently pushes branch
   builds to GHCR. Disable on Forgejo
   (`if: github.server_url == 'https://github.com'`) since GitHub no
   longer receives commits anyway. Branch images on Codeberg are not
   useful — they would just clutter the registry. (Per release skill
   memory: `feedback_github_mirror_decommissioned.md`.)
8. **`tasks/todo.md`** — sweep for any open items referencing GHCR.

### Phase D — Validate via v0.8.53 release (~1 hr active + CI wall time)

1. Bump version 0.8.52 → 0.8.53 (`./scripts/bump-version.sh patch`).
2. Run the existing release skill flow (PR + tag).
3. New `publish-images` job runs after install-test passes; images
   appear under `https://codeberg.org/nekoguntai-castle/-/packages`.
4. **Manual verification on amd64 host:**
   ```bash
   docker pull codeberg.org/nekoguntai-castle/sanctuary-frontend:v0.8.53
   docker pull codeberg.org/nekoguntai-castle/sanctuary-backend:v0.8.53
   docker run --rm codeberg.org/nekoguntai-castle/sanctuary-backend:v0.8.53 node --version
   ```
5. **Manual verification on arm64 host** — Pi or arm Mac with
   Docker Desktop:
   ```bash
   docker pull --platform linux/arm64 codeberg.org/nekoguntai-castle/sanctuary-frontend:v0.8.53
   docker pull --platform linux/arm64 codeberg.org/nekoguntai-castle/sanctuary-backend:v0.8.53
   ```
   - On a true arm64 host, `--platform` is a no-op assertion.
   - On amd64 with `--platform linux/arm64`, Docker pulls the arm64
     manifest and runs under emulation. The `node --version` smoke
     should still succeed because Node binaries are static enough.
6. **End-to-end deploy** using the new compose file:
   ```bash
   IMAGE_TAG=v0.8.53 docker compose -f docker-compose.ghcr.yml up -d
   ```
   on a clean host (NOT the dev host that already runs Sanctuary —
   port + volume conflicts; use a fresh VM or a per-project
   `COMPOSE_PROJECT_NAME`). Verify the webapp loads at the expected
   port, login works, healthchecks all green.
7. **End-to-end upgrade** from v0.8.52 → v0.8.53 using the same
   compose file (manual repro of what `install-test.yml`'s
   `Upgrade Baseline` automates). Confirm postgres data persists,
   migrations run, no manual ops needed.

**Exit criteria**:
- Multi-arch manifest lists exist on Codeberg for both images.
- `image-digests-v0.8.53.json` artifact attached to the workflow run
  with both digest values.
- Clean install + upgrade pass on amd64 and arm64 hosts using the
  new registry.
- No regression in `install-test.yml` (since RC tags don't pull from
  Codeberg, that lane is unaffected).

### Phase E — Umbrel dispatch (this repo PR + sanctuary-umbrel PR)

Pass 2 verification revealed `update-on-dispatch.yml` is more
GitHub-coupled than first read suggested. The receiving side is NOT
plug-and-play with Codeberg images. Phase E is two coordinated PRs:

#### Phase E.1 — sanctuary-umbrel preparation PR (~120 lines)

**This PR must merge BEFORE Phase E.2's first dispatch fires** or
the dispatch will write nonsense (sed regex won't match, gh release
will fail).

Changes to `.github/workflows/update-on-dispatch.yml`:

1. **Update sed patterns** to match Codeberg image references:
   ```bash
   # Match either old (ghcr.io) or new (codeberg.org) prefix; rewrite to Codeberg.
   sed -i -E "s|(ghcr\\.io|codeberg\\.org)/nekoguntai-castle/sanctuary-frontend:[^[:space:]]*|codeberg.org/nekoguntai-castle/sanctuary-frontend:v$VERSION@$FRONTEND_DIGEST|g" sanctuary/docker-compose.yml
   sed -i -E "s|(ghcr\\.io|codeberg\\.org)/nekoguntai-castle/sanctuary-backend:[^[:space:]]*|codeberg.org/nekoguntai-castle/sanctuary-backend:v$VERSION@$BACKEND_DIGEST|g" sanctuary/docker-compose.yml
   ```
2. **Replace `gh release create`** with the Forgejo Release API (the
   same shape `scripts/create-forge-release.sh` in the Sanctuary repo
   uses):
   ```bash
   curl -fsSL -X POST \
     -H "Authorization: token $FORGEJO_TOKEN" \
     -H "Content-Type: application/json" \
     "$FORGEJO_URL/api/v1/repos/$REPO/releases" \
     -d "$BODY"
   ```
   Adds a Forgejo Actions secret on sanctuary-umbrel:
   `UMBREL_RELEASE_TOKEN` with `write:repository` scope on
   sanctuary-umbrel itself.
3. **Replace github.com URLs** in commit message and release notes
   with Codeberg URLs:
   - `https://codeberg.org/nekoguntai-castle/sanctuary/releases/tag/v$VERSION`
4. **Replace `github-actions[bot]` git author** with a generic
   forge-neutral identity:
   - `git config user.name "sanctuary-bot"`
   - `git config user.email "sanctuary-bot@noreply.codeberg.org"`
5. **Pre-flight bootstrap**: when `sanctuary/docker-compose.yml`
   currently still pins `ghcr.io/...:v0.8.49@sha256:...`, the first
   dispatched run will rewrite it to
   `codeberg.org/...:vNEW@sha256:NEW`. The regex above handles both
   prefixes, so no manual one-time bump is needed.
6. **Drop `repository_dispatch` trigger** if Forgejo doesn't expose
   that fire endpoint anyway. Keep `workflow_dispatch` only.
   (Optional cleanup; not blocking.)
7. **Audit `update-on-dispatch.yml` for any other GitHub-only
   assumptions** before merging — the script-on-script auditing rule
   from CLAUDE.md applies.

#### Phase E.2 — Sanctuary-side dispatch PR (~80 lines)

After Phase E.1 merges, this PR adds the dispatch firing job. Until
E.1 lands, dispatch would write broken state, so order matters.

New job in `release-candidate.yml`:

```yaml
notify-umbrel:
  name: Dispatch digest bump to sanctuary-umbrel
  needs: publish-images
  runs-on: ubuntu-latest
  if: |
    always()
    && needs.publish-images.result == 'success'
    && github.event_name == 'push'
    && github.ref_type == 'tag'
  timeout-minutes: 5
  steps:
    - uses: actions/download-artifact@<pinned>
      with: { name: image-digests-${{ github.ref_name }}, path: dist }
    - name: Fire workflow_dispatch
      env:
        FORGEJO_URL: ${{ github.server_url }}      # auto-resolves to forgejo on this runner
        UMBREL_DISPATCH_TOKEN: ${{ secrets.UMBREL_DISPATCH_TOKEN }}
        TAG: ${{ github.ref_name }}
      run: |
        VERSION="${TAG#v}"
        FRONTEND_DIGEST=$(jq -r '.frontend' dist/image-digests-*.json)
        BACKEND_DIGEST=$(jq -r '.backend'  dist/image-digests-*.json)
        if [ -z "$FRONTEND_DIGEST" ] || [ -z "$BACKEND_DIGEST" ] \
           || [ "$FRONTEND_DIGEST" = "null" ] || [ "$BACKEND_DIGEST" = "null" ]; then
          echo "::error::Missing digest in artifact payload"
          exit 1
        fi
        BODY=$(jq -n \
          --arg ver "$VERSION" \
          --arg fe  "$FRONTEND_DIGEST" \
          --arg be  "$BACKEND_DIGEST" \
          '{ ref: "main", inputs: { version: $ver, frontend_digest: $fe, backend_digest: $be } }')
        curl -fsSL -X POST \
          -H "Authorization: token $UMBREL_DISPATCH_TOKEN" \
          -H "Content-Type: application/json" \
          "$FORGEJO_URL/api/v1/repos/nekoguntai-castle/sanctuary-umbrel/actions/workflows/update-on-dispatch.yml/dispatches" \
          -d "$BODY"
```

**Why no PR review checkpoint between dispatch and tag**: the
sanctuary-umbrel workflow already opens its work as a commit + tag +
release on its own. We accept the existing automation trust model.
A manual review step would be a sanctuary-umbrel-side opinion change
out of scope here. If you want operator review later, add a PR
shape to E.1 instead of direct push.

### Phase F — Cleanup (PR, ~100 lines, after 1 successful release)

Once v0.8.53 ships cleanly via Codeberg + Umbrel:

1. **Workflows**: delete `.github/workflows/release.yml`,
   `.github/workflows/create-release.yml`,
   `.github/workflows/release-offline-bundle.yml`. They were gated to
   GitHub-only in PR #319 and there is no GitHub side anymore.
   `docker-build.yml` — keep if Phase C disabled it on Forgejo;
   otherwise also delete.
2. **`docker-compose.ghcr.yml`** — rename to
   `docker-compose.codeberg.yml`. Ship a one-line `docker-compose.ghcr.yml`
   that errors out with `# Renamed to docker-compose.codeberg.yml`
   so existing scripts get a clear failure rather than silently
   pulling stale GHCR images.
3. **Release skill** (`.claude/commands/release.md`): replace GitHub
   release.yml language with the Forgejo publish-images +
   notify-umbrel flow. Document the new sequence: tag → install-test
   green → publish-images → notify-umbrel → sanctuary-umbrel
   auto-tags → Umbrel users see update.
4. **README.md** and **`docs/`**: full sweep for any remaining
   `ghcr.io` references; replace with Codeberg URLs.
5. **GHCR images**: leave existing v0.8.49-and-earlier ghcr tags
   untouched — old installations may still pull them during upgrade.
   Mark deprecated in README. After 2-3 stable releases on Codeberg
   (so v0.9.0 territory), consider deleting the GHCR org/images.

## Sequencing + estimated effort

**Critical ordering decision**: Phases E.1 and E.2 must merge BEFORE
Phase D (the v0.8.53 release) so the validation release fires the
end-to-end pipeline on its first run. Otherwise v0.8.53 would
publish images but skip the Umbrel update — Umbrel users would
remain stuck on v0.8.49 until v0.8.54 or until someone manually
fires `workflow_dispatch`.

Recommended order:

| Step | Phase | Owner | Active effort | Wall time | Blocks |
|---|---|---|---|---|---|
| 1 | A — registry + secrets + smoke | You + me | 30 min | 30 min | B, E.2 |
| 2 | B — build/push pipeline PR | Me | ~3 hr | + 1 PR cycle | D |
| 3 | C — repo wiring PR | Me | ~2 hr | + 1 PR cycle | D |
| 4 | E.1 — sanctuary-umbrel refit PR | Me | ~2 hr | + 1 PR cycle | E.2 |
| 5 | E.2 — Sanctuary notify-umbrel job PR | Me | ~1 hr | + 1 PR cycle | D |
| 6 | D — v0.8.53 validation release end-to-end | Me + you | ~1 hr | ~2 hr CI + manual verify | F |
| 7 | F — cleanup | Me | ~1 hr | + 1 PR cycle | (after 1-2 successful releases on Codeberg) |

**Total active work: ~9-10 hours** spread across 3-4 sessions, plus
your 30 min of Codeberg setup.

**Why we don't do D first then E**: technically possible — we'd ship
images on Codeberg but Umbrel would lag. We could manually trigger
`workflow_dispatch` on `sanctuary-umbrel` for v0.8.53 once E.1
landed. But that's a manual step that defeats the "simple for Umbrel
users" goal and risks getting forgotten. Wiring E end-to-end before
the validation release is cheap (no extra wall time for E.1+E.2 PRs
since they don't gate D's CI in any way).

## Open Decisions (none — all locked above)

All Phase 0 questions have been answered:

- ✅ Registry: Codeberg Packages
- ✅ Visibility: public
- ✅ Architectures: amd64 + arm64
- ✅ Image signing: deferred (cosign in a future v2)
- ✅ Images to publish: `frontend` + `backend` only
- ✅ Tag policy: immutable versioned only, no `:latest`, no RC images
- ✅ Dispatch mechanism: `workflow_dispatch` (verified working on
  Forgejo) — `repository_dispatch` not exposed by Forgejo API
- ✅ Compose filename: keep `docker-compose.ghcr.yml` through Phase E,
  rename in Phase F (after at least one successful Codeberg release)

## Open risks

- **arm64 build wall time on the Forgejo runner.** QEMU emulation of
  arm64 is CPU-heavy and slower than native. Phase B sets
  `timeout-minutes: 90`; if real-world builds exceed that, **fallback
  is amd64-only for v0.8.53 with arm64 deferred to v0.8.54** once we
  either get a real arm64 runner or tune QEMU.
- **Codeberg storage / rate limits.** No published quota; a future
  Codeberg policy change could break us. Mitigation: `IMAGE_REGISTRY`
  env override in `install.sh` lets operators repoint quickly, and
  the offline-bundle path remains the air-gapped fallback. A future
  Phase G could publish to a self-hosted Forgejo Packages mirror as
  redundancy.
- **Codeberg outages.** Public-internet pull dependency. Mitigation:
  the offline-bundle path (`OFFLINE_SIGNING_KEY` + tarball) already
  exists.
- **Token blast radius.** `CODEBERG_PACKAGE_TOKEN` has `write:package`
  scope. If the Forgejo runner host or the token store is
  compromised, attacker can push malicious images. Mitigations:
  scope the token to one repo if Codeberg supports it (verify during
  Phase A), rotate after each release if you want highest paranoia,
  and keep the offline-bundle as the verifiable air-gap path.
- **`UMBREL_DISPATCH_TOKEN` blast radius.** Has `write:repository` on
  sanctuary-umbrel. Compromise lets attacker open commits / tags /
  releases there. Mitigations: rotate after release, scope to that
  one repo.
- **Native binding rebuilds for arm64.** Both Dockerfiles run
  `npm ci`. Packages with native bindings (Prisma engines, esbuild,
  sharp, etc.) compile per-arch. Buildx + QEMU handles this
  correctly but slowly. **Verify locally first**: build the backend
  Dockerfile for `linux/arm64` via `docker buildx build --platform
  linux/arm64 --load -f server/Dockerfile .` on the dev host before
  shipping the workflow.
- **`umbrel-app.yml` version is `"0.8.49"`**. Four releases of digest
  drift. Phase D's first dispatch will jump straight to v0.8.53
  (skipping 0.8.50/0.8.51/0.8.52 entirely on Umbrel side). **This is
  intentional and fine** — no Umbrel user installed a v0.8.50/51/52
  digest, so there is nothing to deprecate gracefully.
- **`docker-build.yml` (Build Dev Images) was building `:main`
  every push to main.** That stops on Forgejo after Phase C disables
  the workflow. If anyone was pulling `:main` from GHCR for testing,
  they should switch to versioned tags from Codeberg.
- **`docker-compose.ghcr.yml` already has known security issues**
  flagged in `docs/plans/deep-bug-scrub-remediation-plan.md` P2-02
  (predictable DB credentials, unauthenticated Redis defaults).
  Phase C does NOT fix these — the security PR remains outstanding.
  Keep the migration scope tight.
- **Update on dispatch workflow currently has hardcoded `ghcr.io`
  references.** Verified by reading the file: its "Update manifest
  files" step builds the new image lines with `ghcr.io/...`. Phase
  E.1 (sanctuary-umbrel PR) handles this. **E.1 must merge before
  E.2's first dispatch fires** or the dispatch will write
  `ghcr.io/v0.8.53@<digest>` references for images that don't exist.
- **`update-on-dispatch.yml` uses `gh release create`** — GitHub CLI
  against api.github.com. Forgejo Actions provides a Forgejo
  GITHUB_TOKEN, not a github.com token, so this step always fails.
  Phase E.1 replaces it with the Forgejo Release API (same shape as
  `scripts/create-forge-release.sh` in this repo).
- **`update-on-dispatch.yml` references `github-actions[bot]` git
  identity and `github.com/...` URLs in commits and release notes.**
  Phase E.1 swaps to a forge-neutral identity and Codeberg URLs.
- **CI runner disk space.** arm64 cross-builds via QEMU produce
  large intermediate layers and intermediate `node_modules`
  directories. The Forgejo runner-dind container needs sufficient
  free disk during a publish run. Mitigation: include a
  `docker system prune -f` step at the start of the publish job to
  reclaim space from prior runs; monitor the dind volume free-space
  during Phase D validation.
- **No build cache on the publish path.** Each release re-builds
  from scratch with no `cache-from`/`cache-to`. Wall time is fully
  paid every release. This is acceptable for v1 — releases are
  infrequent enough. A future Phase G could add registry-cache
  support (`type=registry`) to halve subsequent build times.
- **Floating tags omitted.** No `:latest`, `:v0.8`, or `:v0` tags.
  All references must use the immutable `:vX.Y.Z` form. If anyone
  requires "latest stable" semantics, document the
  `IMAGE_REGISTRY` + `IMAGE_TAG` env-var pattern in README rather
  than introducing a mutable tag.

## Cross-references

- Memory: `feedback_forgejo_runner_concurrency.md` — the runner
  doesn't honor matrix `max-parallel`; build-and-push must be a
  single sequential job (looping images), not a fan-out matrix.
- Memory: `feedback_github_mirror_decommissioned.md` — context for
  why this work is happening at all.
- Existing workflow: `release-candidate.yml` — host for the new
  `publish-images` and `notify-umbrel` jobs.
- Existing script pattern: `scripts/ci/run-extended-upgrade-fixtures.sh`
  — the canonical "loop sequentially over a list" shape we copy in
  `build-and-push-images.sh`.
- Existing dispatch receiver: `sanctuary-umbrel/.github/workflows/update-on-dispatch.yml`
  — already implemented; we just fire it.

## Review log

- v1: initial write.
- v4: pass 3 critical review found:
  - Stale "no changes needed in sanctuary-umbrel" intro paragraph
    contradicted Phase E.1; rewrote to acknowledge E.1 scope.
  - Phase A was missing the `FORGEJO_URL` Forgejo Actions variable
    used by E.2's curl call.
  - Phase A was missing the `UMBREL_RELEASE_TOKEN` secret on the
    sanctuary-umbrel side (used by E.1's gh-release replacement).
  - Phase A's smoke test was image-only; added a workflow_dispatch
    smoke test so Phase A also verifies the dispatch token works
    end-to-end before Phases B/E build on it.
  - Sequencing reordered: E.1 + E.2 must merge BEFORE the v0.8.53
    validation release in Phase D, otherwise v0.8.53 publishes
    images but skips the Umbrel update.
  - Phase A exit criteria expanded to cover all secrets/vars + the
    dispatch smoke result.
- v3: pass 2 critical review found:
  - sanctuary-umbrel's `update-on-dispatch.yml` uses `gh release
    create` which won't work on Forgejo Actions (same root cause as
    PR #319). Phase E split into E.1 (sanctuary-umbrel refactor) and
    E.2 (Sanctuary-side dispatch firing) with explicit ordering.
  - sanctuary-umbrel's sed regex assumes `ghcr.io/...` literal —
    will not match if the file already contains `codeberg.org/...`.
    Phase E.1 widens the regex to match either prefix and rewrite to
    Codeberg.
  - sanctuary-umbrel's commit messages and release notes hardcode
    github.com URLs that no longer resolve. Phase E.1 swaps to
    Codeberg URLs.
  - sanctuary-umbrel's `github-actions[bot]` git identity is
    GitHub-flavored. Phase E.1 swaps to a forge-neutral identity.
  - Added CI runner disk space risk and `docker system prune -f`
    mitigation.
  - Added "no build cache" risk and pointer to a possible future
    Phase G.
  - Made the no-`:latest`/no-floating-tags policy explicit in the
    risks section.
- v2: pass 1 critical review found:
  - GitHub-style `repository_dispatch` 404s on Forgejo; switched to
    verified `workflow_dispatch` endpoint.
  - sanctuary-umbrel's update workflow already exists — Phase E
    halved in scope.
  - sanctuary-umbrel's docker-compose.yml currently pins
    `ghcr.io/.../sanctuary-frontend:v0.8.49@sha256:...` with digest
    pinning; Phase E must include a sanctuary-umbrel-side
    registry-URL swap or the dispatch is meaningless.
  - Locked all Phase 0 open decisions.
  - Noted `umbrel-app.yml` is at version 0.8.49 (4 releases stale)
    and that the first Codeberg dispatch jumps straight to 0.8.53.
  - Added explicit no-`:latest` policy.
  - Verified the Forgejo runner buildx supports arm64 emulation.
  - Added partial-failure semantics to the publish script spec.
  - Added native-binding (Prisma, esbuild, etc.) verification
    requirement to Phase B / risks.
  - Added timeout (90 min) to publish-images job for QEMU overhead.
  - Removed proposed `--provenance=false` flag (no evidence it's
    needed; defer to Phase D verification).
  - Removed `docker-compose.ghcr.yml` rename from Phase C; deferred
    to Phase F to minimize surface area in the migration PR.
