#!/usr/bin/env bash
# Túnel SSH Mac → PostgreSQL Docker na VPS (read-only setup).
# vinylab-postgres NÃO resolve no host da VPS; usa IP do container na rede vinylab_internal.
set -euo pipefail

VPS_USER="${VPS_USER:-viny}"
VPS_HOST="${VPS_HOST:-177.7.34.178}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
CONTAINER="${PG_CONTAINER:-vinylab-postgres}"
NETWORK="${PG_DOCKER_NETWORK:-vinylab_internal}"

echo "Encerrando túneis SSH antigos na porta ${LOCAL_PORT}..."
pkill -f "ssh -.*-L ${LOCAL_PORT}:" 2>/dev/null || true
sleep 1

if lsof -i ":${LOCAL_PORT}" >/dev/null 2>&1; then
  echo "ERRO: porta ${LOCAL_PORT} ainda em uso. Feche o terminal SSH manualmente."
  lsof -i ":${LOCAL_PORT}"
  exit 1
fi

echo "Obtendo IP do container ${CONTAINER}..."
PG_IP=$(ssh -o BatchMode=yes "${VPS_USER}@${VPS_HOST}" \
  "docker inspect -f '{{(index .NetworkSettings.Networks \"${NETWORK}\").IPAddress}}' ${CONTAINER}")

if [[ -z "${PG_IP}" ]]; then
  echo "ERRO: não foi possível obter IP do PostgreSQL na VPS."
  exit 1
fi

echo "Iniciando túnel: 127.0.0.1:${LOCAL_PORT} → ${PG_IP}:5432 (via ${VPS_HOST})"
echo "Mantenha este terminal aberto. Ctrl+C encerra o túnel."
exec ssh -N -o ExitOnForwardFailure=yes -L "${LOCAL_PORT}:${PG_IP}:5432" "${VPS_USER}@${VPS_HOST}"
