# CI job image for Sanctuary's Chromium-dependent browser/render E2E lanes
# ("Full Browser E2E Tests", "Full Render E2E Tests" in .github/workflows/test.yml).
#
# Extends the act base the Forgejo runner fleet already uses (docker CLI,
# node/python tool cache, act compatibility) and bakes in Playwright's OS
# dependencies, separately pinned Chrome for Testing, and Playwright's FFmpeg
# executable for video artifacts.
#
# Modelled directly on counting-cats' scripts/ci/images/playwright-runner.Dockerfile
# (see runner-infra's docs/how-to/runner-job-images.md, "Adding an image").
#
# Rebuild and retag whenever the Playwright or browser toolchain pin changes.
# The builder is owned by runner-infra: build and publish are fleet policy shared
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
# The pinned digest and this file's toolchain defaults are load-bearing:
# tests/ci/check-playwright-runner-contract.test.mjs requires the Playwright
# version to match package-lock.json and browser pins to match
# config/browser-toolchain.json, and requires both jobs'
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

# Playwright's bundled Chromium is below Sanctuary's minimum supported browser
# version. Install Playwright's OS dependencies, then fetch the independently
# pinned Chrome for Testing archive and verify it before extraction.
ARG TOOLCHAIN_VERSION=pw1.64.1-chrome157.0.8103.38
ARG PLAYWRIGHT_VERSION=1.64.1
ARG CHROME_VERSION=157.0.8103.38
ARG MINIMUM_BROWSER_VERSION=156.0.8078.73
ARG CHROME_SHA256=8cdeb344e9b2cefe59f4aea8d1d93d5d93054c03cde217665c16fc1f62e72a66
ENV PLAYWRIGHT_VERSION=${PLAYWRIGHT_VERSION} \
    CHROME_VERSION=${CHROME_VERSION} \
    MINIMUM_BROWSER_VERSION=${MINIMUM_BROWSER_VERSION} \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/chrome/chrome-linux64/chrome
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --prefix /opt/playwright --no-save --no-package-lock "playwright@${PLAYWRIGHT_VERSION}" \
 && /opt/playwright/node_modules/.bin/playwright install-deps chromium \
 && /opt/playwright/node_modules/.bin/playwright install ffmpeg \
 && curl --fail --location --silent --show-error --connect-timeout 20 --max-time 300 --retry 3 --retry-all-errors --retry-delay 2 \
      "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
      --output /tmp/chrome-for-testing.zip \
 && echo "${CHROME_SHA256}  /tmp/chrome-for-testing.zip" | sha256sum --check --status \
 && mkdir -p /opt/chrome \
 && unzip -q /tmp/chrome-for-testing.zip -d /opt/chrome \
 && /opt/chrome/chrome-linux64/chrome --version | grep -F "${CHROME_VERSION}" \
 && rm -f /tmp/chrome-for-testing.zip \
 && rm -rf /var/lib/apt/lists/*

LABEL org.opencontainers.image.title="sanctuary-ci-playwright" \
      org.opencontainers.image.description="act-ubuntu-node + Playwright ${PLAYWRIGHT_VERSION} and verified Chrome for Testing ${CHROME_VERSION}" \
      org.opencontainers.image.version="${TOOLCHAIN_VERSION}"
