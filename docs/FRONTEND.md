# Frontend - Documentação Técnica

## Visão Geral

SPA (Single Page Application) construída com **Angular 17** usando **Standalone Components**, estilizada com **Tailwind CSS** e com suporte a tema claro/escuro.

- **Porta padrão**: 1234
- **Framework**: Angular 17.3.x
- **Estilização**: Tailwind CSS 3.4.x + SCSS para estilos específicos
- **Gerenciamento de estado**: RxJS (BehaviorSubject, Subject) + Angular Signals
- **Comunicação**: HttpClient → API REST

---

## Estrutura de Diretórios

```
Frontend/
├── src/
│   ├── app/
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   └── layout.component.ts       # Layout principal (sidebar + content)
│   │   │   ├── app-header/
│   │   │   │   └── app-header.component.ts   # Header com busca e info do usuário
│   │   │   ├── home/
│   │   │   │   └── home.component.ts         # Dashboard com KPIs e gráficos
│   │   │   ├── empresas/
│   │   │   │   ├── empresas.component.ts     # Listagem principal de empresas
│   │   │   │   ├── empresa-drawer/           # Drawer lateral para edição rápida
│   │   │   │   ├── empresas-cadastro/        # Modal de cadastro (cert ou cred)
│   │   │   │   ├── empresas-summary-cards/   # Cards de resumo (KPIs)
│   │   │   │   ├── import-certificados-lote-modal/  # Importação em lote de certs
│   │   │   │   ├── import-credenciais-modal/        # Importação de credenciais
│   │   │   │   ├── empresas-validacao-modal/        # Validação em massa
│   │   │   │   └── status.utils.ts           # Cálculos de status (cert, cred, geral)
│   │   │   ├── execucao/
│   │   │   │   └── execucao.component.ts     # Execução de automação NFSe
│   │   │   ├── contabilidades/
│   │   │   │   ├── contabilidades.component.ts      # Listagem de contabilidades
│   │   │   │   └── contabilidade-drawer/            # Drawer de edição
│   │   │   ├── configuracoes/
│   │   │   │   └── configuracoes.component.ts       # Configurações globais
│   │   │   └── shared/
│   │   │       └── toast-container/          # Sistema de notificações toast
│   │   ├── services/
│   │   │   ├── empresas-unificado.service.ts # Serviço central de empresas
│   │   │   ├── execucao.service.ts           # Orquestração de execução NFSe
│   │   │   ├── validacoes.service.ts         # Validação de credenciais
│   │   │   ├── certificado.service.ts        # Gestão de certificados
│   │   │   ├── credenciais.service.ts        # Gestão de credenciais
│   │   │   ├── contabilidade.service.ts      # CRUD contabilidades
│   │   │   ├── settings.service.ts           # Configurações globais
│   │   │   ├── dashboard.service.ts          # Dados do dashboard
│   │   │   ├── execucao-logs.service.ts      # Logs de execução
│   │   │   ├── rentabilidade.service.ts      # Billing summary
│   │   │   ├── theme.service.ts              # Tema (claro/escuro)
│   │   │   ├── sidebar.service.ts            # Estado da sidebar
│   │   │   └── toast.service.ts              # Notificações toast
│   │   ├── models/
│   │   │   ├── empresas-unificado.model.ts   # Interfaces de empresa (listagem, detalhes)
│   │   │   ├── automation-settings.model.ts  # Configurações de automação
│   │   │   ├── billing-summary.model.ts      # Resumo de faturamento
│   │   │   ├── contabilidade.model.ts        # Entidade contabilidade
│   │   │   ├── credenciais.model.ts          # Entidade credencial
│   │   │   ├── empresas.model.ts             # Entidade empresa
│   │   │   ├── execucao-batch-log.model.ts   # Logs de execução em lote
│   │   │   ├── execution-row.model.ts        # Linha de execução na tabela
│   │   │   └── rentabilidade.model.ts        # Modelos de cobrança e cenários
│   │   ├── app.component.ts                  # Componente raiz
│   │   ├── app.config.ts                     # Configuração da aplicação
│   │   └── app.routes.ts                     # Definição de rotas
│   ├── environments/
│   │   ├── environment.ts                    # Desenvolvimento (localhost:4321)
│   │   └── environment.prod.ts               # Produção (relativo /api)
│   ├── assets/                               # Recursos estáticos
│   ├── styles.css                            # Estilos globais + Tailwind directives
│   ├── index.html                            # HTML base
│   └── main.ts                               # Bootstrap da aplicação
├── angular.json                              # Configuração Angular CLI
├── tailwind.config.js                        # Configuração Tailwind CSS
├── postcss.config.js                         # PostCSS plugins
├── tsconfig.json                             # TypeScript base
├── tsconfig.app.json                         # TypeScript para app
├── tsconfig.spec.json                        # TypeScript para testes
└── package.json
```

---

## Rotas da Aplicação

