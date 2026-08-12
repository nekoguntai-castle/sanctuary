#!/usr/bin/env python3
"""Negative-path tests for the pinned Jade reference harness."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest import mock


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
HARNESS_PATH = REPO_ROOT / "scripts/ci/jade-vendor-protocol-harness.py"
SPEC = importlib.util.spec_from_file_location("jade_vendor_protocol_harness", HARNESS_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load Jade vendor protocol harness")
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)


def tarball(commit: str, relative: str, payload: bytes) -> bytes:
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        member = tarfile.TarInfo(f"Jade-{commit}/{relative}")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))
    return output.getvalue()


class Response:
    def __init__(self, payload: bytes, content_length: str | None = None) -> None:
        self.payload = payload
        self.headers = {} if content_length is None else {"Content-Length": content_length}

    def __enter__(self) -> Response:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, limit: int) -> bytes:
        return self.payload[:limit]


class JadeVendorProtocolHarnessTest(unittest.TestCase):
    def test_manifest_rejects_schema_and_runtime_drift(self) -> None:
        manifest = json.loads((REPO_ROOT / "config/jade-protocol-harness.json").read_text())
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "manifest.json"
            manifest["schemaVersion"] = 2
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "Unsupported Jade harness schema"):
                HARNESS.load_manifest(path)

            manifest["schemaVersion"] = 1
            manifest["runtime"]["pythonVersion"] = "0.0.0"
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(RuntimeError, "Python version drift"):
                HARNESS.load_manifest(path)

    def test_download_rejects_declared_and_actual_oversize_content(self) -> None:
        vendor = {"sourceTarball": "https://example.invalid/source", "sourceTarballSha256": "0" * 64}
        declared = Response(b"small", str(HARNESS.MAX_TARBALL_BYTES + 1))
        with mock.patch.object(HARNESS.urllib.request, "urlopen", return_value=declared):
            with self.assertRaisesRegex(RuntimeError, "tarball is oversized"):
                HARNESS.download_source(vendor)

        payload = b"x" * (HARNESS.MAX_TARBALL_BYTES + 1)
        actual = Response(payload)
        with mock.patch.object(HARNESS.urllib.request, "urlopen", return_value=actual):
            with self.assertRaisesRegex(RuntimeError, "exceeded its byte limit"):
                HARNESS.download_source(vendor)

    def test_download_rejects_hash_drift(self) -> None:
        payload = b"pinned source"
        vendor = {"sourceTarball": "https://example.invalid/source", "sourceTarballSha256": "0" * 64}
        with mock.patch.object(HARNESS.urllib.request, "urlopen", return_value=Response(payload)):
            with self.assertRaisesRegex(RuntimeError, "tarball hash drift"):
                HARNESS.download_source(vendor)

    def test_materialization_accepts_exact_hash_and_rejects_drift(self) -> None:
        commit = "a" * 40
        relative = "jadepy/jade.py"
        payload = b"verified"
        vendor = {
            "sourceCommit": commit,
            "sourceFiles": {relative: hashlib.sha256(payload).hexdigest()},
        }
        source = tarball(commit, relative, payload)
        with tempfile.TemporaryDirectory() as temporary:
            destination = pathlib.Path(temporary)
            HARNESS.materialize_pinned_files(source, vendor, destination)
            self.assertEqual((destination / relative).read_bytes(), payload)

            vendor["sourceFiles"][relative] = "0" * 64
            with self.assertRaisesRegex(RuntimeError, "Jade source drift"):
                HARNESS.materialize_pinned_files(source, vendor, destination)

    def test_transport_stubs_reject_protocol_drift(self) -> None:
        auth = HARNESS.AuthTransport()
        request = auth.build_request("id", "pin", {"reply": "wrong"})
        with self.assertRaisesRegex(RuntimeError, "Auth reply body drift"):
            auth.make_rpc_call(request, False)

        psbt = HARNESS.PsbtTransport()
        with self.assertRaisesRegex(RuntimeError, "response-id correlation failed"):
            psbt.validate_reply({"id": "expected"}, {"id": "stale"})

        error = HARNESS.ErrorTransport.make_rpc_call(
            HARNESS.ErrorTransport.build_request("id", "ping", None),
            False,
        )
        self.assertEqual(error["error"]["code"], -32000)


if __name__ == "__main__":
    unittest.main()
