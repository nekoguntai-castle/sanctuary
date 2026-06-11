# Forgejo Runner Host Bootstrap

Use this runbook when adding or rebuilding a Sanctuary Forgejo Actions runner
host. It turns the runner capacity and cleanup pattern into repeatable host
configuration instead of a one-off repair.

The bootstrap script is managed outside this repository in the runner-infra
repository at `scripts/ops/bootstrap-forgejo-runner-host.sh`. Keep changes to
the script and its regression tests there; this runbook records the Sanctuary
runner operating contract.

The bootstrap path creates a Docker-in-Docker runner stack, a systemd service
that starts it after reboot, and a timer that prunes unused Docker resources so
the runner does not exhaust containers, networks, images, or build cache.

Runner hosts should not suspend while they are counted as CI capacity. Disable
sleep before promotion:

```bash
sudo install -d -m 0755 /etc/systemd/sleep.conf.d /etc/systemd/logind.conf.d
sudo tee /etc/systemd/sleep.conf.d/10-disable-sleep.conf >/dev/null <<'EOF'
[Sleep]
AllowSuspend=no
AllowHibernation=no
AllowSuspendThenHibernate=no
AllowHybridSleep=no
EOF
sudo tee /etc/systemd/logind.conf.d/10-disable-sleep.conf >/dev/null <<'EOF'
[Login]
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
IdleAction=ignore
EOF
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo systemctl restart systemd-logind.service
```

## Prerequisites

- Linux host with Docker Engine and the Docker Compose plugin installed.
- Root or sudo access on the runner host.
- A one-time Forgejo repository runner registration token.
- Network access from the runner host to the Forgejo instance.

Do not put registration tokens or sudo passwords in files, shell history, PR
descriptions, or task notes. Prefer reading the token into an environment
variable for the current shell and unsetting it after registration.

## Bootstrap

From a fresh `runner-infra` checkout on the runner host:

```bash
export FORGEJO_INSTANCE_URL="https://forgejo.example.invalid"
read -rsp "Forgejo runner registration token: " FORGEJO_RUNNER_REGISTRATION_TOKEN
printf '\n'
export FORGEJO_RUNNER_REGISTRATION_TOKEN

sudo --preserve-env=FORGEJO_INSTANCE_URL,FORGEJO_RUNNER_REGISTRATION_TOKEN \
  scripts/ops/bootstrap-forgejo-runner-host.sh \
  --service-name forgejo-runner \
  --runner-name "$(hostname -s)-docker-runner" \
  --capacity 4

unset FORGEJO_RUNNER_REGISTRATION_TOKEN
```

The default labels are image-backed Forgejo labels:

```text
ubuntu-latest:docker://ghcr.io/catthehacker/ubuntu:act-22.04
ubuntu-22.04:docker://ghcr.io/catthehacker/ubuntu:act-22.04
ubuntu-20.04:docker://ghcr.io/catthehacker/ubuntu:act-20.04
```

Keep those labels image-backed. Plain labels can make jobs land in a runner
environment that does not match the Node, npm, Python, Docker, and shell
toolchains expected by the workflows.

## Defaults

The script writes the runner stack under `/opt/forgejo-runner` by default and
installs these systemd units:

- `forgejo-runner.service` starts `docker compose up -d` after Docker and
  network-online are available.
- `forgejo-runner-cleanup.service` runs the bounded cleanup script.
- `forgejo-runner-cleanup.timer` runs cleanup 20 minutes after boot and about
  hourly after that, with randomized delay.

Runner defaults:

- `runner.capacity: 4`
- `runner.shutdown_timeout: 5m`
- Docker-in-Docker address pools:
  - `172.30.0.0/16` as `/24` networks
  - `172.31.0.0/16` as `/24` networks
  - `10.240.0.0/16` as `/24` networks
  - `10.241.0.0/16` as `/24` networks
- Docker-in-Docker storage uses classic `overlay2` with Docker's
  `containerd-snapshotter` feature disabled.
- Build cache cleanup target: `30GB`

Override capacity or address pools explicitly when sizing a larger host:

```bash
sudo --preserve-env=FORGEJO_INSTANCE_URL,FORGEJO_RUNNER_REGISTRATION_TOKEN \
  scripts/ops/bootstrap-forgejo-runner-host.sh \
  --service-name forgejo-runner-large \
  --runner-name "$(hostname -s)-large-runner" \
  --capacity 8 \
  --address-pool base=172.30.0.0/16,size=24 \
  --address-pool base=172.31.0.0/16,size=24 \
  --address-pool base=10.240.0.0/16,size=24 \
  --address-pool base=10.241.0.0/16,size=24
```

## Verification

After bootstrap:

```bash
systemctl is-enabled forgejo-runner.service
systemctl is-active forgejo-runner.service
systemctl is-enabled forgejo-runner-cleanup.timer
systemctl is-active forgejo-runner-cleanup.timer
systemctl list-timers --all forgejo-runner-cleanup.timer --no-pager
docker compose -f /opt/forgejo-runner/docker-compose.yml ps
```

In Forgejo, verify the repository runner is `active` and exposes the expected
`ubuntu-latest`, `ubuntu-22.04`, and `ubuntu-20.04` labels.

Run a reboot proof before counting the host as durable capacity:

```bash
sudo systemctl reboot
```

After the host returns, re-run the service, timer, compose, and Forgejo runner
checks. The runner is not production-ready until it comes back active after
reboot without manual `docker compose up`.

## Cleanup Behavior

The cleanup timer prunes only unused resources inside the runner's
Docker-in-Docker daemon:

- stopped containers older than 24 hours
- unused networks older than 24 hours
- dangling images older than 168 hours
- build cache older than 24 hours, keeping the cache under the configured limit

It does not prune volumes and does not remove running job containers or active
job networks. If a host is already exhausted before jobs can start, manual
operator recovery may still be required once, but the timer prevents normal
runner churn from recreating the exhaustion.

## Updating Existing Hosts

For an existing runner host, run the script from the `runner-infra` checkout
with the same `--service-name` and `--runner-name`. If the host is already
registered, the script keeps the existing runner registration and rewrites the
compose, config, systemd, and cleanup files.

Use `--skip-register` when you only want to refresh host files:

```bash
sudo scripts/ops/bootstrap-forgejo-runner-host.sh \
  --service-name forgejo-runner \
  --runner-name "$(hostname -s)-docker-runner" \
  --capacity 4 \
  --skip-register
```

Then restart the stack:

```bash
sudo systemctl restart forgejo-runner.service
```

Changing labels for an already registered runner usually requires deleting the
old runner registration in Forgejo and registering the host again with a fresh
registration token. Do that deliberately; do not edit token files by hand.
