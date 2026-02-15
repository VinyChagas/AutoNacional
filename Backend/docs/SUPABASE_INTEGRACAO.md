# Integração Supabase (Server-Side)

## Configuração

### Variáveis obrigatórias (quando `USE_SUPABASE=true`)

| Variável | Descrição |
|----------|-----------|
| `SUPABASE_URL` | URL do projeto (ex: `https://xxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave service role (Settings → API) |
| `CRYPTO_KEY` | Chave para criptografia de credenciais |
| `CERT_STORAGE_BUCKET` | Nome do bucket Supabase Storage para .pfx |

⚠️ **NUNCA** exponha `SUPABASE_SERVICE_ROLE_KEY` ao frontend. Use apenas no backend.

### Bucket de certificados

1. No Supabase Dashboard: Storage → New bucket
2. Nome: `certificados` (ou o valor de `CERT_STORAGE_BUCKET`)
3. Pode ser privado; o backend usa service role para acesso

## Uso do cliente Supabase

```typescript
import { getSupabaseClient } from '../config/supabase';
import { env } from '../config/env';

// Storage - upload de certificado
const client = getSupabaseClient();
const { data, error } = await client.storage
  .from(env.CERT_STORAGE_BUCKET)
  .upload(`${cnpj}.pfx`, buffer, { upsert: true });

// Tabela - insert
const { data, error } = await client
  .from('certificados_digitais')
  .insert({ cnpj, arquivo, empresa_id })
  .select()
  .single();
```

## Estrutura de pastas

```
src/
├── config/
│   ├── env.ts          # Validação de variáveis de ambiente
│   └── supabase.ts     # Cliente Supabase (service role)
├── middleware/
│   ├── response.ts     # jsonSuccess, jsonError
│   ├── error-handler.ts
│   ├── upload.ts       # multer: uploadSingle, uploadArray
│   └── index.ts
├── modules/
│   ├── empresas/
│   ├── credenciais/
│   ├── certificados/
│   ├── imports/
│   └── index.ts
└── services/
    └── supabase-example.ts  # Exemplos de uso
```

## Respostas padronizadas

```typescript
import { jsonSuccess, jsonError, jsonCreated } from './middleware/response';

// Sucesso
jsonSuccess(res, { items: [] });
jsonCreated(res, newItem, 'Criado com sucesso');

// Erro
jsonError(res, 'Mensagem de erro', 400, 'CODE');
```

## Multer (upload multipart)

```typescript
import { uploadSingle, uploadArray, uploadPlanilha } from '../middleware/upload';

// Um arquivo
router.post('/upload', uploadSingle('certificado'), handler);

// Múltiplos arquivos
router.post('/import-lote', uploadArray('certificados', 50), handler);

// Planilha Excel
router.post('/import-planilha', uploadPlanilha('arquivo'), handler);
```
