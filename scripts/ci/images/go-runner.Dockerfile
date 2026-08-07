# CI job image for the Bitcoin address cross-verification lane.
#
# Extends the act base the Forgejo runner already uses (keeps the docker CLI,
# Node and act compatibility) and bakes in the Go toolchain that
# scripts/verify-addresses/implementations/go-verify.go needs.
#
# Why bake it rather than install per run: the address verifier is a five-way
# cross-check, and the Go implementation is one of the five. Without Go on the
# image it reports [UNAVAILABLE] and the check silently degrades to four-way --
# which is exactly what happened, undetected, until the fixture drift surfaced
# it. Installing Go per run would fix the strength but put a ~150 MB download on
# the critical path of a lane whose healthy runtime is under two minutes.
#
# Rebuild and retag when go.mod's Go directive changes:
#
#   scripts/ci/rebuild-go-runner-image.sh
#
# Then map a runner label to the pushed digest in the runner-infra host profiles
# (RUNNER_LABELS) and restart the runner, following the same pattern as the
# playwright-* labels.
FROM ghcr.io/catthehacker/ubuntu:act-22.04

# Pinned by version and checksum: this image is a supply-chain surface for a
# tool whose entire purpose is independent verification, so the toolchain it
# verifies with must not float.
ARG GO_VERSION=1.25.12
ARG GO_SHA256=234828b7a89e0e303d2556310ee549fbcf253d28de937bac3da13d6294262ac1

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    if [ "$arch" != "amd64" ]; then \
      echo "go-runner image is pinned for amd64; got ${arch}" >&2; exit 1; \
    fi; \
    curl -fsSL -o /tmp/go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"; \
    echo "${GO_SHA256}  /tmp/go.tar.gz" | sha256sum -c -; \
    rm -rf /usr/local/go; \
    tar -C /usr/local -xzf /tmp/go.tar.gz; \
    rm -f /tmp/go.tar.gz; \
    ln -sf /usr/local/go/bin/go /usr/local/bin/go; \
    ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt; \
    go version

LABEL org.opencontainers.image.title="sanctuary-ci-go" \
      org.opencontainers.image.description="act-22.04 + pinned Go ${GO_VERSION} for the address cross-verification lane" \
      org.opencontainers.image.version="${GO_VERSION}"
