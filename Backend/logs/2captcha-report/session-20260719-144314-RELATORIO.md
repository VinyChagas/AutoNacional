# Relatório diagnóstico — integração 2captcha (hCaptcha)

Documento gerado automaticamente pelo AutoNacional para o suporte do 2captcha.
**A chave de API completa NÃO está incluída neste arquivo.**

- Session ID: `20260719-144314`
- Início da sessão: 2026-07-19T17:43:14.323Z
- Última atualização: 2026-07-19T17:49:28.020Z

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

- Horário: 2026-07-19T17:45:13.684Z
```json
{
  "seq": 1,
  "at": "2026-07-19T17:45:13.684Z",
  "sessionId": "20260719-144314",
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

- Horário: 2026-07-19T17:45:13.687Z
```json
{
  "seq": 2,
  "at": "2026-07-19T17:45:13.687Z",
  "sessionId": "20260719-144314",
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

- Horário: 2026-07-19T17:45:14.504Z
```json
{
  "seq": 3,
  "at": "2026-07-19T17:45:14.504Z",
  "sessionId": "20260719-144314",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83303682787
  },
  "elapsedMs": 815
}
```

### Evento #4 — api_request

- Horário: 2026-07-19T17:45:26.513Z
```json
{
  "seq": 4,
  "at": "2026-07-19T17:45:26.513Z",
  "sessionId": "20260719-144314",
  "type": "api_request",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83303682787
  }
}
```

### Evento #5 — api_response

- Horário: 2026-07-19T17:45:27.003Z
```json
{
  "seq": 5,
  "at": "2026-07-19T17:45:27.003Z",
  "sessionId": "20260719-144314",
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
  "elapsedMs": 490
}
```

### Evento #6 — api_response

- Horário: 2026-07-19T17:46:46.007Z
```json
{
  "seq": 6,
  "at": "2026-07-19T17:46:46.007Z",
  "sessionId": "20260719-144314",
  "type": "api_response",
  "tentativa": 1,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "response": {
    "errorId": 0,
    "status": "ready",
    "pollCount": 16,
    "hasToken": true,
    "tokenLength": 2582
  },
  "elapsedMs": 263
}
```

### Evento #7 — token_received

- Horário: 2026-07-19T17:46:46.011Z
```json
{
  "seq": 7,
  "at": "2026-07-19T17:46:46.011Z",
  "sessionId": "20260719-144314",
  "type": "token_received",
  "tentativa": 1,
  "apiVersion": "v2",
  "taskId": 83303682787,
  "tokenLength": 2582,
  "tokenPrefix": "P1_eyJhbGciO…"
}
```

### Evento #8 — solution_submitted_to_target_site

- Horário: 2026-07-19T17:46:46.083Z
```json
{
  "seq": 8,
  "at": "2026-07-19T17:46:46.083Z",
  "sessionId": "20260719-144314",
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

- Horário: 2026-07-19T17:46:47.804Z
```json
{
  "seq": 9,
  "at": "2026-07-19T17:46:47.804Z",
  "sessionId": "20260719-144314",
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

- Horário: 2026-07-19T17:46:47.806Z
```json
{
  "seq": 10,
  "at": "2026-07-19T17:46:47.806Z",
  "sessionId": "20260719-144314",
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

- Horário: 2026-07-19T17:46:48.052Z
```json
{
  "seq": 11,
  "at": "2026-07-19T17:46:48.052Z",
  "sessionId": "20260719-144314",
  "type": "api_response",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/createTask",
  "response": {
    "errorId": 0,
    "taskId": 83303692090
  },
  "elapsedMs": 244
}
```

### Evento #12 — api_request

- Horário: 2026-07-19T17:47:00.060Z
```json
{
  "seq": 12,
  "at": "2026-07-19T17:47:00.060Z",
  "sessionId": "20260719-144314",
  "type": "api_request",
  "tentativa": 2,
  "apiVersion": "v2",
  "endpoint": "https://api.2captcha.com/getTaskResult",
  "requestBody": {
    "clientKey": "4b76…266b (len=32)",
    "taskId": 83303692090
  }
}
```

### Evento #13 — api_response

- Horário: 2026-07-19T17:47:00.541Z
```json
{
  "seq": 13,
  "at": "2026-07-19T17:47:00.541Z",
  "sessionId": "20260719-144314",
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
  "elapsedMs": 481
}
```

### Evento #14 — api_response

- Horário: 2026-07-19T17:49:28.009Z
```json
{
  "seq": 14,
  "at": "2026-07-19T17:49:28.009Z",
  "sessionId": "20260719-144314",
  "type": "api_response",
  "tentativa": 2,
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
  "elapsedMs": 258
}
```

### Evento #15 — captcha_failed

- Horário: 2026-07-19T17:49:28.013Z
```json
{
  "seq": 15,
  "at": "2026-07-19T17:49:28.013Z",
  "sessionId": "20260719-144314",
  "type": "captcha_failed",
  "tentativa": 2,
  "etapa": "getTaskResult",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

### Evento #16 — captcha_failed

- Horário: 2026-07-19T17:49:28.017Z
```json
{
  "seq": 16,
  "at": "2026-07-19T17:49:28.017Z",
  "sessionId": "20260719-144314",
  "type": "captcha_failed",
  "tentativa": 2,
  "etapa": "resolverHCaptcha",
  "erro": "2captcha getTaskResult: ERROR_CAPTCHA_UNSOLVABLE — Workers could not solve the Captcha"
}
```

## Arquivos gerados

- Relatório (este arquivo): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260719-144314-RELATORIO.md`
- Eventos (JSONL): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260719-144314-events.jsonl`
- Último evento: `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\ultimo-evento.json`
