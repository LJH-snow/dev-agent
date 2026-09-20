#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_DIR="$ROOT_DIR/apps/macos/SignalLoomDesktop"
SWIFT_BUILD_DIR="$ROOT_DIR/.codex/native-build"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/Signal Loom Desktop.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/SignalLoomDesktop"
SERVER_SCRIPT="$ROOT_DIR/apps/desktop/dist/index.js"
APP_PROCESS_NAME="SignalLoomDesktop"
BUNDLE_ID="com.signal-loom.desktop"
MIN_SYSTEM_VERSION="13.0"
APP_LOG_FILE="${TMPDIR:-/tmp}/signal-loom-desktop-launch.log"

cd "$ROOT_DIR"

kill_existing_app() {
  /usr/bin/pkill -x "$APP_PROCESS_NAME" >/dev/null 2>&1 || true
  local orphan_pid
  while read -r orphan_pid; do
    [[ -n "$orphan_pid" ]] || continue
    if /bin/ps eww -p "$orphan_pid" -o command= |
      /usr/bin/grep -Fq 'DEV_AGENT_DESKTOP_NATIVE=1'; then
      /bin/kill "$orphan_pid" >/dev/null 2>&1 || true
    fi
  done < <(
    /usr/bin/pgrep -f "$SERVER_SCRIPT" || true
  )
}

stage_app() {
  pnpm --filter @dev-agent/desktop run build

  local node_path
  node_path="$(command -v node || true)"
  if [[ -z "$node_path" ]]; then
    echo "Node.js is required to build the local Desktop app." >&2
    exit 1
  fi

  swift build \
    -c debug \
    --package-path "$PACKAGE_DIR" \
    --scratch-path "$SWIFT_BUILD_DIR" \
    -Xswiftc -gnone
  local swift_bin
  swift_bin="$(
    swift build \
      -c debug \
      --package-path "$PACKAGE_DIR" \
      --scratch-path "$SWIFT_BUILD_DIR" \
      -Xswiftc -gnone \
      --show-bin-path
  )/SignalLoomDesktop"

  rm -rf "$APP_BUNDLE"
  mkdir -p "$APP_MACOS" "$APP_RESOURCES"
  cp "$swift_bin" "$APP_BINARY"
  chmod +x "$APP_BINARY"

  printf '%s\n' "$ROOT_DIR" >"$APP_RESOURCES/project-root.txt"
  printf '%s\n' "$node_path" >"$APP_RESOURCES/node-path.txt"

  cat >"$APP_CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>SignalLoomDesktop</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>Signal Loom Desktop</string>
  <key>CFBundleDisplayName</key>
  <string>Signal Loom Desktop</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
</dict>
</plist>
PLIST
}

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

launch_app_direct() {
  /usr/bin/nohup "$APP_BINARY" >"$APP_LOG_FILE" 2>&1 </dev/null &
}

launch_app() {
  if [[ "${DEV_AGENT_DESKTOP_LAUNCH_SERVICES:-0}" == "1" ]]; then
    open_app
    return
  fi
  launch_app_direct
}

server_pid_for_app() {
  local app_pid="$1"
  local node_pid
  while read -r node_pid; do
    [[ -n "$node_pid" ]] || continue
    if /bin/ps eww -p "$node_pid" -o command= |
      /usr/bin/grep -Fq 'DEV_AGENT_DESKTOP_NATIVE=1'; then
      printf '%s\n' "$node_pid"
      return
    fi
  done < <(/usr/bin/pgrep -f "$SERVER_SCRIPT" || true)
}

server_port() {
  local pid="$1"
  /usr/sbin/lsof -nP -a -p "$pid" -iTCP -sTCP:LISTEN -Fn 2>/dev/null |
    /usr/bin/awk '
      /^n127\.0\.0\.1:/ {
        sub(/^n127\.0\.0\.1:/, "", $0)
        print
        exit
      }
    '
}

verify_app() {
  local attempt
  local app_pid=""
  for attempt in {1..40}; do
    app_pid="$(/usr/bin/pgrep -x "$APP_PROCESS_NAME" || true)"
    [[ -n "$app_pid" ]] && break
    /bin/sleep 0.25
  done
  if [[ -z "$app_pid" ]]; then
    echo "Signal Loom Desktop.app did not start." >&2
    exit 1
  fi

  local node_pid=""
  local port=""
  local health_response=""
  local page_response=""
  for attempt in {1..40}; do
    node_pid="$(server_pid_for_app "$app_pid" || true)"
    if [[ -n "$node_pid" ]]; then
      port="$(server_port "$node_pid" || true)"
      health_response="$(
        /usr/bin/curl --fail --silent --show-error \
          "http://127.0.0.1:$port/health" 2>/dev/null || true
      )"
      page_response="$(
        /usr/bin/curl --fail --silent --show-error \
          "http://127.0.0.1:$port/" 2>/dev/null || true
      )"
      if [[ -n "$port" ]] &&
        [[ "$health_response" == *'"status":"ok"'* ]] &&
        [[ "$page_response" == *"Signal Loom"* ]]; then
        echo "Signal Loom Desktop.app is running (pid $app_pid, server port $port)."
        return
      fi
    fi
    /bin/sleep 0.25
  done

  echo "Signal Loom Desktop.app started, but its local server did not become healthy." >&2
  exit 1
}

kill_existing_app

case "$MODE" in
  run)
    stage_app
    launch_app
    ;;
  --verify|verify)
    stage_app
    launch_app_direct
    verify_app
    ;;
  --debug|debug)
    stage_app
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    stage_app
    launch_app
    exec /usr/bin/log stream --info --style compact --predicate "process == \"$APP_PROCESS_NAME\""
    ;;
  --telemetry|telemetry)
    stage_app
    launch_app
    exec /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  *)
    echo "usage: $0 [run|--verify|--debug|--logs|--telemetry]" >&2
    exit 2
    ;;
esac
