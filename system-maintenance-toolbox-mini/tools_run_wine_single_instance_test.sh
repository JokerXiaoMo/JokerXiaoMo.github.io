#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
EXE="$ROOT/release/系统维护工具箱 mini（64位·单实例稳定版）.exe"
PREFIX="$ROOT/.wine-single-instance-prefix"
SCREENSHOT="$ROOT/runtime_single_instance_check.png"
RESULT="$ROOT/runtime_single_instance_result.txt"

rm -rf "$PREFIX" "$SCREENSHOT" "$RESULT"
export WINEPREFIX="$PREFIX"
export WINEARCH=win64
export WINEDEBUG=-all

xvfb-run -a -s "-screen 0 1024x768x24" bash -c '
  set -e
  wineboot -u
  wine reg add "HKCU\\Software\\Wine\\Fonts\\Replacements" /v "Microsoft YaHei UI" /d "Noto Sans CJK SC" /f >/dev/null
  wine "$1" >/dev/null 2>&1 &
  first_pid=$!
  sleep 5
  wine "$1" >/dev/null 2>&1 &
  second_pid=$!
  sleep 3
  wait "$second_pid"
  kill -0 "$first_pid"
  windows=$(xdotool search --name "mini" | wc -l)
  test "$windows" -eq 1
  ffmpeg -loglevel error -y -video_size 1024x768 -f x11grab -i "$DISPLAY" -frames:v 1 "$2"
  printf "first_instance_alive=yes\nsecond_instance_exited=yes\nwindow_count=%s\n" "$windows" > "$3"
  wineserver -k || true
  wait "$first_pid" || true
' _ "$EXE" "$SCREENSHOT" "$RESULT"

test -s "$SCREENSHOT"
test -s "$RESULT"
cat "$RESULT"
