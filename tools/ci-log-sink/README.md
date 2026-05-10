# Sanctuary CI log sink

Tiny LAN-only HTTP service that accepts failed-step log tails from Forgejo
runners and serves them back over HTTP. Solves the gap that Forgejo 15.0.1's
Actions API has no public endpoint for fetching job logs — investigators
(human or LLM agent) need a way to grab failure context without browser /
session-cookie access.

## Architecture

Every CI lane already wraps long-running steps with `scripts/ci/run-with-log.sh`
and follows up with `scripts/ci/write-diagnostic-summary.sh`. The summary
helper now invokes `scripts/ci/publish-failed-logs.sh`, which `PUT`s each
failed log tail (capped at 256 KiB to match the inline echo) to this sink
under a stable URL.

URL shape:

    http://<sink-host>:9090/runs/<run_id>/<job_safe_name>/<log_basename>

After a CI failure, fetch the log directly:

    curl http://10.14.23.20:9090/runs/2180/quick-critical-mutation-shard-1/critical-mutation-gate.log

## Trust model

LAN-only with a single shared bearer token. Two layers:

1. **Bind to a private LAN IP**, not `0.0.0.0`. Removes the failure mode
   where a misconfigured router or VPN bridge accidentally exposes :9090
   to the WAN.
2. **Bearer token** on every `/runs/*` request (`Authorization: Bearer
   <token>`). When `SANCTUARY_CI_LOG_SINK_TOKEN` is unset on the server,
   the service runs unauthenticated — only intended for ephemeral test
   runs, not LAN deploys. The startup log line shows `auth=bearer-required`
   or `auth=OPEN` so misconfiguration is visible.

`/healthz` is unauthenticated so liveness probes don't need the secret.

Logs are still piped through `scripts/ci/redactor.sh` before upload, so
accidental secret leakage is mitigated at the source even if a token were
to leak.

### Token lifecycle

- Generate once: `openssl rand -hex 32`.
- **CI runners**: store as a Forgejo Actions *secret* (Settings → Actions →
  Secrets, name `SANCTUARY_CI_LOG_SINK_TOKEN`). Workflows expose it via
  `env: SANCTUARY_CI_LOG_SINK_TOKEN: ${{ secrets.SANCTUARY_CI_LOG_SINK_TOKEN }}`
  so it's masked in logs and unavailable to forks.
- **Local readers** (Claude Code, dashboards): store at
  `~/.config/sanctuary/ci-log-sink-token` mode `0600`. Pass via
  `Authorization: Bearer "$(cat ~/.config/sanctuary/ci-log-sink-token)"`.
- **Sink host**: store in the platform's secret-env mechanism (LaunchAgent
  `EnvironmentVariables` block; systemd `EnvironmentFile` referencing a
  `0600` root-owned file). Never commit the token to the repo.
- **Rotation**: generate new token → update Forgejo secret → update sink
  env → reload service. Existing runs keep working until the old run's
  step concludes; new requests use the new token.

## Storage

Files live under `/var/lib/sanctuary-ci-logs/runs/<run_id>/<job>/<log>`.
Each individual upload is capped at 512 KiB
(`SANCTUARY_CI_LOG_SINK_MAX_BYTES`). A background thread prunes
`runs/<run_id>` directories whose mtime is older than 30 days
(`SANCTUARY_CI_LOG_SINK_RETENTION_DAYS`).

## Install on a LAN host

### Linux (systemd)

```bash
# 1. Copy the service files
sudo install -d /opt/sanctuary-ci-log-sink
sudo install -m 0755 server.py /opt/sanctuary-ci-log-sink/server.py
sudo install -m 0644 sanctuary-ci-log-sink.service /etc/systemd/system/

# 2. Start the service
sudo systemctl daemon-reload
sudo systemctl enable --now sanctuary-ci-log-sink.service

# 3. Verify
curl -fsS http://localhost:9090/healthz   # should print: ok
ss -tnlp | grep 9090
```

