#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/ops/bootstrap-forgejo-runner-host.sh [options]

Writes a Docker-in-Docker Forgejo runner stack plus systemd boot and cleanup
units for a Linux runner host.

Required for registration:
  FORGEJO_INSTANCE_URL                     Forgejo base URL
  FORGEJO_RUNNER_REGISTRATION_TOKEN        one-time runner registration token

Options:
  --root DIR                 install root (default: /opt/forgejo-runner)
  --systemd-dir DIR          systemd unit directory (default: /etc/systemd/system)
  --service-name NAME        systemd/container name stem (default: forgejo-runner)
  --runner-name NAME         Forgejo runner display name (default: <hostname>-docker-runner)
  --labels LABELS            comma-separated runner labels
  --capacity N               concurrent job capacity (default: 4)
  --shutdown-timeout VALUE   runner shutdown grace period (default: 5m)
  --address-pool VALUE       Docker default address pool; may be repeated
  --build-cache-limit VALUE  buildx cleanup max-used-space (default: 30GB)
  --skip-register            write files but do not register the runner
  --skip-systemctl           do not daemon-reload, enable, or start units
  --skip-compose-validate    do not run docker compose config after writing
  -h, --help                 show this help
EOF
}

fail() {
  echo "bootstrap-forgejo-runner-host: $*" >&2
  exit 1
}

warn() {
  echo "warning: $*" >&2
}

is_positive_integer() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

