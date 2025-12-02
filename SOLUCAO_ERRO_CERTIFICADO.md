# 🔧 Solução para Erro de Certificado

## Problema Identificado

**Erro:** `Erro de autenticação: Erro durante automação NFSe: Erro inesperado ao criar contexto com certificado:`

O erro ocorre na etapa de **autenticação** ao tentar criar o contexto do Playwright com o certificado digital.

## Possíveis Causas

1. **Certificado não encontrado ou inválido**
2. **Senha do certificado incorreta**
3. **Formato do certificado incompatível**
4. **Erro ao carregar/decodificar o certificado**

## Próximos Passos para Diagnóstico

### 1. Verificar Logs do Backend

Os logs do backend devem conter informações mais detalhadas sobre o erro. Verifique:

- Logs do terminal/console onde o backend está rodando
- Procure por mensagens como:
  - "Erro inesperado ao criar contexto com certificado"
  - "Erro ao carregar certificado"
  - Qualquer traceback ou stack trace

### 2. Verificar Certificados Cadastrados

Verifique se os certificados estão cadastrados corretamente:

- Acesse a tela de Certificados no frontend
- Verifique se os 3 CNPJs têm certificados válidos
- Verifique se os certificados não estão vencidos

### 3. Verificar Logs Completos no Frontend

Execute novamente e verifique os logs completos que aparecem no console (F12), especialmente:

- Os logs dentro do array `status.logs`
- Esses logs podem conter informações mais detalhadas do backend

## Soluções Possíveis

### Solução 1: Verificar se o certificado existe
O certificado pode não estar sendo encontrado para os CNPJs. Verifique no banco de dados ou na tela de certificados.

### Solução 2: Recarregar o certificado
Se o certificado estiver corrompido, pode ser necessário fazer upload novamente.

### Solução 3: Verificar formato do certificado
O certificado pode estar em formato incompatível ou corrompido.

## O Que Fazer Agora

1. **Compartilhe os logs do backend** - Procure no terminal onde o backend está rodando
2. **Expanda os logs no console** - Clique no array de logs no console do navegador para ver os detalhes
3. **Verifique se os certificados estão válidos** - Na tela de certificados do frontend

Com essas informações poderemos identificar a causa exata!

