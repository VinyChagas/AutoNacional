# Relatório diagnóstico — integração 2captcha (hCaptcha)

Documento gerado automaticamente pelo AutoNacional para o suporte do 2captcha.
**A chave de API completa NÃO está incluída neste arquivo.**

- Session ID: `20260720-125839`
- Início da sessão: 2026-07-20T15:58:39.402Z
- Última atualização: 2026-07-20T15:58:39.403Z

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

_Nenhuma tentativa de resolução ainda. Execute um download que abra o modal de captcha._
## Arquivos gerados

- Relatório (este arquivo): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260720-125839-RELATORIO.md`
- Eventos (JSONL): `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\session-20260720-125839-events.jsonl`
- Último evento: `C:\Users\vinic\Documents\Projetos\AutoNacional\Backend\logs\2captcha-report\ultimo-evento.json`
