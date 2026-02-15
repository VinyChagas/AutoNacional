# Fluxo de Cadastro Unificado: Empresas

**Versão:** Fev/2026

## Resumo

As telas antigas **Certificados** e **Credenciais** foram unificadas na nova tela **Empresas**. Todas as operações de cadastro e gestão de empresas, certificados digitais e credenciais acontecem em um único lugar.

## Rotas e Redirecionamentos

| Rota antiga   | Status      | Redirecionamento |
|---------------|-------------|------------------|
| `/certificados` | Descontinuada | Redireciona para `/empresas` |
| `/credenciais`  | Descontinuada | Redireciona para `/empresas` |
| `/empresas`     | **Ativa**     | Tela principal de cadastro unificado |

**Compatibilidade:** Links internos ou bookmarks para `/certificados` e `/credenciais` continuam funcionando — o usuário é automaticamente redirecionado para `/empresas`.

## Menu de Navegação

O menu superior foi simplificado:

- **Home** – Página inicial
- **Empresas** – Cadastro unificado (certificados + credenciais)
- **Execução** – Automação NFSe
- **Contabilidades** – Gestão de contabilidades
- **Configurações** – Configurações do sistema

Os itens "Certificados" e "Credenciais" foram removidos do menu.

## Funcionalidades na Tela Empresas

### 1. Listagem

- Busca por CNPJ ou Razão Social
- Filtro por contabilidade
- Toggles:
  - Com certificado
  - Com credenciais
  - Certificado vencido

### 2. Cadastro

- **Certificado Digital** – Upload de PFX/P12 + senha
- **Credencial** – CNPJ + Razão Social + senha (login CNPJ_SENHA)

### 3. Importação em Lote

- **Importar Certificados** – Fluxo Preview + Confirmar (arquivos .pfx/.p12)
- **Importar Credenciais** – Fluxo Preview + Confirmar (planilha .xlsx/.csv com colunas cnpj, razao_social, senha)

### 4. Edição

Modal com abas:

- **Dados** – Razão social, regime, contabilidade
- **Certificado** – Adicionar ou visualizar certificados
- **Credenciais** – Adicionar ou atualizar credenciais

## Integração com API

A tela Empresas usa o `EmpresasUnificadoService`, que consome:

- `GET /api/empresas` – Listagem com filtros
- `GET /api/empresas/:id` – Detalhes com certificados e credenciais
- `PUT /api/empresas/:id` – Atualização de dados
- `POST /api/empresas/cadastro/certificado` – Cadastro via PFX (multipart)
- `POST /api/empresas/cadastro/credencial` – Cadastro via CNPJ+senha
- `POST /api/imports/certificados/preview` e `confirmar`
- `POST /api/imports/credenciais/preview` e `confirmar`

## Componentes Descontinuados

Os componentes `CertificadoUploadComponent` e `CredenciaisComponent` **não são mais carregados** pelas rotas, mas os arquivos permanecem no projeto por compatibilidade temporária. Os serviços `CertificadoService` e `CredenciaisService` continuam disponíveis para o módulo de **Execução**, que ainda os utiliza para listar certificados e credenciais na seleção de empresas para automação.
