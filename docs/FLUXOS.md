# Fluxos de Negócio

## Visão Geral dos Fluxos

O AutoNacional opera em torno de 5 fluxos principais:

1. **Cadastro de Empresas** — via certificado digital ou credencial
2. **Importação em Lote** — certificados e credenciais via planilhas
3. **Validação de Credenciais** — teste automatizado no portal NFSe
4. **Execução de Automação** — download de notas fiscais (XML/PDF)
5. **Gestão de Contabilidades** — organização de empresas por escritório

---

## 1. Cadastro de Empresa via Certificado Digital

```
Usuário seleciona arquivo .pfx/.p12
    │
    ▼
Frontend extrai informações do certificado
(CNPJ, Razão Social, Validade) via API
    │
    ▼
Usuário preenche senha do certificado
    │
    ▼
POST /api/certificados/upload
    │
    ▼
Backend:
  1. Valida o certificado (node-forge)
  2. Extrai dados (CNPJ, empresa, validade)
  3. Cria/atualiza empresa no banco (Prisma)
  4. Criptografa senha (AES-256-CBC)
  5. Faz upload do .pfx para Supabase Storage
  6. Salva metadados no banco
    │
    ▼
Empresa cadastrada com certificado vinculado
```

### Validações
- Arquivo deve ser .pfx ou .p12 válido
- Senha deve desbloquear o certificado
- CNPJ extraído do certificado
- Se empresa já existe (mesmo CNPJ), atualiza o certificado

---

## 2. Cadastro de Empresa via Credencial

```
Usuário preenche formulário:
  - CNPJ da empresa
  - Razão Social
  - Tipo: CNPJ_SENHA ou CPF_SENHA
  - Usuário (CNPJ ou CPF)
  - Senha
    │
    ▼
POST /api/empresas + POST /api/credenciais
    │
    ▼
Backend:
  1. Cria empresa no banco
  2. Criptografa senha (AES-256-CBC)
  3. Salva credencial com status NAO_TESTADO
    │
    ▼
Empresa cadastrada com credencial vinculada
```

---

## 3. Importação em Lote de Certificados

```
Usuário arrasta/seleciona múltiplos .pfx/.p12
    │
    ▼
POST /api/certificados/preview-lote
    │
    ▼
Backend extrai info de cada certificado
Retorna preview (CNPJ, empresa, validade, status)
    │
    ▼
Usuário revisa a lista:
  - Define senha padrão
  - Remove certificados indesejados
  - Seleciona contabilidade
    │
    ▼
POST /api/certificados/upload-lote
    │
    ▼
Backend processa cada certificado:
  1. Valida com a senha fornecida
  2. Cria/atualiza empresa
  3. Upload para Storage
  4. Salva metadados
    │
    ▼
Resultado: X importados, Y erros, Z já existentes
```

---

## 4. Importação de Credenciais via Planilha

```
Usuário seleciona planilha (.xlsx/.csv)
    │
    ▼
POST /api/imports/credenciais/preview
    │
    ▼
Backend:
  1. Lê planilha (xlsx parser)
  2. Mapeia colunas (CNPJ, CPF, Senha)
  3. Valida cada linha
  4. Retorna preview
    │
    ▼
Usuário revisa no modal:
  - Seleciona linhas para importar
  - Define contabilidade
  - Verifica erros de validação
    │
    ▼
POST /api/imports/credenciais
    │
    ▼
Backend processa cada linha:
  1. Cria empresa (se não existir)
  2. Criptografa senha
  3. Salva credencial (status NAO_TESTADO)
    │
    ▼
Resultado: X importados, Y erros
```

### Formato da Planilha Esperado

| CNPJ              | CPF          | Senha       |
| ----------------- | ------------ | ----------- |
| 12.345.678/0001-99| 123.456.789-00| minha-senha |
| 98.765.432/0001-88| 987.654.321-00| outra-senha |

---

## 5. Validação de Credenciais em Massa

```
Usuário abre modal de validação:
  - Seleciona escopo (selecionadas / filtradas / todas)
  - Escolhe modo (headless / visível)
  - Define concorrência e timeout
    │
    ▼
POST /api/validacoes/start
    │
    ▼
Backend:
  1. Cria job de validação
  2. Para cada empresa (em paralelo, conforme concorrência):
     a. Descriptografa credencial
     b. Abre Playwright (Chromium)
     c. Navega ao portal NFSe
     d. Tenta login com CNPJ/CPF + senha
     e. Verifica resultado (OK, INVALIDA, BLOQUEADA)
     f. Atualiza status no banco
     g. Fecha browser
    │
    ▼
Frontend faz polling: GET /api/validacoes/:job_id
    │
    ▼
Exibe progresso em tempo real:
  - Barra de progresso
  - Contador: Processando N/M | OK: x | Erros: y
    │
    ▼
Ao concluir: toast de conclusão, listagem recarregada
```

