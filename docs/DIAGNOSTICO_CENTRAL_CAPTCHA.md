# Diagnóstico — Central Manual de hCaptcha

> Relatório técnico da falha do primeiro teste de resolução manual e das correções/instrumentação aplicadas.
> Data: 2026-07-23

---

## 27.1 Resumo

A falha **não pode ser atribuída apenas** a “o widget não apareceu” ou “o token não chegou”. A análise de código mostrou **dois problemas de implementação reais** no caminho Central → Playwright e **uma divergência arquitetural** em relação ao fluxo 2Captcha.

### Onde o fluxo quebrava (evidência de código)

| # | Etapa | Achado |
| - | ----- | ------ |
| 1 | Captura `pageUrl` | Quando o sitekey vinha de um frame, `pageurl` podia ser a **URL do iframe hCaptcha**, não a do Portal Nacional. |
| 2 | Injeção | `page.evaluate` só no documento principal; **sem** `input`/`change`/`blur`; **sem** invocar `data-callback`. |
| 3 | Pós-injeção | Clique em `#btnSubmitHCaptcha` era tratado como sucesso **sem observar** se o portal aceitou. |
| 4 | Arquitetura | **2Captcha resolve o desafio já aberto no Playwright**; a Central **renderiza um novo widget** (novo desafio) e gera token para **outra instância**. |

Ou seja: mesmo com token não-vazio e Promise resolvida, o portal pode continuar bloqueado — e a automação antiga **não detectava** essa rejeição.

---

## 27.2 Classificação principal

```text
F. Injeção incorreta  +  G. Callback ou submissão incompleta
```

**Correções aplicadas nesta tarefa.**  

Risco residual (a confirmar com `CAPTCHA_DEBUG=true` em execução real):

```text
I. Provável limitação de contexto/desafio
   (token gerado em widget novo na Central ≠ desafio aberto no Playwright)
```

**Não classificar como H (limitação de domínio) sem** o `diagnostic.json` de uma tentativa real mostrando hashes iguais + `portal.result = REJECTED` / `MODAL_REMAINED_OPEN`.

---

## 27.3 Evidências por etapa

| Etapa | Resultado (análise estática + testes) | Evidência |
| ----- | ------------------------------------- | --------- |
| Captura no Playwright | **Bug corrigido** | `hcaptcha-page.ts`: `pageurl` agora é sempre `page.url()` |
| Payload enviado | OK após correção + fingerprint | `payloadFingerprint` + logs `payload_before_publish` |
| Payload recebido | Verificável no FE | Painel técnico + `fingerprintValid` |
| Widget renderizado | Depende do sitekey/domínio | Instrumentado (`widgetId`, erros de `render`) |
| Token gerado | Callback + `getResponse` | Comparação de hash no card |
| Transporte do token | Testado | Ack Socket.IO com `tokenHash`; teste de 5 captchas |
| Promise resolvida | OK | `ManualCaptchaProvider` + testes |
| Injeção | **Corrigida** | Todos os frames + eventos + callback nomeado |
| Callback | **Melhorado** | Invoca `data-callback` se existir |
| Requisição do portal | **Instrumentada** | `observarResultadoPortalAposSubmit` |
| Resposta do portal | **Classificada** | `ACCEPTED` / `REJECTED` / `NO_REQUEST_SENT` / … |

### Comparação 2Captcha vs Central Manual

| Etapa | 2Captcha | Central Manual (antes) | Diferença |
| ----- | -------- | ---------------------- | --------- |
| sitekey | Extraído da página | Extraído da página | Igual (origem) |
| pageUrl | Podia ser URL do iframe | Podia ser URL do iframe | Bug compartilhado; **corrigido** |
| rqdata | Enviado à API 2Captcha | Enviado ao widget Angular | Mesmo valor, **uso diferente** |
| action | Não capturado | Não capturado → agora capturado | Corrigido |
| Natureza do desafio | Resolve o desafio **já aberto** no Chromium | Cria **novo** desafio no browser da Central | **Divergência crítica** |
| Método de injeção | `value=` + clique Confirmar | Igual (antes) | Agora: frames + eventos + callback |
| Verificação portal | Nenhuma | Nenhuma → agora observa rede/modal | Corrigido |
| user-agent | Do Playwright | Do Playwright (payload) | Widget Central usa UA do operador |

