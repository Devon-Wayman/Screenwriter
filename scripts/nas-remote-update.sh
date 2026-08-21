#!/usr/bin/env sh
set -eu

source_dir="$1"
compose_file="$2"
service_name="$3"
image_name="$4"
app_port="$5"
use_sudo="$6"
app_version="$7"

if [ "$use_sudo" = "1" ]; then
  docker_command="sudo docker"
else
  docker_command="docker"
fi

if [ ! -f "$source_dir/Dockerfile" ]; then
  echo "Dockerfile not found in $source_dir" >&2
  exit 1
fi
if [ ! -f "$compose_file" ]; then
  echo "CasaOS Compose file not found: $compose_file" >&2
  exit 1
fi

rollback_image="${image_name%:*}:rollback"
had_previous=0
if $docker_command image inspect "$image_name" >/dev/null 2>&1; then
  had_previous=1
  echo "Saving the currently installed image as $rollback_image..."
  $docker_command tag "$image_name" "$rollback_image"
fi

echo "Building $image_name (Screenwriter $app_version)..."
$docker_command build --pull --build-arg "APP_VERSION=$app_version" --tag "$image_name" "$source_dir"

echo "Recreating CasaOS service $service_name..."
$docker_command compose -f "$compose_file" up -d --force-recreate --no-deps "$service_name"

healthy=0
attempt=1
while [ "$attempt" -le 20 ]; do
  if command -v curl >/dev/null 2>&1; then
    if curl --fail --silent "http://127.0.0.1:$app_port/api/health" | grep -q "\"version\":\"$app_version\""; then healthy=1; break; fi
  elif command -v wget >/dev/null 2>&1; then
    if wget -qO- "http://127.0.0.1:$app_port/api/health" | grep -q "\"version\":\"$app_version\""; then healthy=1; break; fi
  else
    echo "Neither curl nor wget is installed; skipping HTTP health verification."
    healthy=1
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done

if [ "$healthy" = "1" ]; then
  echo "Updated service passed its health check."
  exit 0
fi

echo "Updated service failed its health check." >&2
if [ "$had_previous" = "1" ]; then
  echo "Restoring the previous image..." >&2
  $docker_command tag "$rollback_image" "$image_name"
  $docker_command compose -f "$compose_file" up -d --force-recreate --no-deps "$service_name"
  echo "Rollback requested. Inspect logs with: $docker_command logs $service_name" >&2
fi
exit 1
