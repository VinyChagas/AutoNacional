# NFS-e nativa — etapa 22.8 — pré-homologação e validação final (Commit 08)

## 1. Objetivo

Validar offline a arquitetura fiscal nativa (Commits 01–07), fortalecer segurança (A1, XML, XXE, namespace), documentar evidências e preparar planos de homologação real e rollback — **sem** ativar SEFIN, Portal Nacional ou produção.

## 2. Escopo

Inclui: contratos, descoberta, classificação, recuperação, checkpoint, infraestrutura, orquestração, feature flag, autorização, PDF legado.

Exclui: consultas reais, alteração de PQueue/worker/login/CAPTCHA/PDF/ZIP/Prisma/frontend/.env, distributed lock, PDF nativo.

## 3. Arquitetura final

```text
Page autenticada (legado)
        │
        ▼
decidirIntegracaoNativa
  flag + autorizacaoNativa + pré-condições
        │
   LEGADO_SOLICITADO ──────────► processarTabela* (XML/PDF legado)
        │
   NATIVO_RECUSADO ────────────► OrquestracaoNfseError (sem fallback)
        │
   NATIVO_SOLICITADO
        ▼
descoberta → A1 → comTrava(CNPJ, período)
  plano → checkpoint → retomada → SEFIN → XML → reconciliação → auditoria
        ▼
finally libera trava
```

Worker operacional **não** injeta `autorizacaoNativa` → motor bloqueado por padrão.

## 4. Matriz de prontidão

| Componente | Classificação | Evidência |
|---|---|---|
| Contratos | APROVADO_OFFLINE | `nfse-contracts.test.ts` + homologação 26 |
| Descoberta | APROVADO_OFFLINE | `discovery.test.ts` |
| Classificação | APROVADO_OFFLINE | `classification.test.ts` |
| Recuperação | APROVADO_OFFLINE | `recovery.test.ts` (transporte mock) |
| Certificado A1 | APROVADO_OFFLINE | inspeção PKCS#12 sintética; `notBefore`/`notAfter` |
| XML | APROVADO_OFFLINE | validador + namespace oficial + anti-XXE |
| Checkpoint | APROVADO_OFFLINE | `checkpoint.test.ts` |
| Retomada | APROVADO_OFFLINE | órfão/corrompido/retomada em homologação |
| Persistência | APROVADO_OFFLINE | repositório fiscal + raiz isolada |
| Auditoria | APROVADO_OFFLINE | snapshots parcial/reconciliada |
| Reconciliação | APROVADO_OFFLINE | cobertura e conclusão |
| Concorrência | APROVADO_OFFLINE | `EXECUCAO_EM_USO` single-host |
| Segurança | APROVADO_OFFLINE | sem PFX/senha em logs; XXE recusado |
| Feature flag | APROVADO_OFFLINE | ausente/false/inválida → legado |
| Autorização | APROVADO_OFFLINE | sem auth → legado; auth+pré-falha → recusa |
| PDF | APROVADO_OFFLINE | `baixarPdf` → NATIVO_RECUSADO / legado |
| ZIP | NAO_APLICAVEL | exportação ZIP legado não alterada |
| Integração operacional | APROVADO_OFFLINE | gancho sem autorização no worker |
| Homologação real | PENDENTE_REAL | procedimento documentado, não executado |
| Multi-host | BLOQUEADO | sem evidência de FS compartilhado |

## 5. Evidências dos cenários (30)

Arquivo executor: `Backend/src/automation/nfse/homologacao/homologacao-22.8.test.ts`.

| ID | Descrição | Tipo | Resultado | Evidência | Limitação |
|---|---|---|---|---|---|
| 01 | Sem movimento | integração | PASS | cobertura reconciliada 0 docs | mock descoberta |
| 02 | Só emitidas | integração | PASS | persistidos=1 | transporte simulado |
| 03 | Só recebidas | integração | PASS | persistidos=1 | transporte simulado |
| 04 | Emitidas+recebidas | integração | PASS | persistidos=2 | transporte simulado |
| 05 | Canceladas | unitário | PASS | excluídas do plano | — |
| 06 | Indeterminada | integração | PASS | `SITUACAO_INDETERMINADA` | — |
| 07 | Paginação / chaves | unitário | PASS | 5 chaves únicas | inventário sintético |
| 08 | XML integral | integração | PASS | persistido | — |
| 09 | Parcial | integração | PASS | auditoria PARCIAL | — |
| 10 | SEFIN transitória | integração | PASS | TIMEOUT | mock |
| 11 | SEFIN permanente | integração | PASS | HTTP_404 | mock |
| 12 | Retomada | integração | PASS | sem nova SEFIN | — |
| 13 | Órfão válido | integração | PASS | reaproveitado | — |
| 14 | XML corrompido | integração | PASS | INCONSISTENTE | — |
| 15 | Hash divergente | integração | PASS | persistência recusada | — |
| 16 | Fingerprint | integração | PASS | IDENTIDADE_DIVERGENTE | — |
| 17 | Simultânea | integração | PASS | EXECUCAO_EM_USO | single-host |
| 18 | A1 indisponível | unitário | PASS | CERTIFICADO_INEXISTENTE | — |
| 19 | A1 expirado / notBefore | unitário | PASS | expirado + ainda não válido | forge DER |
| 20 | PDF solicitado | decisão | PASS | NATIVO_RECUSADO | — |
| 21 | Flag off | decisão | PASS | LEGADO_SOLICITADO | — |
| 22 | Flag on sem auth | decisão | PASS | LEGADO_SOLICITADO | — |
| 23 | Flag+auth | decisão | PASS | NATIVO_SOLICITADO | — |
| 24 | Auditoria parcial | integração | PASS | PARCIAL | — |
| 25 | Auditoria reconciliada | integração | PASS | RECONCILIADA | — |
| 26 | dCompet ≠ período | unitário | PASS | vigente incluído | — |
| 27 | Namespace inválido | unitário | PASS | NAMESPACE_INVALIDO | — |
| 28 | Direção divergente | unitário | PASS | tomador/emitente | — |
| 29 | CNPJ divergente | unitário | PASS | CNPJ_DIVERGENTE | — |
| 30 | Exportação incompleta | integração | PASS | loteLiberado=false | — |

