#!/usr/bin/env python3
"""Execute pinned Blockstream Jade reference-client protocol behavior."""

from __future__ import annotations

import hashlib
import http.client
import importlib
import io
import json
import pathlib
import sys
import tarfile
import tempfile
import time
import types
import urllib.error
import urllib.request


MAX_TARBALL_BYTES = 32 * 1024 * 1024
DOWNLOAD_ATTEMPTS = 4


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def load_manifest(path: pathlib.Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    require(manifest["schemaVersion"] == 1, "Unsupported Jade harness schema")
    require(
        manifest["runtime"]["pythonVersion"] == ".".join(map(str, sys.version_info[:3])),
        "Jade harness Python version drift",
    )
    return manifest


def is_retryable_download_error(error: BaseException) -> bool:
    if isinstance(error, urllib.error.HTTPError):
        return error.code in {408, 429} or 500 <= error.code <= 599
    return isinstance(
        error,
        (
            urllib.error.URLError,
            TimeoutError,
            ConnectionResetError,
            http.client.IncompleteRead,
        ),
    )


def read_source(request: urllib.request.Request) -> bytes:
    for attempt in range(1, DOWNLOAD_ATTEMPTS + 1):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                content_length = response.headers.get("Content-Length")
                if content_length is not None:
                    require(
                        int(content_length) <= MAX_TARBALL_BYTES,
                        "Jade source tarball is oversized",
                    )
                return response.read(MAX_TARBALL_BYTES + 1)
        except (
            urllib.error.HTTPError,
            urllib.error.URLError,
            TimeoutError,
            ConnectionResetError,
            http.client.IncompleteRead,
        ) as error:
            if not is_retryable_download_error(error) or attempt == DOWNLOAD_ATTEMPTS:
                raise
            time.sleep(attempt * 2)
    raise AssertionError("unreachable Jade download retry state")


def download_source(vendor: dict) -> bytes:
    request = urllib.request.Request(
        vendor["sourceTarball"], headers={"User-Agent": "sanctuary-jade-protocol-harness/1"}
    )
    data = read_source(request)
    require(len(data) <= MAX_TARBALL_BYTES, "Jade source tarball exceeded its byte limit")
    require(
        hashlib.sha256(data).hexdigest() == vendor["sourceTarballSha256"],
        "Jade source tarball hash drift",
    )
    return data


def materialize_pinned_files(source: bytes, vendor: dict, destination: pathlib.Path) -> None:
    prefix = f"Jade-{vendor['sourceCommit']}/"
    with tarfile.open(fileobj=io.BytesIO(source), mode="r:gz") as archive:
        for relative, expected_hash in vendor["sourceFiles"].items():
            member = archive.getmember(prefix + relative)
            require(member.isfile(), f"Jade source member is not a file: {relative}")
            require(member.size <= 4 * 1024 * 1024, f"Jade source member is oversized: {relative}")
            extracted = archive.extractfile(member)
            require(extracted is not None, f"Unable to read Jade source member: {relative}")
            data = extracted.read()
            require(hashlib.sha256(data).hexdigest() == expected_hash, f"Jade source drift: {relative}")
            output = destination / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(data)


def install_import_stubs() -> None:
    cbor = types.ModuleType("cbor2")
    cbor.dumps = lambda value: value
    cbor.loads = lambda value: value
    sys.modules["cbor2"] = cbor

    serial = types.ModuleType("serial")
    serial.Serial = object
    serial.serialutil = types.SimpleNamespace(SerialException=OSError)
    serial_tools = types.ModuleType("serial.tools")
    list_ports = types.ModuleType("serial.tools.list_ports")
    list_ports.comports = lambda: []
    serial_tools.list_ports = list_ports
    serial.tools = serial_tools
    sys.modules["serial"] = serial
    sys.modules["serial.tools"] = serial_tools
    sys.modules["serial.tools.list_ports"] = list_ports


class AuthTransport:
    def __init__(self) -> None:
        self.requests: list[tuple[dict, bool]] = []

    @staticmethod
    def build_request(message_id: str, method: str, params: object) -> dict:
        return {"id": message_id, "method": method, "params": params}

    def make_rpc_call(self, request: dict, long_timeout: bool) -> dict:
        self.requests.append((request, long_timeout))
        if request["method"] == "auth_user":
            return {
                "id": request["id"],
                "result": {
                    "http_request": {
                        "params": {
                            "urls": ["https://j8d.io/get_pin", "http://jadeabc.onion/get_pin"],
                            "method": "POST",
                            "accept": "json",
                            "data": {"payload": "opaque-blind-pin-data"},
                        },
                        "on-reply": "pin",
                    }
                },
            }
        require(request["method"] == "pin", "Vendor auth continuation method drift")
        require(request["params"] == {"reply": "opaque-oracle-response"}, "Auth reply body drift")
        return {"id": request["id"], "result": True}


class PsbtTransport:
    def __init__(self) -> None:
        self.requests: list[dict] = []

    @staticmethod
    def build_request(message_id: str, method: str, params: object) -> dict:
        return {"id": message_id, "method": method, "params": params}

    def write_request(self, request: dict) -> None:
        self.requests.append(request)

    def read_response(self) -> dict:
        request = self.requests[-1]
        if request["method"] == "sign_psbt":
            return {"id": request["id"], "result": b"signed-", "seqnum": 1, "seqlen": 2}
        require(request["method"] == "get_extended_data", "Extended-data method drift")
        return {"id": request["id"], "result": b"psbt", "seqnum": 2, "seqlen": 2}

    @staticmethod
    def validate_reply(request: dict, reply: dict) -> None:
        require(request["id"] == reply["id"], "Vendor response-id correlation failed")


class ErrorTransport:
    @staticmethod
    def build_request(message_id: str, method: str, params: object) -> dict:
        return {"id": message_id, "method": method, "params": params}

    @staticmethod
    def make_rpc_call(request: dict, long_timeout: bool) -> dict:
        del long_timeout
        return {
            "id": request["id"],
            "error": {"code": -32000, "message": "locked", "data": {"retry": False}},
        }


def run_reference_cases(source_root: pathlib.Path, manifest: dict) -> list[str]:
    install_import_stubs()
    sys.path.insert(0, str(source_root))
    jade_module = importlib.import_module("jadepy.jade")
    jade_error_module = importlib.import_module("jadepy.jade_error")
    JadeAPI = jade_module.JadeAPI

    auth_transport = AuthTransport()
    oracle_requests: list[dict] = []

    def oracle(params: dict) -> dict:
        oracle_requests.append(params)
        return {"body": {"reply": "opaque-oracle-response"}}

    auth_result = JadeAPI(auth_transport).auth_user("mainnet", oracle, epoch=1_700_000_000)
    require(auth_result is True, "Vendor auth_user did not complete")
    require(len(auth_transport.requests) == 2, "Vendor auth continuation count drift")
    first_request, first_long_timeout = auth_transport.requests[0]
    require(first_request["method"] == "auth_user", "Vendor auth method drift")
    require(
        first_request["params"] == {"network": "mainnet", "epoch": 1_700_000_000},
        "Vendor auth parameters drift",
    )
    require(first_long_timeout is True, "Vendor auth no longer uses the interactive timeout")
    require(len(oracle_requests) == 1, "Vendor auth oracle request count drift")
    require(oracle_requests[0]["method"] == manifest["authBoundary"]["method"], "Oracle method drift")
    require(oracle_requests[0]["accept"] == manifest["authBoundary"]["accept"], "Oracle accept drift")

    psbt_transport = PsbtTransport()
    unsigned_psbt = b"psbt\xffbinary-input"
    signed_psbt = JadeAPI(psbt_transport).sign_psbt("testnet", unsigned_psbt)
    require(bytes(signed_psbt) == b"signed-psbt", "Vendor extended PSBT reconstruction drift")
    require(psbt_transport.requests[0]["params"]["psbt"] is unsigned_psbt, "PSBT bytes became text")
    continuation = psbt_transport.requests[1]
    require(continuation["method"] == "get_extended_data", "PSBT continuation method drift")
    require(continuation["params"]["orig"] == "sign_psbt", "PSBT continuation origin drift")
    require(continuation["params"]["origid"] == psbt_transport.requests[0]["id"], "PSBT origid drift")
    require(continuation["params"]["seqnum"] == 2, "PSBT continuation sequence drift")
    require(continuation["params"]["seqlen"] == 2, "PSBT continuation length drift")

    try:
        JadeAPI(ErrorTransport()).ping()
        raise RuntimeError("Vendor RPC error was accepted")
    except jade_error_module.JadeError as error:
        require(error.code == -32000, "Vendor error code drift")

    return ["auth-http-continuation", "binary-psbt-extended-data", "rpc-error-propagation"]


def main() -> None:
    require(len(sys.argv) == 3, "Usage: harness MANIFEST OUTPUT")
    manifest_path = pathlib.Path(sys.argv[1])
    output_path = pathlib.Path(sys.argv[2])
    manifest = load_manifest(manifest_path)
    source = download_source(manifest["vendor"])
    with tempfile.TemporaryDirectory(prefix="jade-reference-") as temporary:
        source_root = pathlib.Path(temporary)
        materialize_pinned_files(source, manifest["vendor"], source_root)
        cases = run_reference_cases(source_root, manifest)
    output_path.write_text(
        json.dumps(
            {
                "status": "passed",
                "vendorRelease": manifest["vendor"]["release"],
                "vendorCommit": manifest["vendor"]["sourceCommit"],
                "sourceTarballSha256": manifest["vendor"]["sourceTarballSha256"],
                "pythonVersion": manifest["runtime"]["pythonVersion"],
                "cases": cases,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
