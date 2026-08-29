#!/usr/bin/env bash
set -euo pipefail

minimum_cpus=2
minimum_memory_kib=$((4 * 1024 * 1024))
minimum_disk_kib=$((15 * 1024 * 1024))
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repository_root="$(cd "$script_dir/../.." && pwd)"

cpus="$(getconf _NPROCESSORS_ONLN)"
memory_kib="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
disk_kib="$(df -Pk "$repository_root" | awk 'NR == 2 { print $4 }')"

if [ "$cpus" -lt "$minimum_cpus" ]; then
  echo "wallet-sync replay requires at least $minimum_cpus host CPUs; found $cpus" >&2
  exit 1
fi
if [ "$memory_kib" -lt "$minimum_memory_kib" ]; then
  echo "wallet-sync replay requires at least 4 GiB host RAM; found ${memory_kib} KiB" >&2
  exit 1
fi
if [ "$disk_kib" -lt "$minimum_disk_kib" ]; then
  echo "wallet-sync replay requires at least 15 GiB free disk; found ${disk_kib} KiB" >&2
  exit 1
fi

printf 'wallet-sync replay host accepted: cpus=%s memory_kib=%s free_disk_kib=%s\n' \
  "$cpus" "$memory_kib" "$disk_kib"
