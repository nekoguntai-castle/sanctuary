#!/bin/bash
# Placeholder environment so Compose can render the stack for static contract tests.
# Source this file; every value can be overridden by the caller.

export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-contract-postgres-password}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-contract-redis-password}"
export JWT_SECRET="${JWT_SECRET:-contract-jwt-secret-with-enough-length}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-contract-encryption-key-with-enough-length}"
export ENCRYPTION_SALT="${ENCRYPTION_SALT:-contract-encryption-salt}"
export GATEWAY_SECRET="${GATEWAY_SECRET:-contract-gateway-secret}"
export WORKER_DIAGNOSTICS_SECRET="${WORKER_DIAGNOSTICS_SECRET:-contract-worker-diagnostics-secret-with-enough-length}"
export LLM_EGRESS_PROXY_SECRET="${LLM_EGRESS_PROXY_SECRET:-contract-llm-secret}"
export GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-contract-grafana-secret}"
export SANCTUARY_DEPLOYMENT_ID="${SANCTUARY_DEPLOYMENT_ID:-contract-deployment}"
export SANCTUARY_OWNER_ID="${SANCTUARY_OWNER_ID:-contract-owner}"
export SANCTUARY_RELEASE="${SANCTUARY_RELEASE:-contract-release}"
export SANCTUARY_OPERATION_RUN_ID="${SANCTUARY_OPERATION_RUN_ID:-contract-run}"
export SANCTUARY_PROJECT="${SANCTUARY_PROJECT:-contract-project}"
export SANCTUARY_VERSION="${SANCTUARY_VERSION:-0.0.0-contract}"
export SANCTUARY_COMMIT="${SANCTUARY_COMMIT:-contract-commit}"
export SANCTUARY_SOURCE_COMMIT="${SANCTUARY_SOURCE_COMMIT:-contract-source-commit}"
export SANCTUARY_BUILD_ID="${SANCTUARY_BUILD_ID:-contract-build}"
export SANCTUARY_IMAGE_LOCK_SHA256="${SANCTUARY_IMAGE_LOCK_SHA256:-contract-lock-sha256}"
export SANCTUARY_CLEANUP_CREATED_AT="${SANCTUARY_CLEANUP_CREATED_AT:-2000-01-01T00:00:00Z}"
