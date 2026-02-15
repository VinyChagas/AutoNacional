# Setup Supabase — AutoNacional

Configuração final do Supabase para o backend Node.js.

## 1. Service Role Key (obrigatório)

A variável `SUPABASE_SERVICE_ROLE_KEY` no `.env` **precisa ser a chave completa** do seu projeto.

1. Acesse: [Supabase Dashboard](https://supabase.com/dashboard) → projeto `sabqvvgaracqouyzxdgb`
2. **Settings** → **API**
3. Em **Project API keys**, copie a chave **`service_role`** (não use a `anon`)
4. Cole no `.env` substituindo o valor atual:

```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOi...sua_chave_completa_aqui...
```

> A chave tem cerca de 200+ caracteres. Não use "..." como placeholder.

## 2. Bucket de certificados

O backend **cria automaticamente** o bucket `certificados` no Storage na primeira inicialização, se ele não existir.

Se preferir criar manualmente:
- Supabase Dashboard → **Storage** → **New bucket**
- Nome: `certificados`
- **Public**: desmarcado (privado)
- **File size limit**: 10 MB

## 3. Variáveis já configuradas

- `SUPABASE_URL` ✓
- `SUPABASE_JWKS_URL` ✓
- `SUPABASE_AUDIENCE` ✓
- `SUPABASE_ISSUER` ✓
- `CERT_STORAGE_BUCKET=certificados` ✓
- `CORS_ORIGINS` ✓ (inclui localhost:4200 e localhost:1234)

## 4. Reiniciar o backend

Após configurar a `SUPABASE_SERVICE_ROLE_KEY`:

```bash
cd Backend
npm start
```

O cadastro de certificados digitais passará a funcionar corretamente.
