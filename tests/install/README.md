# Sanctuary Install Test Suite

Comprehensive test suite for verifying the Sanctuary installation process works correctly.

## Overview

This test suite covers:

1. **Unit Tests** - Test individual functions in `install.sh` and host recovery helpers
2. **Fresh Install E2E** - Complete fresh installation process
3. **Upgrade Tests** - Upgrading an existing installation
4. **Container Health** - Verify all containers start and are healthy
5. **Auth Flow** - Login, password change, and authentication flow

## Quick Start

### Run All Tests

```bash
./tests/install/run-all-tests.sh
```

### Run Specific Test Suites

```bash
# Unit tests only (no Docker required)
./tests/install/run-all-tests.sh --unit-only

# E2E tests only
./tests/install/run-all-tests.sh --e2e-only

# Fast mode (skip slow upgrade test)
./tests/install/run-all-tests.sh --fast

# With verbose output
./tests/install/run-all-tests.sh --verbose
```

### Run Individual Test Files

```bash
# Unit tests for install.sh
./tests/install/unit/install-script.test.sh

# Fresh install E2E test
./tests/install/e2e/fresh-install.test.sh

# Container health verification
./tests/install/e2e/container-health.test.sh

# Authentication flow tests
./tests/install/e2e/auth-flow.test.sh

# Upgrade scenario tests
./tests/install/e2e/upgrade-install.test.sh

# Core release lane: upgrade from a specific older ref/tag to the current checkout
./tests/install/e2e/upgrade-install.test.sh --mode core --source-ref v0.8.39

# Full local suite: include extended recovery scenarios after the core upgrade
./tests/install/e2e/upgrade-install.test.sh --mode full --source-ref v0.8.39

# Fixture-backed release lane from the newest stable tag before this checkout
./tests/install/e2e/upgrade-install.test.sh --mode core --source-ref latest-stable --fixture baseline

# Browser/proxy shape: IP origin through the disposable upgrade-test port set
./tests/install/e2e/upgrade-install.test.sh --mode core --source-ref latest-stable --fixture browser-origin-ip

# Notification worker shape: seeded notification config plus post-upgrade DLQ diagnostics
./tests/install/e2e/upgrade-install.test.sh --mode core --source-ref latest-stable --fixture notification-delivery
```

## Prerequisites

### Required

- Docker with Docker Compose v2
- Git
- Bash 4.0+
- curl
- OpenSSL

### Recommended

- At least 4GB RAM available for Docker
- 10GB free disk space
- Stable network connection (for first build)

## Test Structure

```
tests/install/
├── README.md              # This file
├── run-all-tests.sh       # Master test runner
├── unit/
│   ├── install-script.test.sh   # Unit tests for setup/install behavior
│   ├── reset-user-2fa-script.test.sh # Unit tests for host-side 2FA recovery
│   ├── upgrade-helpers.test.sh  # Unit tests for upgrade refs, fixtures, artifacts
│   └── install-scope.test.sh    # Unit tests for install workflow path scoping
├── e2e/
│   ├── fresh-install.test.sh    # Fresh installation E2E test
│   ├── upgrade-install.test.sh  # Upgrade scenario tests
│   ├── container-health.test.sh # Container health verification
│   └── auth-flow.test.sh        # Authentication flow tests
├── utils/
│   ├── helpers.sh         # Shared test utilities
│   ├── classify-install-scope.sh # GitHub Actions install-test scope classifier
│   ├── upgrade-assertions.sh # User-visible post-upgrade assertions
│   ├── upgrade-fixtures.sh   # Upgrade fixture selection and defaults
│   ├── upgrade-source-refs.sh # Stable tag/source-ref alias resolution
│   └── collect-upgrade-artifacts.sh # Redacted failed-upgrade diagnostics
└── fixtures/              # Test fixtures (if needed)
```

## Test Descriptions

### Unit Tests (`unit/install-script.test.sh`)

Tests setup/install behavior and host recovery helpers without requiring Docker:

- `generate_secret()` - Secret generation
- `check_docker()` - Docker availability check
- `check_git()` - Git availability check
- `check_openssl()` - OpenSSL availability check
- Environment variable handling
- Fresh installs generate a unique `ENCRYPTION_SALT`; legacy encrypted installs with existing `ENCRYPTION_KEY` plus missing `ENCRYPTION_SALT` keep the legacy default salt instead of rotating encryption material
- `reset-user-2fa.sh` status/reset SQL generation, explicit confirmation, backup creation, file permissions, and abort behavior
- Script structure validation

### Fresh Install E2E (`e2e/fresh-install.test.sh`)

Simulates a complete fresh installation:

