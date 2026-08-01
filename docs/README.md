# AutoNacional - Documentação Completa

> Sistema de automação para download e processamento de Notas Fiscais de Serviço Eletrônicas (NFSe) com gestão de certificados digitais e credenciais.

---

## Visão Geral

O **AutoNacional** é uma plataforma completa para automação de processos contábeis relacionados a NFSe. O sistema permite:

- **Gestão de Empresas**: cadastro, edição e organização por contabilidade
- **Certificados Digitais A1**: upload, validação, monitoramento de validade (.pfx/.p12)
- **Credenciais de Acesso**: cadastro seguro (criptografia AES-256-CBC) de login/senha para portais
- **Importação em Lote**: certificados e credenciais via planilhas Excel/CSV
- **Automação NFSe**: download automatizado de XMLs e PDFs via Playwright (Chromium)
- **Validação em Massa**: teste de credenciais em lote com acompanhamento em tempo real
- **Dashboard**: KPIs, gráficos e alertas sobre o estado das empresas
- **Relatórios**: geração de relatórios em PDF e CSV

---

## Stack Tecnológica

| Camada       | Tecnologia                          | Versão   |
| ------------ | ----------------------------------- | -------- |
| Frontend     | Angular (Standalone Components)     | 17.3.x   |
| Estilização  | Tailwind CSS                        | 3.4.x    |
| Backend      | Node.js + Express + TypeScript      | 18+      |
| ORM          | Prisma                              | 7.4.x    |
| Banco        | PostgreSQL (Supabase)               | 15+      |
| Storage      | Supabase Storage                    | -        |
| Automação    | Playwright (Chromium)               | 1.58.x   |
| Criptografia | AES-256-CBC (node-forge / crypto)   | -        |
| Logging      | Pino                                | 10.x     |
| Validação    | Zod                                 | 4.x      |

---

## Índice da Documentação

| Documento                                            | Descrição                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| [SETUP.md](./SETUP.md)                               | Guia completo de instalação e configuração                   |
| [ARQUITETURA.md](./ARQUITETURA.md)                   | Visão geral da arquitetura do sistema                        |
| [BACKEND.md](./BACKEND.md)                           | Documentação técnica do Backend                              |
| [FRONTEND.md](./FRONTEND.md)                         | Documentação técnica do Frontend                             |
| [API_REFERENCE.md](./API_REFERENCE.md)               | Referência completa dos endpoints da API                     |
| [BANCO_DE_DADOS.md](./BANCO_DE_DADOS.md)             | Schema do banco de dados (Prisma/PostgreSQL)                 |
| [VARIAVEIS_AMBIENTE.md](./VARIAVEIS_AMBIENTE.md)     | Referência de variáveis de ambiente                          |
| [FLUXOS.md](./FLUXOS.md)                             | Fluxos de negócio e automação                                |
| [AUTOMACAO_NFSE.md](./AUTOMACAO_NFSE.md)             | Funcionamento completo da automação (individual e filas)     |
| [TELA_EXECUCAO_E_AUTOMACAO.md](./TELA_EXECUCAO_E_AUTOMACAO.md) | Tela Execução + correlação com `Backend/src/automation` |
| [CENTRAL_CAPTCHAS.md](./CENTRAL_CAPTCHAS.md)             | Central Manual de Captchas (Socket.IO + providers)       |
| [DIAGNOSTICO_CENTRAL_CAPTCHA.md](./DIAGNOSTICO_CENTRAL_CAPTCHA.md) | Diagnóstico da falha do token manual + instrumentação |
| [DEPENDENCIAS.md](./DEPENDENCIAS.md)                 | Lista e descrição de todas as dependências                   |
| [TELA_EMPRESAS.md](./TELA_EMPRESAS.md)                       | Documentação completa da tela de Empresas (UI + API) |
| [CHECKLIST_TESTES_EMPRESAS.md](./CHECKLIST_TESTES_EMPRESAS.md) | Checklist de testes manuais da tela de Empresas    |

---

## Estrutura do Repositório

```
AutoNacional/
├── Backend/                    # API Node.js/Express/TypeScript
│   ├── src/                    # Código fonte
│   │   ├── automation/         # Scripts Playwright (NFSe)
│   │   ├── config/             # Configurações (env, supabase)
│   │   ├── db/                 # Cliente Prisma e seeds
│   │   ├── infrastructure/     # Logger, crypto, config
│   │   ├── middleware/         # Express middlewares
│   │   ├── modules/            # Módulos (certificados, credenciais, imports)
│   │   ├── repositories/      # Camada de acesso a dados
│   │   ├── routers/           # Rotas da API REST
│   │   ├── services/          # Lógica de negócio
│   │   ├── utils/             # Utilitários
│   │   └── main.ts            # Ponto de entrada
│   ├── prisma/                # Schema e migrações Prisma
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── Frontend/                   # SPA Angular 17
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/    # Componentes Angular
│   │   │   ├── services/      # Serviços HTTP e estado
│   │   │   ├── models/        # Interfaces TypeScript
│   │   │   └── app.routes.ts  # Rotas da aplicação
│   │   ├── environments/      # Configurações de ambiente
│   │   ├── assets/            # Recursos estáticos
│   │   └── styles.css         # Estilos globais
│   ├── package.json
│   ├── angular.json
│   ├── tailwind.config.js
│   └── tsconfig.json
└── docs/                       # Documentação (este diretório)
```

---

## Quick Start

```bash
# 1. Clonar o repositório
git clone <url-do-repositorio>
cd AutoNacional

# 2. Backend
cd Backend
cp .env.example .env          # Editar com suas credenciais
npm install
npx prisma generate           # Gerar cliente Prisma
npx prisma db push             # Aplicar schema ao banco
npx playwright install chromium # Instalar navegador
npm run dev                    # Iniciar em modo desenvolvimento

# 3. Frontend (em outro terminal)
cd Frontend
npm install
npm start                      # http://localhost:1234
```

> Para instruções detalhadas, consulte [SETUP.md](./SETUP.md).

---

## Licença

UNLICENSED - Uso privado.
