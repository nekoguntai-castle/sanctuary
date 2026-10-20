#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# shellcheck source=../utils/compose-contract-env.sh
source "$SCRIPT_DIR/../utils/compose-contract-env.sh"

rendered="$(docker compose -f "$PROJECT_ROOT/docker-compose.yml" config --format json)"

DOCKERFILE_UID="$(sed -n 's/.*adduser --system --uid \([0-9][0-9]*\) sanctuary.*/\1/p' "$PROJECT_ROOT/server/Dockerfile" | head -n1)"
if [ -z "$DOCKERFILE_UID" ]; then
    echo "could not derive the sanctuary uid from server/Dockerfile" >&2
    exit 1
fi

COMPOSE_JSON="$rendered" DOCKERFILE_UID="$DOCKERFILE_UID" node <<'NODE'
const config = JSON.parse(process.env.COMPOSE_JSON);
const services = config.services;
const init = services['backup-volume-init'];
if (services.worker?.depends_on?.['backup-volume-init']?.condition !== 'service_completed_successfully') {
  throw new Error('worker must wait for backup volume repair');
}
if (!init) {
  throw new Error('backup-volume-init service must exist');
}
const mounts = init.volumes ?? [];
if (mounts.length !== 1 || mounts[0].source !== 'backup_data' || mounts[0].target !== '/data/backups') {
  throw new Error('backup-volume-init must mount only backup_data at /data/backups');
}
if (init.user !== '0:0') throw new Error('backup-volume-init must run as 0:0');
if (JSON.stringify(init.cap_drop) !== JSON.stringify(['ALL'])) throw new Error('backup-volume-init must drop ALL capabilities');
if (JSON.stringify(init.cap_add) !== JSON.stringify(['CHOWN'])) throw new Error('backup-volume-init must add only CHOWN');
if (init.network_mode !== 'none') throw new Error('backup-volume-init must have no network');
if (init.read_only !== true) throw new Error('backup-volume-init must be read_only');
if (init.restart !== 'no') throw new Error('backup-volume-init must not restart');
if (init.pull_policy !== 'never') throw new Error('backup-volume-init must never pull');
if (init.image !== services.migrate?.image) throw new Error('backup-volume-init must reuse the migration image');
if (init.depends_on?.migrate?.condition !== 'service_completed_successfully') {
  throw new Error('backup-volume-init must wait for the migration image build');
}
const command = init.command ?? [];
if (command[0] !== 'chown' || command.length !== 3 || command[2] !== '/data/backups' || command.includes('-R')) {
  throw new Error(`backup-volume-init must chown only /data/backups, got ${JSON.stringify(command)}`);
}
const owner = String(command[1]).split(':')[0];
if (owner !== process.env.DOCKERFILE_UID) {
  throw new Error(`chown uid ${owner} must equal the Dockerfile sanctuary uid ${process.env.DOCKERFILE_UID}`);
}
const backendMount = (services.backend?.volumes ?? []).find((v) => v.source === 'backup_data');
if (!backendMount || backendMount.target !== '/data/backups' || backendMount.read_only !== true) {
  throw new Error('backend must mount backup_data read-only at /data/backups');
}
const workerMount = (services.worker?.volumes ?? []).find((v) => v.source === 'backup_data');
if (!workerMount || workerMount.target !== '/data/backups' || workerMount.read_only) {
  throw new Error('worker must mount backup_data read-write at /data/backups');
}
NODE

grep -Fq 'install -d -m 0750 -o sanctuary -g nodejs /data/backups' "$PROJECT_ROOT/server/Dockerfile" \
    || { echo "Dockerfile must pre-create /data/backups owned by sanctuary" >&2; exit 1; }

echo "Backup volume Compose contract passed"
