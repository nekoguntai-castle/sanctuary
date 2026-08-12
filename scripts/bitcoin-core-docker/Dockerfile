# Bitcoin Core built from official source
#
# This Dockerfile builds Bitcoin Core from the official GitHub repository,
# verifying release signatures to ensure authenticity.
#
# Build arguments:
#   BITCOIN_VERSION - Version to build (e.g., 27.0, 26.2)
#   TARGETARCH - Target architecture (amd64, arm64)
#
# Usage:
#   docker build --build-arg BITCOIN_VERSION=27.0 -t sanctuary-bitcoind:27.0 .

ARG BITCOIN_VERSION=27.0

# Stage 1: Build environment
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS builder

ARG BITCOIN_VERSION
ARG TARGETARCH

# Install build dependencies
RUN apt-get update && apt-get install -y \
    automake \
    autotools-dev \
    bsdmainutils \
    build-essential \
    curl \
    git \
    gnupg \
    libevent-dev \
    libboost-dev \
    libsqlite3-dev \
    libtool \
    pkg-config \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Download and verify Bitcoin Core source
# We fetch the release tarball and verify its signature
COPY verify-and-build.sh /build/
RUN chmod +x /build/verify-and-build.sh

# Download source and verify signatures
RUN /build/verify-and-build.sh download ${BITCOIN_VERSION}

# Verify signatures (this will fail the build if signatures don't verify)
RUN /build/verify-and-build.sh verify ${BITCOIN_VERSION}

# Configure and build
RUN /build/verify-and-build.sh build ${BITCOIN_VERSION}

# Stage 2: Runtime image (minimal)
FROM debian:bookworm-slim@sha256:abd67ffcfa541b485a3dff59865ab629aa048a6c613e639d36e7456b0b229241 AS runtime

# Install only runtime dependencies
RUN apt-get update && apt-get install -y \
    libevent-2.1-7 \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -r -m -d /home/bitcoin bitcoin

# Copy only the compiled binaries
COPY --from=builder /build/bitcoin-*/src/bitcoind /usr/local/bin/
COPY --from=builder /build/bitcoin-*/src/bitcoin-cli /usr/local/bin/

# Create data directory
RUN mkdir -p /home/bitcoin/.bitcoin && chown -R bitcoin:bitcoin /home/bitcoin

USER bitcoin
WORKDIR /home/bitcoin

# Expose ports (mainnet: 8332/8333, testnet: 18332/18333, regtest: 18443/18444)
EXPOSE 8332 8333 18332 18333 18443 18444

# Default to regtest mode for testing
ENTRYPOINT ["bitcoind"]
CMD ["-regtest", "-server", "-printtoconsole"]
