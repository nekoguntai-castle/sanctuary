#!/usr/bin/env bash
# Build (and optionally push) the CI job image that carries the Go toolchain
# for the address cross-verification lane.
#
#   scripts/ci/rebuild-go-runner-image.sh [RUNNER_DOCKER_CONTAINER]
#
# Mirrors counting-cats' scripts/ci/rebuild-playwright-runner-image.sh, which is
# the established pattern for this fleet: build a small image on top of the act
# base, push it to the registry, then map a runner label to the pushed digest in
# the runner-infra host profiles.
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
runner_docker_container="${1:-}"
image_repository="${GO_RUNNER_IMAGE_REPOSITORY:-sanctuary-ci-go}"
push_image="${GO_RUNNER_PUSH:-0}"

fail() {
  printf 'rebuild-go-runner-image: %s\n' "$*" >&2
  exit 2
}

if [[ "$push_image" != "0" && "$push_image" != "1" ]]; then
  fail "GO_RUNNER_PUSH must be 0 or 1, got ${push_image}"
fi

if [ "$push_image" = "1" ]; then
  registry="${image_repository%%/*}"
  if [ -z "${GO_RUNNER_IMAGE_REPOSITORY:-}" ] ||
    [[ "$image_repository" != */* ]] ||
    [[ "$registry" != *.* && "$registry" != *:* && "$registry" != "localhost" ]]; then
    fail 'GO_RUNNER_PUSH=1 requires an explicit registry-qualified GO_RUNNER_IMAGE_REPOSITORY'
  fi
fi

# The image exists to satisfy this go.mod, so the tag tracks it rather than a
# number maintained by hand in two places.
go_directive="$(
  awk '$1 == "go" { print $2; exit }' \
    "${root_dir}/scripts/verify-addresses/implementations/go.mod"
)"
[ -n "$go_directive" ] || fail 'could not read the go directive from implementations/go.mod'

go_version="${GO_RUNNER_GO_VERSION:-}"
if [ -z "$go_version" ]; then
  # Default to the Dockerfile pin, and fail loudly if it ever drops below what
  # go.mod requires rather than building an image that cannot compile the target.
  go_version="$(
    awk -F= '$1 ~ /^ARG GO_VERSION/ { print $2; exit }' \
      "${root_dir}/scripts/ci/images/go-runner.Dockerfile"
  )"
fi
[ -n "$go_version" ] || fail 'could not determine the Go version to build'

lowest="$(printf '%s\n%s\n' "$go_directive" "$go_version" | sort -V | head -n 1)"
if [ "$lowest" != "$go_directive" ]; then
  fail "pinned Go ${go_version} is older than the go.mod directive ${go_directive}"
fi

image="${image_repository}:${go_version}"
runner_label="go-${go_version}"

runner_docker() {
  if [ -n "$runner_docker_container" ]; then
    docker exec "$runner_docker_container" docker "$@"
  else
    docker "$@"
  fi
}

# DOCKER_BUILDKIT=0 for the same reason as the playwright image: under BuildKit a
# rootless-Podman host selects the docker-container driver, whose result stays in
# the build cache, so the immediate `docker run` verification cannot find the tag.
if [ -n "$runner_docker_container" ]; then
  docker exec -i -e DOCKER_BUILDKIT=0 "$runner_docker_container" docker build \
    --build-arg "GO_VERSION=${go_version}" \
    -t "$image" - < "${root_dir}/scripts/ci/images/go-runner.Dockerfile"
else
  DOCKER_BUILDKIT=0 docker build \
    --build-arg "GO_VERSION=${go_version}" \
    -t "$image" \
    -f "${root_dir}/scripts/ci/images/go-runner.Dockerfile" \
    "$root_dir"
fi

runner_docker image inspect "$image" >/dev/null
# Prove the toolchain actually runs, not merely that the layer unpacked.
runner_docker run --rm "$image" go version

runner_image="$image"
if [ "$push_image" = "1" ]; then
  runner_docker push "$image"
  runner_image="$(
    runner_docker image inspect "$image" --format '{{range .RepoDigests}}{{println .}}{{end}}' |
      awk -v repository="$image_repository" 'index($0, repository "@sha256:") == 1 { print; exit }'
  )"
  [ -n "$runner_image" ] || fail "push completed but no digest was recorded for ${image}"
fi

printf 'Built %s\nRunner label mapping: %s:docker://%s\n' "$image" "$runner_label" "$runner_image"
