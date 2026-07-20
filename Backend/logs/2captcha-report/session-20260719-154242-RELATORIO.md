# Relatório diagnóstico — integração 2captcha (hCaptcha)

Documento gerado automaticamente pelo AutoNacional para o suporte do 2captcha.
**A chave de API completa NÃO está incluída neste arquivo.**

- Session ID: `20260719-154242`
- Início da sessão: 2026-07-19T18:42:42.640Z
- Última atualização: 2026-07-20T11:59:42.102Z

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

- Horário: 2026-07-19T18:43:15.977Z
```json
{
  "seq": 1,
  "at": "2026-07-19T18:43:15.977Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 1,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #2 — api_request

- Horário: 2026-07-19T18:43:15.980Z
```json
{
  "seq": 2,
  "at": "2026-07-19T18:43:15.980Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #3 — api_response

- Horário: 2026-07-19T18:43:16.706Z
```json
{
  "seq": 3,
  "at": "2026-07-19T18:43:16.706Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83304001519
  },
  "elapsedMs": 724
}
```

### Evento #4 — api_request

- Horário: 2026-07-19T18:43:28.713Z
```json
{
  "seq": 4,
  "at": "2026-07-19T18:43:28.713Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83304001519
  }
}
```

### Evento #5 — api_response

- Horário: 2026-07-19T18:43:29.201Z
```json
{
  "seq": 5,
  "at": "2026-07-19T18:43:29.201Z",
  "sessionId": "20260719-154242",
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
  "elapsedMs": 488
}
```

### Evento #6 — api_response

- Horário: 2026-07-19T18:44:58.727Z
```json
{
  "seq": 6,
  "at": "2026-07-19T18:44:58.727Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "ready",
    "pollCount": 18,
    "hasToken": true,
    "tokenLength": 2539
  },
  "elapsedMs": 263
}
```

### Evento #7 — token_received

- Horário: 2026-07-19T18:44:58.732Z
```json
{
  "seq": 7,
  "at": "2026-07-19T18:44:58.732Z",
  "sessionId": "20260719-154242",
  "type": "token_received",
  "tentativa": 1,
  "apiVersion": "v2",
  "taskId": 83304001519,
  "tokenLength": 2539,
  "tokenPrefix": "P1_eyJhbGciO…"
}
```

### Evento #8 — solution_submitted_to_target_site

- Horário: 2026-07-19T18:44:58.778Z
```json
{
  "seq": 8,
  "at": "2026-07-19T18:44:58.778Z",
  "sessionId": "20260719-154242",
  "type": "solution_submitted_to_target_site",
  "tentativa": 1,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "camposInjetados": [
    "h-captcha-response",
    "g-recaptcha-response"
  ],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #9 — captcha_detected

- Horário: 2026-07-19T18:45:00.415Z
```json
{
  "seq": 9,
  "at": "2026-07-19T18:45:00.415Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 2,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #10 — api_request

- Horário: 2026-07-19T18:45:00.417Z
```json
{
  "seq": 10,
  "at": "2026-07-19T18:45:00.417Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #11 — api_response

- Horário: 2026-07-19T18:45:00.723Z
```json
{
  "seq": 11,
  "at": "2026-07-19T18:45:00.723Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83304010642
  },
  "elapsedMs": 303
}
```

### Evento #12 — api_request

- Horário: 2026-07-19T18:45:12.731Z
```json
{
  "seq": 12,
  "at": "2026-07-19T18:45:12.731Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83304010642
  }
}
```

### Evento #13 — api_response

- Horário: 2026-07-19T18:45:13.218Z
```json
{
  "seq": 13,
  "at": "2026-07-19T18:45:13.218Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 487
}
```

### Evento #14 — api_response

- Horário: 2026-07-19T18:46:48.016Z
```json
{
  "seq": 14,
  "at": "2026-07-19T18:46:48.016Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "ready",
    "pollCount": 19,
    "hasToken": true,
    "tokenLength": 2611
  },
  "elapsedMs": 263
}
```

### Evento #15 — token_received

- Horário: 2026-07-19T18:46:48.020Z
```json
{
  "seq": 15,
  "at": "2026-07-19T18:46:48.020Z",
  "sessionId": "20260719-154242",
  "type": "token_received",
  "tentativa": 2,
  "apiVersion": "v2",
  "taskId": 83304010642,
  "tokenLength": 2611,
  "tokenPrefix": "P1_eyJhbGciO…"
}
```

### Evento #16 — solution_submitted_to_target_site

- Horário: 2026-07-19T18:46:48.083Z
```json
{
  "seq": 16,
  "at": "2026-07-19T18:46:48.083Z",
  "sessionId": "20260719-154242",
  "type": "solution_submitted_to_target_site",
  "tentativa": 2,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "camposInjetados": [
    "h-captcha-response",
    "g-recaptcha-response"
  ],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #17 — captcha_detected

- Horário: 2026-07-19T18:46:50.086Z
```json
{
  "seq": 17,
  "at": "2026-07-19T18:46:50.086Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 3,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #18 — api_request

- Horário: 2026-07-19T18:46:50.088Z
```json
{
  "seq": 18,
  "at": "2026-07-19T18:46:50.088Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 3,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #19 — api_response

- Horário: 2026-07-19T18:46:50.361Z
```json
{
  "seq": 19,
  "at": "2026-07-19T18:46:50.361Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 3,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83304021571
  },
  "elapsedMs": 271
}
```

### Evento #20 — api_request

- Horário: 2026-07-19T18:47:02.366Z
```json
{
  "seq": 20,
  "at": "2026-07-19T18:47:02.366Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 3,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83304021571
  }
}
```

### Evento #21 — api_response

- Horário: 2026-07-19T18:47:02.846Z
```json
{
  "seq": 21,
  "at": "2026-07-19T18:47:02.846Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 3,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 480
}
```

### Evento #22 — api_response

- Horário: 2026-07-19T18:49:30.335Z
```json
{
  "seq": 22,
  "at": "2026-07-19T18:49:30.335Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 3,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 29,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 263
}
```

### Evento #23 — captcha_failed

- Horário: 2026-07-19T18:49:30.340Z
```json
{
  "seq": 23,
  "at": "2026-07-19T18:49:30.340Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 3,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #24 — captcha_failed

- Horário: 2026-07-19T18:49:30.344Z
```json
{
  "seq": 24,
  "at": "2026-07-19T18:49:30.344Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 3,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #25 — captcha_detected

- Horário: 2026-07-19T18:49:35.321Z
```json
{
  "seq": 25,
  "at": "2026-07-19T18:49:35.321Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 4,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #26 — api_request

- Horário: 2026-07-19T18:49:35.324Z
```json
{
  "seq": 26,
  "at": "2026-07-19T18:49:35.324Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 4,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #27 — api_response

- Horário: 2026-07-19T18:49:35.596Z
```json
{
  "seq": 27,
  "at": "2026-07-19T18:49:35.596Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 4,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83304037516
  },
  "elapsedMs": 270
}
```

### Evento #28 — api_request

- Horário: 2026-07-19T18:49:47.598Z
```json
{
  "seq": 28,
  "at": "2026-07-19T18:49:47.598Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 4,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83304037516
  }
}
```

### Evento #29 — api_response

- Horário: 2026-07-19T18:49:48.085Z
```json
{
  "seq": 29,
  "at": "2026-07-19T18:49:48.085Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 4,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 487
}
```

### Evento #30 — api_response

- Horário: 2026-07-19T18:51:12.395Z
```json
{
  "seq": 30,
  "at": "2026-07-19T18:51:12.395Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 4,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 17,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 259
}
```

### Evento #31 — captcha_failed

- Horário: 2026-07-19T18:51:12.399Z
```json
{
  "seq": 31,
  "at": "2026-07-19T18:51:12.399Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 4,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #32 — captcha_failed

- Horário: 2026-07-19T18:51:12.404Z
```json
{
  "seq": 32,
  "at": "2026-07-19T18:51:12.404Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 4,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #33 — captcha_detected

- Horário: 2026-07-19T18:58:48.593Z
```json
{
  "seq": 33,
  "at": "2026-07-19T18:58:48.593Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 5,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #34 — api_request

- Horário: 2026-07-19T18:58:48.596Z
```json
{
  "seq": 34,
  "at": "2026-07-19T18:58:48.596Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 5,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=29%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #35 — api_response

- Horário: 2026-07-19T18:58:49.249Z
```json
{
  "seq": 35,
  "at": "2026-07-19T18:58:49.249Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 5,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83304094725
  },
  "elapsedMs": 651
}
```

### Evento #36 — api_request

- Horário: 2026-07-19T18:59:01.263Z
```json
{
  "seq": 36,
  "at": "2026-07-19T18:59:01.263Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 5,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83304094725
  }
}
```

### Evento #37 — api_response

- Horário: 2026-07-19T18:59:01.759Z
```json
{
  "seq": 37,
  "at": "2026-07-19T18:59:01.759Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 5,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 496
}
```

### Evento #38 — api_response

- Horário: 2026-07-19T19:02:00.975Z
```json
{
  "seq": 38,
  "at": "2026-07-19T19:02:00.975Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 5,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 35,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 264
}
```

### Evento #39 — captcha_failed

- Horário: 2026-07-19T19:02:00.979Z
```json
{
  "seq": 39,
  "at": "2026-07-19T19:02:00.979Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 5,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #40 — captcha_failed

- Horário: 2026-07-19T19:02:00.983Z
```json
{
  "seq": 40,
  "at": "2026-07-19T19:02:00.983Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 5,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #41 — captcha_detected

- Horário: 2026-07-20T11:45:28.584Z
```json
{
  "seq": 41,
  "at": "2026-07-20T11:45:28.584Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 6,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #42 — api_request

- Horário: 2026-07-20T11:45:28.589Z
```json
{
  "seq": 42,
  "at": "2026-07-20T11:45:28.589Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 6,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #43 — api_response

- Horário: 2026-07-20T11:45:29.534Z
```json
{
  "seq": 43,
  "at": "2026-07-20T11:45:29.534Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 6,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83309047757
  },
  "elapsedMs": 941
}
```

### Evento #44 — captcha_detected

- Horário: 2026-07-20T11:45:30.104Z
```json
{
  "seq": 44,
  "at": "2026-07-20T11:45:30.104Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 7,
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

### Evento #45 — api_request

- Horário: 2026-07-20T11:45:30.107Z
```json
{
  "seq": 45,
  "at": "2026-07-20T11:45:30.107Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 7,
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

### Evento #46 — api_response

- Horário: 2026-07-20T11:45:30.359Z
```json
{
  "seq": 46,
  "at": "2026-07-20T11:45:30.359Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83309047855
  },
  "elapsedMs": 250
}
```

### Evento #47 — api_request

- Horário: 2026-07-20T11:45:41.537Z
```json
{
  "seq": 47,
  "at": "2026-07-20T11:45:41.537Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83309047757
  }
}
```

### Evento #48 — api_response

- Horário: 2026-07-20T11:45:42.021Z
```json
{
  "seq": 48,
  "at": "2026-07-20T11:45:42.021Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 484
}
```

### Evento #49 — api_request

- Horário: 2026-07-20T11:45:42.371Z
```json
{
  "seq": 49,
  "at": "2026-07-20T11:45:42.371Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83309047855
  }
}
```

### Evento #50 — api_response

- Horário: 2026-07-20T11:45:42.622Z
```json
{
  "seq": 50,
  "at": "2026-07-20T11:45:42.622Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 251
}
```

### Evento #51 — api_response

- Horário: 2026-07-20T11:49:49.548Z
```json
{
  "seq": 51,
  "at": "2026-07-20T11:49:49.548Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 48,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 256
}
```

### Evento #52 — captcha_failed

- Horário: 2026-07-20T11:49:49.553Z
```json
{
  "seq": 52,
  "at": "2026-07-20T11:49:49.553Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 7,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #53 — captcha_failed

- Horário: 2026-07-20T11:49:49.557Z
```json
{
  "seq": 53,
  "at": "2026-07-20T11:49:49.557Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 7,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #54 — api_response

- Horário: 2026-07-20T11:49:54.680Z
```json
{
  "seq": 54,
  "at": "2026-07-20T11:49:54.680Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 7,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 49,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 265
}
```

### Evento #55 — captcha_failed

- Horário: 2026-07-20T11:49:54.685Z
```json
{
  "seq": 55,
  "at": "2026-07-20T11:49:54.685Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 7,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #56 — captcha_failed

- Horário: 2026-07-20T11:49:54.689Z
```json
{
  "seq": 56,
  "at": "2026-07-20T11:49:54.689Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 7,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #57 — captcha_detected

- Horário: 2026-07-20T11:49:54.840Z
```json
{
  "seq": 57,
  "at": "2026-07-20T11:49:54.840Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 8,
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

### Evento #58 — api_request

- Horário: 2026-07-20T11:49:54.843Z
```json
{
  "seq": 58,
  "at": "2026-07-20T11:49:54.843Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 8,
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

### Evento #59 — api_response

- Horário: 2026-07-20T11:49:55.087Z
```json
{
  "seq": 59,
  "at": "2026-07-20T11:49:55.087Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 8,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83309075159
  },
  "elapsedMs": 242
}
```

### Evento #60 — captcha_detected

- Horário: 2026-07-20T11:49:59.767Z
```json
{
  "seq": 60,
  "at": "2026-07-20T11:49:59.767Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 9,
  "targetSite": "https://www.nfse.gov.br",
  "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "sitekey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "hasRqdata": false,
  "rqdataLength": 0,
  "rqdataPrefix": null,
  "apiVersion": "v2",
  "isInvisible": false
}
```

### Evento #61 — api_request

- Horário: 2026-07-20T11:49:59.772Z
```json
{
  "seq": 61,
  "at": "2026-07-20T11:49:59.772Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "task": {
      "type": "HCaptchaTaskProxyless",
      "websiteURL": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
      "websiteKey": "e02c27a0-0542-4c9a-88da-e48697acd87c",
      "isInvisible": false,
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
  }
}
```

### Evento #62 — api_response

- Horário: 2026-07-20T11:50:00.037Z
```json
{
  "seq": 62,
  "at": "2026-07-20T11:50:00.037Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83309075567
  },
  "elapsedMs": 261
}
```

### Evento #63 — api_request

- Horário: 2026-07-20T11:50:07.101Z
```json
{
  "seq": 63,
  "at": "2026-07-20T11:50:07.101Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83309075159
  }
}
```

### Evento #64 — api_response

- Horário: 2026-07-20T11:50:07.356Z
```json
{
  "seq": 64,
  "at": "2026-07-20T11:50:07.356Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 255
}
```

### Evento #65 — api_request

- Horário: 2026-07-20T11:50:12.042Z
```json
{
  "seq": 65,
  "at": "2026-07-20T11:50:12.042Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83309075567
  }
}
```

### Evento #66 — api_response

- Horário: 2026-07-20T11:50:12.308Z
```json
{
  "seq": 66,
  "at": "2026-07-20T11:50:12.308Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 266
}
```

### Evento #67 — api_response

- Horário: 2026-07-20T11:53:22.278Z
```json
{
  "seq": 67,
  "at": "2026-07-20T11:53:22.278Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 9,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "ready",
    "pollCount": 38,
    "hasToken": true,
    "tokenLength": 1491
  },
  "elapsedMs": 252
}
```

### Evento #68 — token_received

- Horário: 2026-07-20T11:53:22.283Z
```json
{
  "seq": 68,
  "at": "2026-07-20T11:53:22.283Z",
  "sessionId": "20260719-154242",
  "type": "token_received",
  "tentativa": 9,
  "apiVersion": "v2",
  "taskId": 83309075159,
  "tokenLength": 1491,
  "tokenPrefix": "P1_eyJ0eXAiO…"
}
```

### Evento #69 — solution_submitted_to_target_site

- Horário: 2026-07-20T11:53:22.344Z
```json
{
  "seq": 69,
  "at": "2026-07-20T11:53:22.344Z",
  "sessionId": "20260719-154242",
  "type": "solution_submitted_to_target_site",
  "tentativa": 9,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1&busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [
    "h-captcha-response",
    "g-recaptcha-response"
  ],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #70 — captcha_detected

- Horário: 2026-07-20T11:53:23.967Z
```json
{
  "seq": 70,
  "at": "2026-07-20T11:53:23.967Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 10,
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

### Evento #71 — api_request

- Horário: 2026-07-20T11:53:23.969Z
```json
{
  "seq": 71,
  "at": "2026-07-20T11:53:23.969Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 10,
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

### Evento #72 — api_response

- Horário: 2026-07-20T11:53:24.232Z
```json
{
  "seq": 72,
  "at": "2026-07-20T11:53:24.232Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 10,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83309096003
  },
  "elapsedMs": 260
}
```

### Evento #73 — api_request

- Horário: 2026-07-20T11:53:36.251Z
```json
{
  "seq": 73,
  "at": "2026-07-20T11:53:36.251Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 10,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83309096003
  }
}
```

### Evento #74 — api_response

- Horário: 2026-07-20T11:53:36.489Z
```json
{
  "seq": 74,
  "at": "2026-07-20T11:53:36.489Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 10,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 238
}
```

### Evento #75 — api_response

- Horário: 2026-07-20T11:53:53.480Z
```json
{
  "seq": 75,
  "at": "2026-07-20T11:53:53.480Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 10,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 43,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 247
}
```

### Evento #76 — captcha_failed

- Horário: 2026-07-20T11:53:53.484Z
```json
{
  "seq": 76,
  "at": "2026-07-20T11:53:53.484Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 10,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #77 — captcha_failed

- Horário: 2026-07-20T11:53:53.489Z
```json
{
  "seq": 77,
  "at": "2026-07-20T11:53:53.489Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 10,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #78 — api_response

- Horário: 2026-07-20T11:57:38.621Z
```json
{
  "seq": 78,
  "at": "2026-07-20T11:57:38.621Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 10,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 47,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 258
}
```

### Evento #79 — captcha_failed

- Horário: 2026-07-20T11:57:38.626Z
```json
{
  "seq": 79,
  "at": "2026-07-20T11:57:38.626Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 10,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #80 — captcha_failed

- Horário: 2026-07-20T11:57:38.630Z
```json
{
  "seq": 80,
  "at": "2026-07-20T11:57:38.630Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 10,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #81 — captcha_detected

- Horário: 2026-07-20T11:57:44.018Z
```json
{
  "seq": 81,
  "at": "2026-07-20T11:57:44.018Z",
  "sessionId": "20260719-154242",
  "type": "captcha_detected",
  "tentativa": 11,
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

### Evento #82 — api_request

- Horário: 2026-07-20T11:57:44.020Z
```json
{
  "seq": 82,
  "at": "2026-07-20T11:57:44.020Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 11,
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

### Evento #83 — api_response

- Horário: 2026-07-20T11:57:44.296Z
```json
{
  "seq": 83,
  "at": "2026-07-20T11:57:44.296Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 11,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83309119123
  },
  "elapsedMs": 274
}
```

### Evento #84 — api_request

- Horário: 2026-07-20T11:57:56.302Z
```json
{
  "seq": 84,
  "at": "2026-07-20T11:57:56.302Z",
  "sessionId": "20260719-154242",
  "type": "api_request",
  "tentativa": 11,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83309119123
  }
}
```

### Evento #85 — api_response

- Horário: 2026-07-20T11:57:56.780Z
```json
{
  "seq": 85,
  "at": "2026-07-20T11:57:56.780Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 11,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "processing",
    "pollCount": 1,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 478
}
```

### Evento #86 — api_response

- Horário: 2026-07-20T11:59:42.089Z
```json
{
  "seq": 86,
  "at": "2026-07-20T11:59:42.089Z",
  "sessionId": "20260719-154242",
  "type": "api_response",
  "tentativa": 11,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 12,
    "errorCode": "ERROR_CAPTCHA_UNSOLVABLE",
    "errorDescription": "Workers could not solve the Captcha",
    "pollCount": 21,
    "hasToken": false,
    "tokenLength": 0
  },
  "elapsedMs": 263
}
```

### Evento #87 — captcha_failed

- Horário: 2026-07-20T11:59:42.095Z
```json
{
  "seq": 87,
  "at": "2026-07-20T11:59:42.095Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 11,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #88 — captcha_failed

- Horário: 2026-07-20T11:59:42.100Z
```json
{
  "seq": 88,
  "at": "2026-07-20T11:59:42.100Z",
  "sessionId": "20260719-154242",
  "type": "captcha_failed",
  "tentativa": 11,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

## Arquivos gerados

- Relatório (este arquivo): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260719-154242-RELATORIO.md`
- Eventos (JSONL): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260719-154242-events.jsonl`
- Último evento: `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\ultimo-evento.json`
