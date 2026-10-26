/**
 * API-02Y — diagnóstico/correção do timeout de ~60s por navegação.
 *
 * Cobre a confirmação de rota em `aguardarRotaOuSeletor` e o retry em
 * `clicarMenuNotasEAguardar`, provando que a espera resolve pela CONDIÇÃO REAL
 * (rota na URL OU #datainicio no DOM) e só consome o timeout máximo em falha real.
 *
 * Restrição atendida: nenhum browser/Playwright real é acionado (fakes puros).
 */
import { describe, expect, it, vi } from 'vitest';
import { aguardarRotaOuSeletor, clicarMenuNotasEAguardar } from './playwright-nav';
import type { Locator, Page } from 'playwright';

interface FakePageState {
  /** Retorna a URL atual. Recebe o nº de polls já executados. */
  url: (polls: number) => string;
  /** Retorna o count() do readySelector. Recebe o nº de polls já executados. */
  count: (polls: number) => number;
}

/**
 * Page falsa determinística. Um contador de "polls" é incrementado a cada
 * `waitForTimeout` (uma iteração do laço), permitindo simular navegação
 * imediata, lenta ou ausente de forma previsível.
 */
function criarFakePage(state: FakePageState): {
  page: Page;
  waitForTimeout: ReturnType<typeof vi.fn>;
} {
  let polls = 0;
  const waitForTimeout = vi.fn(async () => {
    polls += 1;
  });

  const locator = {
    first: () => locator,
    count: vi.fn(async () => state.count(polls)),
  } as unknown as Locator;

  const page = {
    isClosed: () => false,
    context: () => ({ browser: () => ({ isConnected: () => true }) }),
    url: () => state.url(polls),
    locator: () => locator,
    waitForTimeout,
  } as unknown as Page;

  return { page, waitForTimeout };
}

const ROTA = 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas';
const DASH = 'https://www.nfse.gov.br/EmissorNacional/Inicio';