validate_name() {
  local value="$1"
  local label="$2"

  if [[ ! "$value" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    fail "$label may contain only letters, numbers, dots, underscores, and hyphens"
  fi
}

validate_path() {
  local value="$1"
  local label="$2"

  if [[ "$value" =~ [[:space:]] ]]; then
    fail "$label must not contain whitespace"
  fi
  if [[ "$value" != /* ]]; then
    fail "$label must be an absolute path"
  fi
}

runner_root="/opt/forgejo-runner"
systemd_dir="/etc/systemd/system"
service_name="forgejo-runner"
runner_name="$(hostname -s)-docker-runner"
runner_labels="ubuntu-latest:docker://ghcr.io/catthehacker/ubuntu:act-22.04,ubuntu-22.04:docker://ghcr.io/catthehacker/ubuntu:act-22.04,ubuntu-20.04:docker://ghcr.io/catthehacker/ubuntu:act-20.04"
runner_capacity="4"
shutdown_timeout="5m"
runner_image="data.forgejo.org/forgejo/runner:12"
dind_image="docker:dind"
build_cache_limit="30GB"
skip_register=false
skip_systemctl=false
skip_compose_validate=false
address_pools=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --root)
      runner_root="${2:-}"
      shift 2
      ;;
    --systemd-dir)
      systemd_dir="${2:-}"
      shift 2
      ;;
    --service-name)
      service_name="${2:-}"
      shift 2
      ;;
    --runner-name)
      runner_name="${2:-}"
      shift 2
      ;;
    --labels)
      runner_labels="${2:-}"
      shift 2
      ;;
    --capacity)
      runner_capacity="${2:-}"
      shift 2
      ;;
    --shutdown-timeout)
      shutdown_timeout="${2:-}"
      shift 2
      ;;
    --address-pool)
      address_pools+=("${2:-}")
      shift 2
      ;;
    --build-cache-limit)
      build_cache_limit="${2:-}"
      shift 2
      ;;
    --skip-register)
      skip_register=true
      shift
      ;;
    --skip-systemctl)
      skip_systemctl=true
      shift
      ;;
    --skip-compose-validate)
      skip_compose_validate=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      usage
      fail "unknown option: $1"
      ;;
    *)
      usage
      fail "unexpected argument: $1"
      ;;
  esac
done

if [ "${#address_pools[@]}" -eq 0 ]; then
  address_pools=(
    "base=172.30.0.0/16,size=24"
    "base=172.31.0.0/16,size=24"
    "base=10.240.0.0/16,size=24"
    "base=10.241.0.0/16,size=24"
  )
fi

validate_name "$service_name" "--service-name"
validate_path "$runner_root" "--root"
validate_path "$systemd_dir" "--systemd-dir"
is_positive_integer "$runner_capacity" || fail "--capacity must be a positive integer"
[ -n "$runner_name" ] || fail "--runner-name must not be empty"
[ -n "$runner_labels" ] || fail "--labels must not be empty"
[ -n "$shutdown_timeout" ] || fail "--shutdown-timeout must not be empty"
[ -n "$build_cache_limit" ] || fail "--build-cache-limit must not be empty"

# Top-level dir is world-traversable so the runner container (uid 1000 by
# default in data.forgejo.org/forgejo/runner) can reach $runner_root/data;
# bin scripts are similarly readable. The data subdirectory is owned by the
# runner uid so the container can read runner-config.yml and write .runner.
runner_uid="${SANCTUARY_FORGEJO_RUNNER_UID:-1000}"
runner_gid="${SANCTUARY_FORGEJO_RUNNER_GID:-1000}"
install -d -m 0755 "$runner_root" "$runner_root/bin" "$systemd_dir"
if [ "$(id -u)" -eq 0 ]; then
  install -d -m 0750 -o "$runner_uid" -g "$runner_gid" "$runner_root/data"
else
  install -d -m 0755 "$runner_root/data"
fi

existing_server_block=""
if [ -f "$runner_root/data/runner-config.yml" ]; then
  existing_server_block="$(awk 'found { print } /^server:/ { found = 1; print }' "$runner_root/data/runner-config.yml")"
fi

write_runner_config() {
  cat > "$runner_root/data/runner-config.yml" <<YAML
log:
  level: info
  job_level: info

runner:
  file: /data/.runner
  capacity: ${runner_capacity}
  envs:
    DOCKER_HOST: tcp://docker-in-docker:2375
  env_file: ""
  timeout: 3h
  shutdown_timeout: ${shutdown_timeout}
  insecure: false
  fetch_timeout: 30s
  fetch_interval: 2s
  report_interval: 1s
  labels: []

cache:
  enabled: true
  port: 0
  dir: /data/.cache
  external_server: ""
  secret: ""
  secret_url: ""
  host: ""
  proxy_port: 0
  actions_cache_url_override: ""

container:
  network: ""
  enable_ipv6: false
  privileged: false
  options: ""
  workdir_parent:
  valid_volumes:
    - "**"
  docker_host: tcp://docker-in-docker:2375
  force_pull: false
  force_rebuild: false

host:
  workdir_parent:
YAML

  if [ -n "$existing_server_block" ]; then
    printf '\n%s\n' "$existing_server_block" >> "$runner_root/data/runner-config.yml"
  fi
}

write_compose() {
  cat > "$runner_root/docker-compose.yml" <<YAML
services:
  docker-in-docker:
    image: ${dind_image}
    container_name: ${service_name}-dind
    privileged: true
    environment:
      DOCKER_TLS_CERTDIR: ""
    restart: unless-stopped
    command:
      - --host=tcp://0.0.0.0:2375
      - --host=unix:///var/run/docker.sock
      - --tls=false
YAML

  local pool
  for pool in "${address_pools[@]}"; do
    printf '      - --default-address-pool=%s\n' "$pool" >> "$runner_root/docker-compose.yml"
  done

  cat >> "$runner_root/docker-compose.yml" <<YAML
    healthcheck:
      test: ["CMD-SHELL", "docker -H tcp://127.0.0.1:2375 info >/dev/null 2>&1"]
      interval: 10s
      timeout: 5s
      retries: 12
    volumes:
      - dind-data:/var/lib/docker

  runner:
    image: ${runner_image}
    container_name: ${service_name}
    depends_on:
      docker-in-docker:
        condition: service_healthy
    environment:
      DOCKER_HOST: tcp://docker-in-docker:2375
    working_dir: /data
    volumes:
      - ./data:/data
    restart: unless-stopped
    command: forgejo-runner daemon --config /data/runner-config.yml

volumes:
  dind-data:
YAML
}

write_cleanup_script() {
  cat > "$runner_root/bin/forgejo-runner-dind-cleanup" <<SCRIPT
#!/usr/bin/env bash
set -euo pipefail

timeout_s="\${FORGEJO_RUNNER_CLEANUP_TIMEOUT:-180s}"
build_cache_limit="\${FORGEJO_RUNNER_BUILD_CACHE_LIMIT:-${build_cache_limit}}"
dind_container="\${FORGEJO_RUNNER_DIND_CONTAINER:-${service_name}-dind}"

run_docker() {
  local label="\$1"
  shift

  echo "==> \${label}"
  if ! timeout "\${timeout_s}" docker exec "\${dind_container}" docker -H tcp://127.0.0.1:2375 "\$@"; then
    echo "warning: \${label} failed or timed out" >&2
  fi
}

if ! timeout 60s docker exec "\${dind_container}" docker -H tcp://127.0.0.1:2375 info >/dev/null 2>&1; then
  echo "warning: Docker-in-Docker daemon is unavailable; skipping runner cleanup" >&2
  exit 0
fi

# These prune only stopped/unused resources. Running Forgejo job containers,
# their active networks, and mounted volumes are intentionally left alone.
run_docker "prune stopped DinD containers older than 24h" container prune --force --filter "until=24h"
run_docker "prune unused DinD networks older than 24h" network prune --force --filter "until=24h"
run_docker "prune dangling DinD images older than 168h" image prune --force --filter "until=168h"
run_docker "prune old DinD build cache" buildx prune --force --filter "until=24h" --max-used-space "\${build_cache_limit}"
SCRIPT

  chmod 0755 "$runner_root/bin/forgejo-runner-dind-cleanup"
}

write_systemd_units() {
  cat > "$systemd_dir/${service_name}.service" <<UNIT
[Unit]
Description=Forgejo Actions runner stack (${service_name})
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${runner_root}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose stop
RemainAfterExit=yes
TimeoutStartSec=0
TimeoutStopSec=120

[Install]
WantedBy=multi-user.target
UNIT

  cat > "$systemd_dir/${service_name}-cleanup.service" <<UNIT
[Unit]
Description=Cleanup unused Docker resources for ${service_name}
Requires=${service_name}.service
After=${service_name}.service

[Service]
Type=oneshot
ExecStart=${runner_root}/bin/forgejo-runner-dind-cleanup
UNIT

  cat > "$systemd_dir/${service_name}-cleanup.timer" <<UNIT
[Unit]
Description=Hourly cleanup for ${service_name}

[Timer]
OnBootSec=20min
OnUnitActiveSec=1h
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
}

validate_compose() {
  if [ "$skip_compose_validate" = true ]; then
    return
  fi
  if ! command -v docker >/dev/null 2>&1; then
    warn "docker is unavailable; skipping compose validation"
    return
  fi

  (cd "$runner_root" && docker compose config --quiet)
}

register_runner() {
  if [ "$skip_register" = true ]; then
    return
  fi
  if [ -f "$runner_root/data/.runner" ] || [ -f "$runner_root/data/token.txt" ] || [ -n "$existing_server_block" ]; then
    warn "runner already appears registered under $runner_root/data; skipping registration"
    return
  fi

  local instance_url="${FORGEJO_INSTANCE_URL:-}"
  local registration_token="${FORGEJO_RUNNER_REGISTRATION_TOKEN:-}"
  if [ -z "$instance_url" ] || [ -z "$registration_token" ]; then
    warn "FORGEJO_INSTANCE_URL or FORGEJO_RUNNER_REGISTRATION_TOKEN is unset; skipping registration"
    return
  fi

  (cd "$runner_root" && docker compose run --rm runner \
    forgejo-runner register \
      --no-interactive \
      --instance "$instance_url" \
      --token "$registration_token" \
      --name "$runner_name" \
      --labels "$runner_labels" \
      --config /data/runner-config.yml)
}

enable_units() {
  if [ "$skip_systemctl" = true ]; then
    return
  fi

  systemctl daemon-reload
  systemctl enable --now "${service_name}.service"
  systemctl enable --now "${service_name}-cleanup.timer"
}

write_runner_config
write_compose
write_cleanup_script
write_systemd_units
validate_compose
register_runner
enable_units

cat <<EOF
Forgejo runner host files written.

Verify:
  systemctl is-active ${service_name}.service
  systemctl is-active ${service_name}-cleanup.timer
  docker compose -f ${runner_root}/docker-compose.yml ps
EOF
