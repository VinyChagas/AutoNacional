#!/usr/bin/env bash
# Sobe túnel SSH → Postgres da VPS + Backend + Frontend.
# Uso (na raiz): npm run dev
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOCAL_PORT="${LOCAL_PORT:-5433}"
WAIT_TIMEOUT_MS="${DEV_DB_WAIT_MS:-90000}"

vermelho() { printf '\033[0;31m%s\033[0m\n' "$*"; }
verde() { printf '\033[0;32m%s\033[0m\n' "$*"; }
amarelo() { printf '\033[0;33m%s\033[0m\n' "$*"; }

if [[ ! -f Backend/.env ]]; then
  vermelho "Falta Backend/.env — copie Backend/.env.example e configure DATABASE_URL + CRYPTO_KEY."
  exit 1
fi

if ! grep -qE '@127\.0\.0\.1:5433|/localhost:5433' Backend/.env 2>/dev/null; then
  amarelo "Aviso: DATABASE_URL em Backend/.env não aponta para 127.0.0.1:${LOCAL_PORT}."
  amarelo "Para usar o Postgres da VPS via túnel, use algo como:"
  amarelo "  DATABASE_URL=postgresql://...@127.0.0.1:${LOCAL_PORT}/autonacional?schema=public"
fi

if [[ ! -d Backend/node_modules ]]; then
  vermelho "Backend/node_modules ausente. Rode: npm run install:all"
  exit 1
fi
if [[ ! -d Frontend/node_modules ]]; then
  vermelho "Frontend/node_modules ausente. Rode: npm run install:all"
  exit 1
fi
if [[ ! -d node_modules/concurrently ]] || [[ ! -d node_modules/wait-on ]]; then
  amarelo "Instalando dependências da raiz (concurrently, wait-on)..."
  npm install
fi

if ! command -v ssh >/dev/null 2>&1; then
  vermelho "ssh não encontrado no PATH."
  exit 1
fi

verde "AutoNacional dev local"
verde "  1) Túnel DB VPS → 127.0.0.1:${LOCAL_PORT}"
verde "  2) Backend     → http://localhost:4321"
verde "  3) Frontend    → http://localhost:1234"
echo ""
amarelo "Ctrl+C encerra túnel, API e frontend juntos."
amarelo "O túnel SSH pode pedir a passphrase da chave no terminal (1–2 vezes)."
echo ""

# --handle-input: encaminha o teclado ao processo que pedir input (passphrase SSH).
# -k: se um processo cair, encerra os demais (inclui o túnel SSH).
exec npx concurrently \
  --handle-input \
  --kill-others-on-fail \
  --kill-others \
  --names "tunnel,api,web" \
  --prefix-colors "blue,green,cyan" \
  --prefix "[{name}]" \
  "npm run tunnel:db --prefix Backend" \
  "npx wait-on \"tcp:127.0.0.1:${LOCAL_PORT}\" --timeout ${WAIT_TIMEOUT_MS} && npm run dev --prefix Backend" \
  "npm start --prefix Frontend"
