# NFS-e nativa — H1 — preparação de homologação real controlada

## Objetivo

Preparar e validar **offline** os mecanismos de autorização tipada, limites e gates de modo (`DISCOVERY_ONLY` / `SEFIN_RECOVERY`) para uma futura execução real controlada.

**H1 não executa** Portal Nacional, SEFIN, browser, downloads nem o motor nativo operacional.

## Arquitetura de homologação

```text
AutorizacaoHomologacaoNfse (contrato vinculado)
        │
        ▼
validarAutorizacaoHomologacao(contexto)
        │
        ├─ DISCOVERY_ONLY  → prepararDiscoveryOnly
        │     · inventário / classificação (futuro H2)
        │     · SEFIN = proibido
        │     · XML / checkpoint recuperação = proibido
        │
        └─ SEFIN_RECOVERY → prepararSefinRecovery
              · exige inventário completo
              · exige A1 disponível (declarado)
              · limites de documentos e requisições
              · HTTP real = H3 (não H1)
```

Módulos: `Backend/src/automation/nfse/homologacao/`  
Reutiliza contratos, inventário e resolução de raiz fiscal. **Não** altera worker, PQueue, login, CAPTCHA, frontend nem Prisma.

## Contrato de autorização

Campos obrigatórios:

| Campo | Papel |
|---|---|
| `versao: 1` | Formato |
| `autorizada: true` | Necessário, **não suficiente** isoladamente |
| `cnpj` | Empresa exata (14 dígitos) |
| `periodoConsulta` | `PERIODO_CONSULTA_PORTAL` exato |
| `execucaoId` | Execução vinculada |
| `operacao` | `DISCOVERY_ONLY` \| `SEFIN_RECOVERY` |
| `validoAte` | ISO-8601; expiração |
| `diretorioFiscal` | Raiz autorizada (≠ downloads) |
| `limites` | maxDocumentos, maxRequisicoesSefin, timeoutMs |

Proibido no contrato: senha, PFX, passphrase, XML, tokens.

`{ autorizada: true }` do Commit 07 **não** passa em `ehAutorizacaoHomologacaoEstruturada`.

## Modos permitidos

### DISCOVERY_ONLY

- Autoriza descoberta/classificação (execução real em H2).
- `maxRequisicoesSefin` deve ser `0`.
- Gate: `permiteSefin=false`, sem persistência XML, sem checkpoint de recuperação.

### SEFIN_RECOVERY

- Exige operação específica no contrato.
- Exige inventário completo, sem indeterminada.
- Exige certificado disponível (flag injetada em H1; carga real em H3).
- Canceladas permanecem no inventário; só vigentes contam como elegíveis.
- HTTP SEFIN **não** ocorre em H1.

## Limites

`ControladorLimitesHomologacao`:

- `exigirDocumentos(n)` antes de aceitar inventário.
- `exigirProximaRequisicaoSefin()` antes de cada consulta (simulada em H1).
- `interromper(motivo)` → estado `INTERRUPCAO`.
- Sem retries ilimitados; sem paralelismo SEFIN.

Limites locais ≠ limites oficiais da SEFIN.

## Isolamento

| Área | H1 |
|---|---|
| Worker / PQueue / browsers | Intactos |
| Login / CAPTCHA | Intactos |
| Frontend / Prisma / .env | Intactos |
| Flag `NFSE_NATIVE_RECOVERY_ENABLED` | Não habilitada por H1 |
| execution-service | Sem wiring de autorização H1 |

## Segurança

- Autorização não inferida por A1, flag, PDF, login ou pasta existente.
- Evidências com CNPJ mascarado; sem segredos.
- Diretório fiscal distinto de `./downloads`.

## Evidências

`registrarEvidenciaHomologacao` → evento + detalhes sanitizados.  
Testes em `homologacao-h1.test.ts` (cenários 01–20).

## Critérios de interrupção

- Autorização ausente / malformada / expirada.
- CNPJ, período, execução ou diretório divergentes.
- Operação não autorizada.
- Limite de documentos ou requisições.
- Inventário incompleto / indeterminada (SEFIN).
- Certificado indisponível (SEFIN).
- Interrupção explícita do controlador.

## Pendências para H2

1. Wiring seguro da autorização H1 (canal operacional, sem endpoint público nesta fase).
2. Execução real `DISCOVERY_ONLY` na Page autenticada, com evidências.
3. Comparação de inventário nativo × legado.
4. Runbook de operador e janela autorizada.

## Pendências para H3

1. `SEFIN_RECOVERY` com HTTP mTLS real em ambiente controlado.
2. Checkpoint / persistência / auditoria sob autorização H1.
3. Limites observados vs. SEFIN.
4. Validação de PDFs legado em paralelo.
5. Soft-launch por CNPJ autorizado.

## Recomendação

H1 conclui a **preparação** de gates. Não declara homologação real. Motor permanece bloqueado operacionalmente até H2/H3 com autorização vinculada.