| Rota               | Componente              | Descrição                              |
| ------------------ | ----------------------- | -------------------------------------- |
| `/`                | redirect → `/home`      | Redirecionamento para dashboard        |
| `/home`            | HomeComponent           | Dashboard com KPIs e gráficos          |
| `/empresas`        | EmpresasComponent       | Gestão unificada de empresas           |
| `/certificados`    | redirect → `/empresas`  | Rota legada                            |
| `/credenciais`     | redirect → `/empresas`  | Rota legada                            |
| `/execucao`        | ExecucaoComponent       | Execução de automação NFSe             |
| `/contabilidades`  | ContabilidadesComponent | CRUD de contabilidades                 |
| `/configuracoes`   | ConfiguracoesComponent  | Configurações de automação             |

Todas as rotas filhas do `LayoutComponent` (sidebar + header + router outlet).

---

## Componentes Detalhados

### `LayoutComponent`
- **Função**: Layout principal da aplicação
- **Estrutura**: sidebar colapsável à esquerda + área de conteúdo com header
- **Animações**: transições de rota com Angular Animations
- **Responsividade**: sidebar colapsa em telas menores

### `HomeComponent` (Dashboard)
- **KPIs**: total de empresas, certificados vencidos, credenciais para validar, operacionais
- **Gráficos**: Chart.js via ng2-charts (barras, rosca)
- **Alertas**: lista de ações pendentes

### `EmpresasComponent` (Tela Principal)
- **Listagem**: tabela com filtros, busca, ordenação e paginação
- **Seleção múltipla**: checkboxes para ações em lote (excluir, validar)
- **Filtros**: contabilidade, status de certificado, status de credencial, sem método
- **Summary Cards**: 4 cards de KPI acima da tabela
- **Ações**: cadastrar, importar em lote, validar em massa

### `EmpresaDrawerComponent`
- **Função**: drawer lateral para edição rápida de empresa
- **Tabs**: contabilidade, certificado, credenciais
- **Features**: upload/remoção de certificado, habilitar/desabilitar credencial
- **Dirty check**: detecta mudanças não salvas

### `EmpresasCadastroComponent`
- **Modal**: cadastro de nova empresa
- **Métodos**: via certificado digital (.pfx/.p12) OU credencial (CNPJ/CPF + senha)
- **Extração automática**: dados do certificado (CNPJ, razão social, validade)

### `ImportCertificadosLoteModalComponent`
- **Importação em lote**: arrastar/selecionar múltiplos .pfx/.p12
- **Pré-visualização**: tabela com CNPJ, empresa, validade, status
- **Senha padrão**: campo para senha compartilhada
- **Validação**: verifica se certificado é válido antes de importar

### `ImportCredenciaisModalComponent`
- **Importação via planilha**: .xlsx/.csv com colunas CNPJ, CPF, Senha
- **Preview**: tabela com validação inline
- **Seleção**: escolher quais linhas importar
- **Contabilidade**: atribuir contabilidade às credenciais importadas

### `EmpresasValidacaoModalComponent`
- **Validação em massa**: testar credenciais no portal NFSe
- **Escopo**: selecionadas, filtradas ou todas
- **Modo**: headless ou visível
- **Progresso**: barra de progresso em tempo real via polling

### `ExecucaoComponent`
- **Filtro por contabilidade**: selecionar contabilidade
- **Período**: mês/ano de início e fim
- **Tipo**: emitidas, recebidas ou ambas
- **Execução em lote**: selecionar empresas e executar fila
- **Acompanhamento**: status em tempo real por empresa
- **Relatórios**: exportar resultado em PDF ou CSV

### `ContabilidadesComponent`
- **CRUD**: criar, editar, excluir contabilidades
- **Informações**: nome, CNPJ, email, telefone, responsável
- **Contagem**: número de empresas vinculadas

### `ConfiguracoesComponent`
- **Formulário reativo**: configurações de automação
- **Campos**: headless, timeouts, concorrência, viewport, paths
- **File System Access API**: seleção de diretório para downloads
- **Persistência**: salva no backend (Settings no banco)

---

## Serviços

### `EmpresasUnificadoService`
Serviço central para toda a tela de empresas:
- `listarEmpresas(filtros)`: listagem com filtros
- `obterDetalhes(id)`: detalhes completos
- `cadastrarComCertificado(form)`: cadastro via certificado
- `cadastrarComCredencial(form)`: cadastro via credencial
- `importarCertificadosLote(files, senha)`: importação em lote
- `importarCredenciais(dados)`: importação via planilha
- `excluirEmpresas(ids)`: exclusão em massa

### `ExecucaoService`
Orquestração da execução NFSe:
- `executar(empresaId, periodo, tipo)`: inicia execução
- `executarLote(empresaIds, periodo, tipo)`: execução em lote
- `obterStatus(executionId)`: polling de status
- `gerarRelatorioPDF(resultados)`: exportação PDF
- `gerarRelatorioCSV(resultados)`: exportação CSV

