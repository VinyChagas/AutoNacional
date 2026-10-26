# NFS-e nativo — H2.1 DISCOVERY_ONLY

Homologação controlada de descoberta fiscal (emitidas + recebidas) sob autorização H1 completa.

**Esta etapa é offline.** Não executa consultas reais ao Portal Nacional nem SEFIN.

---

## 1. Ponto de integração

| Camada | Papel |
|--------|--------|
| `execution-service.ts` | Após login, a `Page` autenticada, CNPJ, período e `execucaoId` já existem. Fluxo nativo atual usa `decidirIntegracaoNativa` / `tentarFluxoNativoControlado` (Commit 07) — **sem** canal H1. |
| `homologacao/discovery-only-adapter.ts` | Adaptador **injetável** H2.1. Único ponto que orquestra `discoverNfse` sob `AutorizacaoHomologacaoNfse`. |
| `discovery/discovery-service.ts` | `discoverNfse({ page, cnpj, periodo, tipo, maxPaginas })` — reutiliza a Page; não cria browser/login. |

**Integração futura (H2.2):** chamar `executarDiscoveryOnlyHomologacao` somente quando uma autorização H1 for fornecida por canal seguro (fora do escopo H2.1). Até lá, o adaptador **não** é referenciado pelo `execution-service`.

---

## 2. Contrato de execução

```text
DISCOVERY_ONLY
    → validar AutorizacaoHomologacaoNfse (integral)
    → validar limites / interrupção / timeout
    → discover EMITIDAS (Page autenticada)
    → discover RECEBIDAS (mesma Page)
    → consolidar inventário
    → evidências + resultado estruturado
```

Entrada (`EntradaDiscoveryOnlyHomologacao`):

- `autorizacao` — H1 tipada (não `{ autorizada: true }`)
- `page` — Page já autenticada (injetada)
- `cnpj`, `periodoConsulta`, `execucaoId`, `diretorioFiscal` — devem coincidir com a autorização
- `discover` — função injetável (`discoverNfse` real ou mock offline)
- `signal` — interrupção opcional
- `inicioLimitesEm` — apenas para testes de timeout

---

## 3. Autorização

Antes da primeira navegação fiscal, `validarAutorizacaoHomologacao` exige:

| Campo | Regra |
|-------|--------|
| `autorizada` | `true` **e** estrutura H1 completa |
| `cnpj` | Exato (normalizado) |
| `periodoConsulta` | Exato |
| `execucaoId` | Exato |
| `operacao` | `DISCOVERY_ONLY` |
| `validoAte` | Não expirado |
| `diretorioFiscal` | Exato (comparável) |
| `limites` | `maxDocumentos`, `maxPaginas`, `maxRequisicoesSefin` (=0), `timeoutMs` |

**Não** autoriza por: feature flag, certificado A1, login, PDF desativado ou diretório existente.

Sem autorização válida: nenhuma chamada a `discover`; fluxo legado permanece intocado.

---

## 4. Limites

| Limite | Efeito |
|--------|--------|
| `maxDocumentos` | Após cada direção; se excedido, interrompe; inventário **PARCIAL** |
| `maxPaginas` | Repassado a `discoverNfse`; se atingido → **LIMITE_PAGINAS**, inventário **INCOMPLETO** (nunca cobertura 100%) |
| `timeoutMs` | Antes de cada direção; estouro → **TIMEOUT** |
| `AbortSignal` | Interrupção → **INTERRUPCAO** |
| `maxRequisicoesSefin` | Deve ser `0` em DISCOVERY_ONLY |

Extensão mínima do contrato H1: campo `maxPaginas` em `LimitesHomologacaoNfse`.

---

## 5. Resultado

`ResultadoDiscoveryOnlyHomologacao`:

- `execucaoId`, `cnpjMascarado`, `periodoConsulta`
- Totais: emitidas, recebidas, vigentes, canceladas, indeterminadas, páginas
- `estadoInventario`: COMPLETO | PARCIAL | INDETERMINADO
- `veredito`: **PASS** somente se inventário COMPLETO e sem erros de limite/interrupção
- `diagnosticos` (mensagens sanitizadas; chaves de 50 dígitos omitidas)
- `evidencias[]`, `limitesAplicados`, `codigoErro`
- `efeitosProibidos`: sefin / escritaXml / checkpoint / navegadorAdicional / loginAdicional — todos `false`

Não inclui: PFX, senhas, cookies, tokens, XML integral, CPF, chaves completas em logs.

---

## 6. Evidências

Via `homologacao/evidencias.ts` (append, sem sobrescrever):

- `discovery_only_inicio` — identidade + limites
- `discovery_only_direcao` — por EMITIDAS/RECEBIDAS
- `discovery_only_limite_*` / `discovery_only_erro` — falhas sanitizadas
- `discovery_only_fim` — quantidades + veredito

**Não** declarar PASS com inventário incompleto.  
**Não** declarar homologação real concluída nesta etapa.

---

## 7. Tratamento de falhas

| Situação | Veredito | Navegação |
|----------|----------|-----------|
| Auth inválida / ausente / expirada | FAIL | Nenhuma |
| Limite documentos/páginas / timeout / abort | INCOMPLETO ou FAIL | Interrompe novas direções |
| Descoberta incompleta / duplicidade | INCOMPLETO | Continua ou encerra conforme código |
| Falha interna | FAIL | Evidência `discovery_only_erro` |

---

## 8. Isolamento do legado

- Adaptador **não** registrado no `execution-service`
- Sem endpoint público, sem env que autorize automaticamente, sem frontend
- Commit 07 (`autorizada: true` genérico) **não** passa na validação H1
- `efeitosProibidos` documenta ausência de SEFIN/XML/checkpoint/browser/login extras

---

## 9. Bloqueios operacionais (H2.1)

Não existe canal seguro para fornecer `AutorizacaoHomologacaoNfse` em produção nesta etapa.

Por isso:

1. Implementação = adaptador injetável + testes offline + esta documentação
2. Execuções normais do AutoNacional **não** ativam DISCOVERY_ONLY
3. Homologação real (Portal) fica para H2.2, com canal de autorização explícito

---

## 10. Procedimento futuro (H2.2)

1. Definir canal seguro de autorização H1 (fora de env automático / UI pública)
2. Após login legado, com Page autenticada, montar contexto + auth vinculada
3. Invocar `executarDiscoveryOnlyHomologacao({ discover: discoverNfse, page, ... })`
4. Persistir evidências em diretório autorizado
5. Somente então avaliar PASS real com inventário COMPLETO
6. Manter SEFIN desligado até etapa de recovery autorizada
