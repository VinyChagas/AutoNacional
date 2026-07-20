/**
 * Relatório diagnóstico de interação com a API do 2captcha.
 *
 * Gera arquivos em Backend/logs/2captcha-report/ para enviar ao suporte do
 * fornecedor (chave mascarada). Cobre:
 *  1) solicitação com parâmetros do captcha
 *  2) código/script usado (referência + payload real)
 *  3) site onde o captcha está sendo resolvido
 *  + como a solução é submetida no site de destino
 */

import * as fs from 'fs';
import * as path from 'path';
import { BACKEND_DIR, TWOCAPTCHA_API_KEY, TWOCAPTCHA_API_VERSION, CAPTCHA_IS_INVISIBLE, CAPTCHA_MODE, CAPTCHA_SOLVE_TIMEOUT_MS } from '../infrastructure/config';
import { getLogger } from '../infrastructure/logger';

const logger = getLogger('captcha-report');

const REPORT_DIR = path.join(BACKEND_DIR, 'logs', '2captcha-report');

let sessionId = '';
let sessionStartedAt = '';
let eventos: Array<Record<string, unknown>> = [];
let tentativaAtual = 0;

export function mascararChave(key: string): string {
  if (!key || key.length < 10) return '***';
  return `${key.slice(0, 4)}…${key.slice(-4)} (len=${key.length})`;
}

function agoraIso(): string {
  return new Date().toISOString();
}

function caminhoEventosJsonl(): string {
  return path.join(REPORT_DIR, `session-${sessionId}-events.jsonl`);
}

function caminhoRelatorioMd(): string {
  return path.join(REPORT_DIR, `session-${sessionId}-RELATORIO.md`);
}

function caminhoUltimoJson(): string {
  return path.join(REPORT_DIR, 'ultimo-evento.json');
}

