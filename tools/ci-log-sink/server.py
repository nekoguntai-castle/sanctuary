#!/usr/bin/env python3
"""Sanctuary CI log sink — minimal LAN-only HTTP service for runner log uploads.

Runners on the local LAN POST/PUT failed-step log tails; tooling on the same
LAN GETs them by URL. No auth — LAN-perimeter trust only. Designed to be
run as a systemd unit on a stable LAN host.

Environment:
  SANCTUARY_CI_LOG_SINK_BIND_HOST   default 0.0.0.0
  SANCTUARY_CI_LOG_SINK_BIND_PORT   default 9090
  SANCTUARY_CI_LOG_SINK_DATA_DIR    default /var/lib/sanctuary-ci-logs
  SANCTUARY_CI_LOG_SINK_MAX_BYTES   per-file cap, default 524288 (512 KiB)
  SANCTUARY_CI_LOG_SINK_RETENTION_DAYS  default 30

Endpoints:
  PUT/POST /runs/<run_id>/<job_path>/<log_basename>
      Body is the log content (raw bytes). Stored at
      <DATA_DIR>/runs/<run_id>/<job_path>/<log_basename> after path
      sanitization. Returns 200 + JSON metadata.
  GET /runs/<run_id>/<job_path>/<log_basename>
      Streams the stored file as text/plain.
  GET /runs/                Lists run IDs.
  GET /runs/<run_id>/       Lists files under that run.
  GET /healthz              200 OK liveness probe.

Path safety: every URL component is validated against [A-Za-z0-9._-]+ and
the resolved file path is asserted to live under DATA_DIR before any I/O.

Pruning: a background thread deletes runs/<run_id> directories whose
mtime is older than RETENTION_DAYS. Runs once per hour.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import threading
import time
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional

BIND_HOST = os.environ.get("SANCTUARY_CI_LOG_SINK_BIND_HOST", "0.0.0.0")
BIND_PORT = int(os.environ.get("SANCTUARY_CI_LOG_SINK_BIND_PORT", "9090"))
DATA_DIR = Path(os.environ.get("SANCTUARY_CI_LOG_SINK_DATA_DIR", "/var/lib/sanctuary-ci-logs")).resolve()
MAX_BYTES = int(os.environ.get("SANCTUARY_CI_LOG_SINK_MAX_BYTES", str(512 * 1024)))
RETENTION_DAYS = int(os.environ.get("SANCTUARY_CI_LOG_SINK_RETENTION_DAYS", "30"))

# Shared bearer token. When set, every request to /runs/* must carry
# `Authorization: Bearer <TOKEN>`; the /healthz endpoint stays open so
# liveness probes don't need the secret. When unset, the service is
# unauthenticated — only intended for ephemeral test runs, not LAN deploys.
AUTH_TOKEN = os.environ.get("SANCTUARY_CI_LOG_SINK_TOKEN", "")

# Path components are restricted to a safe alphabet to prevent path traversal
# and to keep filesystem layout predictable across hosts.
SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9._-]+$")


def safe_join(*components: str) -> Optional[Path]:
    """Validate components and join under DATA_DIR. Returns None on rejection."""
    if not components:
        return None
    for c in components:
        if not c or not SAFE_COMPONENT.match(c):
            return None
    target = DATA_DIR.joinpath(*components).resolve()
    try:
        target.relative_to(DATA_DIR)
    except ValueError:
        return None
    return target


def parse_runs_path(url_path: str) -> Optional[list[str]]:
    """Strip leading /runs/ and split into validated components."""
    if not url_path.startswith("/runs/"):
        return None
    rest = url_path[len("/runs/") :].rstrip("/")
    if not rest:
        return []
    return rest.split("/")


class LogSinkHandler(BaseHTTPRequestHandler):
    server_version = "SanctuaryCILogSink/1.0"

    def log_message(self, format: str, *args) -> None:  # quieter default logging
        sys.stderr.write(
            f"[{self.log_date_time_string()}] {self.address_string()} {format % args}\n"
        )

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, status: int, body: bytes, content_type: str = "text/plain; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        """Constant-time bearer-token check. /healthz bypasses auth so probes
        don't need the secret. When AUTH_TOKEN is unset (test mode), accept
        all requests."""
        if not AUTH_TOKEN:
            return True
        header = self.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return False
        presented = header[len("Bearer ") :].strip()
        return hmac.compare_digest(presented, AUTH_TOKEN)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send_text(200, b"ok\n")
            return
        if not self._authorized():
            self._send_json(401, {"error": "unauthorized"})
            return
        components = parse_runs_path(self.path)
        if components is None:
            self._send_json(404, {"error": "not found"})
            return
        if not components:
            # GET /runs/ -> list run IDs
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            runs_dir = DATA_DIR / "runs"
            runs_dir.mkdir(parents=True, exist_ok=True)
            entries = sorted(p.name for p in runs_dir.iterdir() if p.is_dir())
            self._send_json(200, {"runs": entries})
            return
        target = safe_join("runs", *components)
        if target is None:
            self._send_json(400, {"error": "invalid path component"})
            return
        if target.is_dir():
            entries = sorted(p.name for p in target.iterdir())
            self._send_json(200, {"path": "/runs/" + "/".join(components), "entries": entries})
            return
        if target.is_file():
            try:
                data = target.read_bytes()
            except OSError as exc:
                self._send_json(500, {"error": f"read failed: {exc}"})
                return
            self._send_text(200, data)
            return
        self._send_json(404, {"error": "not found"})

    def _put_or_post(self) -> None:
        if not self._authorized():
            self._send_json(401, {"error": "unauthorized"})
            return
        components = parse_runs_path(self.path)
        if not components:
            self._send_json(404, {"error": "must POST/PUT under /runs/<run_id>/.../<file>"})
            return
        target = safe_join("runs", *components)
        if target is None:
            self._send_json(400, {"error": "invalid path component"})
            return
        length_header = self.headers.get("Content-Length")
        if length_header is None:
            self._send_json(411, {"error": "Content-Length required"})
            return
        try:
            length = int(length_header)
        except ValueError:
            self._send_json(400, {"error": "invalid Content-Length"})
            return
        if length < 0:
            self._send_json(400, {"error": "negative Content-Length"})
            return
        if length > MAX_BYTES:
            self._send_json(413, {"error": f"payload exceeds {MAX_BYTES} bytes"})
            return
        body = self.rfile.read(length) if length else b""
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            target.write_bytes(body)
        except OSError as exc:
            self._send_json(500, {"error": f"write failed: {exc}"})
            return
        self._send_json(
            200,
            {
                "path": "/runs/" + "/".join(components),
                "bytes": len(body),
                "stored_at": str(target),
            },
        )

    def do_PUT(self) -> None:
        self._put_or_post()

    def do_POST(self) -> None:
        self._put_or_post()


def prune_loop() -> None:
    interval_seconds = 3600
    while True:
        try:
            cutoff = time.time() - RETENTION_DAYS * 86400
            runs_dir = DATA_DIR / "runs"
            if runs_dir.is_dir():
                for run_dir in list(runs_dir.iterdir()):
                    try:
                        if run_dir.stat().st_mtime < cutoff:
                            shutil.rmtree(run_dir, ignore_errors=True)
                    except OSError:
                        continue
        except Exception as exc:  # pragma: no cover - background thread
            sys.stderr.write(f"[prune] {exc}\n")
        time.sleep(interval_seconds)


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "runs").mkdir(parents=True, exist_ok=True)
    threading.Thread(target=prune_loop, daemon=True).start()
    auth_status = "bearer-required" if AUTH_TOKEN else "OPEN (no token configured)"
    sys.stderr.write(
        f"sanctuary-ci-log-sink listening on http://{BIND_HOST}:{BIND_PORT}\n"
        f"  data_dir={DATA_DIR}\n"
        f"  max_bytes_per_file={MAX_BYTES}\n"
        f"  retention_days={RETENTION_DAYS}\n"
        f"  auth={auth_status}\n"
    )
    httpd = ThreadingHTTPServer((BIND_HOST, BIND_PORT), LogSinkHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("shutting down\n")


if __name__ == "__main__":
    main()
