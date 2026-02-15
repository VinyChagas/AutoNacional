# AutoNacional Backend (Node.js)

Backend da API AutoNacional em Node.js/TypeScript.

## Pré-requisitos

- Node.js 18+
- npm ou pnpm

## Instalação

```bash
npm install
# Instalar navegador Chromium para Playwright (automação NFSe)
npx playwright install chromium
```

## Variáveis de ambiente

Copie o `.env.example` para `.env` e ajuste as variáveis.

```bash
cp .env.example .env
```

## Scripts

| Script   | Descrição                    |
|----------|------------------------------|
| `npm run dev`  | Inicia em modo desenvolvimento (hot reload) |
| `npm run build`| Compila TypeScript para `dist/`             |
| `npm start`    | Inicia o servidor (após build)              |
| `npm run clean`| Remove a pasta `dist/`                       |
| `npm run test:playwright` | Valida instalação do Playwright (abre navegador e fecha) |

## Execução

```bash
# Desenvolvimento
npm run dev

# Produção (após build)
npm run build && npm start
```

O servidor inicia em **http://localhost:3000** por padrão (variável `PORT`).

## Rotas disponíveis

| Método | Rota           | Descrição                    |
|--------|----------------|------------------------------|
| GET    | `/`            | Status da API                |
| GET    | `/health`      | Health check                 |
| GET/PUT| `/api/settings` | Configurações de automação   |
| *      | `/api/empresas` | CRUD de empresas             |
| *      | `/api/credenciais` | CRUD de credenciais       |
| *      | `/api/certificados` | CRUD de certificados (metadados) |
| *      | `/api/execucoes` | Listar execuções           |
| POST   | `/api/execucao/:empresa_id` | Iniciar execução      |
| *      | `/api/contabilidades` | CRUD de contabilidades  |
| GET    | `/api/relatorios/execucoes/resumo` | Resumo de execuções |
| POST   | `/api/nfse/:cnpj/abrir` | Abrir dashboard NFSe (requer CertificateService) |

## Progresso da migração

- [x] **Fase 1**: Fundação (estrutura, config, Express, CORS)
- [x] **Fase 2**: Rotas simples (health, settings)
- [x] **Fase 3**: Banco de dados e CRUD (empresas, credenciais, certificados, execuções, settings)
- [x] **Fase 4**: Automação Playwright (playwright_nfse, download_manager, processar_notas, ExecutionService)
- [ ] **Fase 5**: Certificados e criptografia (Fernet, CertificateService)
- [x] **Fase 6**: Rotas restantes (contabilidades, relatórios, NFSe) — Docker e testes pendentes

Consulte `Backend/docs/DOCUMENTACAO_CERTIFICADOS_CREDENCIAIS.md` para detalhes das rotas e banco de dados.
