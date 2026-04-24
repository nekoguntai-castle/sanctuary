#!/bin/bash

UPGRADE_FIXTURE_LABEL="legacy-runtime-env"

upgrade_fixture_before_source_install() {
    use_legacy_repo_env_layout
    return 0
}

upgrade_fixture_after_source_install() {
    if ! seed_upgrade_baseline_admin_state; then
        return 1
    fi

    if [ ! -f "$TEST_ENV_FILE" ]; then
        log_error "Expected runtime env file not found before legacy conversion: $TEST_ENV_FILE"
        return 1
    fi

    cp "$TEST_ENV_FILE" "$PROJECT_ROOT/.env"
    chmod 600 "$PROJECT_ROOT/.env"
    rm -f "$TEST_ENV_FILE"
    return 0
}

upgrade_fixture_before_upgrade() {
    local source_env_file="$UPGRADE_SOURCE_CHECKOUT/.env"

    if [ ! -f "$source_env_file" ]; then
        log_error "Legacy source env file not found: $source_env_file"
        return 1
    fi

    cp "$source_env_file" "$TARGET_PROJECT_ROOT/.env"
    chmod 600 "$TARGET_PROJECT_ROOT/.env"
    rm -f "$TEST_ENV_FILE"
    return 0
}

upgrade_fixture_after_upgrade() {
    local resolved_env_file=""

    resolved_env_file="$(resolve_env_file)"
    if [ "$resolved_env_file" != "$TARGET_PROJECT_ROOT/.env" ]; then
        log_error "Legacy runtime env fixture did not resolve the repo-root .env on the upgraded checkout"
        log_error "Resolved env file: $resolved_env_file"
        return 1
    fi

    if [ -f "$TEST_ENV_FILE" ]; then
        log_error "Legacy runtime env fixture unexpectedly recreated the external runtime env file"
        return 1
    fi

    return 0
}