### Status Possíveis de Credencial Após Validação

| Status      | Significado                                    |
| ----------- | ---------------------------------------------- |
| `OK`        | Login realizado com sucesso                    |
| `INVALIDA`  | Senha incorreta ou usuário não encontrado      |
| `BLOQUEADA` | Conta bloqueada após tentativas excessivas     |
| `ERRO`      | Erro técnico (timeout, portal indisponível)    |

---

## 6. Execução de Automação NFSe

```
Usuário configura execução:
  - Seleciona contabilidade (filtra empresas)
  - Define período (mês/ano início e fim)
  - Tipo: emitidas, recebidas ou ambas
  - Seleciona empresas para executar
    │
    ▼
Para cada empresa: POST /api/execucao/:empresa_id
    │
    ▼
Backend (ExecutionService):
  1. Cria registro de execução (status: pendente)
  2. Adiciona à fila p-queue
  3. Quando a vez chega:
     │
     ▼
  4. Carrega certificado do Supabase Storage
     (certificate-loader → download → temp/)
     │
     ▼
  5. Cria contexto Playwright com certificado A1
     (playwright-nfse → autenticação SSL cliente)
     │
     ▼
  6. Navega ao portal NFSe autenticado
     │
     ▼
  7. Para cada competência (mês/ano):
     a. Acessa aba de notas emitidas
     b. Varre tabela de notas (com paginação)
     c. Para cada nota: download XML + PDF
     d. Acessa aba de notas recebidas (se aplicável)
     e. Repete varredura e downloads
     │
     ▼
  8. Organiza downloads:
     downloads/{cnpj}/{ano}/{mes}/emitidas/
     downloads/{cnpj}/{ano}/{mes}/recebidas/
     │
     ▼
  9. Atualiza registro no banco:
     - Status: concluido/erro
     - Contagens: qtd_notas_emitidas, qtd_notas_recebidas
     - Mensagem de resultado
     │
     ▼
  10. Fecha browser

Frontend faz polling periódico:
  GET /api/execucao/:id/status
    │
    ▼
Exibe em tempo real:
  - Status por empresa (ícone + cor)
  - Etapa atual (autenticando, processando, baixando...)
  - Progresso (%)
  - Contagem de notas
    │
    ▼
Ao concluir todas as empresas:
  - Botão para gerar relatório (PDF/CSV)
  - Resumo: total executado, sucessos, erros
```

### Etapas da Execução

| Etapa                | Descrição                           | Progresso |
| -------------------- | ----------------------------------- | --------- |
| `inicio`             | Aguardando na fila                  | 0%        |
| `carregando_cert`    | Baixando certificado do Storage     | 10%       |
| `autenticando`       | Abrindo browser e autenticando      | 20%       |
| `navegando`          | Navegando para competência          | 30%       |
| `processando_notas`  | Varrendo tabela de notas            | 30-90%    |
| `baixando`           | Downloading XMLs e PDFs             | 90%       |
| `finalizando`        | Fechando browser e salvando         | 95%       |
| `concluido`          | Execução finalizada com sucesso     | 100%      |
| `erro`               | Execução falhou                     | -         |

---

## 7. Gestão de Contabilidades

```
CRUD simples:
  - Listar contabilidades (com contagem de empresas)
  - Criar nova contabilidade (nome, CNPJ, email, telefone, responsável)
  - Editar contabilidade
  - Excluir contabilidade (empresas perdem vínculo, não são excluídas)

Uso principal:
  - Organizar empresas por escritório de contabilidade
  - Filtrar empresas por contabilidade na tela de Empresas
  - Filtrar por contabilidade na tela de Execução
  - Atribuir contabilidade durante importação em lote
```

---

## 8. Fluxo de Relatórios

### Relatório PDF (pós-execução)

```
Usuário clica "Gerar PDF" na tela de Execução
    │
    ▼
Frontend (jsPDF + jsPDF-autotable):
  1. Monta cabeçalho (data, período, contabilidade)
  2. Monta tabela de resultados por empresa
  3. Gera PDF local
  4. Inicia download automático
```

### Relatório CSV (pós-execução)

```
Usuário clica "Exportar CSV"
    │
    ▼
Frontend (xlsx):
  1. Monta planilha com resultados
  2. Gera arquivo .csv
  3. Inicia download automático
```

---

## 9. Fluxo de Configurações

```
Usuário acessa /configuracoes
    │
    ▼
GET /api/settings → carrega configurações atuais
    │
    ▼
Usuário ajusta formulário:
  - Headless (sim/não)
  - Timeout por empresa
  - Concorrência máxima de browsers
  - Diretório de downloads
  - Nível de log
  - etc.
    │
    ▼
PUT /api/settings → salva no banco
    │
    ▼
Configurações aplicadas na próxima execução
```