A **primeira divergência de processo** (não de transporte) é:  
2Captcha não re-renderiza o widget; a Central sim.

---

## 27.4 Como gerar evidência ao vivo

1. No `Backend/.env`:

```env
CAPTCHA_DEBUG=true
```

2. Reinicie o backend e o frontend (`environment.captchaDebug` já true em dev).

3. Inicie lote em modo **Manual**, abra a Central, resolva um captcha.

4. Artefatos:

```text
Backend/debug/captchas/{batchId}/{executionId}/{attemptId}/
  ├── 01-original-detected.png
  ├── 02-before-injection.png
  ├── 03-after-injection.png
  ├── 04-after-submit.png
  └── diagnostic.json
```

5. Critério para **limitar a origem/contexto (H/I)**:

- `tokenFlow.allHashesMatch === true`
- injeção com `fieldsFilled > 0`
- `portal.result` ∈ `REJECTED` | `MODAL_REMAINED_OPEN` | `NEW_CHALLENGE_CREATED`
- fluxo 2Captcha OK no mesmo ponto

---

## 27.5 Arquivos

### Criados

- `Backend/src/automation/captcha-diagnostic.ts`
- `Backend/src/automation/captcha-diagnostic.test.ts`
- `Backend/src/automation/scripts/control-captcha-flow.test.ts`
- `Frontend/src/app/utils/captcha-fingerprint.ts`
- `docs/DIAGNOSTICO_CENTRAL_CAPTCHA.md` (este arquivo)

### Alterados

- `Backend/src/infrastructure/config.ts` — `CAPTCHA_DEBUG`
- `Backend/src/automation/hcaptcha-page.ts` — captura/injeção/observação
- `Backend/src/automation/processar-notas-competencia.ts` — diagnóstico no fluxo MANUAL
- `Backend/src/automation/captcha/types.ts` — `attemptId`, fingerprint
- `Backend/src/automation/captcha/manual-captcha.provider.ts`
- `Backend/src/services/manual-captcha.service.ts` — ack com hash
- `Backend/src/infrastructure/socket.ts`
- `Frontend` Central (painel técnico, fingerprint, getResponse, hash transporte)
- `Frontend/src/environments/environment.ts` — `captchaDebug`

### Variáveis

| Variável | Padrão | Uso |
| -------- | ------ | --- |
| `CAPTCHA_DEBUG` | `false` | Logs + screenshots + `diagnostic.json` |

### Testes

25 testes passando (serviço manual, providers, diagnóstico, fluxo de controle).

---

## 27.6 Correções aplicadas

1. **pageUrl** sempre da página principal do portal.  
2. **Injeção** em todos os frames + eventos `input`/`change`/`blur`.  
3. **Callback** `data-callback` invocado quando nomeado.  
4. **Observação do portal** após Confirmar; falha → retry (`ERROR_CAPTCHA_UNSOLVABLE`).  
5. **attemptId** + fingerprint + hashes em toda a cadeia.  
6. **Painel técnico** na Central quando debug ativo.

---

## 27.7 Conclusão objetiva

| Pergunta | Resposta |
| -------- | -------- |
| O problema está na nossa implementação? | **Sim, em parte** — injeção/callback/pageUrl/falta de verificação (corrigidos). |
| O token chegou intacto ao Playwright? | Transporte/correlação: **sim** (testes + ack com hash). Validar ao vivo com `diagnostic.json`. |
| O callback correto foi executado? | Antes: **não garantido**. Agora: executa se `data-callback` existir. |
| O portal enviou uma requisição? | Antes: **desconhecido**. Agora: classificado em `portal.requestSent` / `result`. |
| O portal rejeitou explicitamente o token? | **Não comprovável só com análise estática** — exige tentativa com `CAPTCHA_DEBUG=true`. |
| Há evidência de limitação de origem/contexto? | Há **evidência arquitetural forte** (novo desafio vs desafio existente), mas **H só após** hashes iguais + rejeição do portal no `diagnostic.json`. |

### Próximo passo recomendado

Rodar **um** lote MANUAL com `CAPTCHA_DEBUG=true` e anexar o `diagnostic.json`.  
- Se `allHashesMatch` e `portal.result` = rejeição/modal aberto → tratar como **desafio/contexto** (evoluir arquitetura: remote browser / stream / solver sem re-render).  
- Se hash divergir ou `fieldsFilled = 0` → ainda é bug de implementação naquele ambiente.
