#!/usr/bin/env sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

target=${1:-current}
case "$target" in
  current) platform="" ;;
  mac|macos) platform="--mac" ;;
  windows|win) platform="--win" ;;
  linux) platform="--linux" ;;
  *) echo "Usage: $0 [current|mac|windows|linux]" >&2; exit 2 ;;
esac

echo "Building Screenwriter web assets and local server..."
npm run build
echo "Packaging standalone Screenwriter for ${target}..."
npx electron-builder $platform
echo "Standalone artifacts are in release/."
