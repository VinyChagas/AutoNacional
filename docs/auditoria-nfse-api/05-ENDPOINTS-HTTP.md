# 05 — Endpoints HTTP

Inventário **estático** de URLs e rotas relevantes à automação NFS-e. Nenhuma chamada externa foi executada nesta auditoria.

## Conclusão principal

**Não há integração com API oficial ADN / Emissor Nacional no código.** O portal é consumido como **aplicação web** via Playwright. O único `fetch` HTTP de terceiros identificado no fluxo de automação é o da API **2Captcha**.

---

## 1. URLs do portal (páginas UI)

| URL / padrão | Uso | Evidência |
|--------------|-----|-----------|
| `https://www.nfse.gov.br/EmissorNacional/` | Entrada / login | `playwright-nfse.ts` L25; `login-credencial-nfse.ts` L22 |
| `https://certificado.nfse.gov.br` | Origin mTLS A1 (não visitada explicitamente como `goto` no trecho principal; registrada em `clientCertificates`) | `playwright-nfse.ts` L106–116 |
| `**/Notas/Emitidas` | Lista emitidas | `playwright-nav.ts` L146–147 |
| `**/Notas/Recebidas` | Lista recebidas | idem |
| Dashboard / MeusDados (regex) | Detecção pós-login | `playwright-nfse.ts` L296–298 |

**API REST do portal (documentada no código):** NÃO IDENTIFICADO NO CÓDIGO.

---

## 2. 2Captcha (único fetch externo da automação)

| Endpoint | Uso | Evidência |
|----------|-----|-----------|
| `https://api.2captcha.com/createTask` | Criar task v2 | `captcha-solver.ts` L38 |
| `https://api.2captcha.com/getTaskResult` | Poll resultado v2 | L39 |
| `https://2captcha.com/in.php` | API v1 in | L36 |
| `https://2captcha.com/res.php` | API v1 res | L37 |

Relatório diagnóstico cita os mesmos endpoints: `captcha-report.ts` L83–86.

---

## 3. `page.request` / download HTTP autenticado (código morto no fluxo principal)

| Função | Comportamento | Uso no fluxo principal |
|--------|---------------|------------------------|
| `baixarArquivoDireto` | `page.request.get(fullUrl)` com sessão do browser; grava XML/PDF | **Não chamado** — única definição/ocorrência em `download-manager.ts` L298–359 |

Fluxo real usa evento Playwright `download` + `salvarDownloadDireto` (`download-operation.ts` L596–617).

---

## 4. API interna Express (necessária à automação)

Montagem em `main.ts` L91–105.

| Método | Rota | Papel na automação | Evidência |
|--------|------|--------------------|-----------|
| POST | `/api/execucao/multiplas` | Dispara lote | `routers/execucao.ts` L85 |
| GET | `/api/execucao/stream/:batch_id` | SSE progresso | L286 |
| GET | `/api/execucao/batch/:batch_id/status` | Status agregado | L297 |
| POST | `/api/execucao/:empresa_id` | Execução unitária | L321 |
| GET | `/api/execucao/:empresa_id/status` | Status unitário | L401 |
| POST | `/api/nfse/:cnpj/abrir` | Abrir dashboard (teste/manual) | `routers/nfse.ts` L18 |
| GET/PUT | `/api/settings` | Inclui `downloadsBasePath`, concorrência | `routers/settings.ts` |
| CRUD | `/api/certificados`, `/api/empresas`, `/api/credenciais` | Cadastro pré-automação | routers respectivos |
| GET | `/health` | DB + estado da fila | `main.ts` L72–88 |

Outras rotas (`/api/dashboard`, `/api/metrics`, `/api/logs`, `/api/relatorios`, `/api/validacoes`, `/api/imports`) são suporte operacional/UI — não fazem parte do handshake com o portal NFS-e.

---

## 5. Socket.IO (não REST)

Central Manual de Captchas: eventos publicados pelo backend (`manual-captcha.service.ts` + `infrastructure/socket`). Transporte WebSocket/Socket.IO, não REST do portal.

---

## 6. ADN / Emissor API oficial

| Item | Status |
|------|--------|
| Cliente ADN | NÃO IDENTIFICADO NO CÓDIGO |
| Endpoints oficiais de distribuição de NFS-e | NÃO IDENTIFICADO NO CÓDIGO |
| Token OAuth / mTLS HTTP Node para API | NÃO IDENTIFICADO NO CÓDIGO |

Referências oficiais externas (contexto para POC, **fora deste repositório**) devem ser tratadas em `10-PLANO-POC-API.md` como protocolo futuro — não como implementação existente.