1. Verifies prerequisites
2. Checks repository structure
3. Generates SSL certificates
4. Builds Docker images
5. Starts all containers
6. Waits for containers to be healthy
7. Verifies database migration
8. Tests login with default credentials
9. Tests password change flow
10. Verifies basic API endpoints

### Upgrade Tests (`e2e/upgrade-install.test.sh`)

Tests upgrading an existing installation:

`--mode core` is the focused release/CI lane:

1. Resolves an older source ref (explicit `--source-ref` or the newest stable tag not equal to the current commit)
2. Creates an initial installation from that source checkout
3. Creates test data (changes password, enables encrypted admin 2FA, seeds an encrypted secondary 2FA user, and preserves a legacy plaintext 2FA user)
4. Captures pre-upgrade state
5. Stops the source containers and switches to the current checkout
6. Runs the current checkout's installer in upgrade mode against the shared runtime env
7. Verifies secrets preserved, including both `ENCRYPTION_KEY` and `ENCRYPTION_SALT`
8. Verifies data preserved
9. Verifies post-upgrade 2FA login with the preserved admin TOTP secret
10. Verifies multi-user 2FA preservation, including encrypted and legacy plaintext secret storage
11. Verifies backup-code login accepts normalized input, marks the code used, and rejects replay
12. Verifies encrypted 2FA state rejects drifted `ENCRYPTION_KEY` and drifted `ENCRYPTION_SALT`
13. Verifies host-side 2FA reset recovery and API re-enrollment
14. Verifies fixture runtime shape, including legacy repo-root `.env` mode and optional profile flags when selected
15. Verifies representative app state survives: group ownership, wallet metadata, labels, node config, and mutable settings
16. Verifies migrations completed after the upgrade
17. Verifies user-visible post-upgrade traffic through nginx: login, `/auth/me`, `/auth/refresh`, CSRF-protected support-package generation, and direct worker health
18. Verifies seeded notification config can be processed by the upgraded notification worker and route exhausted jobs into Redis-backed DLQ diagnostics

Source refs support exact refs/tags and aliases:

- `latest-stable`, `auto`, and `n-1`: newest `vX.Y.Z` tag before the target commit
- `n-2`: previous stable tag
- `n-3`: third most recent stable tag

Upgrade fixtures can be comma-separated:

- `baseline`: changed admin password, encrypted 2FA, seeded app state, and browser-path smoke
- `browser-origin-ip`: baseline plus `127.0.0.1` browser-visible origin
- `legacy-runtime-env`: baseline using the repo-root `.env` compatibility path across source and target checkouts
- `notification-delivery`: baseline plus seeded notification preferences and post-upgrade worker/DLQ proof
- `optional-profiles`: baseline with monitoring and Tor enabled through setup/start paths
- `seeded-app-state`: explicit representative persisted state fixture, useful when combined with other fixture names

`--mode full` runs the core lane and then continues into the older recovery scenarios such as password-drift recovery, rebuild, and volume-persistence checks.

### Container Health (`e2e/container-health.test.sh`)

Verifies all containers are healthy:

- Database container health and connectivity
- Backend container health and API readiness
- Frontend container and nginx
- Gateway container health
- Network connectivity between containers
- External port accessibility
- Resource usage checks

### Auth Flow (`e2e/auth-flow.test.sh`)

Tests authentication and password management:

- Login with default credentials
- Login response structure validation
- Invalid credentials rejection
- Token verification
- Password change flow
- Password complexity requirements
- Old password invalidation

## Command Line Options

### run-all-tests.sh

| Option | Description |
|--------|-------------|
| `--unit-only` | Run only unit tests |
| `--e2e-only` | Run only E2E tests |
| `--skip-cleanup` | Keep containers after tests |
| `--verbose` | Show detailed output |
| `--fast` | Skip slow tests (upgrade) |
| `--upgrade-fixture FIXTURE[,FIXTURE...]` | Fixture list for `upgrade-install.test.sh` |
| `--help` | Show help |

### Individual Test Scripts

