#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build/linux-release"
DIST_DIR="${ROOT_DIR}/dist/linux"

cmake --preset linux-release
cmake --build --preset linux-release --config Release
cmake -E rm -rf "${DIST_DIR}"
cmake --install "${BUILD_DIR}" --prefix "${DIST_DIR}" --config Release

echo "Linux build staged at ${DIST_DIR}"
echo "Run ${DIST_DIR}/bin/Screenwriter"
