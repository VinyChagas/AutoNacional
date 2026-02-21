# Dependências do Projeto

## Backend

### Dependências de Produção

| Pacote                          | Versão   | Descrição                                                |
| ------------------------------- | -------- | -------------------------------------------------------- |
| `express`                       | ^4.22.1  | Framework web HTTP para criação da API REST              |
| `cors`                          | ^2.8.6   | Middleware de Cross-Origin Resource Sharing               |
| `dotenv`                        | ^17.3.1  | Carrega variáveis de ambiente de arquivo `.env`          |
| `@prisma/client`                | ^7.4.0   | Cliente ORM Prisma para acesso ao banco PostgreSQL       |
| `@prisma/adapter-pg`            | ^7.4.0   | Adapter Prisma para PostgreSQL nativo                    |
| `@prisma/adapter-better-sqlite3`| ^7.4.0   | Adapter Prisma para SQLite (desenvolvimento local)       |
| `prisma`                        | ^7.4.0   | CLI e engine do Prisma (migrações, geração de cliente)   |
| `pg`                            | ^8.18.0  | Driver PostgreSQL para Node.js                           |
| `postgres`                      | ^3.4.8   | Cliente PostgreSQL alternativo (postgres.js)             |
| `better-sqlite3`                | ^12.6.2  | Driver SQLite3 nativo (desenvolvimento local)            |
| `@supabase/supabase-js`         | ^2.95.3  | SDK JavaScript do Supabase (Storage, Auth)               |
| `playwright`                    | ^1.58.2  | Automação de navegador (Chromium) para portal NFSe       |
| `node-forge`                    | ^1.3.3   | Criptografia e manipulação de certificados PKCS#12       |
| `pino`                          | ^10.3.1  | Logger JSON estruturado de alta performance              |
| `multer`                        | ^2.0.2   | Middleware para upload de arquivos (multipart/form-data)  |
| `xlsx`                          | ^0.18.5  | Parser de planilhas Excel (.xlsx) e CSV                  |
| `zod`                           | ^4.3.6   | Validação e parsing de schemas TypeScript-first          |
| `p-queue`                       | ^9.1.0   | Fila de promessas com controle de concorrência           |

### Dependências de Desenvolvimento

| Pacote                    | Versão   | Descrição                                          |
| ------------------------- | -------- | -------------------------------------------------- |
| `typescript`              | ^5.9.3   | Compilador TypeScript                              |
| `ts-node-dev`             | ^2.0.0   | Executor TypeScript com hot reload                 |
| `@types/express`          | ^4.17.21 | Tipos TypeScript para Express                      |
| `@types/cors`             | ^2.8.19  | Tipos TypeScript para cors                         |
| `@types/multer`           | ^2.0.0   | Tipos TypeScript para Multer                       |
| `@types/node`             | ^25.2.3  | Tipos TypeScript para Node.js                      |
| `@types/node-forge`       | ^1.3.14  | Tipos TypeScript para node-forge                   |
| `@types/better-sqlite3`   | ^7.6.13  | Tipos TypeScript para better-sqlite3               |

---

## Frontend

### Dependências de Produção

| Pacote                            | Versão   | Descrição                                         |
| --------------------------------- | -------- | ------------------------------------------------- |
| `@angular/core`                   | ^17.3.0  | Core do framework Angular                         |
| `@angular/common`                 | ^17.3.0  | Módulos comuns (HttpClient, pipes, directives)    |
| `@angular/forms`                  | ^17.3.0  | Formulários reativos e template-driven            |
| `@angular/router`                 | ^17.3.0  | Sistema de rotas SPA                              |
| `@angular/platform-browser`       | ^17.3.0  | Plataforma browser (DOM rendering)                |
| `@angular/platform-browser-dynamic`| ^17.3.0 | Bootstrap dinâmico (JIT compilation)              |
| `@angular/animations`             | ^17.3.0  | Sistema de animações Angular                      |
| `rxjs`                            | ~7.8.0   | Programação reativa (Observables, operadores)     |
| `tslib`                           | ^2.3.0   | Helpers runtime para TypeScript                   |
| `zone.js`                         | ~0.14.3  | Zone tracking para change detection do Angular    |
| `chart.js`                        | ^4.5.1   | Biblioteca de gráficos (barras, rosca, linha)     |
| `ng2-charts`                      | ^5.0.4   | Wrapper Angular para Chart.js                     |
| `jspdf`                           | ^3.0.4   | Geração de documentos PDF no browser              |
| `jspdf-autotable`                 | ^5.0.2   | Plugin jsPDF para geração de tabelas em PDF       |
| `xlsx`                            | ^0.18.5  | Parser/gerador de planilhas Excel no browser      |