| Option | Description |
|--------|-------------|
| `--verbose`, `-v` | Show detailed output |
| `--keep-containers` | Don't cleanup containers after test |
| `--mode core|full` | Choose the focused ref-to-ref upgrade lane or the extended local suite |
| `--core-only` | Shortcut for `--mode core` |
| `--full-suite` | Shortcut for `--mode full` |
| `--source-ref REF` | Older source ref/tag/alias to install before upgrading |
| `--fixture FIXTURE[,FIXTURE...]` | Upgrade fixture list |
| `--skip-cleanup` | Skip initial cleanup |
| `--slow` | Use longer timeouts |
| `--keep-state` | Don't reset password after auth tests |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTPS_PORT` | 8443 | HTTPS port for tests |
| `HTTP_PORT` | 8080 | HTTP port for tests |
| `GATEWAY_PORT` | 4000 | Gateway API port |
| `UPGRADE_TEST_DEFAULT_HTTPS_PORT` | 9443 | Default HTTPS port used by `upgrade-install.test.sh` when `HTTPS_PORT` is unset |
| `UPGRADE_TEST_DEFAULT_HTTP_PORT` | 9080 | Default HTTP port used by `upgrade-install.test.sh` when `HTTP_PORT` is unset |
| `UPGRADE_TEST_DEFAULT_GATEWAY_PORT` | 4400 | Default gateway port used by `upgrade-install.test.sh` when `GATEWAY_PORT` is unset |
| `SANCTUARY_UPGRADE_SOURCE_REF` | auto | Older ref/tag to install before upgrading |
| `SANCTUARY_UPGRADE_TEST_MODE` | full | Upgrade suite mode (`core` for the focused ref-to-ref lane, `full` for extended recovery scenarios) |
| `SANCTUARY_UPGRADE_FIXTURE` | baseline | Upgrade fixture list |
| `SANCTUARY_UPGRADE_ARTIFACT_DIR` | `.tmp/upgrade-artifacts/<test-id>` | Directory for failed-upgrade diagnostics |
| `SANCTUARY_2FA_RESET_BACKUP_DIR` | `$HOME/.config/sanctuary/recovery` | Backup directory used by `scripts/reset-user-2fa.sh` |
| `CONTAINER_STARTUP_TIMEOUT` | 300 | Seconds to wait for containers |
| `HEALTH_CHECK_TIMEOUT` | 120 | Seconds to wait for health checks |
| `DEBUG` | false | Enable debug output |

## CI/CD Integration

### GitHub Actions Workflows

The test suite is integrated into GitHub Actions via two workflows:

#### 1. Install Tests (`.github/workflows/install-test.yml`)

This workflow runs automatically on:

| Trigger | Test Suite | Upgrade Tests | Release Gate |
|---------|------------|---------------|--------------|
| Push to main (install paths) | Scoped install lanes | Path-scoped | No |
| PR to main (install paths) | Scoped install lanes | Path-scoped | No |
| Release tag (`v*.*.*`) | Release-critical + blocking upgrade matrix | Baseline + extended | **Yes** |
| Nightly schedule | Upgrade matrix | Baseline + extended | No |
| Manual dispatch | Configurable | Configurable | No |

PR runs are scoped by `tests/install/utils/classify-install-scope.sh` instead of running every install lane for every install-related path. Unit/docs-only changes run unit checks, installer changes run installer checks, compose/docker changes run a reusable stack plus container health, auth-flow changes run a reusable stack plus auth flow, and Prisma/migration-only changes run the baseline upgrade matrix. Upgrade harness, fixture, workflow, release, scheduled, and manual `all`/`upgrade`/`release-critical` changes run both baseline and extended upgrade lanes. Container-health and auth-flow share one stack when both are relevant.

**Release-critical tests** include:
- Unit tests, including install-script, 2FA reset-script, and upgrade-helper safety checks (~5 seconds)
- Fresh install E2E (~5-10 min)
- Container health and auth flow on a reusable stack (~2-5 min)
- Baseline upgrade matrix: `latest-stable/baseline` and `n-2/baseline` (~10-20 min per lane)
- Extended upgrade fixtures: `latest-stable/browser-origin-ip`, `latest-stable/legacy-runtime-env`, `latest-stable/notification-delivery`, and `latest-stable/optional-profiles` (~10-20 min per lane)
- Optional full recovery upgrade lane: `latest-stable/baseline` with `--mode full` (~20-35 min)

Total release validation time: ~25-60 minutes depending on upgrade matrix concurrency and image build cache.

**Manual trigger options:**
```yaml
workflow_dispatch:
  inputs:
    test_suite: all|unit|fresh-install|upgrade|container-health|auth-flow|release-critical
    keep_containers: true|false
    upgrade_source_ref: v0.8.39 # optional override for the matrix source ref
```

#### 2. Release Candidate Validation (`.github/workflows/release-candidate.yml`)

Use this workflow **before cutting a release** to run the full test suite including the blocking historical upgrade matrix.

**Recommended release process:**
1. Run the Release Candidate workflow on the commit you plan to release
   - Let it auto-upgrade from the matrix source aliases, or provide `upgrade_source_ref` for a specific source version you care about
   - Enable `include_full_upgrade_recovery` for the final pre-cut pass when you want the extended recovery scenarios in CI
2. Wait for all tests to pass, including the upgrade matrix
3. Create the release tag
4. The Install Tests workflow will run release-critical tests and the blocking upgrade matrix on the tag
5. If all tests pass, Docker images will be built and pushed

