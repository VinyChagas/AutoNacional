# AutoNacional A1 — Release estável (API-03A … API-03P)

Documento de release do motor de recuperação NFS-e por certificado digital **A1** (Portal Nacional → SEFIN → XML fiscal).

**Status:** preparação para publicação — aguarda aprovação do operador antes de commit/push/PR/merge/deploy.

**Tag sugerida:** `v1.0.0-a1`  
**Branch sugerida:** `release/autonacional-a1-stable`  
**Base atual de trabalho:** `nfsexplorer` (47 commits à frente de `origin/main` + working tree API-03*)

---

## 1. Arquitetura do motor A1

```text
UI Iniciar (tipoAutenticacao=certificado)
        │
        ▼
execution-service
  ├─ credenciais ──────────────► Playwright legado (login/senha)  [inalterado]
  └─ certificado A1
        │
        ▼
decidirIntegracaoNativa (flag + autorização)
  ├─ LEGADO_SOLICITADO ────────► fluxo Playwright XML/PDF legado
  ├─ NATIVO_RECUSADO ──────────► erro tipado (sem fallback silencioso)
  └─ NATIVO_SOLICITADO
        ▼
Page autenticada (certificado) → descoberta Portal
        ▼
trava fiscal (CNPJ + período)
        ▼
checkpoint → retomada → recuperação SEFIN (mTLS A1)
        ▼
validação XML → persistência → reconciliação → auditoria
        ▼
exportação operacional (Emitidas / Recebidas / Intermediadas / Pendentes)
```

Componentes principais (`Backend/src/automation/nfse/`):

| Camada | Papel |
|--------|--------|
| `discovery/` | Listagem Portal, captura, classificação de linhas |
| `classification/` | Situação (VIGENTE / CANCELADA / INDETERMINADA), substituição, decisão judicial |
| `recovery/` | SEFIN mTLS, validação XML, papéis PRESTADOR/TOMADOR/INTERMEDIARIO |
| `checkpoint/` | Evolução incremental, preservação API-03P, retomada, reconciliação |
| `orchestration/` | Orquestrador nativo, exportação, indicadores |
| `infrastructure/` | Store XML/checkpoint/auditoria, repositório fiscal |
| `services/retry-empresa.ts` | Retry por falhas transitórias (não misturado ao módulo de senha) |

---

## 2. Fluxo Portal → SEFIN → XML

1. **Descoberta:** autenticação A1 no Portal; Emitidas/Recebidas; inventário COMPLETO com chave, direção e situação.
2. **Checkpoint:** identidade por fingerprint (`chave:direção:situação`); evolução segura (API-03F/03P).
3. **Plano SEFIN:** vigentes e indeterminadas elegíveis; canceladas fora da recuperação.
4. **Recuperação:** GET SEFIN com PFX A1; validação chave + vínculo CNPJ pelo papel; persistência atômica.
5. **Exportação:** cópia idempotente para downloads operacionais (não move originais fiscais).

---

## 3. Tratamento de situações fiscais

| Situação | Origem típica | Recuperação | Exportação |
|----------|---------------|-------------|------------|
| VIGENTE | Portal P100 / sinais vigentes | Sim | Emitidas/Recebidas (ou Intermediadas se papel) |
| CANCELADA | P104 / P105 / ícones cancelada/substituída | Não | Não (XML histórico pode permanecer no store) |
| INDETERMINADA | Evidência insuficiente (API-03L/03M) | Sim (atenção fiscal) | `Pendentes_Validacao_Fiscal` |

**Papéis XML (API-03O):** `PRESTADOR` | `TOMADOR` | `INTERMEDIARIO` — intermediário não é reclassificado como tomador.

**Preservação (API-03P):** descoberta posterior `INDETERMINADA` não sobrescreve `CANCELADA`/`VIGENTE` comprovadas no checkpoint; ausência de evidência ≠ mudança fiscal.

**Transições automáticas:**

- Permitidas: `VIGENTE→CANCELADA`, `INDETERMINADA→VIGENTE|CANCELADA`
- Bloqueadas: `CANCELADA→VIGENTE` (exige revisão)
- Preservadas (não bloqueiam empresa): `CANCELADA|VIGENTE→INDETERMINADA` com evidência histórica

---

## 4. Estrutura de armazenamento

