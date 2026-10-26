# NFS-e nativo — H2.2.4-A Bootstrap operacional e CLI segura

**Status:** preparação OFFLINE. Homologação fiscal real **não** liberada.

**Branch:** `nfsexplorer`

## Bootstrap

No `Backend/src/main.ts`, após init de storage e antes do HTTP listen:

1. Lê env privilegiada de **processo** `AUTONACIONAL_HOMOLOGACAO_STORE` (caminho absoluto).
2. Se ausente → canal `null` → legado intacto.
3. Se presente → valida store (absoluto, sem symlink, `0700`) → `criarCanalAutorizacaoArquivo` → `configurarCanalHomologacaoOperacional`.
4. **Não** emite tickets, **não** ativa, **não** executa Discovery, **não** abre o gate.

A existência do diretório **não** autoriza Discovery-Only.

### Configuração privilegiada

| Mecanismo | Uso |
|-----------|-----|
| `AUTONACIONAL_HOMOLOGACAO_STORE` | Path absoluto do store (só montagem do canal) |
| Settings API / UI | **Não** usado (editável por usuários comuns) |

Interpretar esta env como “ligar Discovery” é **incorreto**. Só disponibiliza o canal vazio.

## CLI

```bash
cd Backend
npm run homologacao:cli -- consultar --store /abs/store --execucao-id 123
npm run homologacao:cli -- emitir --store /abs/store \
  --execucao-id 123 --cnpj 11222333000181 \
  --periodo-inicio 01/01/2024 --periodo-fim 31/01/2024 \
  --diretorio-fiscal /abs/evidencias --valido-ate 2024-12-31T23:59:59.000Z \
  --motivo "homologacao controlada"
npm run homologacao:cli -- ativar --store /abs/store \
  --autorizacao-id auth-... --motivo "liberacao individual"
npm run homologacao:cli -- cancelar --store /abs/store \
  --autorizacao-id auth-... --motivo "revogacao"
```

- Sem servidor HTTP / endpoint / frontend.
- Só `DISCOVERY_ONLY` (`maxRequisicoesSefin = 0`).
- Ativação exige `--motivo`.
- Não inicia navegador, login, Discovery nem Backend.

## Permissões do store

| Recurso | Modo |
|---------|------|
| Diretório store | `0700` (verificado após `chmod`) |
| Tickets / índices / leases / auditoria | `0600` |
| Symlink como store | **recusado** |
| Path relativo | **recusado** |
| Lease órfão | **não** removido automaticamente |
| Multi-host / NFS | **não** suportado / não declarado |

## Auditoria

Append-only em `{store}/_auditoria/cli-audit.jsonl` (modo `0600`, append POSIX `O_APPEND`):

- `cli_emissao`, `cli_ativacao`, `cli_cancelamento`, `cli_consulta`, `cli_recusada`
- Campos: `autorizacaoId`, `execucaoId`, CNPJ mascarado, período, estado, motivo, código de erro
- Motivo/detalhe sanitizados (senha/token/cookie/chave 50 dígitos)

Se a operação no store **já** persistiu e a auditoria falhar depois: erro `FALHA_EVIDENCIA` (ticket **não** é revertido; falha é explícita).

**Não** registra senhas, PFX, cookies, tokens, XML, chaves fiscais completas.

## Comportamentos

| Situação | Resultado |
|----------|-----------|
| Sem bootstrap | legado |
| Bootstrap sem tickets | legado |
| Ticket sem ativação | `BLOQUEADA` na ponte |
| Ticket ativado | só aquela `execucaoId` |
| Gate global | permanece `false` |

## Revogação

`cancelar` com motivo enquanto `DISPONIVEL` → `CANCELADA` + lease de cancelamento.

## Bloqueio atual do `execucaoId` (race)

Hoje `adicionarExecucao`:

1. `execucoesRepo.criar` → obtém `id`
2. Enfileira imediatamente em `PQueue`
3. Devolve `id`

A janela para emitir/ativar ticket é **após** o enqueue e **antes** de `auth_ok`. Em fila vazia + login rápido, a race permanece.

## Proposta mínima H2.2.4-B (não implementada)

Separar criação de enfileiramento **somente** para homologação:

1. `criarExecucaoHomologacaoPendente` — Prisma `criar` + estado `aguardando_autorizacao` **sem** `fila.add`.
2. Operador obtém `execucaoId` → CLI emitir → CLI ativar.
3. `liberarExecucaoHomologacao(execucaoId)` — valida ticket ativado + consumo ainda não feito → **uma** vez `fila.add` (flag/lease anti-duplicata).
4. Fluxo normal (`POST` atual) permanece inalterado.

### Arquivos que precisariam mudar (H2.2.4-B)

| Arquivo | Mudança |
|---------|---------|
| `execution-service.ts` | criar sem enqueue + liberar com guarda |
| `routers/execucao.ts` | rota privilegiada/interna opcional **ou** só CLI chama liberar via módulo |
| `repositories/execucoes.ts` / Prisma | status `aguardando_autorizacao` (se modelado) |
| Testes | hold → emit → activate → release |

**Não** alterar CAPTCHA, browser manager, login, PQueue concurrency, frontend, PDF.

Preferência: liberação via módulo/CLI privilegiada (sem endpoint público). Se rota for necessária, exigir mecanismo já privilegiado (`INTERNAL_API_KEY`), nunca settings de usuário.

## Restrições / falhas

- Store inseguro → bootstrap `recusado`, canal null.
- Emissão sem motivo / SEFIN → recusada.
- Ativação sem motivo → recusada.
- CLI **nunca** dispara execução Playwright.

## Exemplos fictícios

```text
export AUTONACIONAL_HOMOLOGACAO_STORE=/var/lib/autonacional/homologacao-store
# reiniciar Backend → canal montado, vazio

# (após obter execucaoId de uma execução — race ainda existe até H2.2.4-B)
npm run homologacao:cli -- emitir --store "$AUTONACIONAL_HOMOLOGACAO_STORE" ...
npm run homologacao:cli -- ativar --store "$AUTONACIONAL_HOMOLOGACAO_STORE" \
  --autorizacao-id auth-... --motivo "H2.2.4-A dry-run"
```
