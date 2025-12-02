# 🔍 Debug Detalhado - Execuções Falhando

## 📊 Situação Atual

Baseado nos logs compartilhados:
```
Timeout ao aguardar execução (60s)
Fila vazia. Task processadora pausada.
```

## ✅ Melhorias Implementadas

### 1. **Logs Detalhados na Adição de Execuções**
- Log antes de adicionar à fila (tamanho da fila)
- Log depois de adicionar à fila (tamanho da fila)
- Log do total de execuções ativas em memória
- Prefixo `[ADICIONAR]` para fácil identificação

### 2. **Logs Detalhados no Processamento**
- Log quando a task processadora tenta pegar da fila
- Log do tamanho da fila e execuções ativas em memória
- Log quando execução é obtida da fila
- Prefixo `[PROCESSAR]` para fácil identificação

### 3. **Logs Detalhados no Erro de Autenticação**
- Tipo da exceção
- Traceback completo
- Args da exceção
- Mensagem de erro completa

### 4. **Logs na Chamada do Playwright**
- Parâmetros passados para `abrir_dashboard_nfse`
- Resultado retornado
- Erros com traceback completo

## 🔎 Próximos Passos

### 1. **Executar Novamente**
Clique em "Executar Todos" novamente no frontend.

### 2. **Copiar Logs do Backend**
No terminal onde o backend está rodando, procure por:

**Logs de adição à fila:**
- `[ADICIONAR] Adicionando execução à fila`
- `[ADICIONAR] Execução adicionada à fila`
- `[ADICIONAR] Execução registrada em execucoes_ativas`

**Logs de processamento:**
- `[PROCESSAR] Aguardando próxima execução na fila`
- `[PROCESSAR] ✅ Execução obtida da fila`
- `[PROCESSAR] ⏱️ Timeout ao aguardar execução`

**Logs de erro:**
- `❌ Erro inesperado ao criar contexto com certificado`
- `❌ Traceback completo:`
- `[empresa_id] ❌ Erro ao executar abrir_dashboard_nfse`

**Logs de autenticação:**
- `🔐 Iniciando criação de contexto com certificado`
- `📥 Carregando certificado do armazenamento`
- `🚀 Iniciando Playwright Async API`

### 3. **Copiar Logs do Frontend**
No console do navegador (F12), procure por:
- `[Polling] Status recebido`
- `[Polling] ⚠️ EXECUÇÃO FALHOU`
- Mensagens de erro completas

## 🎯 O Que Estamos Investigando

1. **As execuções estão sendo adicionadas à fila?**
   - Verificar logs com `[ADICIONAR]`

2. **A task processadora está pegando da fila?**
   - Verificar logs com `[PROCESSAR]`

3. **Onde exatamente está falhando?**
   - Verificar traceback completo nos logs de erro

4. **Qual é o erro real do certificado?**
   - Verificar logs com `❌` e traceback completo

## 📝 Formato Esperado dos Logs

Com os novos logs, você deve ver algo como:

```
[ADICIONAR] Adicionando execução à fila - Empresa empresa-52352633000162 (CNPJ: 52352633000162). Tamanho da fila antes: 0
[ADICIONAR] Execução adicionada à fila: Empresa empresa-52352633000162 (CNPJ: 52352633000162). Tamanho da fila depois: 1
[PROCESSAR] Aguardando próxima execução na fila... (fila tem 1 itens)
[PROCESSAR] ✅ Execução obtida da fila: Empresa empresa-52352633000162
[empresa-52352633000162] Chamando abrir_dashboard_nfse com CNPJ: 52352633000162
🔐 Iniciando criação de contexto com certificado A1 para CNPJ: 52352633000162
❌ Erro inesperado ao criar contexto com certificado: [TipoErro] Mensagem completa aqui
❌ Traceback completo:
   [traceback detalhado aqui]
```

**Compartilhe TODOS esses logs comigo para identificarmos o problema exato!**