function escreverArquivo(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function appendJsonl(obj: Record<string, unknown>): void {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.appendFileSync(caminhoEventosJsonl(), `${JSON.stringify(obj)}\n`, 'utf8');
}

function regenerarMarkdown(): void {
  const chaveMask = mascararChave(TWOCAPTCHA_API_KEY);
  const lines: string[] = [];

  lines.push('# Relatório diagnóstico — integração 2captcha (hCaptcha)');
  lines.push('');
  lines.push('Documento gerado automaticamente pelo AutoNacional para o suporte do 2captcha.');
  lines.push('**A chave de API completa NÃO está incluída neste arquivo.**');
  lines.push('');
  lines.push(`- Session ID: \`${sessionId}\``);
  lines.push(`- Início da sessão: ${sessionStartedAt}`);
  lines.push(`- Última atualização: ${agoraIso()}`);
  lines.push('');
  lines.push('## Checklist do fornecedor');
  lines.push('');
  lines.push('### 1) Solicitação com valores dos parâmetros do captcha');
  lines.push('');
  lines.push('Além deste relatório, anexe uma captura de tela de:');
  lines.push('https://2captcha.com/statistics/uploads');
  lines.push('');
  lines.push('Os eventos abaixo trazem `sitekey`, `pageurl`/`websiteURL`, `taskId` e respostas da API.');
  lines.push('');
  lines.push('### 2) Código / script usado para chamar a API');
  lines.push('');
  lines.push('- Arquivo: `Backend/src/automation/captcha-solver.ts`');
  lines.push(`- API version configurada: \`${TWOCAPTCHA_API_VERSION}\``);
  lines.push('- Endpoint v2 createTask: `https://api.2captcha.com/createTask`');
  lines.push('- Endpoint v2 getTaskResult: `https://api.2captcha.com/getTaskResult`');
  lines.push('- Endpoint v1 in: `https://2captcha.com/in.php`');
  lines.push('- Endpoint v1 res: `https://2captcha.com/res.php`');
  lines.push('');
  lines.push('Payload típico **API v2 Enterprise (sem proxy)** enviado pela aplicação:');
  lines.push('```json');
  lines.push(JSON.stringify({
    clientKey: chaveMask,
    task: {
      type: 'HCaptchaTaskProxyless',
      websiteURL: '<pageurl capturado do navegador>',
      websiteKey: '<sitekey capturado do widget>',
      isInvisible: CAPTCHA_IS_INVISIBLE,
      userAgent: '<navigator.userAgent do Playwright>',
      enterprisePayload: {
        rqdata: '<rqdata capturado do hCaptcha Enterprise>',
      },
    },
  }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('> **rqdata é opcional.** Quando existir valor real, envia-se `enterprisePayload.rqdata`.');
  lines.push('> Quando não for encontrado, a propriedade deve ser **omitida** (nunca `""`, `null` ou `c.req`).');
  lines.push('');
  lines.push('Payload típico **API v1**:');
  lines.push('```json');
  lines.push(JSON.stringify({
    key: chaveMask,
    method: 'hcaptcha',
    sitekey: '<sitekey>',
    pageurl: '<pageurl>',
    json: 1,
  }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('### 3) Site onde o captcha está sendo resolvido');
  lines.push('');
  lines.push('- Portal: **NFSe Nacional (Emissor Nacional)**');
  lines.push('- Domínio: `https://www.nfse.gov.br`');
  lines.push('- Páginas típicas: `/EmissorNacional/Notas/Emitidas` e `/EmissorNacional/Notas/Recebidas`');
  lines.push('- Modal: "VALIDAÇÃO DE USUÁRIO" com widget hCaptcha ("Sou humano")');
  lines.push('- Confirmação no site: botão `#btnSubmitHCaptcha` ("Confirmar")');
  lines.push('');
  lines.push('### Submissão da solução no site de destino');
  lines.push('');
  lines.push('Após receber o token do 2captcha, a aplicação:');
  lines.push('1. Injeta o token em `textarea[name="h-captcha-response"]` e `g-recaptcha-response`');
  lines.push('2. Clica em `#btnSubmitHCaptcha`');
  lines.push('3. Aguarda o evento de download do arquivo (XML/PDF)');
  lines.push('');
  lines.push('## Configuração da sessão');
  lines.push('');
  lines.push(`- API key (mascarada): \`${chaveMask}\``);
  lines.push(`- TWOCAPTCHA_API_VERSION: \`${TWOCAPTCHA_API_VERSION}\``);
  lines.push(`- CAPTCHA_IS_INVISIBLE: \`${CAPTCHA_IS_INVISIBLE}\``);
  lines.push(`- CAPTCHA_MODE: \`${CAPTCHA_MODE}\``);
  lines.push(`- CAPTCHA_SOLVE_TIMEOUT_MS: \`${CAPTCHA_SOLVE_TIMEOUT_MS}\``);
  lines.push('');
  lines.push('## Eventos desta sessão');
  lines.push('');

  if (eventos.length === 0) {
    lines.push('_Nenhuma tentativa de resolução ainda. Execute um download que abra o modal de captcha._');
  } else {
    for (const ev of eventos) {
      lines.push(`### Evento #${ev.seq} — ${ev.type}`);
      lines.push('');
      lines.push(`- Horário: ${ev.at}`);
      lines.push('```json');
      lines.push(JSON.stringify(ev, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  lines.push('## Arquivos gerados');
  lines.push('');
  lines.push(`- Relatório (este arquivo): \`${caminhoRelatorioMd()}\``);
  lines.push(`- Eventos (JSONL): \`${caminhoEventosJsonl()}\``);
  lines.push(`- Último evento: \`${caminhoUltimoJson()}\``);
  lines.push('');

  escreverArquivo(caminhoRelatorioMd(), lines.join('\n'));
}

/**
 * Inicia uma sessão de relatório ao subir o backend.
 * Cria a pasta e um relatório inicial pronto para o suporte.
 */
export function iniciarRelatorio2Captcha(): string {
  const ts = new Date();
  sessionId = [
    ts.getFullYear(),
    String(ts.getMonth() + 1).padStart(2, '0'),
    String(ts.getDate()).padStart(2, '0'),
    '-',
    String(ts.getHours()).padStart(2, '0'),
    String(ts.getMinutes()).padStart(2, '0'),
    String(ts.getSeconds()).padStart(2, '0'),
  ].join('');
  sessionStartedAt = agoraIso();
  eventos = [];
  tentativaAtual = 0;

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  regenerarMarkdown();

  const md = caminhoRelatorioMd();
  logger.info(
    { reportDir: REPORT_DIR, reportFile: md },
    'Relatório diagnóstico 2captcha iniciado (chave mascarada)'
  );
  return md;
}

export function getRelatorio2CaptchaPath(): string {
  return sessionId ? caminhoRelatorioMd() : '';
}

function registrarEvento(type: string, data: Record<string, unknown>): void {
  if (!sessionId) {
    iniciarRelatorio2Captcha();
  }
  const ev = {
    seq: eventos.length + 1,
    at: agoraIso(),
    sessionId,
    type,
    ...data,
  };
  eventos.push(ev);
  appendJsonl(ev);
  escreverArquivo(caminhoUltimoJson(), JSON.stringify(ev, null, 2));
  regenerarMarkdown();
  logger.info({ type, seq: ev.seq }, 'Evento 2captcha registrado no relatório');
}

/** Início de uma tentativa (sitekey/pageurl/rqdata capturados do portal). */
export function reportCaptchaDetectado(dados: {
  sitekey: string;
  pageurl: string;
  userAgent?: string;
  rqdata?: string;
}): void {
  tentativaAtual += 1;
  registrarEvento('captcha_detected', {
    tentativa: tentativaAtual,
    targetSite: 'https://www.nfse.gov.br',
    websiteURL: dados.pageurl,
    websiteKey: dados.sitekey,
    sitekey: dados.sitekey,
    pageurl: dados.pageurl,
    userAgent: dados.userAgent,
    hasRqdata: Boolean(dados.rqdata),
    rqdataLength: dados.rqdata?.length ?? 0,
    rqdataPrefix: dados.rqdata ? `${dados.rqdata.slice(0, 16)}…` : null,
    apiVersion: TWOCAPTCHA_API_VERSION,
    isInvisible: CAPTCHA_IS_INVISIBLE,
  });
}

/** Request enviado à API (v1 ou v2), com chave mascarada. */
export function reportApiRequest(dados: {
  apiVersion: 'v1' | 'v2';
  endpoint: string;
  body: Record<string, unknown>;
}): void {
  const body = JSON.parse(JSON.stringify(dados.body)) as Record<string, unknown>;
  if (typeof body.clientKey === 'string') {
    body.clientKey = mascararChave(body.clientKey);
  }
  if (typeof body.key === 'string') {
    body.key = mascararChave(body.key);
  }
  // Não grava rqdata completo no relatório (pode ser longo/sensível) — só prefixo/tamanho
  const task = body.task as Record<string, unknown> | undefined;
  const ep = task?.enterprisePayload as Record<string, unknown> | undefined;
  if (ep && typeof ep.rqdata === 'string') {
    const rq = ep.rqdata;
    ep.rqdata = `${rq.slice(0, 16)}… (len=${rq.length})`;
  }
  if (typeof body.rqdata === 'string') {
    const rq = body.rqdata;
    body.rqdata = `${rq.slice(0, 16)}… (len=${rq.length})`;
  }
  if (typeof body.data === 'string' && body.data.length > 40) {
    const d = body.data;
    body.data = `${d.slice(0, 16)}… (len=${d.length})`;
  }
  registrarEvento('api_request', {
    tentativa: tentativaAtual,
    apiVersion: dados.apiVersion,
    endpoint: dados.endpoint,
    requestBody: body,
  });
}

/** Resposta recebida da API. */
export function reportApiResponse(dados: {
  apiVersion: 'v1' | 'v2';
  endpoint: string;
  response: unknown;
  elapsedMs?: number;
}): void {
  registrarEvento('api_response', {
    tentativa: tentativaAtual,
    apiVersion: dados.apiVersion,
    endpoint: dados.endpoint,
    response: dados.response,
    elapsedMs: dados.elapsedMs,
  });
}

/** Token recebido (apenas tamanho / prefixo, nunca o token completo). */
export function reportTokenRecebido(dados: {
  apiVersion: 'v1' | 'v2';
  taskId?: string | number;
  tokenLength: number;
  tokenPrefix: string;
}): void {
  registrarEvento('token_received', {
    tentativa: tentativaAtual,
    apiVersion: dados.apiVersion,
    taskId: dados.taskId,
    tokenLength: dados.tokenLength,
    tokenPrefix: `${dados.tokenPrefix}…`,
  });
}

/** Como a solução foi submetida no site NFSe. */
export function reportSolucaoSubmetidaNoSite(dados: {
  pageurl: string;
  camposInjetados: string[];
  botaoConfirmacao: string;
  sucesso: boolean;
  erro?: string;
}): void {
  registrarEvento('solution_submitted_to_target_site', {
    tentativa: tentativaAtual,
    targetSite: 'https://www.nfse.gov.br',
    pageurl: dados.pageurl,
    camposInjetados: dados.camposInjetados,
    botaoConfirmacao: dados.botaoConfirmacao,
    sucesso: dados.sucesso,
    erro: dados.erro,
  });
}

/** Falha na resolução. */
export function reportCaptchaFalha(dados: {
  etapa: string;
  erro: string;
}): void {
  registrarEvento('captcha_failed', {
    tentativa: tentativaAtual,
    etapa: dados.etapa,
    erro: dados.erro,
  });
}
