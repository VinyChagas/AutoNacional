# Relatório diagnóstico — integração 2captcha (hCaptcha)

Documento gerado automaticamente pelo AutoNacional para o suporte do 2captcha.
**A chave de API completa NÃO está incluída neste arquivo.**

- Session ID: `20260723-133944`
- Início da sessão: 2026-07-23T16:39:44.993Z
- Última atualização: 2026-07-23T18:31:17.305Z

## Checklist do fornecedor

### 1) Solicitação com valores dos parâmetros do captcha

Além deste relatório, anexe uma captura de tela de:
https://2captcha.com/statistics/uploads

Os eventos abaixo trazem `sitekey`, `pageurl`/`websiteURL`, `taskId` e respostas da API.

### 2) Código / script usado para chamar a API

- Arquivo: `Backend/src/automation/captcha-solver.ts`
- API version configurada: `v2`
- Endpoint v2 createTask: `https://api.2captcha.com/createTask`
- Endpoint v2 getTaskResult: `https://api.2captcha.com/getTaskResult`
- Endpoint v1 in: `https://2captcha.com/in.php`
- Endpoint v1 res: `https://2captcha.com/res.php`

Payload típico **API v2 Enterprise (sem proxy)** enviado pela aplicação:
```json
{
  "clientKey": "4b76…266b (len=32)",
  "task": {
    "type": "HCaptchaTaskProxyless",
    "websiteURL": "<pageurl capturado do navegador>",
    "websiteKey": "<sitekey capturado do widget>",
    "isInvisible": false,
    "userAgent": "<navigator.userAgent do Playwright>",
    "enterprisePayload": {
      "rqdata": "<rqdata capturado do hCaptcha Enterprise>"
    }
  }
}
```

> **rqdata é opcional.** Quando existir valor real, envia-se `enterprisePayload.rqdata`.
> Quando não for encontrado, a propriedade deve ser **omitida** (nunca `""`, `null` ou `c.req`).

Payload típico **API v1**:
```json
{
  "key": "4b76…266b (len=32)",
  "method": "hcaptcha",
  "sitekey": "<sitekey>",
  "pageurl": "<pageurl>",
  "json": 1
}
```

### 3) Site onde o captcha está sendo resolvido

- Portal: **NFSe Nacional (Emissor Nacional)**
- Domínio: `https://www.nfse.gov.br`
- Páginas típicas: `/EmissorNacional/Notas/Emitidas` e `/EmissorNacional/Notas/Recebidas`
- Modal: "VALIDAÇÃO DE USUÁRIO" com widget hCaptcha ("Sou humano")
- Confirmação no site: botão `#btnSubmitHCaptcha` ("Confirmar")

### Submissão da solução no site de destino

Após receber o token do 2captcha, a aplicação:
1. Injeta o token em `textarea[name="h-captcha-response"]` e `g-recaptcha-response`
2. Clica em `#btnSubmitHCaptcha`
3. Aguarda o evento de download do arquivo (XML/PDF)

## Configuração da sessão

- API key (mascarada): `4b76…266b (len=32)`
- TWOCAPTCHA_API_VERSION: `v2`
- CAPTCHA_IS_INVISIBLE: `false`
- CAPTCHA_MODE: `auto_manual`
- CAPTCHA_SOLVE_TIMEOUT_MS: `420000`

## Eventos desta sessão

### Evento #1 — captcha_detected

- Horário: 2026-07-23T18:28:21.017Z
```json
{
  "seq": 1,
  "at": "2026-07-23T18:28:21.017Z",
  "sessionId": "20260723-133944",
  "type": "captcha_detected",
  "tentativa": 1,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #2 — api_request

- Horário: 2026-07-23T18:28:21.021Z
```json
{
  "seq": 2,
  "at": "2026-07-23T18:28:21.021Z",
  "sessionId": "20260723-133944",
  "type": "api_request",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #3 — api_response

- Horário: 2026-07-23T18:28:21.620Z
```json
{
  "seq": 3,
  "at": "2026-07-23T18:28:21.620Z",
  "sessionId": "20260723-133944",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83340719277
  },
  "elapsedMs": 597
}
```

### Evento #4 — api_request

- Horário: 2026-07-23T18:28:33.631Z
```json
{
  "seq": 4,
  "at": "2026-07-23T18:28:33.631Z",
  "sessionId": "20260723-133944",
  "type": "api_request",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83340719277
  }
}
```

### Evento #5 — api_response

- Horário: 2026-07-23T18:28:33.898Z
```json
{
  "seq": 5,
  "at": "2026-07-23T18:28:33.898Z",
  "sessionId": "20260723-133944",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 267
}
```

### Evento #6 — api_response

- Horário: 2026-07-23T18:31:17.293Z
```json
{
  "seq": 6,
  "at": "2026-07-23T18:31:17.293Z",
  "sessionId": "20260723-133944",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 32,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 264
}
```

### Evento #7 — captcha_failed

- Horário: 2026-07-23T18:31:17.298Z
```json
{
  "seq": 7,
  "at": "2026-07-23T18:31:17.298Z",
  "sessionId": "20260723-133944",
  "type": "captcha_failed",
  "tentativa": 1,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #8 — captcha_failed

- Horário: 2026-07-23T18:31:17.302Z
```json
{
  "seq": 8,
  "at": "2026-07-23T18:31:17.302Z",
  "sessionId": "20260723-133944",
  "type": "captcha_failed",
  "tentativa": 1,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

## Arquivos gerados

- Relatório (este arquivo): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260723-133944-RELATORIO.md`
- Eventos (JSONL): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260723-133944-events.jsonl`
- Último evento: `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\ultimo-evento.json`