**Manual trigger:**
```yaml
workflow_dispatch:
  inputs:
    ref: 'main'  # Git ref to test (branch, tag, or SHA)
    version: '0.5.0'  # Optional version for logging
    upgrade_source_ref: 'v0.8.39'  # Optional older ref/tag to install before upgrading
    include_full_upgrade_recovery: true # Optional full-mode recovery lane
```

### Release Blocking

When a release tag (`v*.*.*`) is pushed:
- Install tests automatically run the `release-critical` suite and blocking upgrade matrix
- Failed tests will block the release (workflow fails)
- The test summary clearly indicates pass/fail status

To configure as a required status check:
1. Go to Repository Settings > Branches > Branch protection rules
2. Add rule for `main` or your release branch
3. Enable "Require status checks to pass before merging"
4. Add "Install Test Summary" as a required check

### Local CI Simulation

```bash
# Run most local install checks without the long upgrade lane
./tests/install/run-all-tests.sh --verbose --fast

# Full local suite including one upgrade fixture lane
./tests/install/run-all-tests.sh --verbose
```

## Debugging Failed Tests

### View Container Logs

```bash
# All containers
docker compose logs

# Specific container
docker logs sanctuary-backend --tail 100
docker logs sanctuary-db --tail 100
docker logs sanctuary-frontend --tail 100
docker logs sanctuary-migrate
```

### Keep Containers Running

```bash
# Run tests without cleanup
./tests/install/e2e/fresh-install.test.sh --keep-containers

# Manually inspect
docker compose ps
docker exec -it sanctuary-backend sh
docker exec -it sanctuary-db psql -U sanctuary -d sanctuary
```

### Enable Debug Mode

```bash
./tests/install/run-all-tests.sh --verbose
```

### Common Issues

1. **Port conflicts**: Change `HTTPS_PORT`, `HTTP_PORT`, and `GATEWAY_PORT`; upgrade tests also support `UPGRADE_TEST_DEFAULT_*` overrides
2. **Timeout errors**: Use `--slow` option for slower systems
3. **Build failures**: Check Docker disk space with `docker system df`
4. **Network issues**: Ensure Docker networking is working with `docker network ls`

## Writing New Tests

### Test Template

```bash
#!/bin/bash
source "$SCRIPT_DIR/../utils/helpers.sh"

test_my_feature() {
    log_info "Testing my feature..."

    # Your test logic here

    if [ some_condition ]; then
        log_success "Feature works correctly"
        return 0
    else
        log_error "Feature failed"
        return 1
    fi
}

# Run with: run_test "My Feature Test" test_my_feature
```

### Available Assertions

```bash
assert_equals "expected" "actual" "message"
assert_not_empty "$value" "message"
assert_file_exists "/path/to/file" "message"
assert_directory_exists "/path/to/dir" "message"
assert_http_status "https://url" "200" "message"
assert_container_healthy "container-name" "message"
assert_container_running "container-name" "message"
```

### Available Helpers

```bash
# Docker helpers
check_docker_available
wait_for_container_running "name" timeout
wait_for_container_healthy "name" timeout
wait_for_all_containers_healthy timeout
cleanup_containers "/project/path"

# HTTP helpers
wait_for_http_endpoint "url" timeout expected_status
api_request "METHOD" "/endpoint" '{"data":"json"}' "token"
login_and_get_token "username" "password"
change_password "token" "current" "new"

# Database helpers
check_admin_user_exists "container"
check_default_password_marker "container"
wait_for_migration_complete timeout
```

## Test Coverage

| Area | Coverage |
|------|----------|
| install.sh functions | Unit tests |
| SSL certificate generation | E2E |
| Docker build process | E2E |
| Container startup | E2E + Health |
| Database migration | E2E |
| Admin user creation | E2E |
| Default password flag | E2E + Auth |
| Password change | E2E + Auth |
| API authentication | Auth |
| Upgrade preservation | Upgrade: secrets, encrypted 2FA, backup codes, representative app state, browser/proxy smoke |
| Volume persistence | Upgrade |

## Performance

Approximate test duration:

| Test Suite | Duration |
|------------|----------|
| Unit Tests | ~5 seconds |
| Fresh Install | ~5-10 minutes (first build) |
| Container Health | ~2 minutes |
| Auth Flow | ~2 minutes |
| Upgrade Install | ~10-20 minutes per fixture lane |
| **All Tests** | ~25-60 minutes depending on upgrade matrix concurrency and image cache |

Note: First run is slower due to Docker image building. Subsequent runs are faster due to caching.

## Contributing

When adding new tests:

1. Follow existing patterns in the test files
2. Use helpers from `utils/helpers.sh`
3. Add cleanup in teardown
4. Handle timeouts gracefully
5. Provide clear error messages
6. Update this README
