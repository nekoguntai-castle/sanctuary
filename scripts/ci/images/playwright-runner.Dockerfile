# CI job image for Sanctuary's Chromium-dependent browser/render E2E lanes
# ("Full Browser E2E Tests", "Full Render E2E Tests" in .github/workflows/test.yml).
#
# Extends the act base the Forgejo runner fleet already uses (docker CLI,
# node/python tool cache, act compatibility) and bakes in Playwright's
# Chromium + its OS dependencies. This removes the on-the-fly
# `playwright install --with-deps chromium` (an apt-get) from the critical
# path of every browser/render E2E run.
#
# Modelled directly on counting-cats' scripts/ci/images/playwright-runner.Dockerfile
# (see runner-infra's docs/how-to/runner-job-images.md, "Adding an image").
#
# Rebuild and retag whenever the lockfile's Playwright version changes. The
# builder is owned by runner-infra: build and publish are fleet policy shared
# with the other repos that ship job images, while this Dockerfile stays here
# because only this repo knows what its browser jobs need. From a
# runner-infra checkout:
#
#   scripts/ops/build-runner-image.sh --image sanctuary-ci-playwright \
#     --repo /path/to/sanctuary --push \
#     --registry nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright
#
# Unlike a runner-label image, this one is consumed directly by a job-level
# `container:` block (runner-infra's docs/how-to/runner-job-images.md,
# "Prefer container: for new images" -- see .github/workflows/test.yml's
# full-browser-e2e-tests / full-render-e2e-tests). Paste the digest the
# build prints straight into both jobs' `container.image`:
#
#   image: nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-playwright@sha256:...
#
# There is no runner label, no config/runner-images.env entry, and no host
# re-render for this image -- the digest change lands entirely in this
# repo's own PR (see docs/reference/ci-cd-strategy.md's "CI job images"
# note).
#
# The pinned digest and this file's default PLAYWRIGHT_VERSION are both
# load-bearing beyond documentation:
# tests/ci/check-playwright-runner-contract.test.mjs requires this file's
# default PLAYWRIGHT_VERSION to equal the version node_modules/playwright-core
# resolves to in package-lock.json (so a Playwright bump cannot silently
# desync the Dockerfile from the lockfile), and requires both jobs'
# container.image to pin the same real digest (not the
# PLAYWRIGHT_IMAGE_DIGEST_PENDING placeholder left until the image above is
# built and pushed).
#
# THE BASE
#
# act-ubuntu-node is runner-infra's fleet base: the mirrored act-22.04 image
# with Node and Python pre-placed in /opt/hostedtoolcache. Inheriting it means
# this image pulls from the internal registry (not ghcr.io) and gets the
# actions/setup-node tool-cache hit like every other fleet image.
#
# Pinned by digest, like every other image reference in the fleet: a tag here
# would let the base change under CI with no commit in this repository.
# Bumping it means taking a new digest from runner-infra's act-ubuntu-node
# build and rebuilding this image on top.
FROM nexus.tabineko.dev/nekoguntai-castle/act-ubuntu-node@sha256:9a9cf26dae68eb81e0446f91f81427b0c65c380371225b47ece9ddb407a68891

# Exact version from the lockfile (node_modules/playwright-core in
# package-lock.json), so the image cannot drift from what the repo installs.
# Baking Chromium removes `playwright install --with-deps` from the critical
# path -- the step that has previously hung for hours on a transient
# apt-mirror outage (see CLAUDE.md's Docker Commands / CI section).
ARG PLAYWRIGHT_VERSION=1.63.0
RUN npx --yes playwright@${PLAYWRIGHT_VERSION} install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="sanctuary-ci-playwright" \
      org.opencontainers.image.description="act-ubuntu-node + baked Playwright ${PLAYWRIGHT_VERSION} Chromium + deps for Sanctuary's browser/render E2E lanes" \
      org.opencontainers.image.version="${PLAYWRIGHT_VERSION}"