Raiz típica (fora do Git): `~/Library/Application Support/AutoNacional/nfse-fiscal/` (macOS) ou equivalente configurado.

```text
nfse-fiscal/
  checkpoints/{cnpj}/{periodo}/checkpoint.json
  xml/{cnpj}/{periodo}/{chave}.xml
  auditoria/{cnpj}/{periodo}/{execucaoId}/...
```

Downloads operacionais (também fora do versionamento): árvore Contabilidade/Mês/Empresa/`Emitidas|Recebidas|Intermediadas|Pendentes_Validacao_Fiscal`.

**Não versionar:** `.env`, PFX, cookies, checkpoints reais, XMLs reais, downloads, bancos locais.

---

## 5. Retomada por checkpoint

- `retomarExecucaoNfse` não consulta SEFIN nem abre certificado.
- PERSISTIDO íntegro permanece; hash divergente → INCONSISTENTE (não sobrescreve).
- API-03P: identidade considera inventário alinhado às situações preservadas.
- Retry de empresa (API-03G) classifica `TRANSICAO_SITUACAO_INVALIDA` como permanente; preservações evitam esse erro no enfraquecimento de evidência.

---

## 6. Exportação operacional

- Vigentes confirmados → Emitidas/Recebidas conforme direção/papel.
- Intermediário → pasta `Intermediadas`.
- Indeterminadas com XML válido → `Pendentes_Validacao_Fiscal` (API-03M).
- Exportação **não** exige reconciliação 100%; lote contábil “limpo” é indicador separado.
- Idempotente; conflito de conteúdo não apaga origem fiscal.

---

## 7. Resultado da homologação (lote A1)

| Métrica | Valor |
|---------|-------|
| Empresas processadas | 242 |
| Sucessos iniciais | 241 |
| Erro inicial | 1 (resolvido via retry, conforme operador) |
| Notas vigentes | 3304 |
| XMLs confirmados | 3303 |
| Downloads registrados | 3327 |

Implementações **API-03A … API-03P** consideradas concluídas para esta release.

---

## 8. Limitações conhecidas

- Motor A1 nativo depende de flag/autorização; sem autorização explícita o legado permanece.
- PDF nativo não é escopo desta estabilização (compatibilidade PDF legado).
- `CANCELADA→VIGENTE` continua exigindo revisão humana.
- Budget de estilos Angular em warning (bundle inicial > 500 kB); build de produção OK (erro máximo 2 MB).
- Fixtures usam CNPJs/chaves de teste; XML real de produção **não** deve entrar no Git.
- Checkpoints/XMLs em Application Support são operacionais — nunca commitá-los.

---

## 9. Isolamento vs fluxo legado (usuário e senha)

- Roteamento em `execution-service`: `tipoAutenticacao === 'credenciais'` → Playwright legado; certificado → decisão nativa A1.
- Módulo de repositório/criptografia de senhas **não** foi refatorado nesta release.
- Feature flag / `decidirIntegracaoNativa` preserva legado quando a flag está off ou sem autorização.
- `NATIVO_RECUSADO` não faz fallback silencioso para legado.

---

## 10. Procedimento de rollback

1. **Reverter deploy** para tag/commit anterior estável em `main` (ou último release conhecido).
2. **Desativar flag** `NFSE_NATIVE_RECOVERY_ENABLED` (ou equivalente) para forçar legado sem remover código.
3. **Não apagar** `nfse-fiscal/` nem downloads — retomada usa checkpoints existentes.
4. Se merge da release precisar ser desfeito: `git revert` do merge commit (preferível a reset forçado em `main`).
5. Validar smoke: uma empresa credenciais + uma empresa A1 em homologação.

---

## 11. Checklist pré-publicação (operador)

- [ ] Revisar lista de arquivos do commit (sem XML real / `.env` / checkpoints)
- [ ] Confirmar fixture intermediário sanitizada
- [ ] Backend: `npm test` + `npm run typecheck` + `npm run build`
- [ ] Frontend: `ng test` + `npm run build:prod`
- [ ] Criar branch `release/autonacional-a1-stable` a partir do estado aprovado
- [ ] Abrir PR para `main` com descrição da seção “PR” do relatório API-03Q
- [ ] Após merge: tag `v1.0.0-a1` (ou convenção aprovada — repositório ainda sem tags)
