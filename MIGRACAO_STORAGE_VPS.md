# Migração Storage → filesystem local na VPS

**Data:** 2026-08-28  
**Objetivo:** substituir Supabase Storage por armazenamento local privado de certificados PFX, sem alterar o PostgreSQL nem os paths relativos já gravados em `certificados_digitais.arquivo`.  
**Escopo:** código do Backend. Sem cutover definitivo, sem exclusão do projeto/bucket Supabase, sem deploy, sem exposição HTTP da pasta.

---

## Arquitetura

```
Angular Frontend
        │
        ▼
Express Backend
   ├── Prisma  ──────────► PostgreSQL VPS
   └── CertificateStorage ─► Filesystem local
                             CERT_STORAGE_PATH
                             /srv/data/autonacional/certificados
```

O banco continua com paths **relativos**, por exemplo:

`contabilidade/1/empresa/12345678000199/certs/arquivo.pfx`

O backend resolve internamente `CERT_STORAGE_PATH + path_relativo`. Path absoluto **não** é gravado no banco.

---

## Abstração criada

`CertificateStorage` (`save` / `read` / `delete` / `exists`)

Implementação: `LocalCertificateStorage`

| Arquivo | Função |
|---------|--------|
| `Backend/src/storage/certificate-storage.ts` | Interface, erros, máscara de path relativo |
| `Backend/src/storage/path-safety.ts` | Validação contra path traversal |
| `Backend/src/storage/local-certificate-storage.ts` | Filesystem local |
| `Backend/src/storage/index.ts` | Singleton `getCertificateStorage()`, checagem de prontidão |

Proteção obrigatória antes de ler/gravar/excluir:

- rejeita `..`
- rejeita caminhos absolutos
- exige que o path resolvido permaneça dentro de `CERT_STORAGE_PATH`
- segue `realpath` da pasta base (evita falso negativo com symlink, ex. `/var` → `/private/var`)
- mensagens de erro e logs **não** incluem o path físico completo

---

## Arquivos alterados

### Criados

| Arquivo | Mudança |
|---------|---------|
| `Backend/src/storage/certificate-storage.ts` | Interface `CertificateStorage` |
| `Backend/src/storage/path-safety.ts` | Path traversal |
| `Backend/src/storage/local-certificate-storage.ts` | Implementação local |
| `Backend/src/storage/index.ts` | Factory / bootstrap |
| `Backend/src/storage/local-certificate-storage.test.ts` | Testes em diretório temporário |
| `Backend/scripts/smoke-vps-storage.mjs` | Smoke read-only |
| `MIGRACAO_STORAGE_VPS.md` | Este relatório |

### Modificados (produção)

| Arquivo | Mudança |
|---------|---------|
| `Backend/src/modules/certificados/empresas/cadastro-certificado.service.ts` | `upload` → `storage.save` |
| `Backend/src/modules/imports/import-certificados.service.ts` | `download`/`upload` → `read`/`save` |
| `Backend/src/services/certificate-loader.ts` | `download` → `storage.read` (Playwright) |
| `Backend/src/services/certificado-storage.service.ts` | `remove` → `storage.delete` |
| `Backend/src/routers/certificados.ts` | `/importar` e `/importar-lote` passam a usar `CertificateStorage` (antes: `certificados_armazenados`) |
| `Backend/src/main.ts` | Bootstrap verifica `CERT_STORAGE_PATH` (sem path físico nos logs) |
| `Backend/src/config/env.ts` | `CERT_STORAGE_PATH`; removidas vars de Supabase Storage |
| `Backend/src/infrastructure/config.ts` | Idem |
| `Backend/src/routers/config.ts` | Status de storage local; `supabaseConfigured` mantido por compatibilidade com o frontend |
| `Backend/src/controllers/logs.controller.ts` | Removido import morto de Supabase |
| `Backend/.env.example` | `CERT_STORAGE_PATH`; removidas `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CERT_STORAGE_BUCKET`, `USE_SUPABASE` |
| `Backend/package.json` | Removida `@supabase/supabase-js`; script `test:smoke-storage` |
| `Backend/package-lock.json` | Lock atualizado |
| `Backend/scripts/export-storage-certificados.mjs` | Comentário: script pontual, não é runtime |

### Removidos (código de produção)

| Arquivo | Motivo |
|---------|--------|
| `Backend/src/config/supabase.ts` | Cliente Storage / bootstrap de bucket |
| `Backend/src/lib/supabase.ts` | Duplicata morta |
| `Backend/src/services/supabase-example.ts` | Exemplos de Storage |

