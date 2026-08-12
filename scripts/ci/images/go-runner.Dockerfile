# CI job image for the Bitcoin address cross-verification lane.
#
# Extends the act base the Forgejo runner already uses (keeps the docker CLI,
# act compatibility) and bakes in the exact Node, npm, and Go toolchains that
# scripts/verify-addresses/implementations/go-verify.go needs.
#
# Why bake it rather than install per run: the address verifier is a five-way
# cross-check, and the Go implementation is one of the five. Without Go on the
# image it reports [UNAVAILABLE] and the check silently degrades to four-way --
# which is exactly what happened, undetected, until the fixture drift surfaced
# it. Installing Go per run would fix the strength but put a ~150 MB download on
# the critical path of a lane whose healthy runtime is under two minutes.
#
# This Dockerfile lives here, not in runner-infra, on purpose: a clone of this
# repository should describe its own CI environment, and the Go version belongs
# next to the go.mod that requires it. runner-infra owns building and publishing
# it, because that logic is fleet policy shared with counting-cats' image.
#
# Rebuild and retag when the pinned version changes:
#
#   cd ~/runner-infra
#   scripts/ops/build-runner-image.sh --image sanctuary-ci-go --repo ~/sanctuary \
#     --push --registry nexus.tabineko.dev/nekoguntai-castle/sanctuary-ci-go
#
# That prints the digest-pinned label mapping; add it to runner-infra's
# config/runner-images.env and re-render each host. See
# runner-infra/docs/how-to/runner-job-images.md.
FROM ghcr.io/catthehacker/ubuntu:act-22.04@sha256:41e84facdece5f25b0de00cd69969f5f032c54f5bb7313f385727330db9ac40f

# Pinned by version and checksum: this image is a supply-chain surface for a
# tool whose entire purpose is independent verification, so the toolchain it
# verifies with must not float.
ARG NODE_VERSION=24.19.0
ARG NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647
ARG NPM_VERSION=11.19.0
ARG NPM_SHA512=48377f8478372aa1c4e47b763475b135836da82436a5700f2e5e8eb5084fc840f93c7b117eb3ad3b5f7d3194c81b6710a10d59448f6ddbcb21ac3fb672bdc003
ARG GO_VERSION=1.25.12
ARG GO_SHA256=234828b7a89e0e303d2556310ee549fbcf253d28de937bac3da13d6294262ac1

# The act base prepends its own toolcache. Put the checksum-pinned toolchain
# first so both the build verification and every job use the baked binaries.
ENV PATH="/usr/local/bin:${PATH}" \
    GOTOOLCHAIN="local"

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" != "amd64" ]; then \
      echo "go-runner image is pinned for amd64; got ${arch}" >&2; exit 1; \
    fi; \
    curl -fsSL -o /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz"; \
    echo "${NODE_SHA256}  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -C /usr/local --strip-components=1 -xJf /tmp/node.tar.xz; \
    rm -f /tmp/node.tar.xz; \
    curl -fsSL -o /tmp/npm.tgz "https://registry.npmjs.org/npm/-/npm-${NPM_VERSION}.tgz"; \
    echo "${NPM_SHA512}  /tmp/npm.tgz" | sha512sum -c -; \
    npm install --global --audit=false --fund=false /tmp/npm.tgz; \
    rm -f /tmp/npm.tgz; \
    test "$(node --version)" = "v${NODE_VERSION}"; \
    test "$(npm --version)" = "${NPM_VERSION}"; \
    curl -fsSL -o /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"; \
    echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c -; \
    rm -rf /usr/local/go; \
    tar -C /usr/local -xzf /tmp/go.tar.gz; \
    rm -f /tmp/go.tar.gz; \
    ln -sf /usr/local/go/bin/go /usr/local/bin/go; \
    ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt; \
    go version

LABEL org.opencontainers.image.title="sanctuary-ci-go" \
      org.opencontainers.image.description="act-22.04 + pinned Node ${NODE_VERSION}, npm ${NPM_VERSION}, and Go ${GO_VERSION} for wallet verification" \
      org.opencontainers.image.version="node-${NODE_VERSION}-npm-${NPM_VERSION}-go-${GO_VERSION}"
