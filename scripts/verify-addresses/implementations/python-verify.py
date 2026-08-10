#!/usr/bin/env python3
"""Independent bip_utils BIP39/BIP32 batch address verifier."""

import hashlib
import importlib.metadata
import json
import os
import platform
import sys

try:
    import bip_utils
    from bip_utils import (
        Base58Encoder,
        Bip32Secp256k1,
        Bip39SeedGenerator,
        P2TRAddr,
        P2TRAddrDecoder,
        SegwitBech32Encoder,
    )
    AVAILABLE = True
except ImportError:
    bip_utils = None
    AVAILABLE = False


VERSIONS = {
    "xpub": "0488b21e", "ypub": "049d7cb2", "zpub": "04b24746",
    "Ypub": "0295b43f", "Zpub": "02aa7ed3", "tpub": "043587cf",
    "upub": "044a5262", "vpub": "045f1cf6", "Upub": "024289ef",
    "Vpub": "02575483",
}


def source_sha256():
    with open(__file__, "rb") as source_file:
        return hashlib.sha256(source_file.read()).hexdigest()


def dependency_fingerprint():
    excluded = {"pip", "setuptools"}
    packages = sorted(
        f"{distribution.metadata['Name'].lower()}=={distribution.version}"
        for distribution in importlib.metadata.distributions()
        if distribution.metadata["Name"].lower() not in excluded
    )
    return hashlib.sha256("\n".join(packages).encode()).hexdigest()


def ripemd160(payload):
    if os.environ.get("VERIFY_ADDRESSES_FORCE_RIPEMD160_FALLBACK") != "1":
        try:
            return hashlib.new("ripemd160", payload).digest()
        except (ValueError, TypeError):
            pass
    if AVAILABLE and hasattr(bip_utils, "Ripemd160"):
        return bip_utils.Ripemd160.QuickDigest(payload)
    raise RuntimeError("RIPEMD160 is unavailable from hashlib and bip_utils")


def hash160(payload):
    return ripemd160(hashlib.sha256(payload).digest())


def network_params(chain):
    if chain == "mainnet":
        return b"\x00", b"\x05", "bc"
    if chain in ("testnet3", "testnet4", "signet"):
        return b"\x6f", b"\xc4", "tb"
    if chain == "regtest":
        return b"\x6f", b"\xc4", "bcrt"
    raise ValueError(f"unsupported chain environment: {chain}")


def parse_path(path):
    if not path.startswith("m/"):
        raise ValueError(f"invalid absolute BIP32 path: {path}")
    result = []
    for component in path[2:].split("/"):
        hardened = component.endswith(("'", "h", "H"))
        number = component[:-1] if hardened else component
        index = int(number)
        if index < 0 or index >= 0x80000000:
            raise ValueError(f"invalid BIP32 path component: {component}")
        result.append(index | (0x80000000 if hardened else 0))
    return result


def derive_path(root, path):
    node = root
    parent = root
    for index in parse_path(path):
        parent = node
        node = node.ChildKey(index)
    return node, parent


def account_evidence(seed_id, root, account, parent, case):
    public_key = account.PublicKey().RawCompressed().ToBytes()
    parent_key = parent.PublicKey().RawCompressed().ToBytes()
    master_key = root.PublicKey().RawCompressed().ToBytes()
    child_number = parse_path(case["accountPath"])[-1]
    payload = (
        bytes([len(parse_path(case["accountPath"]))])
        + hash160(parent_key)[:4]
        + child_number.to_bytes(4, "big")
        + account.ChainCode().ToBytes()
        + public_key
    )
    version = bytes.fromhex(VERSIONS[case["slip132Format"]])
    return {
        "seedId": seed_id,
        "masterFingerprint": hash160(master_key)[:4].hex(),
        "originPath": case["accountPath"],
        "encoded": Base58Encoder.CheckEncode(version + payload),
        "versionHex": version.hex(),
        "depth": payload[0],
        "parentFingerprint": payload[1:5].hex(),
        "childNumber": child_number,
        "chainCodeHex": payload[9:41].hex(),
        "publicKeyHex": payload[41:74].hex(),
        "payloadHex": payload.hex(),
    }


def multisig_script(pubkeys, threshold):
    if not 1 <= threshold <= len(pubkeys) <= 16:
        raise ValueError("invalid multisig quorum")
    ordered = sorted(pubkeys)
    return (
        bytes([0x50 + threshold])
        + b"".join(bytes([len(key)]) + key for key in ordered)
        + bytes([0x50 + len(ordered), 0xae])
    )


