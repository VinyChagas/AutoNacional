# Migração Storage SFTP — AutoNacional Backend

Documentação da evolução da abstração `CertificateStorage` para suportar **filesystem local** e **SFTP remoto**, permitindo executar o Backend no Mac enquanto PostgreSQL e certificados PFX permanecem na VPS.

## Resumo

| Cenário | `CERT_STORAGE_DRIVER` | Destino dos PFX |
|---------|----------------------|-----------------|
| Mac (dev) | `sftp` | VPS via SSH/SFTP |
| VPS (produção futura) | `local` | `/srv/data/autonacional/certificados` |

A interface `CertificateStorage` **não foi alterada**. Serviços consumidores (`certificate-loader`, `cadastro-certificado`, `import-certificados`, etc.) continuam usando `getCertificateStorage().read/save/delete/exists()` sem saber qual driver está ativo.

---

## Arquivos criados

| Arquivo | Descrição |
|---------|-----------|
| `src/storage/sftp-connection-manager.ts` | Gerenciamento de conexão SSH/SFTP (connect, reconnect, keepalive, close) |
| `src/storage/sftp-certificate-storage.ts` | Implementação `SftpCertificateStorage` |
| `src/storage/sftp-certificate-storage.test.ts` | Testes unitários do driver SFTP e factory |
| `MIGRACAO_STORAGE_SFTP.md` | Este documento |

## Arquivos alterados

| Arquivo | Alteração |
|---------|-----------|
| `src/config/env.ts` | `CERT_STORAGE_DRIVER` e variáveis SFTP |
| `src/storage/index.ts` | Factory por driver, `closeCertificateStorage()`, readiness SFTP |
| `src/storage/path-safety.ts` | `resolveSafeCertificatePathPosix`, `assertResolvedInsidePosixBase` |
| `src/main.ts` | Logs de startup por driver, shutdown com fechamento SFTP |
| `scripts/smoke-vps-storage.mjs` | Suporte a `local` e `sftp` (read-only) |
| `.env.example` | Documentação dos dois modos |
| `package.json` / `package-lock.json` | Dependência `ssh2` + `@types/ssh2` |

**Não alterados (conforme solicitado):** Prisma schema, PostgreSQL, Frontend, Supabase.

---

## Biblioteca SFTP