**Frontend:** nenhuma mudança funcional. O Angular continua sem saber onde os PFX estão.

---

## Checklist

| Item | Status |
|------|--------|
| `supabase.storage` removido (produção) | **SIM** |
| Dependência `@supabase/supabase-js` removida | **SIM** |
| `CERT_STORAGE_PATH` implementado | **SIM** |
| Path traversal protegido | **SIM** |
| Path absoluto **não** salvo no banco | **SIM** |
| Banco / migrations / dados migrados alterados | **NÃO** |
| Projeto/bucket Supabase excluído | **NÃO** |
| Arquivos da VPS excluídos | **NÃO** |
| Pasta exposta via HTTP/Caddy | **NÃO** |
| Rota pública direta para PFX | **NÃO** |
| Frontend alterado funcionalmente | **NÃO** |

---

## Testes executados

```
npm test   →  16 arquivos, 141 testes, todos passando
npx tsc --noEmit  →  OK
```

Cobertura nova em `local-certificate-storage.test.ts` (diretório temporário, **nunca** a pasta real da VPS):

- leitura de arquivo existente
- escrita de arquivo de teste
- `exists()`
- exclusão
- arquivo inexistente (`CertificateFileNotFoundError`)
- path traversal bloqueado (`..`, absoluto, escape da pasta base)
- mensagens de erro sem path físico

---

## Smoke test

Script: `npm run test:smoke-storage` (`Backend/scripts/smoke-vps-storage.mjs`)

Read-only. Verifica:

- `CERT_STORAGE_PATH` definido
- diretório existe e é acessível
- há arquivos PFX no diretório
- um registro de `certificados_digitais` com `arquivo` é localizado fisicamente
- o arquivo pode ser lido
- **não** imprime conteúdo PFX, senha, connection string nem path físico completo

**Não foi executado na VPS nesta etapa** — aguardando autorização para teste manual.

---

## Variáveis de ambiente

Adicionada:

```
CERT_STORAGE_PATH=/srv/data/autonacional/certificados
```

Removidas da configuração de produção (não são mais lidas pelo backend):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CERT_STORAGE_BUCKET`
- `USE_SUPABASE` / `USE_SUPABASE_STORAGE`

`CRYPTO_KEY` / `APP_CRED_KEY` **permanecem** (senha do certificado no banco).

---

## Variáveis Supabase ainda necessárias

**Nenhuma para o runtime de produção.**

Scripts pontuais de migração (`export-storage-certificados.mjs`, `fase1-backup.mjs`, `dump-supabase.mjs`) ainda mencionam credenciais Supabase caso alguém precise reexecutá-los. Não fazem parte do Express em produção. O export de Storage exigiria reinstalar `@supabase/supabase-js` temporariamente.

---

## Pendências

1. Incluir `CERT_STORAGE_PATH=/srv/data/autonacional/certificados` no `.env` da VPS (não commitado).
2. Rebuild/restart do backend na VPS **após** autorização (sem deploy definitivo feito aqui).
3. Rodar `npm run test:smoke-storage` na VPS (read-only).
4. Teste manual: upload, substituição, exclusão, importação em lote, carregamento Playwright.
5. A tela Configurações do Angular ainda rotula o indicador como “Supabase”; o valor agora significa “storage local de PFX pronto”. Sem mudança funcional no FE.
6. Documentação antiga (`docs/`, `Backend/docs/SETUP_SUPABASE.md`, etc.) ainda cita Storage Supabase.
7. `Backend/dist/` fica desatualizado até o próximo `npm run build`.
8. Não excluir o projeto/bucket Supabase até o teste manual ser aprovado.

---

## Riscos

- Se algum `arquivo` no banco não existir em disco (path divergente da cópia), o Playwright falhará ao carregar o PFX — o smoke test detecta o cruzamento de um registro.
- Rotas legadas `/api/certificados/importar` e `/importar-lote` continuam gravando path relativo no formato `{cnpj}.pfx` (regra de negócio preservada); o cadastro via Empresas usa `contabilidade/{id}/empresa/{cnpj}/certs/{ts}.pfx`. Ambos são relativos sob `CERT_STORAGE_PATH`.
- Permissões POSIX da pasta na VPS (leitura/escrita pelo usuário do processo Node) não foram alteradas aqui.
- Sem `express.static` e sem rota de download público de PFX — a pasta deve permanecer fora do Caddy.

---

**STORAGE PRONTO PARA TESTE MANUAL: SIM**

Aguardando autorização para o teste manual na VPS. Nenhum deploy foi feito.