The service uses systemd `DynamicUser=yes` and `StateDirectory=sanctuary-ci-logs`,
so the data directory is auto-created with correct ownership.

### macOS (per-user LaunchAgent — no sudo)

```bash
# 1. Place server + token file under $HOME
mkdir -p ~/sanctuary-ci-log-sink/data
cp server.py ~/sanctuary-ci-log-sink/server.py
chmod +x ~/sanctuary-ci-log-sink/server.py
openssl rand -hex 32 > ~/sanctuary-ci-log-sink/token
chmod 600 ~/sanctuary-ci-log-sink/token

# 2. Resolve the LAN IP this host should bind to
LAN_IP="$(ipconfig getifaddr en0)"   # adjust interface as needed
echo "Binding sink to $LAN_IP"

# 3. Materialize the plist with $HOME, the LAN IP, and the token interpolated
TOKEN="$(cat ~/sanctuary-ci-log-sink/token)"
sed -e "s#HOME_PATH#$HOME#g" \
    -e "s#BIND_HOST_PLACEHOLDER#$LAN_IP#g" \
    -e "s#AUTH_TOKEN_PLACEHOLDER#$TOKEN#g" \
    dev.sanctuary.ci-log-sink.plist \
  > ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist
chmod 600 ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist

# 4. Load + start
launchctl unload -w ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist 2>/dev/null || true
launchctl load -w ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist

# 5. Verify
curl -fsS "http://$LAN_IP:9090/healthz"     # should print: ok (no token needed)
curl -fsS -H "Authorization: Bearer $TOKEN" "http://$LAN_IP:9090/runs/"
lsof -nP -iTCP:9090 -sTCP:LISTEN            # should show python3 bound to LAN_IP
```

Logs land in `~/sanctuary-ci-log-sink/sink.log`. Unload with
`launchctl unload -w ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist`.

The plist itself contains the token (file mode 0600) so launchd can pass it
into the service env on every load. Don't `git add` the materialized plist.

## Wire CI runners

Set the sink URL once in Forgejo as a workflow variable
(Settings → Actions → Variables):

    SANCTUARY_CI_LOG_SINK_URL=http://<sink-host>:9090

When unset, `scripts/ci/publish-failed-logs.sh` is a no-op — workflows still
work, just without the upload.

## Operations

- **Logs**: `journalctl -u sanctuary-ci-log-sink -f`
- **Stop/start**: `sudo systemctl {stop,start,restart} sanctuary-ci-log-sink`
- **Inspect storage**: `sudo ls -R /var/lib/sanctuary-ci-logs/runs/`
- **Resize cap or retention**: edit `Environment=` lines in
  `/etc/systemd/system/sanctuary-ci-log-sink.service`, then
  `sudo systemctl daemon-reload && sudo systemctl restart sanctuary-ci-log-sink`.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `HTTP 401` from `/runs/*` | Token not sent or wrong | Check `Authorization: Bearer <token>` header; confirm it matches `~/.config/sanctuary/ci-log-sink-token` (local) or `secrets.SANCTUARY_CI_LOG_SINK_TOKEN` (CI) |
| `HTTP 401` and the sink log shows `auth=OPEN` at startup | `SANCTUARY_CI_LOG_SINK_TOKEN` was unset on the server but client is still sending a token | Either set the env on the server (preferred) OR remove the header from the client — but never run unauthenticated in production |
| `Connection refused` from a runner | Sink not running, or bound to wrong interface | `lsof -nP -iTCP:9090 -sTCP:LISTEN` on the host; check `BIND_HOST` matches a routable LAN IP |
| Sink `auth=OPEN` after deploy that should have set the token | Plist substitution missed `AUTH_TOKEN_PLACEHOLDER` | Inspect `~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist`; rerun the install sed command |
| `publish-failed-logs.sh: published=0 skipped=N` despite a failed step | Sidecar JSON marks `wrapped_exit=0` even though the step failed | Check the failed step actually used `run-with-log.sh` (only those generate sidecars); raw-shell steps don't get publishing |
| Workflow run reports CI green but `/runs/<id>/` shows nothing | Variable `SANCTUARY_CI_LOG_SINK_URL` was unset when the run started — runs already in flight don't pick up later edits | Push a trivial commit to retrigger; new runs will have it |