describe('API-02Y — aguardarRotaOuSeletor', () => {
  it('navegação imediata: rota correta + #datainicio presente → via=imediato, sem polling', async () => {
    const { page, waitForTimeout } = criarFakePage({
      url: () => `${ROTA}?x=1`,
      count: () => 1,
    });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      timeout: 60000,
    });
    expect(r.via).toBe('imediato');
    expect(r.rotaOk).toBe(true);
    expect(r.timedOut).toBe(false);
    expect(waitForTimeout).not.toHaveBeenCalled();
  });

  it('rota correta COM query string resolve na hora (antes o glob travava 60s)', async () => {
    const { page } = criarFakePage({
      url: () => `${ROTA}?executar=1&datainicio=01%2F08%2F2026`,
      count: () => 1,
    });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      timeout: 60000,
    });
    expect(r.via).toBe('imediato');
    expect(r.rotaOk).toBe(true);
  });

  it('navegação lenta: rota só aparece após 3 polls → resolve via rota, sem estourar timeout', async () => {
    const { page, waitForTimeout } = criarFakePage({
      url: (p) => (p >= 3 ? ROTA : DASH),
      count: () => 0,
    });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      timeout: 60000,
      intervaloMs: 1,
    });
    expect(r.rotaOk).toBe(true);
    expect(r.via).toBe('rota');
    expect(r.timedOut).toBe(false);
    expect(waitForTimeout).toHaveBeenCalled();
  });

  it('resolve via seletor quando #datainicio aparece antes da rota', async () => {
    const { page } = criarFakePage({
      url: () => DASH,
      count: (p) => (p >= 2 ? 1 : 0),
    });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      timeout: 60000,
      intervaloMs: 1,
    });
    expect(r.seletorOk).toBe(true);
    expect(r.via).toBe('seletor');
  });

  it('timeout real: nem rota nem seletor → via=timeout, timedOut=true (proteção preservada)', async () => {
    const { page } = criarFakePage({ url: () => DASH, count: () => 0 });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      timeout: 5,
      intervaloMs: 1,
    });
    expect(r.via).toBe('timeout');
    expect(r.timedOut).toBe(true);
    expect(r.rotaOk).toBe(false);
    expect(r.seletorOk).toBe(false);
  });

  it('API-02Z: URL de Recebidas com #datainicio NÃO confirma navegação para Emitidas', async () => {
    const RECEBIDAS = 'https://www.nfse.gov.br/EmissorNacional/Notas/Recebidas?executar=1';
    const { page } = criarFakePage({ url: () => RECEBIDAS, count: () => 1 });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      urlSubstringsProibidas: ['/Notas/Recebidas'],
      timeout: 5,
      intervaloMs: 1,
    });
    // Seletor presente, mas rota é a direção errada → não pode confirmar.
    expect(r.rotaOk).toBe(false);
    expect(r.seletorOk).toBe(false);
    expect(r.via).toBe('timeout');
    expect(r.timedOut).toBe(true);
  });

  it('API-02Z: URL de Emitidas com #datainicio NÃO confirma navegação para Recebidas', async () => {
    const EMITIDAS = 'https://www.nfse.gov.br/EmissorNacional/Notas/Emitidas?executar=1';
    const { page } = criarFakePage({ url: () => EMITIDAS, count: () => 1 });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Recebidas',
      readySelector: '#datainicio',
      urlSubstringsProibidas: ['/Notas/Emitidas'],
      timeout: 5,
      intervaloMs: 1,
    });
    expect(r.rotaOk).toBe(false);
    expect(r.seletorOk).toBe(false);
    expect(r.via).toBe('timeout');
    expect(r.timedOut).toBe(true);
  });

  it('API-02Z: rota correta confirma mesmo com a proibida configurada', async () => {
    const { page } = criarFakePage({ url: () => `${ROTA}?executar=1`, count: () => 1 });
    const r = await aguardarRotaOuSeletor(page, {
      urlSubstring: '/Notas/Emitidas',
      readySelector: '#datainicio',
      urlSubstringsProibidas: ['/Notas/Recebidas'],
      timeout: 60000,
    });
    expect(r.via).toBe('imediato');
    expect(r.rotaOk).toBe(true);
  });
});

/** menu falso: conta os cliques. */
function criarMenuFake(): Locator & { cliques: number } {
  const menu = {
    cliques: 0,
    click: vi.fn(async () => {
      menu.cliques += 1;
    }),
  } as unknown as Locator & { cliques: number };
  return menu;
}

describe('API-02Y — clicarMenuNotasEAguardar', () => {
  it('sucesso na 1ª tentativa clica o menu uma única vez', async () => {
    const { page } = criarFakePage({ url: () => ROTA, count: () => 1 });
    const menu = criarMenuFake();
    await clicarMenuNotasEAguardar(page, menu, 'Emitidas', { timeout: 60000 });
    expect(menu.cliques).toBe(1);
  });

  it('retentativa: só confirma após o 2º clique → clica duas vezes e retorna', async () => {
    const menu = criarMenuFake();
    // Rota/seletor só aparecem depois do 2º clique do menu.
    const { page } = criarFakePage({
      url: () => (menu.cliques >= 2 ? ROTA : DASH),
      count: () => (menu.cliques >= 2 ? 1 : 0),
    });
    await clicarMenuNotasEAguardar(page, menu, 'Emitidas', { timeout: 3 });
    expect(menu.cliques).toBe(2);
  });

  it('falha real nas duas tentativas lança erro (timeout máximo respeitado)', async () => {
    const { page } = criarFakePage({ url: () => DASH, count: () => 0 });
    const menu = criarMenuFake();
    await expect(
      clicarMenuNotasEAguardar(page, menu, 'Emitidas', { timeout: 2 })
    ).rejects.toThrow(/não confirmada/);
    expect(menu.cliques).toBe(2);
  });
});
