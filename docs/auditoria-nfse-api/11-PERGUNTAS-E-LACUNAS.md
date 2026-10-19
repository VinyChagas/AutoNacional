# 11 — Perguntas e lacunas

Itens marcados **NÃO IDENTIFICADO NO CÓDIGO** ou limitações conscientes da análise estática. Não são “bugs” por si — são gaps para a POC e para o handoff.

## Lacunas de produto / dados

| # | Lacuna | Impacto |
|---|--------|---------|
| 1 | Parser XML fiscal (chave, CNPJs, valor, competência, situação) | Impossível reconciliar fiscalmente só pelo DB atual |
| 2 | Tabela Prisma de nota individual / índice por chave 44 | Histórico = contagens + filesystem |
| 3 | Uso de `downloadsPattern` no save real | Setting/UI sugerem `{cnpj}/{ano}/{mes}`; save usa contabilidade/mês-execução/razão social |
| 4 | Extração estruturada de colunas DOM além de chave/número/cancelada | Tomador, prestador, valor, competência da linha: não localizados |
| 5 | Resume de lote a partir da nota N após crash | Só skip se arquivo válido já existe |
| 6 | Agendamento (cron) de competências | Disparo apenas via API/UI |

## Lacunas de integração HTTP / API oficial

| # | Lacuna | Impacto |
|---|--------|---------|
| 7 | Cliente ADN / API oficial Emissor | POC precisa descobrir e implementar fora deste repo |
| 8 | mTLS via `https.Agent` / OpenSSL PEM no Node | Só Playwright `clientCertificates` comprovado no código |
| 9 | Validade de reuso do mesmo PFX em cliente HTTP puro | **Não testado em runtime** nesta auditoria — registrar resultado nos Testes B/C do doc 10 |
| 10 | Uso de `baixarArquivoDireto` (`page.request.get`) | Função existe; **não chamada** no fluxo principal — comportamento em produção NÃO IDENTIFICADO |

## Lacunas de autenticação / sessão

| # | Lacuna | Impacto |
|---|--------|---------|
| 11 | Persistência de sessão/cookies entre runs | Browser efêmero; cada execução reautentica |
| 12 | hCaptcha no login A1 | NÃO IDENTIFICADO — CAPTCHA documentado só no download |
| 13 | Detalhe completo do fluxo credencial vs CAPTCHA | Fora do caminho A1 principal; não aprofundado como o download |

## Lacunas de processos / ops

| # | Lacuna | Impacto |
|---|--------|---------|
| 14 | Fila distribuída / multi-instância | `PQueue` in-process; duas instâncias Node podem conflitar em FS/settings |
| 15 | Garantia de que `suggestedFilename` contém a chave 44 | Naming depende do portal; chave está estável no DOM |
| 16 | Alinhamento mês-execução vs competência filtrada | Pasta pode ser “outubro-2026” mesmo filtrando setembro |

## Perguntas em aberto (para o time / POC)

1. A API oficial ADN cobre **emitidas e recebidas** com o mesmo certificado A1 usado no Emissor Nacional UI?
2. Há limite de rate/quota que impacte >150 downloads/mês?
3. O time quer padronizar pastas futuras em `{cnpj}/{ano}/{mes}` (setting) e migrar o save atual?
4. É aceitável a POC parsear XML e manter índice local (SQLite/JSON) já que o AutoNacional não o faz?
5. Existe pasta de referência “golden” de uma competência real (sem dados sensíveis) para o Teste G?

## Método desta auditoria (limitações)

- Apenas análise estática de código.
- Sem instalação de deps, sem Playwright, sem rede externa, sem certificados reais.
- Afirmações citam arquivo/função/linhas; ausência = **NÃO IDENTIFICADO NO CÓDIGO**, não “inexistente no mundo”.
