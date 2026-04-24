# Upgrade Findings: PostgreSQL Auth Drift On Release Upgrade

Status: fixed on `main` by `2d59029776e942fc3b44ef1947195e98ac8505f4`; relevant when diagnosing upgrades performed with releases older than that hotfix.

## Summary

Upgrading from `v0.8.40` to `v0.8.41` can fail even when `./install.sh` preserves the existing runtime env file. The failure mode is PostgreSQL authentication drift between the operator's runtime env and the existing database user password.

The observable result is:

- `migrate` exits with `P1000`
- `worker` restarts and logs Prisma auth failures
- `backend` may flap between healthy and unhealthy while startup retries race with the worker

## Verified Symptoms

Typical logs on the broken host:

- `Error: P1000: Authentication failed against database server`
- `password authentication failed for user "sanctuary"`
- `backend` fails migration checks and cache warmers
- `worker` fails feature-flag, node-config, and address queries during startup

## Root Cause

The runtime `POSTGRES_PASSWORD` can drift from the password stored for the existing PostgreSQL role inside the persisted database volume. During upgrade, `setup.sh` reused the runtime env value but did not reliably prove that the live application path could authenticate with it.

Two details mattered:

1. A localhost check from inside the `postgres` container can be a false positive.
   - `psql -h 127.0.0.1` inside the database container can succeed while peer containers on the Compose bridge network still get `28P01`.
   - The production-relevant path is `backend/worker/migrate -> postgres:5432` over the Compose network.
2. Some installations do not have a PostgreSQL role named `postgres`.
   - Repair logic cannot assume a `postgres` DB role exists for `ALTER USER`.
   - The configured application user must be supported as the repair path.

## Misleading Signal To Avoid

Do not treat this as authoritative:

```bash
docker exec "$(docker compose ps -q postgres)" \
  psql -h 127.0.0.1 -U sanctuary -d sanctuary -tAc 'SELECT 1'
```

That validates localhost auth inside the database container, not the real bridge-network path the app uses.

## Reliable Checks

Validate from the same Compose network and hostname the app uses:

```bash
POSTGRES_CONTAINER="$(docker compose ps -q postgres)"
POSTGRES_NETWORK="$(docker inspect --format '{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$POSTGRES_CONTAINER" | head -n1)"

docker run --rm \
  --network "$POSTGRES_NETWORK" \
  -e "PGPASSWORD=$POSTGRES_PASSWORD" \
  postgres:16-alpine \
  psql -w -h postgres -U "${POSTGRES_USER:-sanctuary}" -d "${POSTGRES_DB:-sanctuary}" -tAc 'SELECT 1'
```

Also validate from the live backend container if needed:

```bash
printf 'SELECT 1;\n' | docker exec -i "$(docker compose ps -q backend)" npx prisma db execute --stdin
```

## Manual Recovery

If an upgrade has already failed, repair the DB user password to match the current runtime env:

```bash
cd ~/sanctuary
set -a; source ~/.config/sanctuary/sanctuary.env; set +a

P="$(docker compose ps -q postgres)"
DB_USER="${POSTGRES_USER:-sanctuary}"
DB_NAME="${POSTGRES_DB:-sanctuary}"
PW_ESCAPED="$(printf "%s" "$POSTGRES_PASSWORD" | sed "s/'/''/g")"

docker exec "$P" sh -lc "psql -w -h 127.0.0.1 -U \"$DB_USER\" -d \"$DB_NAME\" -v ON_ERROR_STOP=1 -c \"ALTER USER \\\"$DB_USER\\\" WITH PASSWORD '$PW_ESCAPED';\""
docker compose up -d migrate worker backend frontend gateway ai
```

## Hotfix Included In This Patch

`scripts/setup.sh` now:

- detects the existing `postgres` container for the current Compose project
- validates `POSTGRES_PASSWORD` over the Compose bridge network using the `postgres` hostname
- repairs the database user password before startup continues
- avoids assuming a `postgres` DB role exists

## Additional Non-Blocking Warnings Observed During Recovery

These were present on the host but did not block the upgrade once PostgreSQL auth was repaired:

- Redis warns that `maxmemory-policy` is `allkeys-lru` instead of `noeviction`
- Tor orphan container restarts when the Tor compose profile is not part of the current run
- Nginx warns that `listen ... http2` is deprecated
- Gateway warns that APNs/FCM are not configured

These should be tracked separately from the hard PostgreSQL upgrade failure.
