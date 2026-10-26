# NFS-e nativo — H2.2 preparação (execução real)

Preparação offline para a primeira descoberta real no Portal Nacional.
**Não declara homologação real concluída.**

---

## 1. Auditoria de limites (H2.1.1)

| Controle | H2.1 | H2.1.1 |
|----------|------|--------|
| Timeout | Só entre direções | Antes de cada direção **e** em cada etapa cooperativa da paginação (`antes_navegacao`, `antes_pagina`, `antes_extracao`, `apos_pagina`, `antes_avancar`) + após a direção |
| AbortSignal | Só entre direções | Propagado via `ControleDescoberta` até o runner |
| maxPaginas | Por chamada (= por direção) | **Orçamento GLOBAL** da execução; 2ª direção recebe o restante |
| maxDocumentos | Após cada direção | Orçamento global + teto restante passado à descoberta |
| Paginação truncada | Podia mapear para FAILED | `DISCOVERY_INCOMPLETE` + inventário **PARCIAL**; nunca PASS |

Arquivos: `homologacao/limites.ts`, `homologacao/discovery-only-adapter.ts`, `discovery/discovery-runner.ts`, `discovery/controle-descoberta.ts`.

---

## 2. Propagação do AbortSignal

```text
executarDiscoveryOnlyHomologacao(signal)
  → ControleDescoberta { signal, antesDeOperacao }
  → discoverNfse / executarDescoberta
  → exigirControleDescoberta(etapa) antes de abrir / capturar / extrair / avançar
```

### Limitações (Playwright)

- Abort cooperativo **não** cancela `page.click` / `page.goto` já em andamento.
- `Promise.race` **não** interrompe I/O Playwright.
- Após abort: nenhuma nova etapa; inventário incompleto; **nunca** veredito PASS.
- Chamadas Playwright em voo podem ainda completar no browser; o adaptador apenas deixa de consumir o resultado como sucesso.

---

## 3. Limites de páginas e documentos

- `maxPaginas`: total da homologação (Emitidas + Recebidas).
- `maxDocumentos`: total acumulado; se excedido, interrompe novas operações.
- Duplicidades: chaves repetidas não duplicam no inventário consolidado; diagnóstico sanitizado.
- Truncamento de páginas → `LIMITE_PAGINAS` + `INCOMPLETO`.

---

## 4. Canal seguro de execução (proposto)

### O que já existe após autenticação

| Dado | Origem |
|------|--------|
| Page autenticada | `execution-service` pós-login |
| CNPJ | contexto da empresa |
| Período | `dataInicio` / `dataFim` |
| execucaoId | `execucaoDbId` |
| Diretório fiscal | resolver de storage nativo |
| Auth H1 | **ainda não** — Commit 07 usa `{autorizada:true}` genérico |

### Restrições desta etapa

Não modificar: frontend, worker, PQueue, CAPTCHA, endpoint público, env que autorize, hardcoded auth, novo browser/login.

### Alternativas (sem improvisar ativação)

1. **Operador offline (preferida para 1ª real):** script/CLI interno que, com sessão já autenticada injetável em laboratório, monta `AutorizacaoHomologacaoNfse` e chama `executarDiscoveryOnlyHomologacao({ discover: discoverNfse, page, persistirEvidencias: true })`. Fora do caminho do worker.
2. **Injeção por execução (futuro H2.2):** store em memória `Map<execucaoId, AutorizacaoHomologacaoNfse>` preenchido só por ferramenta privilegiada; `execution-service` consulta o store **sem** fallback para flag/env. Exige alteração mínima e revisada do serviço — **não implementada agora**.
3. **Bloqueio atual:** sem (1) ou (2), o adaptador permanece inacessível às execuções normais. Correto.

---

## 5. Evidências

`persistirEvidenciasHomologacao`:

- Diretório: `{diretorioFiscal}/homologacao/evidencia-h2-{execucaoId}-{timestamp}.json`
- Escrita atômica (`.tmp` → `rename`)
- Recusa sobrescrita se o arquivo existir
- CNPJ mascarado; diagnósticos sanitizados; limites aplicados; sem senha/PFX/XML/token/cookie/CPF/chave completa

Testes usam apenas diretórios temporários (`os.tmpdir`).

---

## 6. Critérios de interrupção

| Evento | Veredito típico | Inventário |
|--------|-----------------|------------|
| AbortSignal | FAIL / INCOMPLETO | PARCIAL ou INDETERMINADO |
| Timeout | FAIL | idem |
| Limite páginas/docs | INCOMPLETO | PARCIAL |
| Paginação truncada | INCOMPLETO | PARCIAL |
| Auth inválida | FAIL | sem descoberta |

**Nunca PASS** após cancelamento ou cobertura parcial.

---

## 7. Riscos restantes

1. Playwright em voo após abort.
2. Sem canal seguro ligado ao worker — 1ª descoberta real exige procedimento operador (alternativa 1).
3. Auth Commit 07 genérica não basta para H1.
4. Relógio de timeout em produção deve usar wall-clock real (`relogio` opcional só para testes).

---

## 8. Procedimento para primeira descoberta real (H2.2+)

1. Ambiente de homologação controlada; certificado e sessão válidos **fora** deste repositório de testes.
2. Emitir `AutorizacaoHomologacaoNfse` com CNPJ, período, `execucaoId`, diretório, limites curtos (`maxPaginas`, `maxDocumentos`, `timeoutMs`).
3. Obter Page já autenticada (fluxo legado existente).
4. Chamar:

```ts
await executarDiscoveryOnlyHomologacao({
  autorizacao,
  page,
  cnpj,
  periodoConsulta,
  execucaoId,
  diretorioFiscal,
  discover: discoverNfse,
  signal: controller.signal,
  persistirEvidencias: true,
});
```

5. Inspecionar evidências no diretório autorizado.
6. Aceitar apenas `veredito === 'PASS'` com inventário `COMPLETO`.
7. Manter SEFIN / XML / checkpoint desligados até etapa de recovery autorizada.

**Esta documentação não substitui a execução real nem declara PASS de homologação nacional.**