### Dependências de Desenvolvimento

| Pacote                            | Versão   | Descrição                                         |
| --------------------------------- | -------- | ------------------------------------------------- |
| `@angular-devkit/build-angular`   | ^17.3.17 | Build tools Angular (Webpack/esbuild)             |
| `@angular/cli`                    | ^17.3.17 | Angular CLI (ng serve, ng build, etc.)            |
| `@angular/compiler`               | ^17.3.0  | Compilador de templates Angular                   |
| `@angular/compiler-cli`           | ^17.3.0  | CLI do compilador Angular                         |
| `typescript`                      | ~5.4.2   | Compilador TypeScript                             |
| `tailwindcss`                     | ^3.4.18  | Framework CSS utility-first                       |
| `postcss`                         | ^8.5.6   | Processador CSS (necessário pelo Tailwind)        |
| `autoprefixer`                    | ^10.4.21 | Adiciona vendor prefixes CSS automaticamente      |
| `jasmine-core`                    | ~5.1.0   | Framework de testes unitários                     |
| `karma`                           | ~6.4.0   | Test runner para testes unitários                 |
| `karma-chrome-launcher`           | ~3.2.0   | Launcher Chrome para Karma                        |
| `karma-coverage`                  | ~2.2.0   | Plugin de cobertura de código                     |
| `karma-jasmine`                   | ~5.1.0   | Adapter Jasmine para Karma                        |
| `karma-jasmine-html-reporter`     | ~2.1.0   | Reporter HTML para Jasmine                        |
| `@types/jasmine`                  | ~5.1.0   | Tipos TypeScript para Jasmine                     |
| `@types/jspdf`                    | ^1.3.3   | Tipos TypeScript para jsPDF                       |

---

## Compatibilidade de Versões

### Angular 17.3.x — Matriz de Compatibilidade

| Dependência          | Versão Compatível | Notas                              |
| -------------------- | ----------------- | ---------------------------------- |
| TypeScript           | ~5.4.x            | Angular 17 suporta TS 5.2-5.4     |
| RxJS                 | ~7.8.x            | Requerido pelo Angular 17          |
| Zone.js              | ~0.14.x           | Requerido pelo Angular 17          |
| Node.js              | 18.x ou 20.x      | Angular 17 suporta Node 18+       |

### Prisma 7.4.x — Compatibilidade

| Dependência          | Versão Compatível | Notas                              |
| -------------------- | ----------------- | ---------------------------------- |
| Node.js              | 18.x+             | Prisma 7 requer Node 18+          |
| PostgreSQL           | 12+               | Todas as versões recentes          |
| TypeScript           | 5.x               | Compatível com TS 5+              |

### Playwright 1.58.x — Compatibilidade

| Dependência          | Versão Compatível | Notas                              |
| -------------------- | ----------------- | ---------------------------------- |
| Node.js              | 18.x+             | Playwright requer Node 18+        |
| Chromium             | Instalado via CLI  | `npx playwright install chromium`  |

---

## Notas Importantes

### p-queue (ESM)
O `p-queue` v8+ é um pacote **ESM-only**. O projeto usa `commonjs` como module system no TypeScript, portanto pode ser necessário usar `dynamic import`:
```typescript
const { default: PQueue } = await import('p-queue');
```

### xlsx (Licenciamento)
O pacote `xlsx` (SheetJS Community Edition) é licenciado sob Apache 2.0. Para uso comercial avançado, considere a versão Pro.

### Playwright (Browsers)
Após `npm install`, é necessário instalar os browsers separadamente:
```bash
npx playwright install chromium
```
Em Linux, também pode ser necessário instalar dependências do sistema:
```bash
npx playwright install-deps
```