Nenhum cenário marcado PASS sem execução nesta etapa. Homologação SEFIN real: **NOT_RUN** / **PENDENTE_REAL**.

## 6. Limitações

- PKCS#12 via `node-forge` + `fromDer`: BER não canônico pode falhar (documentado no código).
- Trava multi-host não homologada.
- PDF nativo inexistente.
- Descoberta HTML real do Portal: coberta em testes de discovery com DOM simulado, não com browser.
- Autorização operacional ainda sem canal seguro em produção.

## 7. Certificados A1

- Inspeção local antes de rede: senha, bag cliente↔chave privada, CA ignorada como cliente.
- `notAfter` e **`notBefore`** (Commit 08).
- Cópia de Buffer no adaptador; sem cache em módulo; sem log de PFX/senha.
- Loader operacional não alterado; import lazy.

## 8. XML

- Parser próprio sem resolução de entidade.
- Recusa `DOCTYPE` / `ENTITY` (`XML_ENTIDADE_EXTERNA`).
- Namespace oficial: `http://www.sped.fazenda.gov.br/nfse` (Manual Integrado SNNFS-e / gov.br).
- dCompet apenas metadado.
- Limite de tamanho alinhado a `LIMITES_RECUPERACAO_PADRAO.maxBytesXml`.

## 9. Concorrência

- Uma `comTrava` por CNPJ+período na sequência crítica.
- `jaComTrava` evita deadlock.
- Liberação no `finally`.
- Processo morto: recuperação órfã do Commit 05 (pid/token).
- Multi-host: **BLOQUEADO** sem evidência.

## 10. Segurança

- Flag + autorização; worker sem auth.
- Sem SEFIN/A1/storage na seleção de legado.
- Sem fallback após NATIVO_SOLICITADO/RECUSADO.
- Diagnósticos sanitizados (orquestrador).

## 11. Compatibilidade com legado

- Flag off / sem auth → legado idêntico.
- `baixarPdf=true` → legado / NATIVO_RECUSADO se auth explícita.
- Login, CAPTCHA, PQueue, ZIP intactos.

## 12. Plano de homologação real (não executar)

Pré-requisitos:

1. Autorização explícita tipada da execução.
2. CNPJ autorizado pelo operador.
3. Período autorizado.
4. Certificado A1 autorizado (ICP-Brasil).
5. Ambiente identificado (staging/homolog).
6. Janela agendada e operador responsável.
7. Preservação/backup dos dados fiscais existentes.
8. `NFSE_FISCAL_STORAGE_PATH` isolado.
9. Limites de chamadas e critérios de interrupção.
10. Evidências: inventário, XMLs, reconciliação, auditoria, PDFs legado.

Comparar inventário nativo × legado; não misturar resultados sem contrato.

## 13. Critérios de aprovação (offline)

- Typecheck OK.
- Suite de testes ok.
- 30 cenários PASS nesta etapa.
- Motor bloqueado sem autorização.
- Sem vazamento de segredos nos asserts.

## 14. Critérios de bloqueio (produção)

- Ausência de canal de autorização.
- PDF exigido sem estratégia.
- Multi-host sem FS/trava comprovada.
- Certificado real não validado em staging.
- Qualquer ativação sem runbook.

## 15. Plano de rollback

1. Manter legado: não fornecer `autorizacaoNativa`.
2. Desabilitar `NFSE_NATIVE_RECOVERY_ENABLED` (ausente/`false`).
3. Revogar autorização no canal futuro.
4. Interromper novas execuções via fila / desligar flag.
5. Preservar checkpoints, XMLs e auditorias (não apagar).
6. Investigar por `execucaoId` e snapshots.

Não usar `git reset --hard`, `git clean` ou `git stash` como rollback de dados.

## 16. Pendências operacionais

1. Canal seguro de autorização por execução.
2. Soft-launch por empresa/contabilidade.
3. Homologação SEFIN mTLS real.
4. Estratégia PDF/DANFS-e.
5. Evidência multi-host se aplicável.
6. Observabilidade (métricas nativas).

## 17. Recomendação final

A arquitetura está **pronta para pré-homologação offline**. O motor deve permanecer **operacionalmente bloqueado**. Este commit **não** autoriza consultas reais nem ativação em produção.
