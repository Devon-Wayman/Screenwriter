#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd -- "$script_dir/.." && pwd)"
config_file="${SCREENWRITER_DEPLOY_CONFIG:-$project_dir/.env.deploy.local}"

if [[ ! -f "$config_file" ]]; then
  echo "Missing deployment configuration: $config_file" >&2
  echo "Copy .env.deploy.example to .env.deploy.local and edit it first." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$config_file"

required=(NAS_HOST NAS_USER NAS_SSH_PORT REMOTE_SOURCE_DIR REMOTE_COMPOSE_FILE REMOTE_SERVICE_NAME IMAGE_NAME APP_PORT NAS_USE_SUDO)
for variable in "${required[@]}"; do
  if [[ -z "${!variable:-}" ]]; then
    echo "Missing required setting: $variable" >&2
    exit 1
  fi
done

if [[ ! "$NAS_SSH_PORT" =~ ^[0-9]+$ || ! "$APP_PORT" =~ ^[0-9]+$ ]]; then
  echo "NAS_SSH_PORT and APP_PORT must be numbers." >&2
  exit 1
fi
if [[ "$NAS_USE_SUDO" != "0" && "$NAS_USE_SUDO" != "1" ]]; then
  echo "NAS_USE_SUDO must be 0 or 1." >&2
  exit 1
fi
if [[ "$REMOTE_SOURCE_DIR" != /* || "$REMOTE_COMPOSE_FILE" != /* ]]; then
  echo "REMOTE_SOURCE_DIR and REMOTE_COMPOSE_FILE must be absolute NAS paths." >&2
  exit 1
fi
for value in "$REMOTE_SOURCE_DIR" "$REMOTE_COMPOSE_FILE" "$REMOTE_SERVICE_NAME" "$IMAGE_NAME"; do
  if [[ ! "$value" =~ ^[A-Za-z0-9_./:@+-]+$ ]]; then
    echo "Unsafe character in deployment setting: $value" >&2
    exit 1
  fi
done

target="$NAS_USER@$NAS_HOST"
ssh_options=(-p "$NAS_SSH_PORT" -o ConnectTimeout=8 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

release_type="patch"
case "${1:-}" in
  --check) release_type="check" ;;
  --major) release_type="major" ;;
  --minor) release_type="minor" ;;
  --patch|"") release_type="patch" ;;
  --no-bump) release_type="none" ;;
  *) echo "Usage: $0 [--check|--patch|--minor|--major|--no-bump]" >&2; exit 1 ;;
esac

echo "Checking Tailscale/SSH connection to $target..."
ssh "${ssh_options[@]}" "$target" true

if [[ "$release_type" == "check" ]]; then
  echo "NAS is reachable and SSH authentication succeeded."
  exit 0
fi

local_version="$(node -p "require('$project_dir/package.json').version")"
health_json="$(ssh "${ssh_options[@]}" "$target" "if command -v curl >/dev/null 2>&1; then curl --fail --silent 'http://127.0.0.1:$APP_PORT/api/health' || true; elif command -v wget >/dev/null 2>&1; then wget -qO- 'http://127.0.0.1:$APP_PORT/api/health' || true; fi")"
deployed_version="$(node -e 'try { const value=JSON.parse(process.argv[1]); process.stdout.write(value.version || ""); } catch {}' "$health_json")"
next_version="$(node "$script_dir/next-version.mjs" "$local_version" "$deployed_version" "$release_type")"

echo "Local version:    $local_version"
echo "Deployed version: ${deployed_version:-unknown (pre-versioned build)}"
if [[ "$next_version" != "$local_version" ]]; then
  echo "Next version:     $next_version ($release_type release)"
  (cd "$project_dir" && npm version "$next_version" --no-git-tag-version --allow-same-version >/dev/null)
else
  echo "Version:          $next_version (no bump requested)"
fi

echo "Preparing remote source directory..."
ssh "${ssh_options[@]}" "$target" "mkdir -p '$REMOTE_SOURCE_DIR'"

echo "Synchronizing application source..."
rsync -az --human-readable --progress \
  --exclude '.git/' \
  --exclude '.env.deploy.local' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude 'server-dist/' \
  --exclude 'build/' \
  --exclude 'electron/' \
  --exclude 'release/' \
  --exclude 'data/' \
  --exclude 'screenplays/' \
  --exclude '*.tsbuildinfo' \
  -e "ssh -p $NAS_SSH_PORT -o ConnectTimeout=8" \
  "$project_dir/" "$target:$REMOTE_SOURCE_DIR/"

echo "Building and activating the update..."
# Allocate a terminal for this step so remote sudo can request a password when
# the NAS user is not a member of the Docker group.
ssh -tt "${ssh_options[@]}" "$target" \
  "'$REMOTE_SOURCE_DIR/scripts/nas-remote-update.sh' '$REMOTE_SOURCE_DIR' '$REMOTE_COMPOSE_FILE' '$REMOTE_SERVICE_NAME' '$IMAGE_NAME' '$APP_PORT' '$NAS_USE_SUDO' '$next_version'"

echo
echo "Screenwriter update completed successfully."
echo "Version: $next_version"
echo "Open: http://$NAS_HOST:$APP_PORT"
