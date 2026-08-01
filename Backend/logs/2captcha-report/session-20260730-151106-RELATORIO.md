# Relatório diagnóstico — integração 2captcha (hCaptcha)

Documento gerado automaticamente pelo AutoNacional para o suporte do 2captcha.
**A chave de API completa NÃO está incluída neste arquivo.**

- Session ID: `20260730-151106`
- Início da sessão: 2026-07-30T18:11:06.087Z
- Última atualização: 2026-07-30T18:14:14.347Z

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

- Horário: 2026-07-30T18:11:47.393Z
```json
{
  "seq": 1,
  "at": "2026-07-30T18:11:47.393Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 1,
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

### Evento #2 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:12:19.596Z
```json
{
  "seq": 2,
  "at": "2026-07-30T18:12:19.596Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 1,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #3 — captcha_detected

- Horário: 2026-07-30T18:12:20.311Z
```json
{
  "seq": 3,
  "at": "2026-07-30T18:12:20.311Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 2,
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

### Evento #4 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:12:43.226Z
```json
{
  "seq": 4,
  "at": "2026-07-30T18:12:43.226Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 2,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #5 — captcha_detected

- Horário: 2026-07-30T18:12:43.675Z
```json
{
  "seq": 5,
  "at": "2026-07-30T18:12:43.675Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 3,
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

### Evento #6 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:13:22.605Z
```json
{
  "seq": 6,
  "at": "2026-07-30T18:13:22.605Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 3,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #7 — captcha_detected

- Horário: 2026-07-30T18:13:23.609Z
```json
{
  "seq": 7,
  "at": "2026-07-30T18:13:23.609Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 4,
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

### Evento #8 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:13:30.280Z
```json
{
  "seq": 8,
  "at": "2026-07-30T18:13:30.280Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 4,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #9 — captcha_detected

- Horário: 2026-07-30T18:13:31.217Z
```json
{
  "seq": 9,
  "at": "2026-07-30T18:13:31.217Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 5,
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

### Evento #10 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:13:40.349Z
```json
{
  "seq": 10,
  "at": "2026-07-30T18:13:40.349Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 5,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #11 — captcha_detected

- Horário: 2026-07-30T18:13:41.669Z
```json
{
  "seq": 11,
  "at": "2026-07-30T18:13:41.669Z",
  "sessionId": "20260730-151106",
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

### Evento #12 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:13:47.502Z
```json
{
  "seq": 12,
  "at": "2026-07-30T18:13:47.502Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 6,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #13 — captcha_detected

- Horário: 2026-07-30T18:13:49.012Z
```json
{
  "seq": 13,
  "at": "2026-07-30T18:13:49.012Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 7,
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

### Evento #14 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:13:57.167Z
```json
{
  "seq": 14,
  "at": "2026-07-30T18:13:57.167Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 7,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #15 — captcha_detected

- Horário: 2026-07-30T18:13:59.180Z
```json
{
  "seq": 15,
  "at": "2026-07-30T18:13:59.180Z",
  "sessionId": "20260730-151106",
  "type": "captcha_detected",
  "tentativa": 8,
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

### Evento #16 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:14:04.922Z
```json
{
  "seq": 16,
  "at": "2026-07-30T18:14:04.922Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 8,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

### Evento #17 — captcha_detected

- Horário: 2026-07-30T18:14:06.072Z
```json
{
  "seq": 17,
  "at": "2026-07-30T18:14:06.072Z",
  "sessionId": "20260730-151106",
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

### Evento #18 — solution_submitted_to_target_site

- Horário: 2026-07-30T18:14:14.346Z
```json
{
  "seq": 18,
  "at": "2026-07-30T18:14:14.346Z",
  "sessionId": "20260730-151106",
  "type": "solution_submitted_to_target_site",
  "tentativa": 9,
  "targetSite": "https://www.nfse.gov.br",
  "pageurl": "https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?busca=&datainicio=01%2F06%2F2026&datafim=30%2F06%2F2026",
  "camposInjetados": [],
  "botaoConfirmacao": "#btnSubmitHCaptcha",
  "sucesso": true
}
```

## Arquivos gerados

- Relatório (este arquivo): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260730-151106-RELATORIO.md`
- Eventos (JSONL): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260730-151106-events.jsonl`
- Último evento: `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\ultimo-evento.json`
