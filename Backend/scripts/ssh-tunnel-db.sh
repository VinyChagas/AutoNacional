#!/usr/bin/env bash
# Túnel SSH Mac → PostgreSQL Docker na VPS.
# vinylab-postgres NÃO resolve no host da VPS; usa IP do container na rede vinylab_internal.
#
# Pedirá a passphrase da chave no terminal (usa /dev/tty).
# Para modo não interativo: SSH_BATCH=1 (exige chave já no ssh-agent).
set -euo pipefail

VPS_USER="${VPS_USER:-viny}"
VPS_HOST="${VPS_HOST:-177.7.34.178}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
CONTAINER="${PG_CONTAINER:-vinylab-postgres}"
NETWORK="${PG_DOCKER_NETWORK:-vinylab_internal}"
IDENTITY_FILE="${SSH_IDENTITY_FILE:-${HOME}/.ssh/id_ed25519}"

CONTROL_PATH="${SSH_CONTROL_PATH:-${HOME}/.ssh/cm-autonacional-%r@%h:%p}"
mkdir -p "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh" 2>/dev/null || true

SSH_BASE=(
  ssh
  -o IdentitiesOnly=yes
  -o PreferredAuthentications=publickey
  -o ControlMaster=auto
  -o "ControlPath=${CONTROL_PATH}"
  -o ControlPersist=300
)
if [[ -f "${IDENTITY_FILE}" ]]; then
  SSH_BASE+=(-i "${IDENTITY_FILE}")
fi

# BatchMode desliga prompt de passphrase/senha — só sob demanda.
if [[ "${SSH_BATCH:-0}" == "1" ]]; then
  SSH_BASE+=(-o BatchMode=yes)
fi

print_ssh_help() {
  cat <<EOF

Falha de autenticação SSH (${VPS_USER}@${VPS_HOST}).

1) Digite a passphrase quando o SSH pedir (não use SSH_BATCH=1).
2) Ou carregue a chave no agent:
     ssh-add --apple-use-keychain ${IDENTITY_FILE}
3) Confirme acesso:
     ssh -i ${IDENTITY_FILE} -o IdentitiesOnly=yes ${VPS_USER}@${VPS_HOST} 'echo OK'

Se ainda falhar: a chave pública precisa estar em authorized_keys do usuário ${VPS_USER} na VPS.

EOF
}

echo "Encerrando túneis SSH antigos na porta ${LOCAL_PORT}..."
pkill -f "ssh -.*-L ${LOCAL_PORT}:" 2>/dev/null || true
sleep 1

if lsof -i ":${LOCAL_PORT}" >/dev/null 2>&1; then
  echo "ERRO: porta ${LOCAL_PORT} ainda em uso. Feche o terminal SSH manualmente."
  lsof -i ":${LOCAL_PORT}"
  exit 1
fi

if [[ ! -f "${IDENTITY_FILE}" ]]; then
  echo "ERRO: chave SSH não encontrada: ${IDENTITY_FILE}"
  echo "Defina SSH_IDENTITY_FILE ou crie ~/.ssh/id_ed25519"
  exit 1
fi

echo "Obtendo IP do container ${CONTAINER} (via ${VPS_USER}@${VPS_HOST})..."
echo "Se a chave tiver passphrase, digite-a abaixo quando o SSH pedir."

set +e
PG_IP=$("${SSH_BASE[@]}" -o ConnectTimeout=30 "${VPS_USER}@${VPS_HOST}" \
  "docker inspect -f '{{(index .NetworkSettings.Networks \"${NETWORK}\").IPAddress}}' ${CONTAINER}" 2>/tmp/autonacional-ssh-tunnel.err)
SSH_RC=$?
set -e

if [[ ${SSH_RC} -ne 0 ]]; then
  echo "ERRO: SSH falhou (código ${SSH_RC})."
  if [[ -f /tmp/autonacional-ssh-tunnel.err ]]; then
    cat /tmp/autonacional-ssh-tunnel.err
  fi
  if grep -qi 'Permission denied\|passphrase\|Could not open' /tmp/autonacional-ssh-tunnel.err 2>/dev/null; then
    print_ssh_help
  fi
  exit "${SSH_RC}"
fi

if [[ -z "${PG_IP}" ]]; then
  echo "ERRO: não foi possível obter IP do PostgreSQL na VPS."
  exit 1
fi

echo "Iniciando túnel: 127.0.0.1:${LOCAL_PORT} → ${PG_IP}:5432 (via ${VPS_HOST})"
echo "Ctrl+C encerra o túnel (e o npm run dev)."
exec "${SSH_BASE[@]}" -N -o ExitOnForwardFailure=yes \
  -L "${LOCAL_PORT}:${PG_IP}:5432" "${VPS_USER}@${VPS_HOST}"
