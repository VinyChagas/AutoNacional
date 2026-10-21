# NFS-e nativo — H2.2.4-B1 Canal administrativo UDS

**Status:** canal de diagnóstico OFFLINE. Preparar/liberar **não** implementados. Execução fiscal real **não** liberada.

**Decisão:** alternativa B (Unix Domain Socket).

## Arquitetura

```text
CLI (homologacao:cli admin health|status)
        │  UDS + token
        ▼
Backend (mesmo processo da PQueue)
        └── servidor admin (opcional)
              ops: health | status
```

- Sem TCP, sem HTTP admin, sem segunda PQueue/worker.
- Socket filesystem (`homologacao-admin.sock`), não abstract namespace.
- Desativado por padrão.

## Compatibilidade

| Ambiente | Situação |
|----------|----------|
| macOS / Linux | Suportado (socket em filesystem) |
| Docker Linux | Compatível se o diretório do socket for volume compartilhado com o host/CLI |
| Windows nativo | Fora do escopo operacional atual do AutoNacional |

`SO_PEERCRED` **não** é API estável no Node.js → autenticação por **segredo administrativo** independente.

## Segurança

| Controle | Detalhe |
|----------|---------|
| Dir absoluto | `AUTONACIONAL_HOMOLOGACAO_ADMIN_SOCKET_DIR` |
| Permissões dir | `0700`, sem symlink, uid do processo |
| Socket | `0600`; órfão removível só se ECONNREFUSED + mesmo uid |
| Segredo | arquivo `0600` via `AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET_FILE` (≥32 chars) |
| Produção | **somente** arquivo; inline/env solto recusado |
| CLI | **sem** `--secret` em argv (só `--secret-file`) |
| Token | SHA-256 + `timingSafeEqual` |
| Socket órfão | remove só com `ECONNREFUSED` + mesmo uid; timeout → recusa |
| INTERNAL_API_KEY | **não** reutilizado |

Existência do socket **não** autoriza Discovery.

## Protocolo (v1)

Request (uma linha JSON + `\n`):

```json
{"v":1,"op":"health","token":"…","id":"req-1"}
```

Ops permitidas: `health` | `status`.

Limite: 4096 bytes. Timeout: 5s. Campos `shell`/`eval`/`cmd`/… rejeitados.

## Configuração

```bash
export AUTONACIONAL_HOMOLOGACAO_ADMIN_SOCKET_DIR=/var/lib/autonacional/admin-uds
export AUTONACIONAL_HOMOLOGACAO_ADMIN_SECRET_FILE=/var/lib/autonacional/admin.secret
# arquivo secret: chmod 0600, ≥16 chars
```

Sem essas envs → canal ausente; Backend sobe normalmente.

Com envs e falha de segurança → **exit 1** (sem canal parcial).

## CLI

```bash
npm run homologacao:cli -- admin health --socket-dir /abs/dir --secret-file /abs/secret
npm run homologacao:cli -- admin status --socket-dir /abs/dir --secret-file /abs/secret
```

Comandos de ticket (`emitir`/`ativar`/…) inalterados (store).

## Ciclo de vida

1. Bootstrap após canal de tickets (se houver).
2. Bind UDS + chmod.
3. Shutdown: `encerrarAdminSocket` antes de parar a fila HTTP/PQueue.
4. Reinício: remove órfão seguro; recusa se outro processo estiver vivo no socket.

## Pré-requisitos para preparar/liberar (próxima etapa)

Este canal é a base para ops futuras (`preparar` / `liberar`) no **mesmo** processo da PQueue.

Ainda **não** implementado:

- Preparação sem enqueue
- Liberação controlada
- Consumo de ticket (continua na ponte)

## Limitações

- Sem validação de peer UID via kernel (Node).
- Docker exige volume compartilhado para a CLI no host.
- Não há idempotência de preparar/liberar nesta etapa.
