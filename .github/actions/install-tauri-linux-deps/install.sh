#!/usr/bin/env bash

set -euo pipefail

run_bounded_retry() {
  local max_attempts="$1"
  shift
  local attempt status
  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    if "$@"; then
      return 0
    else
      status="$?"
    fi
    if ((attempt < max_attempts)); then
      echo "dependency install attempt ${attempt}/${max_attempts} failed (${status}); retrying resumably" >&2
      sleep "${RAPIDRAW_RETRY_DELAY_SECONDS:-5}"
    fi
  done
  return "${status}"
}

if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

export DEBIAN_FRONTEND=noninteractive

packages=(
  libwebkit2gtk-4.1-dev
  build-essential
  curl
  wget
  file
  libssl-dev
  libayatana-appindicator3-dev
  librsvg2-dev
  patchelf
)

apt_options=(
  -o DPkg::Lock::Timeout=120
  -o Acquire::Retries=5
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
)

sudo timeout --signal=TERM --kill-after=30s 10m apt-get update "${apt_options[@]}"
run_bounded_retry 2 \
  sudo timeout --signal=TERM --kill-after=30s 10m \
  apt-get install -y --no-install-recommends "${apt_options[@]}" "${packages[@]}"
