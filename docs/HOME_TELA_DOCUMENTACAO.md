# Documentação da Tela Home (Dashboard)

Tela inicial do sistema com visão geral operacional. KPIs, gráficos e alertas para gestão do ambiente NFSe.

---

## Índice

1. [Visão geral](#visão-geral)
2. [Estrutura da interface](#estrutura-da-interface)
3. [Arquivos do componente](#arquivos-do-componente)
4. [Dados e serviços](#dados-e-serviços)
5. [API do Dashboard](#api-do-dashboard)

---

## Visão geral

A tela **Home** exibe um dashboard operacional com:

- **KPIs principais**: empresas operacionais, total de empresas, certificados vencendo, credenciais inválidas
- **Gráficos**: execuções por dia (barras), distribuição por regime tributário (pizza)
- **Métricas operacionais**: execuções no mês, taxa de sucesso, notas encontradas, erros
- **Alertas acionáveis**: empresas sem método, certificados vencidos, empresas não validadas (links para `/empresas`)

**Rota da aplicação:** `/` (raiz) ou `/home`

---

## Estrutura da interface

### Seções (de cima para baixo)

| Seção | Descrição |
|-------|-----------|
| **Título + Filtro** | Saudação "Olá, Usuário 👋", subtítulo e dropdown de período (Hoje, 7 dias, 30 dias, Mês) |
| **KPIs principais (4 cards)** | Empresas Operacionais, Total de Empresas, Certificados Vencendo, Credenciais Inválidas, com variação % vs período anterior |
| **Gráficos (2 colunas)** | Gráfico de barras (Execuções nos últimos 7 dias) + gráfico de pizza (Empresas por Regime Tributário) |
| **Métricas operacionais (4 cards)** | Total de Execuções no Mês, Taxa de Sucesso, Notas Encontradas, Erros no Mês |
| **Alertas (3 cards)** | Empresas sem método, Certificados Vencidos, Empresas não validadas há +7 dias (clicáveis → `/empresas`) |

### Cards de alerta

Os cards de alerta são clicáveis e redirecionam para `/empresas`, permitindo ações corretivas rápidas.

---

## Arquivos do componente

| Arquivo | Descrição |
|---------|-----------|
| `Frontend/src/app/components/home/home.component.ts` | Lógica, estado, gráficos (Chart.js via ng2-charts) |
| `Frontend/src/app/components/home/home.component.html` | Template com skeleton loading e animações |
| `Frontend/src/app/components/home/home.component.scss` | Estilos do dashboard |

### Dependências

- **NgChartsModule** (ng2-charts) – gráficos de barras e pizza
- **ThemeService** – suporte a tema claro/escuro nos gráficos
- **DashboardService** – dados do backend ou mock

---

## Dados e serviços

### DashboardService

| Método | Descrição |
|--------|-----------|
| `getResumo(period)` | Resumo geral (KPIs, métricas, alertas) |
| `getExecucoes(period)` | Execuções por dia para gráfico de barras |
| `getDistribuicaoRegime()` | Distribuição por regime tributário para gráfico pizza |

**Períodos:** `1d`, `7d`, `30d`, `1m`

O serviço possui fallback para dados mock quando a API não está disponível (`setUseMock(true)`).

---

## API do Dashboard

**Base URL:** `GET /api/dashboard`

| Rota | Descrição |
|------|-----------|
| `GET /resumo?period=30d` | Resumo com KPIs e métricas |
| `GET /execucoes?period=7d` | Execuções por dia |
| `GET /distribuicao-regime` | Quantidade de empresas por regime tributário |

### Resposta do resumo (`DashboardResumo`)

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `empresas_total` | number | Total de empresas cadastradas |
| `empresas_operacionais` | number | Empresas com certificado válido ou credenciais OK |
| `empresas_operacionais_variacao` | number? | Variação % vs período anterior |
| `certificados_vencendo` | number | Certificados próximos do vencimento |
| `credenciais_invalidas` | number | Credenciais com status inválido |
| `execucoes_mes` | number | Total de execuções no mês |
| `taxa_sucesso` | number | % de sucesso nas execuções |
| `notas_encontradas` | number | Quantidade de notas processadas |
| `erros_mes` | number | Erros no mês |
| `empresas_sem_metodo` | number? | Empresas sem certificado nem credenciais |
| `certificados_vencidos` | number? | Certificados já vencidos |
| `empresas_nao_validadas` | number? | Sem validação há mais de 7 dias |

### Execução por dia (`ExecucaoPorDia`)

| Campo | Tipo |
|-------|------|
| `data` | string (ISO) |
| `total` | number |
| `sucesso` | number |
| `erro` | number |

### Distribuição regime (`DistribuicaoRegime`)

| Campo | Tipo |
|-------|------|
| `regime` | string |
| `quantidade` | number |

---

*Documentação gerada em fevereiro/2025 – Projeto AutoNacional*