def single_result(pubkey, script_type, chain):
    p2pkh, p2sh, hrp = network_params(chain)
    key_hash = hash160(pubkey)
    if script_type == "legacy":
        address = Base58Encoder.CheckEncode(p2pkh + key_hash)
        script = b"\x76\xa9\x14" + key_hash + b"\x88\xac"
    elif script_type == "nested_segwit":
        redeem = b"\x00\x14" + key_hash
        redeem_hash = hash160(redeem)
        address = Base58Encoder.CheckEncode(p2sh + redeem_hash)
        script = b"\xa9\x14" + redeem_hash + b"\x87"
    elif script_type == "native_segwit":
        address = SegwitBech32Encoder.Encode(hrp, 0, key_hash)
        script = b"\x00\x14" + key_hash
    elif script_type == "taproot":
        address = P2TRAddr.EncodeKey(pubkey, hrp=hrp)
        output_key = P2TRAddrDecoder.DecodeAddr(address, hrp=hrp)
        script = b"\x51\x20" + output_key
    else:
        raise ValueError(f"unsupported single-sig script type: {script_type}")
    return address, script.hex()


def multisig_result(pubkeys, threshold, script_type, chain):
    _, p2sh, hrp = network_params(chain)
    witness_script = multisig_script(pubkeys, threshold)
    witness_hash = hashlib.sha256(witness_script).digest()
    if script_type == "p2wsh":
        address = SegwitBech32Encoder.Encode(hrp, 0, witness_hash)
        output_script = b"\x00\x20" + witness_hash
    elif script_type == "p2sh_p2wsh":
        redeem_hash = hash160(b"\x00\x20" + witness_hash)
        address = Base58Encoder.CheckEncode(p2sh + redeem_hash)
        output_script = b"\xa9\x14" + redeem_hash + b"\x87"
    else:
        raise ValueError(f"unsupported multisig script type: {script_type}")
    return address, output_script.hex()


def derive_case(case, seeds, version):
    if len(set(case["seedIds"])) != len(case["seedIds"]):
        raise ValueError(f'duplicate seed-derived account key in {case["id"]}')
    account_keys = []
    child_pubkeys = []
    seen_account_keys = set()
    for seed_id in case["seedIds"]:
        mnemonic = seeds[seed_id]
        seed = Bip39SeedGenerator(mnemonic).Generate()
        root = Bip32Secp256k1.FromSeed(seed)
        account, parent = derive_path(root, case["accountPath"])
        key_evidence = account_evidence(seed_id, root, account, parent, case)
        key_identity = (key_evidence["chainCodeHex"], key_evidence["publicKeyHex"])
        if key_identity in seen_account_keys:
            raise ValueError(f'duplicate derived account key material in {case["id"]}')
        seen_account_keys.add(key_identity)
        account_keys.append(key_evidence)
        child = account.ChildKey(case["branch"]).ChildKey(case["index"])
        child_pubkeys.append(child.PublicKey().RawCompressed().ToBytes())
    if case["kind"] == "single_sig":
        address, script = single_result(child_pubkeys[0], case["scriptType"], case["chain"])
    else:
        address, script = multisig_result(
            child_pubkeys, case["threshold"], case["scriptType"], case["chain"]
        )
    return {
        "caseId": case["id"],
        "implementation": "bip_utils (Python)",
        "implementationVersion": version,
        "evidenceScope": "seed-to-account-and-output",
        "accountKeys": account_keys,
        "address": address,
        "scriptPubKeyHex": script,
    }


def batch():
    request = json.load(sys.stdin)
    cases = request.get("cases")
    seed_rows = request.get("seeds")
    if not isinstance(cases, list) or not isinstance(seed_rows, list):
        raise ValueError("batch request requires cases and seeds arrays")
    seeds = {row["id"]: row["mnemonic"] for row in seed_rows}
    version = getattr(bip_utils, "__version__", "unknown")
    return {"evidence": [derive_case(case, seeds, version) for case in cases]}


def main():
    command = sys.argv[1] if len(sys.argv) == 2 else None
    if command == "check":
        print(json.dumps({
            "available": AVAILABLE,
            "version": getattr(bip_utils, "__version__", None) if AVAILABLE else None,
            "pythonVersion": platform.python_version(),
            "effectiveUid": os.geteuid(),
            "dependencyFingerprint": dependency_fingerprint(),
            "sourceSha256": source_sha256(),
        }))
        return
    if command != "batch":
        raise ValueError("usage: python-verify.py check|batch")
    if not AVAILABLE:
        raise RuntimeError("bip_utils is not installed")
    print(json.dumps(batch(), separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
