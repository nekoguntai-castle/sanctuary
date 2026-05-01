#!/usr/bin/env python3
"""
Python Address Verification Script

Uses bip_utils library for address derivation - completely independent
from JavaScript implementations.

Usage:
    python python-verify.py single <xpub> <index> <script_type> <change> <network>
    python python-verify.py multi <xpubs_json> <threshold> <index> <script_type> <change> <network>

Output:
    JSON with { "address": "..." } or { "error": "..." }
"""

import sys
import json
from typing import List

try:
    import bip_utils
    from bip_utils import (
        Base58Decoder,
        Base58Encoder,
        Bip32Secp256k1,
        P2TRAddr,
        SegwitBech32Encoder,
    )
    HAS_BIP_UTILS = True
except ImportError:
    bip_utils = None
    HAS_BIP_UTILS = False

try:
    # Alternative: python-bitcoinlib
    import bitcoin
    from bitcoin.core import CScript
    from bitcoin.core.script import OP_0, OP_CHECKMULTISIG
    from bitcoin.wallet import P2PKHBitcoinAddress, P2SHBitcoinAddress, P2WPKHBitcoinAddress
    HAS_PYTHON_BITCOINLIB = True
except ImportError:
    HAS_PYTHON_BITCOINLIB = False


def hash160(payload: bytes) -> bytes:
    """Bitcoin HASH160: RIPEMD160(SHA256(payload))."""
    import hashlib

    return hashlib.new('ripemd160', hashlib.sha256(payload).digest()).digest()


def network_params(network: str) -> tuple[bytes, bytes, str]:
    """Return P2PKH version, P2SH version, and SegWit HRP for the network."""
    if network == 'mainnet':
        return bytes([0x00]), bytes([0x05]), 'bc'
    if network == 'testnet':
        return bytes([0x6F]), bytes([0xC4]), 'tb'
    raise ValueError(f"Unsupported network: {network}")


def standard_xpub(xpub: str, network: str) -> str:
    """Convert extended pubkeys to xpub version bytes accepted by bip_utils."""
    prefix = xpub[:4]
    if prefix == 'xpub':
        return xpub

    decoded = Base58Decoder.CheckDecode(xpub)
    new_version = bytes([0x04, 0x88, 0xB2, 0x1E])
    return Base58Encoder.CheckEncode(new_version + decoded[4:])


def derive_pub_key(xpub: str, index: int, change: bool, network: str) -> bytes:
    """Derive the compressed public key at change/index from an account xpub."""
    bip32_ctx = Bip32Secp256k1.FromExtendedKey(standard_xpub(xpub, network))
    change_idx = 1 if change else 0
    derived = bip32_ctx.DerivePath(f"{change_idx}/{index}")
    return derived.PublicKey().RawCompressed().ToBytes()


def base58check_address(version: bytes, payload: bytes) -> str:
    return Base58Encoder.CheckEncode(version + payload)


def derive_single_sig_bip_utils(xpub: str, index: int, script_type: str, change: bool, network: str) -> str:
    """Derive single-sig address using bip_utils primitives."""
    p2pkh_version, p2sh_version, bech32_hrp = network_params(network)
    pub_key = derive_pub_key(xpub, index, change, network)

    # Generate address based on script type
    if script_type == 'legacy':
        return base58check_address(p2pkh_version, hash160(pub_key))

    elif script_type == 'nested_segwit':
        witness_program = bytes([0x00, 0x14]) + hash160(pub_key)
        return base58check_address(p2sh_version, hash160(witness_program))

    elif script_type == 'native_segwit':
        return SegwitBech32Encoder.Encode(bech32_hrp, 0, hash160(pub_key))

    elif script_type == 'taproot':
        return P2TRAddr.EncodeKey(pub_key, hrp=bech32_hrp)

    else:
        raise ValueError(f"Unknown script type: {script_type}")


def derive_multisig_bip_utils(xpubs: List[str], threshold: int, index: int,
                               script_type: str, change: bool, network: str) -> str:
    """Derive multisig address using bip_utils primitives."""
    import hashlib

    _, p2sh_version, bech32_hrp = network_params(network)

    # Derive public keys from each xpub
    pub_keys = []
    for xpub in xpubs:
        pub_keys.append(derive_pub_key(xpub, index, change, network))

    # Sort public keys (BIP-67)
    pub_keys.sort()

    # Build multisig redeem script
    # OP_M <pubkey1> <pubkey2> ... <pubkeyN> OP_N OP_CHECKMULTISIG
    redeem_script = bytes([0x50 + threshold])  # OP_M
    for pk in pub_keys:
        redeem_script += bytes([len(pk)]) + pk
    redeem_script += bytes([0x50 + len(pub_keys)])  # OP_N
    redeem_script += bytes([0xAE])  # OP_CHECKMULTISIG

    # Hash the redeem script
    script_hash = hashlib.sha256(redeem_script).digest()
    script_hash_160 = hashlib.new('ripemd160', script_hash).digest()

    if script_type == 'p2sh':
        # P2SH: hash160 of redeem script
        return base58check_address(p2sh_version, script_hash_160)

    elif script_type == 'p2wsh':
        # P2WSH: SHA256 of witness script (same as redeem script for multisig)
        return SegwitBech32Encoder.Encode(bech32_hrp, 0, script_hash)

    elif script_type == 'p2sh_p2wsh':
        # P2SH-P2WSH: P2SH wrapping P2WSH
        # Create witness script hash (SHA256)
        witness_program = bytes([0x00, 0x20]) + script_hash
        # Hash160 of the witness program
        wp_hash = hashlib.new('ripemd160', hashlib.sha256(witness_program).digest()).digest()
        return base58check_address(p2sh_version, wp_hash)

    else:
        raise ValueError(f"Unknown multisig script type: {script_type}")


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python-verify.py <command> <args>"}))
        sys.exit(1)

    command = sys.argv[1]

    if command == "check":
        # Check if library is available
        print(json.dumps({
            "available": HAS_BIP_UTILS,
            "version": getattr(bip_utils, "__version__", "unknown") if HAS_BIP_UTILS else None,
            "name": "bip_utils"
        }))
        sys.exit(0)

    if not HAS_BIP_UTILS:
        print(json.dumps({"error": "bip_utils library not installed. Run: pip install bip_utils"}))
        sys.exit(1)

    try:
        if command == "single":
            # single <xpub> <index> <script_type> <change> <network>
            if len(sys.argv) != 7:
                print(json.dumps({"error": "Usage: single <xpub> <index> <script_type> <change> <network>"}))
                sys.exit(1)

            xpub = sys.argv[2]
            index = int(sys.argv[3])
            script_type = sys.argv[4]
            change = sys.argv[5].lower() == 'true'
            network = sys.argv[6]

            address = derive_single_sig_bip_utils(xpub, index, script_type, change, network)
            print(json.dumps({"address": address}))

        elif command == "multi":
            # multi <xpubs_json> <threshold> <index> <script_type> <change> <network>
            if len(sys.argv) != 8:
                print(json.dumps({"error": "Usage: multi <xpubs_json> <threshold> <index> <script_type> <change> <network>"}))
                sys.exit(1)

            xpubs = json.loads(sys.argv[2])
            threshold = int(sys.argv[3])
            index = int(sys.argv[4])
            script_type = sys.argv[5]
            change = sys.argv[6].lower() == 'true'
            network = sys.argv[7]

            address = derive_multisig_bip_utils(xpubs, threshold, index, script_type, change, network)
            print(json.dumps({"address": address}))

        else:
            print(json.dumps({"error": f"Unknown command: {command}"}))
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
