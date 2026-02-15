# Frontend AutoNacional

Frontend em Angular 17 com Tailwind CSS para gerenciamento de certificados digitais A1 e automação NFSe.

## 📋 Sobre o Projeto

Este frontend fornece:
- **Tela Empresas** – cadastro unificado de empresas, certificados digitais A1 (.pfx/.p12) e credenciais (CNPJ+senha)
- **Execução** – automação NFSe com seleção de empresas
- **Contabilidades** – gestão de contabilidades parceiras
- **Integração com API REST** do backend Node.js (Express)
- **Design responsivo** usando Tailwind CSS
- **Componentes standalone** do Angular 17

> **Nota:** As telas antigas "Certificados" e "Credenciais" foram descontinuadas. As rotas `/certificados` e `/credenciais` redirecionam para `/empresas`. Veja `docs/FLUXO_EMPRESAS.md` para detalhes.

## 🚀 Instalação Rápida

### 1. Pré-requisitos

- **Node.js 20.9.0+** (recomendado usar nvm)
- **npm 8.0.0+** (vem com Node.js)

### 2. Instalação

```bash
# Clone ou navegue até a pasta Frontend
cd Frontend

# Instale as dependências
npm install

# Inicie o servidor de desenvolvimento
npm start
```

O servidor estará disponível em: **http://localhost:1234**

**Pronto!** 🎉

## 📦 Estrutura do Projeto

```
Frontend/
├── src/
│   ├── app/
│   │   ├── app.component.ts          # Componente raiz
│   │   ├── app.component.html        # Template principal
│   │   ├── app.config.ts             # Configuração da aplicação
│   │   ├── app.routes.ts             # Rotas da aplicação
│   │   ├── components/
│   │   │   └── certificado-upload/   # Componente de upload
│   │   └── services/
│   │       └── certificado.service.ts # Serviço de comunicação com API
│   ├── assets/                        # Arquivos estáticos
│   ├── index.html                    # HTML principal
│   ├── main.ts                       # Entry point
│   └── styles.css                    # Estilos globais
├── angular.json                      # Configuração Angular CLI
├── tailwind.config.js                # Configuração Tailwind CSS
├── tsconfig.json                     # Configuração TypeScript
└── package.json                      # Dependências e scripts
```

## 🎯 Como Usar

### Iniciar Servidor de Desenvolvimento

```bash
npm start
```

O servidor inicia na porta **1234** por padrão.

### Build para Produção

```bash
npm run build
```

Os arquivos compilados estarão em `dist/autonacional-frontend/`

### Executar Testes

```bash
npm test
```

## 🔧 Funcionalidades

### ✅ Tela Empresas (Cadastro Unificado)

- Listagem com busca (CNPJ/razão social), filtros por contabilidade e status (certificado/credenciais)
- Cadastro via **Certificado Digital** (upload PFX) ou **Credencial** (CNPJ+senha)
- Importação em lote: certificados (Preview + Confirmar) e credenciais (planilha xlsx/csv)
- Modal de edição com abas: Dados, Certificado, Credenciais

### ✅ Execução e Contabilidades

- Execução de automação NFSe com seleção de empresas
- Gestão de contabilidades parceiras

### ✅ Design Moderno

- Interface responsiva com Tailwind CSS
- Componentes standalone do Angular 17
- Feedback visual claro (toasts de sucesso/erro)

## 🛠️ Tecnologias

- **Angular 17** - Framework frontend moderno
- **TypeScript** - Linguagem tipada
- **Tailwind CSS** - Framework CSS utility-first
- **RxJS** - Programação reativa
- **Angular CLI** - Ferramentas de desenvolvimento

## 📝 Configuração

### URL do Backend

Por padrão, o frontend se conecta ao backend Node.js em:
```
http://localhost:3000/api
```

Para alterar, edite `src/environments/environment.ts`:

```typescript
apiUrl: 'http://localhost:3000/api'
```

### Porta do Servidor

A porta padrão é **1234**. Para alterar, edite `package.json`:

```json
"start": "ng serve --port 1234"
```

Ou use variável de ambiente:

```bash
PORT=4200 npm start
```

## 🎨 Desenvolvimento

### Criar Novo Componente

```bash
ng generate component nome-do-componente
```

### Criar Novo Serviço

```bash
ng generate service nome-do-servico
```

### Criar Nova Rota

Edite `src/app/app.routes.ts`:

```typescript
export const routes: Routes = [
  { path: 'nova-rota', component: NovoComponente }
];
```

## 🔌 Integração com Backend

O frontend se comunica com o backend Node.js (Express). Principais endpoints:

- `GET /api/empresas` – Listagem com filtros
- `POST /api/empresas/cadastro/certificado` – Upload PFX (multipart)
- `POST /api/empresas/cadastro/credencial` – Cadastro CNPJ+senha
- `POST /api/imports/certificados/preview` e `confirmar`
- `POST /api/imports/credenciais/preview` e `confirmar`

Veja `docs/FLUXO_EMPRESAS.md` para documentação completa do fluxo.

## ⚠️ Troubleshooting

### Erro: "Cannot find module"
```bash
rm -rf node_modules package-lock.json
npm install
```

### Erro: "Port already in use"
```bash
# Use outra porta
ng serve --port 4200
```

### Erro: "Backend não responde"
- Verifique se o backend Node.js está rodando em `http://localhost:3000`
- Verifique se CORS está configurado no backend
- Abra o console do navegador (F12) para ver erros detalhados

### Erro: "Tailwind não está funcionando"
```bash
# Reinstale as dependências
npm install
# Recompile
npm start
```

## 📚 Scripts Disponíveis

| Script | Descrição |
|--------|-----------|
| `npm start` | Inicia servidor de desenvolvimento (porta 1234) |
| `npm run build` | Compila para produção |
| `npm run watch` | Compila e observa mudanças |
| `npm test` | Executa testes unitários |

## 🎯 Estado Atual

- [x] Tela Empresas com cadastro unificado (certificados + credenciais)
- [x] Importação em lote (Preview + Confirmar)
- [x] Execução de automação NFSe via interface
- [x] Gestão de contabilidades
- [ ] Histórico de operações
- [ ] Autenticação de usuários

## 📄 Licença

Uso interno - VinyChagas