## When to retire this service

This whole tree exists as a **workaround** for Forgejo 15.0.1 not
exposing the Gitea-upstream
`/api/v1/repos/<owner>/<repo>/actions/jobs/<job_id>/logs` endpoint
(tracked at [Gitea #35176](https://github.com/go-gitea/gitea/issues/35176)).
Every component here — the HTTP service, the LaunchAgent / systemd
unit, the publisher script, the workflow env wiring — is here only
because that endpoint is missing. When a future Forgejo version ships
the endpoint, **this entire workaround should be removed** and CI
log access should switch back to the native API.

### Verifying the API is available

On the upgraded Forgejo, with a token that has at least `read:repository`:

```bash
curl -fsS -H "Authorization: token $FORGEJO_TOKEN" \
  "$FORGEJO_URL/api/v1/repos/<owner>/<repo>/actions/jobs/<job_id>/logs"
```

A `200 OK` with the captured stdout body means the workaround is
obsolete. A `404 page not found` means it's still needed.

### Retirement steps (run in order)

1. **Delete the workaround code.** Single sweep:
   ```bash
   git rm -r tools/ci-log-sink/
   git rm scripts/ci/publish-failed-logs.sh
   ```
2. **Revert `scripts/ci/write-diagnostic-summary.sh`.** Remove the
   trailing block that derives `JOB_SAFE_NAME` and invokes
   `publish-failed-logs.sh`. (See git history for the exact lines.)
3. **Strip the workflow env wiring.** Remove the
   `SANCTUARY_CI_LOG_SINK_URL` and `SANCTUARY_CI_LOG_SINK_TOKEN` lines
   from each workflow's top-level `env:` block:
   - `.github/workflows/test.yml`
   - `.github/workflows/install-test.yml`
   - `.github/workflows/quality.yml`
   - `.github/workflows/architecture.yml`
4. **Drop the Forgejo variable + secret.**
   ```bash
   curl -X DELETE -H "Authorization: token $FORGEJO_TOKEN" \
     "$FORGEJO_URL/api/v1/repos/<owner>/<repo>/actions/variables/SANCTUARY_CI_LOG_SINK_URL"
   curl -X DELETE -H "Authorization: token $FORGEJO_TOKEN" \
     "$FORGEJO_URL/api/v1/repos/<owner>/<repo>/actions/secrets/SANCTUARY_CI_LOG_SINK_TOKEN"
   ```
5. **Stop and uninstall the sink service** on the LAN host:
   ```bash
   # macOS
   launchctl unload -w ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist
   rm ~/Library/LaunchAgents/dev.sanctuary.ci-log-sink.plist
   rm -rf ~/sanctuary-ci-log-sink/
   # Linux
   sudo systemctl disable --now sanctuary-ci-log-sink.service
   sudo rm /etc/systemd/system/sanctuary-ci-log-sink.service
   sudo rm -rf /opt/sanctuary-ci-log-sink/ /var/lib/sanctuary-ci-logs/
   sudo systemctl daemon-reload
   ```
6. **Remove the local reader token.**
   ```bash
   rm ~/.config/sanctuary/ci-log-sink-token
   ```
7. **Update `CONTRIBUTING.md`** "Diagnosing CI failures" section to
   point at the native Forgejo API instead of the LAN sink. Remove
   the cross-reference to this README.
8. **Verify CI still produces visible failures inline.** The
   inline-echo behavior in `write-diagnostic-summary.sh` (added in
   #396) is independent of this workaround and should remain.

### Why this matters

Carrying a workaround is fine; carrying an undocumented one is debt.
This section exists so a maintainer six months from now (or an LLM
agent) can confidently delete the whole tree once the upstream gap
closes, without leaving orphan environment variables, dead workflow
secrets, or a forgotten daemon listening on a LAN port.
