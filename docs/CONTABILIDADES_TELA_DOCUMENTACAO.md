# Documentação da Tela de Contabilidades

Tela para gestão das contabilidades parceiras vinculadas ao sistema. CRUD completo com drawer lateral.

---

## Índice

1. [Visão geral](#visão-geral)
2. [Estrutura da interface](#estrutura-da-interface)
3. [Arquivos do componente](#arquivos-do-componente)
4. [Funcionalidades](#funcionalidades)
5. [API e modelos](#api-e-modelos)

---

## Visão geral

A tela **Contabilidades** centraliza o cadastro e edição de contabilidades parceiras, que são utilizadas como vínculo em empresas e certificados.

**Rota da aplicação:** `/contabilidades`

**Entidades gerenciadas:**
- Nome da contabilidade
- CNPJ (obrigatório, único)
- Email, telefone, responsável (opcionais)
- Contagem de empresas vinculadas

---

## Estrutura da interface

### Layout

| Elemento | Descrição |
|----------|-----------|
| **Header** | Título "Contabilidades", subtítulo e botão "Nova Contabilidade" |
| **Tabela** | Colunas: Nome, CNPJ, Empresas vinculadas, Ações (Editar, Excluir) |
| **Drawer lateral** | Abre ao criar ou editar; formulário com campos da contabilidade |
| **Modal de exclusão** | Confirmação antes de excluir |

### Drawer

- **Modo criar:** campos vazios
- **Modo editar:** campos preenchidos (CNPJ não editável)

---

## Arquivos do componente

| Arquivo | Descrição |
|---------|-----------|
| `Frontend/src/app/components/contabilidades/contabilidades.component.ts` | Listagem, CRUD, controle do drawer |
| `Frontend/src/app/components/contabilidades/contabilidades.component.html` | Template principal + modal |
| `Frontend/src/app/components/contabilidades/contabilidades.component.scss` | Estilos |
| `Frontend/src/app/components/contabilidades/contabilidade-drawer/contabilidade-drawer.component.ts` | Formulário do drawer |
| `Frontend/src/app/components/contabilidades/contabilidade-drawer/contabilidade-drawer.component.html` | Template do drawer |
| `Frontend/src/app/components/contabilidades/contabilidade-drawer/contabilidade-drawer.component.scss` | Estilos do drawer |

---

## Funcionalidades

| Ação | Descrição |
|------|-----------|
| **Listar** | Tabela com todas as contabilidades |
| **Criar** | Botão "Nova Contabilidade" → abre drawer → salva via API |
| **Editar** | Ícone de edição na linha → abre drawer com dados |
| **Excluir** | Ícone de exclusão → modal de confirmação → chama API |

### Validações no drawer

- **Nome:** obrigatório, mínimo 3 caracteres
- **CNPJ:** obrigatório (apenas no criar), 14 dígitos
- **Email, telefone, responsável:** opcionais

---

## API e modelos

### ContabilidadeService

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `listar()` | GET /api/contabilidades | Lista todas as contabilidades |
| `obterPorId(id)` | GET /api/contabilidades/:id | Detalhes de uma contabilidade |
| `criar(dados)` | POST /api/contabilidades | Nova contabilidade |
| `atualizar(id, dados)` | PUT /api/contabilidades/:id | Atualiza contabilidade |
| `excluir(id)` | DELETE /api/contabilidades/:id | Remove contabilidade |

### Modelos (`contabilidade.model.ts`)

```typescript
interface Contabilidade {
  id: number;
  nome_contabilidade: string;
  cnpj: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
  data_cadastro?: string;
  certificados_vinculados?: number;
  empresas_vinculadas_count?: number;
}

interface ContabilidadeCreate {
  nome_contabilidade: string;
  cnpj: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
}

interface ContabilidadeUpdate {
  nome_contabilidade?: string;
  email?: string;
  telefone?: string;
  responsavel?: string;
}
```

### Formato de resposta (listar)

```json
{
  "contabilidades": [
    {
      "id": 1,
      "nome_contabilidade": "Contabilidade Alpha",
      "cnpj": "12345678000199",
      "email": "contato@alpha.com",
      "empresas_vinculadas_count": 12
    }
  ],
  "total": 1
}
```

---

## Integração com outras telas

As contabilidades são referenciadas em:

- **Empresas:** filtro por contabilidade, vínculo ao cadastrar empresa
- **Importação de certificados/credenciais:** seleção obrigatória de contabilidade por linha ou padrão

---

*Documentação gerada em fevereiro/2025 – Projeto AutoNacional*
