# 🔧 Solução para Erro de CORS

## Problema Identificado

O erro ocorre porque:
- O frontend Angular está rodando em uma porta dinâmica (`http://localhost:53229`)
- O backend está bloqueando requisições dessa origem por CORS
- Erro: `Access to XMLHttpRequest at 'http://localhost:8000/api/certificados/importar' from origin 'http://localhost:53229' has been blocked by CORS policy`

## Solução Implementada

A configuração de CORS foi ajustada para **aceitar qualquer porta do localhost em desenvolvimento** usando regex:

```python
allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+"
```

Isso permite que o frontend funcione independente da porta que o Angular escolher.

## ⚠️ AÇÃO NECESSÁRIA

**O servidor backend precisa ser reiniciado para aplicar as mudanças!**

### Como reiniciar:

1. **Pare o servidor atual:**
   - No terminal onde o backend está rodando, pressione `Ctrl+C`

2. **Reinicie o servidor:**
   ```cmd
   cd Backend
   .\scripts\init\iniciar_backend.bat
   ```

   Ou se iniciou manualmente:
   ```cmd
   cd Backend
   python run_server.py
   ```

3. **Verifique os logs:**
   Você deve ver uma mensagem como:
   ```
   ✅ CORS configurado para permitir localhost em qualquer porta (desenvolvimento)
      Regex: http://(localhost|127.0.0.1):\d+
      Isso permite qualquer porta do localhost, incluindo portas aleatórias do Angular
   ```

4. **Teste novamente:**
   - Tente importar o certificado novamente
   - O erro de CORS deve desaparecer

## Verificação

Após reiniciar, você pode verificar se o CORS está funcionando:

1. Abra o console do navegador (F12)
2. Tente fazer a requisição novamente
3. Não deve mais aparecer o erro de CORS
4. Os logs do backend devem mostrar a requisição sendo processada

## Nota

Esta configuração é para **desenvolvimento**. Em produção, defina a variável de ambiente `ENVIRONMENT=production` e `CORS_ORIGINS` com as origens específicas permitidas.