### `ValidacoesService`
Validação de credenciais:
- `iniciarValidacao(config)`: inicia job de validação
- `obterProgresso(jobId)`: streaming de progresso
- `cancelar(jobId)`: cancela job em andamento

### `ThemeService`
- Alterna entre modo claro e escuro
- Persiste preferência em `localStorage`
- Aplica classe `dark` no `<html>`

### `ToastService`
- `success(mensagem)`, `error(mensagem)`, `warning(mensagem)`, `info(mensagem)`
- Exibe notificações temporárias no canto da tela
- Auto-dismiss configurável

---

## Models/Interfaces

### `EmpresaListagemItem`
```typescript
interface EmpresaListagemItem {
  id: number;
  cnpj: string;
  razao_social: string;
  contabilidade_nome: string | null;
  certificado_validade: string | null;
  credencial_status: string | null;
  credencial_tipo: string | null;
}
```

### `AutomationSettings`
```typescript
interface AutomationSettings {
  headless: boolean;
  company_timeout_seconds: number;
  max_retries_per_step: number;
  max_concurrent_browsers: number;
  viewport_preset: string;
  downloads_base_path: string;
  downloads_pattern: string;
  log_level: string;
  // ... mais campos
}
```

---

## Scripts npm

| Script          | Comando                          | Descrição                        |
| --------------- | -------------------------------- | -------------------------------- |
| `npm start`     | `ng serve --port 1234`           | Dev server com hot reload        |
| `npm run build` | `ng build`                       | Build de desenvolvimento         |
| `npm run build:prod` | `ng build --configuration production` | Build de produção     |
| `npm run watch` | `ng build --watch --configuration development` | Build com watch   |
| `npm test`      | `ng test`                        | Testes unitários (Karma/Jasmine) |
| `npm run lint`  | `ng lint`                        | Linting                         |

---

## Configuração Angular

### `angular.json`
- **Builder**: `@angular-devkit/build-angular:application`
- **Output**: `dist/autonacional-frontend`
- **Polyfills**: `zone.js`
- **Budgets**: initial max 2MB (warning 500KB), component styles max 16KB (warning 6KB)
- **Environments**: `environment.ts` (dev) → `environment.prod.ts` (prod)

### `tailwind.config.js`
- **Content**: `./src/**/*.{html,ts}`
- **Dark mode**: `class` (via ThemeService)
- **Plugins**: nenhum

### `tsconfig.json`
- **Target**: ES2022
- **Module**: ES2022
- **Strict**: true
- **Angular Compiler**: strictTemplates, strictInjectionParameters

---

## Integração com Backend

### Environments

**Desenvolvimento** (`environment.ts`):
```typescript
export const environment = {
  production: false,
  apiUrl: 'http://localhost:4321/api',
};
```

**Produção** (`environment.prod.ts`):
```typescript
export const environment = {
  production: true,
  apiUrl: '/api',
};
```

### Padrão de Chamada

```typescript
@Injectable({ providedIn: 'root' })
export class ExemploService {
  private apiUrl = `${environment.apiUrl}/recurso`;

  constructor(private http: HttpClient) {}

  listar(): Observable<Recurso[]> {
    return this.http.get<Recurso[]>(this.apiUrl);
  }

  criar(dados: CriarPayload): Observable<Recurso> {
    return this.http.post<Recurso>(this.apiUrl, dados);
  }
}
```

---

## Sistema de Status

### Status de Certificado
| Status            | Descrição                              | Cor      |
| ----------------- | -------------------------------------- | -------- |
| `VÁLIDO`          | Certificado dentro da validade         | Verde    |
| `VENCENDO`        | Vence em menos de 30 dias              | Amarelo  |
| `VENCIDO`         | Certificado expirado                   | Vermelho |
| `SEM_CERTIFICADO` | Empresa sem certificado cadastrado     | Cinza    |

### Status de Credencial
| Status          | Descrição                              | Cor      |
| --------------- | -------------------------------------- | -------- |
| `OK`            | Credencial validada com sucesso        | Verde    |
| `INVALIDA`      | Login/senha incorretos                 | Vermelho |
| `BLOQUEADA`     | Conta bloqueada no portal              | Vermelho |
| `NAO_TESTADO`   | Credencial ainda não validada          | Cinza    |

### Status Geral da Empresa
| Status         | Descrição                                     | Cor      |
| -------------- | --------------------------------------------- | -------- |
| `OPERACIONAL`  | Cert válido OU credencial OK                  | Verde    |
| `PARCIAL`      | Tem métodos mas parcialmente inválidos        | Amarelo  |
| `ATENCAO`      | Certificado vencendo ou credencial não testada| Amarelo  |
| `INOPERANTE`   | Sem método válido de acesso                   | Vermelho |

---

## Tema (Dark Mode)

O tema é controlado pelo `ThemeService`:
- Classe `dark` no elemento `<html>`
- CSS Variables para cores customizadas
- Tailwind `dark:` prefixo para estilos condicionais
- Persistência em `localStorage('theme')`
