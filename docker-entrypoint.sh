#!/bin/sh
set -eu

# Ensure cache dir exists (it is usually a bind mount: ./.cache -> /app/.cache)
mkdir -p /app/.cache

# Default uid/gid in Dockerfiles: nextjs(1001):nodejs(1001)
TARGET_UID="${TARGET_UID:-1001}"
TARGET_GID="${TARGET_GID:-1001}"

maybe_fix_cache_permissions() {
  # Only attempt chown when running as root
  if [ "$(id -u)" != "0" ]; then
    return 0
  fi

  # If anything under /app/.cache is not owned by TARGET_UID/GID, fix it.
  # BusyBox find supports -user/-group (NAME or numeric ID).
  NEED_FIX="$(find /app/.cache \( -not -user "$TARGET_UID" -o -not -group "$TARGET_GID" \) -print -quit 2>/dev/null || true)"
  if [ -n "$NEED_FIX" ]; then
    echo "[entrypoint] Fixing ownership for /app/.cache -> ${TARGET_UID}:${TARGET_GID}"
    chown -R "$TARGET_UID:$TARGET_GID" /app/.cache || true
  fi
}

maybe_fix_cache_permissions

# Drop privileges to nextjs for running the app (best-effort; requires running as root).
if [ "$(id -u)" = "0" ]; then
  # BusyBox su exists on alpine by default.
  exec su -s /bin/sh nextjs -c "$*"
fi

exec "$@"


