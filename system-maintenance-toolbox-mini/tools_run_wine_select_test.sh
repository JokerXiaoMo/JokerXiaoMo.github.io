#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
EXE="$ROOT/release/系统维护工具箱 mini（64位）.exe"
PREFIX="$ROOT/.wine-select-test-prefix"
SCREENSHOT="$ROOT/runtime_select_check.png"
LOG="$ROOT/runtime_select_check.log"

rm -rf "$PREFIX" "$SCREENSHOT" "$LOG"
export WINEPREFIX="$PREFIX"
export WINEARCH=win64
export WINEDEBUG=-all

xvfb-run -a -s "-screen 0 1024x768x24" bash -c '
  set -e
  wineboot -u
  wine reg add "HKCU\\Software\\Wine\\Fonts\\Replacements" /v "Microsoft YaHei UI" /d "Noto Sans CJK SC" /f >/dev/null
  wine "$1" > "$2" 2>&1 &
  app_pid=$!
  sleep 6
  app_window=$(xdotool search --name "mini" | head -n 1)
  test -n "$app_window"
  eval "$(xdotool getwindowgeometry --shell "$app_window")"
  xdotool mousemove $((X + 615)) $((Y + 175)) click 1
  sleep 4
  ffmpeg -loglevel error -y -video_size 1024x768 -f x11grab -i "$DISPLAY" -frames:v 1 "$3"
  wineserver -k || true
  wait "$app_pid" || true
' _ "$EXE" "$LOG" "$SCREENSHOT"

test -s "$SCREENSHOT"
file "$SCREENSHOT"
