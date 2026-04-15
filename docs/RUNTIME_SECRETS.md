# Runtime Secrets

Sanctuary should keep operator secrets outside the repository checkout. The repo should contain examples, schemas, scripts, and safe defaults. It should not contain live `.env` files or TLS private keys, even when those files are ignored by git.

## Preferred Locations

Default local runtime directory:

```bash
~/.config/sanctuary
```

Default files:

```bash
~/.config/sanctuary/sanctuary.env
~/.config/sanctuary/ssl/fullchain.pem
~/.config/sanctuary/ssl/privkey.pem
```

The runtime paths can be overridden:

```bash
export SANCTUARY_ENV_FILE=/secure/path/sanctuary.env
export SANCTUARY_SSL_DIR=/secure/path/sanctuary-ssl
```

## Fresh Setup

`scripts/setup.sh` writes fresh runtime secrets to the external paths by default:

```bash
./scripts/setup.sh
```

The default outputs are:

- `~/.config/sanctuary/sanctuary.env`
- `~/.config/sanctuary/ssl/fullchain.pem`
- `~/.config/sanctuary/ssl/privkey.pem`

Older installations that already have a repo-root `.env` or repo-local SSL PEMs still work as a backwards-compatible fallback. Use the migration script below to move those legacy files out of the checkout.

## Migrating Existing Local Secrets

Run:

```bash
bash scripts/secrets/migrate-runtime-secrets.sh
```

The migration moves ignored repo-local files to the external runtime directory:

- `.env` -> `~/.config/sanctuary/sanctuary.env`
- `docker/nginx/ssl/fullchain.pem` -> `~/.config/sanctuary/ssl/fullchain.pem`
- `docker/nginx/ssl/privkey.pem` -> `~/.config/sanctuary/ssl/privkey.pem`

The script refuses to overwrite different destination files. If a matching destination already exists, the duplicate repo-local source is removed.

## Starting Sanctuary

`start.sh` loads `SANCTUARY_ENV_FILE` first, then falls back to the legacy repo-root `.env` and `.env.local` files. It also exports `SANCTUARY_SSL_DIR` for Docker Compose.

Normal start:

```bash
./start.sh
```

Raw Docker Compose:

```bash
set -a
source "${SANCTUARY_ENV_FILE:-$HOME/.config/sanctuary/sanctuary.env}"
set +a
SANCTUARY_SSL_DIR="${SANCTUARY_SSL_DIR:-$HOME/.config/sanctuary/ssl}" docker compose up -d
```

## TLS Certificates

Generate local self-signed certificates outside the repo:

```bash
SANCTUARY_SSL_DIR="${HOME}/.config/sanctuary/ssl" bash docker/nginx/ssl/generate-certs.sh localhost
```

Using `mkcert`:

```bash
mkdir -p "${HOME}/.config/sanctuary/ssl"
mkcert -key-file "${HOME}/.config/sanctuary/ssl/privkey.pem" \
  -cert-file "${HOME}/.config/sanctuary/ssl/fullchain.pem" \
  localhost 127.0.0.1
```

## Verification

After migration, the full working-tree secret scan should be clean:

```bash
gitleaks detect --source . --no-git --redact --config .gitleaks.toml
```

Tracked-tree and latest-commit scans should remain clean as separate checks.
