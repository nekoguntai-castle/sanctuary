#!/bin/bash
#
# Bitcoin Core Download, Verification, and Build Script
#
# This script ensures we build from verified, authentic Bitcoin Core source.
# It downloads the source tarball and verifies signatures against known
# Bitcoin Core maintainer keys.
#
# Usage:
#   ./verify-and-build.sh download VERSION   # Download source
#   ./verify-and-build.sh verify VERSION     # Verify signatures
#   ./verify-and-build.sh build VERSION      # Configure and build

set -euo pipefail

BITCOIN_CORE_REPO="https://bitcoincore.org/bin"
GITHUB_REPO="https://github.com/bitcoin/bitcoin"

# Bitcoin Core maintainer signing keys (from https://github.com/bitcoin-core/guix.sigs)
# These are the fingerprints of keys that can sign Bitcoin Core releases
MAINTAINER_KEYS=(
    # Wladimir J. van der Laan (retired, but signed older releases)
    "71A3B16735405025D447E8F274810B012346C9A6"
    # Pieter Wuille
    "133EAC179436F14A5CF1B794860FEB804E669320"
    # Michael Ford (fanquake)
    "E777299FC265DD04793070EB944D35F9AC3DB76A"
    # Hennadii Stepanov (hebasto)
    "D1DBF2C4B96F2DEBF4C16654410108112E7EA81F"
    # Andrew Chow
    "152812300785C96444D3334D17565732E08E5E41"
    # Gloria Zhao
    "6B002C6EA3F91B1B0DF0C9BC8F617F1200A6D25C"
    # Ryan Ofsky
    "F4FC70F07310028424EFC20A8E4256593F177720"
    # Sebastian Falbesoner (theStack)
    "CFB16E21C950F67FA95E558F2EEB9F5CC09526C1"
    # Ava Chow
    "17565732E08E5E41BD59C6BCDC0389B14CADDDFC"
)

download_source() {
    local version=$1
    echo "=== Downloading Bitcoin Core v${version} ==="

    # Download source tarball
    local tarball="bitcoin-${version}.tar.gz"
    local url="${BITCOIN_CORE_REPO}/bitcoin-core-${version}/${tarball}"

    echo "Downloading ${url}..."
    curl -fSL --connect-timeout 20 --max-time 300 --retry 3 --retry-delay 2 -o "${tarball}" "${url}"

    # Download SHA256SUMS and signatures
    echo "Downloading checksums and signatures..."
    curl -fSL --connect-timeout 20 --max-time 300 --retry 3 --retry-delay 2 -o "SHA256SUMS" "${BITCOIN_CORE_REPO}/bitcoin-core-${version}/SHA256SUMS"
    curl -fSL --connect-timeout 20 --max-time 300 --retry 3 --retry-delay 2 -o "SHA256SUMS.asc" "${BITCOIN_CORE_REPO}/bitcoin-core-${version}/SHA256SUMS.asc"

    echo "Download complete."
}

import_keys() {
    echo "=== Importing Bitcoin Core maintainer keys ==="

    # Create a temporary GPG home to avoid polluting system keyring
    export GNUPGHOME=$(mktemp -d)

    # Import keys from keyserver
    for key in "${MAINTAINER_KEYS[@]}"; do
        echo "Importing key ${key}..."
        gpg --keyserver hkps://keys.openpgp.org --recv-keys "${key}" 2>/dev/null || \
        gpg --keyserver hkps://keyserver.ubuntu.com --recv-keys "${key}" 2>/dev/null || \
        echo "Warning: Could not import key ${key}"
    done

    # Also try importing from GitHub builder-keys repo
    echo "Fetching additional keys from bitcoin-core/guix.sigs..."
    curl -fsSL "https://raw.githubusercontent.com/bitcoin-core/guix.sigs/main/builder-keys/keys.txt" 2>/dev/null | \
        gpg --import 2>/dev/null || true

    echo "Key import complete."
}

verify_signatures() {
    local version=$1
    echo "=== Verifying Bitcoin Core v${version} signatures ==="

    # Import maintainer keys
    import_keys

    # Verify the SHA256SUMS file signature
    echo "Verifying SHA256SUMS.asc signature..."

    # We need at least one valid signature from a known key
    if ! gpg --verify SHA256SUMS.asc SHA256SUMS 2>&1 | grep -q "Good signature"; then
        echo "ERROR: No valid signature found on SHA256SUMS"
        echo "This could indicate a compromised download. Aborting."
        exit 1
    fi

    echo "Signature verification passed!"

    # Now verify the tarball checksum
    local tarball="bitcoin-${version}.tar.gz"
    echo "Verifying tarball checksum..."

    # Extract the expected checksum
    local expected_checksum=$(grep "${tarball}" SHA256SUMS | awk '{print $1}')
    local actual_checksum=$(sha256sum "${tarball}" | awk '{print $1}')

    if [ "${expected_checksum}" != "${actual_checksum}" ]; then
        echo "ERROR: Checksum mismatch!"
        echo "Expected: ${expected_checksum}"
        echo "Actual:   ${actual_checksum}"
        exit 1
    fi

    echo "Checksum verification passed!"

    # Extract the verified source
    echo "Extracting verified source..."
    tar -xzf "${tarball}"

    echo "Verification complete. Source is authentic."
}

build_bitcoin() {
    local version=$1
    echo "=== Building Bitcoin Core v${version} ==="

    cd "bitcoin-${version}"

    # Use autogen if available (for git builds), otherwise just configure
    if [ -f "autogen.sh" ]; then
        ./autogen.sh
    fi

    # Configure for minimal daemon-only build (no GUI, no wallet)
    # This is sufficient for address derivation via deriveaddresses RPC
    ./configure \
        --disable-wallet \
        --disable-tests \
        --disable-bench \
        --disable-gui-tests \
        --without-gui \
        --with-daemon \
        --disable-man \
        --disable-zmq \
        CFLAGS="-O2" \
        CXXFLAGS="-O2"

    # Build (use available CPU cores)
    make -j$(nproc)

    echo "Build complete."

    # Verify the binary works
    echo "Testing built binary..."
    ./src/bitcoind --version
    ./src/bitcoin-cli --version

    echo "Bitcoin Core v${version} built and verified successfully!"
}

# Main entry point
case "${1:-help}" in
    download)
        download_source "$2"
        ;;
    verify)
        verify_signatures "$2"
        ;;
    build)
        build_bitcoin "$2"
        ;;
    all)
        download_source "$2"
        verify_signatures "$2"
        build_bitcoin "$2"
        ;;
    help|*)
        echo "Usage: $0 {download|verify|build|all} VERSION"
        echo ""
        echo "Commands:"
        echo "  download VERSION  - Download Bitcoin Core source tarball"
        echo "  verify VERSION    - Verify signatures and checksums"
        echo "  build VERSION     - Configure and build Bitcoin Core"
        echo "  all VERSION       - Do all steps"
        exit 1
        ;;
esac
