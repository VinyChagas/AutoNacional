# 09 — Componentes reutilizáveis

Matriz de aproveitamento para uma POC/API independente (Node macOS), sem copiar o monorepo.

## Matriz obrigatória

| Componente | Classificação | Evidência / nota |
|------------|---------------|------------------|
| Carregamento PFX + decrypt | **ADAPTÁVEL** | `certificate-loader.ts` L24–77; extrair loader sem Playwright; contrato `{pfx, passphrase}` |
| Autenticação portal (mTLS browser) | **NÃO REUTILIZÁVEL** | `playwright-nfse.ts` `clientCertificates` L106–117 — browser-only |
| CNPJ/empresas (Prisma/repos) | **ADAPTÁVEL** | Models `Empresa`/`Certificado`; POC single-company preferirá config local mínima |
| Estrutura de pastas | **ADAPTÁVEL** | Regras atuais em `montarCaminhoCompleto` L155–171 úteis; POC pode alinhar `{cnpj}/{ano}/{mes}` |
| Parser XML fiscal | **NÃO IDENTIFICADO** | Sem dependência/parser no fluxo de download |
| Logs pino | **ADAPTÁVEL** | `infrastructure/logger` + dep `pino` |
| Download independente Playwright | **NÃO REUTILIZÁVEL** | Acoplado a UI, menu ações, CAPTCHA (`download-operation.ts`) |
| Histórico por chave NFS-e | **NÃO IDENTIFICADO** | Só contagens `Execucao` + arquivos no FS |
| Fila `p-queue` | **ADAPTÁVEL** | Opcional na POC single-company; útil se paralelizar meses/tipos |
| Auditoria/reconciliação | **ADAPTÁVEL** | FS + chave 44 do DOM; falta índice DB — POC deve criar |

## Detalhamento por classificação

### ADAPTÁVEL — extrair ou reimplementar leve

1. **Loader de certificado**  
   - Isolar: storage read + `decryptPassword` + validação CNPJ 14 dígitos.  
   - Não levar: wiring `setCertificateLoader` do Express.

2. **Sanitização e path helpers**  
   - `sanitizarNomePasta`, `sanitizarNomeArquivo`, `formatarMesExecucaoParaPasta` (ou substituir por competência fiscal).

3. **Validação de arquivo**  
   - `validarArquivoBaixado` (assinatura XML/PDF) é independente de Playwright `Download` se receber `path`.

4. **Observabilidade**  
   - Pino + estágios nomeados (mesmo sem SSE).

5. **Concorrência**  
   - `p-queue` se a POC crescer além de 1 empresa.

### NÃO REUTILIZÁVEL — caminho UI

- `abrirDashboardNfse` / clique Certificado  
- `clicarMenuNotasEAguardar`, tabelas, paginação  
- `tentarResolverCaptchaSeNecessario` e providers 2Captcha/Central  
- `captcha-window-manager` / layout de janelas  
- Frontend Angular de execução  

### NÃO IDENTIFICADO — gaps a fechar na POC

- Cliente HTTP mTLS / ADN  
- Parser e índice de XML  
- Resume de lote por chave  
- Uso real de `downloadsPattern` no save (hoje só settings/preview)

## Recomendação prática de cópia

| Copiar ideias | Não copiar código acoplado |
|---------------|----------------------------|
| Shape `CertificadoEmMemoria` | `playwright-nfse.ts` inteiro |
| Política de skip se arquivo válido | `processar-notas-competencia.ts` |
| Mascaramento de chave em logs (`maskNfseKey`) | Socket.IO Central |
| Contagem de sucesso/erro por lote (conceito) | Schema completo Prisma multi-contabilidade |
