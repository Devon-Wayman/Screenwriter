#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build/macos-release"
DIST_DIR="${ROOT_DIR}/dist/macos"

cmake --preset macos-release
cmake --build --preset macos-release --config Release

cmake -E rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"
cp -R "${BUILD_DIR}/Screenwriter.app" "${DIST_DIR}/"

if command -v macdeployqt >/dev/null 2>&1; then
    macdeployqt "${DIST_DIR}/Screenwriter.app"
else
    echo "macdeployqt was not found. Install Qt tools or run from a Qt shell to bundle Qt frameworks."
fi

if command -v codesign >/dev/null 2>&1; then
    codesign --force --deep --sign - "${DIST_DIR}/Screenwriter.app"
    codesign --verify --deep --strict --verbose=2 "${DIST_DIR}/Screenwriter.app"
else
    echo "codesign was not found. The staged app may be blocked by macOS code-signing checks."
fi

echo "macOS app staged at ${DIST_DIR}/Screenwriter.app"
