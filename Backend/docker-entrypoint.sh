#!/bin/sh
# Xvfb permite o Chromium headed (captcha manual) sem display físico.
# SIGTERM/SIGINT são repassados ao Node para o encerramento da fila e do Prisma.
set -eu

Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
XVFB_PID=$!
export DISPLAY=:99

node dist/main.js &
NODE_PID=$!

term() {
  kill -TERM "$NODE_PID" 2>/dev/null || true
  wait "$NODE_PID" 2>/dev/null || true
  kill -TERM "$XVFB_PID" 2>/dev/null || true
  exit 0
}

trap term TERM INT
wait "$NODE_PID"
STATUS=$?
kill -TERM "$XVFB_PID" 2>/dev/null || true
exit "$STATUS"