**[ssh2](https://www.npmjs.com/package/ssh2)** — cliente SSH/SFTP maduro e amplamente utilizado no ecossistema Node.js.

- Operações via API SFTP nativa (`readFile`, `writeFile`, `unlink`, `stat`, `mkdir`)
- Sem comandos shell para operações normais de arquivo
- Suporte a `keepaliveInterval` / `keepaliveCountMax` para sessões longas de automação

---

## Como funciona `CertificateStorage`

Interface única para armazenamento de certificados PFX:

```typescript
interface CertificateStorage {
  save(relativePath: string, buffer: Buffer): Promise<void>;
  read(relativePath: string): Promise<Buffer>;
  delete(relativePath: string): Promise<void>;
  exists(relativePath: string): Promise<boolean>;
}
```

Paths no PostgreSQL (`certificados_digitais.arquivo`) permanecem **relativos**, por exemplo:

```
contabilidade/1/empresa/12345678000199/certs/arquivo.pfx
```

O driver resolve internamente:

```
BASE_PATH + path relativo → path físico (local ou remoto)
```

---

## `LocalCertificateStorage`

- Usa `fs/promises` no filesystem local
- Base: `CERT_STORAGE_PATH` (ex.: `/srv/data/autonacional/certificados`)
- Validação de path com `resolveSafeCertificatePath` + `assertResolvedInsideBase` (symlinks)
- Uso futuro na VPS com `CERT_STORAGE_DRIVER=local`

---

## `SftpCertificateStorage`

- Conecta à VPS via SSH/SFTP usando `SftpConnectionManager`
- Base remota: `CERT_STORAGE_SFTP_BASE_PATH`
- Validação POSIX com `resolveSafeCertificatePathPosix` + `assertResolvedInsidePosixBase`
- `save`: cria diretórios remotos recursivamente, envia buffer
- `read`: baixa arquivo, retorna `Buffer` (transparente para Playwright/automação)
- `delete`: remove apenas o arquivo; inexistente = sem erro
- `exists`: `stat` remoto (sem download completo)
- Conexão persistente com fila serializada de operações e **reconexão automática** em falhas transitórias

---

## Variáveis de ambiente

### Comuns

```env
CERT_STORAGE_DRIVER=local   # ou sftp
```

### Modo local (VPS / mesma máquina)

```env
CERT_STORAGE_DRIVER=local
CERT_STORAGE_PATH=/srv/data/autonacional/certificados
```

### Modo SFTP (Mac → VPS)

```env
CERT_STORAGE_DRIVER=sftp
CERT_STORAGE_SFTP_HOST=<host-vps>
CERT_STORAGE_SFTP_PORT=22
CERT_STORAGE_SFTP_USER=<usuario-ssh>
CERT_STORAGE_SFTP_PRIVATE_KEY=/caminho/para/id_ed25519
CERT_STORAGE_SFTP_BASE_PATH=/srv/data/autonacional/certificados
```

**Não versionar:** senhas, private keys, passphrases, IPs reais no repositório.

---

## Segurança de path

Ambos os drivers rejeitam:

- Paths absolutos (`/etc/passwd`, `C:\...`)
- Segmentos `..` (path traversal)
- Null bytes
- Escape da pasta base configurada

O driver SFTP usa normalização **POSIX** (`path.posix`) antes de qualquer operação remota.

Erros **não expõem** paths físicos remotos nem conteúdo de certificados.

---

## Autenticação SSH

### Estratégia

1. Lê a chave privada de `CERT_STORAGE_SFTP_PRIVATE_KEY` (caminho no Mac)
2. Se `SSH_AUTH_SOCK` estiver definido (ssh-agent ativo no macOS), usa o agent como método adicional
3. **Não** lê passphrase do `.env` nem do código

### Chave com passphrase (recomendado no Mac)

Antes de iniciar o Backend:

```bash
# Adiciona a chave ao ssh-agent (solicita passphrase uma vez)
ssh-add ~/.ssh/id_ed25519

# Verifica
ssh-add -l
```

O ssh-agent mantém a chave desbloqueada na sessão. O Backend usa `SSH_AUTH_SOCK` automaticamente.

### Erro de autenticação

Mensagem clara, sem expor chave ou passphrase:

> Falha de autenticação SFTP. Se a chave SSH tiver passphrase, adicione-a ao ssh-agent com `ssh-add` antes de iniciar o Backend.

---

## Gerenciamento de conexão

`SftpConnectionManager`:

| Recurso | Comportamento |
|---------|---------------|
| Conexão | Lazy connect na primeira operação |
| Keepalive | 10s interval, 3 tentativas |
| Timeout | 30s no connect |
| Operações | Fila serializada (`withSftp`) |
| Reconnect | 1 retry automático em `ECONNRESET`, `EPIPE`, etc. |
| Shutdown | `closeCertificateStorage()` em SIGINT/SIGTERM |

---

## Log de startup

**Mac (SFTP):**

```
Database: PostgreSQL próprio conectado
Certificate Storage: SFTP conectado
Arquitetura: Prisma→PostgreSQL VPS | SFTP→certificados PFX na VPS
```

**VPS (local):**

```
Database: PostgreSQL próprio conectado
Certificate Storage: Local filesystem conectado
Arquitetura: Prisma→PostgreSQL VPS | Filesystem local→certificados PFX
```

Nunca imprime secrets, conteúdo PFX ou `DATABASE_URL` completa.

---

## Testes executados

```bash
cd Backend
npm run build          # OK
npm test               # 161 testes (incl. 39 de storage)
```

Cobertura SFTP (mocks, sem PFX reais):

- Configuração do driver (`local` / `sftp` / inválido)
- `read`, `save`, `delete`, `exists`
- Path traversal e path absoluto
- Arquivo inexistente
- Reconexão após falha temporária
- Mensagens sem exposição de paths físicos

---

## Como configurar o Mac

### 1. SSH tunnel PostgreSQL (já existente)

```bash
ssh -L 5433:vinylab-postgres:5432 viny@<host-vps>
```

### 2. ssh-agent (chave com passphrase)

```bash
ssh-add ~/.ssh/id_ed25519
```

### 3. `.env` do Backend

```env
DATABASE_URL=postgresql://autonacional_app:<senha>@127.0.0.1:5433/autonacional?schema=public

CERT_STORAGE_DRIVER=sftp
CERT_STORAGE_SFTP_HOST=<host-vps>
CERT_STORAGE_SFTP_PORT=22
CERT_STORAGE_SFTP_USER=viny
CERT_STORAGE_SFTP_PRIVATE_KEY=/Users/viniciuschagas/.ssh/id_ed25519
CERT_STORAGE_SFTP_BASE_PATH=/srv/data/autonacional/certificados
```

### 4. Iniciar Backend

```bash
cd Backend
npm run dev
```

---

## Smoke test (read-only)

```bash
cd Backend
npm run test:smoke-storage
```

Com `CERT_STORAGE_DRIVER=sftp`, o smoke:

1. Conecta via SFTP à VPS
2. Valida diretório base e contagem de PFX
3. Busca um registro em `certificados_digitais`
4. Confirma existência e leitura do PFX pelo path relativo do banco
5. **Não modifica** nenhum arquivo

> **Aguardando autorização** para executar smoke contra a VPS real (479 PFX).

---

## Pendências

- [ ] Executar `npm run test:smoke-storage` com `CERT_STORAGE_DRIVER=sftp` contra VPS (após autorização)
- [ ] Validar automação NFSe ponta a ponta no Mac com storage remoto
- [ ] Deploy futuro na VPS: trocar para `CERT_STORAGE_DRIVER=local`

---

## Riscos

| Risco | Mitigação |
|-------|-----------|
| Latência SFTP em automações com muitos certificados | Conexão persistente + keepalive; monitorar em produção |
| Queda de conexão SSH durante execução longa | Reconnect automático; erro claro se persistir |
| Chave com passphrase sem ssh-agent | Mensagem orientando `ssh-add` |
| Path traversal | Validação POSIX antes de toda operação |

---

## SFTP STORAGE PRONTO PARA TESTE NO MAC: **SIM**

Implementação, build e testes automatizados concluídos. O smoke test contra a VPS real e testes de escrita/substituição de certificados **não foram executados** — aguardando sua autorização conforme solicitado.
