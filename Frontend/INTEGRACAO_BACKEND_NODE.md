# Integração Frontend com Backend Node.js

Este documento descreve a integração do Frontend Angular com o backend Node.js.

## Alterações realizadas

### 1. Ambiente e configuração

- **`src/environments/environment.ts`** (desenvolvimento): `apiUrl: 'http://localhost:3000/api'`
- **`src/environments/environment.prod.ts`** (produção): `apiUrl: '/api'` (ajuste conforme deploy)
- **`angular.json`**: `fileReplacements` para trocar environment em build de produção

### 2. Services atualizados

Todos os services passam a usar `environment.apiUrl`:

- `EmpresasService`
- `CredenciaisService`
- `ContabilidadeService`
- `SettingsService`
- `CertificadoService`
- `ExecucaoService`

### 3. Backend Node.js – rotas adicionadas

- **`GET /api/empresas/contabilidade/:contabilidade_id`** – empresas por contabilidade (com `skip` e `limit`)
- **`DELETE /api/certificados/cnpj/:cnpj`** – remoção de certificado por CNPJ

### 4. CertificadoService – ajuste de endpoint

- Antes: `DELETE /certificados/metadados/cnpj/:cnpj`
- Depois: `DELETE /certificados/cnpj/:cnpj`

## Como executar

### Backend Node.js

```bash
cd Backend
npm install
npx playwright install chromium
cp .env.example .env   # Ajustar variáveis
npm run dev
```

Servidor em **http://localhost:3000**

### Frontend Angular

```bash
cd Frontend
npm install
ng serve   # ou npm start (porta 1234)
```

Frontend em **http://localhost:1234** (ou **http://localhost:4200**)

Configure o CORS no `Backend/.env` conforme a porta do frontend:

```
# Se usar npm start (porta 1234):
CORS_ORIGINS=http://localhost:1234,http://localhost:4200

# Ou só a 4200 se usar ng serve sem --port:
CORS_ORIGINS=http://localhost:4200
```

## Funcionalidades compatíveis

| Área | Status |
|------|--------|
| Configurações | ✅ |
| Empresas (CRUD, listar por contabilidade) | ✅ |
| Credenciais (CRUD, obter por empresa, obter senha) | ✅ |
| Contabilidades (CRUD) | ✅ |
| Certificados (metadados, deletar por CNPJ) | ✅ |
| Execução (individual e múltiplas) | ✅ |
| Relatórios de execuções | ✅ |
| NFSe abrir | ⚠️ Depende do CertificateService |

## Funcionalidades não migradas (retornam 404)

- **Validação de credenciais individual**: `POST /credenciais/empresa/:id/validar`
- **Validação de credenciais em lote**: `POST /credenciais/validar-lote`
- **Validação de planilha**: `POST /credenciais/importar-planilha/validar`
- **Importação de planilha**: `POST /credenciais/importar-planilha`
- **Certificados**: extrair, importar, validar-lote, importar-lote, listar por contabilidade

Esses recursos dependem de rotinas ainda não implementadas no backend Node; a UI continua disponível, mas as chamadas falham até a migração.

## Referências

- `Backend/README.md` – uso do backend
- `Backend/docs/DOCUMENTACAO_CERTIFICADOS_CREDENCIAIS.md` – rotas e banco de dados
