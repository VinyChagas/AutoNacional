# Checklist de Testes Manuais - Tela Empresas

Este documento descreve como validar cada funcionalidade implementada na tela de Empresas.

## 1) Exclusão em Massa

### Pré-requisitos
- Ter pelo menos 2-3 empresas cadastradas.

### Passos
1. Acesse a tela **Empresas** (`/empresas`).
2. Verifique a **coluna de checkbox** na primeira coluna da tabela.
3. Marque o **checkbox do header** → todas as linhas da página devem ser selecionadas.
4. Desmarque o checkbox do header → seleção deve limpar.
5. Selecione 2 empresas manualmente (checkbox de cada linha).
6. Verifique a **barra de ações** acima da tabela:
   - Texto "X selecionados" (ex: "2 selecionados").
   - Botão "Excluir selecionados".
   - Botão "Limpar seleção".
7. Clique em **Excluir selecionados**.
8. Deve abrir o **modal de confirmação**:
   - Mensagem: "Tem certeza que deseja excluir X empresa(s)? Isso removerá certificados e credenciais vinculadas."
   - Botões: Cancelar / Confirmar exclusão.
9. Clique em **Cancelar** → modal fecha, seleção mantida.
10. Clique novamente em Excluir selecionados → Confirmar exclusão.
11. Após exclusão:
    - Toast de sucesso exibido.
    - Seleção limpa.
    - Listagem recarregada (empresas removidas).
12. Verifique que certificados e credenciais vinculados foram removidos (consultar banco ou tela de detalhes).

---

## 2) Ordenação por Coluna

### Passos
1. Acesse a tela **Empresas**.
2. Clique no header **CNPJ**:
   - 1º clique: ordenação ASC (crescente).
   - 2º clique: ordenação DESC (decrescente).
   - 3º clique: remove ordenação (volta ao padrão).
3. Repita para **Razão Social**, **Contabilidade**, **Certificado**, **Credenciais**, **Status**.
4. Verifique o **ícone** ao lado do nome da coluna:
   - ↕ quando não ordenada.
   - ↑ quando ASC.
   - ↓ quando DESC.
5. A ordenação deve ser aplicada após recarregar (requisição à API).

---

## 3) Botão Validar + Modal

### Passos
1. Acesse a tela **Empresas**.
2. Clique no botão **✅ Validar**.
3. Modal "Validação de Cadastros" deve abrir.

### Seção A - O que validar
4. Marque **Certificados digitais** e/ou **Credenciais**.
5. Pelo menos um deve estar marcado para o botão "Iniciar validação" ficar habilitado.
6. Sem nenhum marcado → botão desabilitado.

### Seção B - Escopo
7. Se houver seleção (checkboxes na tabela): opção "Somente empresas selecionadas (X)" deve aparecer.
8. Opções: Selecionadas / Filtradas / Todas.
9. Selecione "Todas as empresas filtradas".

### Seção C - Avançado
10. Clique em "▶ Avançado" → painel expande.
11. Verifique: Concorrência (1/2/4/8), Timeout (s), Parar após X erros.

### Seção D - Iniciar
12. Verifique o **resumo** (ex: "Validar Certificados e Credenciais em Todas as empresas filtradas.").
13. Clique em **Iniciar validação**.
14. Modal fecha.
15. Toast "Validação iniciada!".
16. **Painel de progresso** aparece acima da tabela:
    - "Processando N/M | OK: x | Erros: y"
    - Barra de progresso preenchendo.
17. Aguarde conclusão (ou simule com poucas empresas).
18. Ao final: toast de conclusão, listagem recarregada.

---

## 4) Status Geral da Empresa

### Passos
1. Acesse a tela **Empresas**.
2. Verifique a coluna **Status** (nova coluna).
3. Badges esperados:
   - **Operacional** (verde): tem cert válido OU cred OK.
   - **Parcial** (amarelo): tem métodos mas parcialmente inválidos.
   - **Inoperante** (vermelho): sem método válido.
4. Passe o mouse sobre o badge → **tooltip** com motivo (ex: "Certificado vencido e credenciais inválidas").

---

## 5) Filtro "Sem Método"

### Passos
1. Acesse a tela **Empresas**.
2. Na barra de filtros, verifique os novos checkboxes:
   - **Sem certificado**
   - **Sem credenciais**
   - **Sem nenhum método** (atalho: ambos)
3. Marque **Sem certificado** → listar apenas empresas sem certificado.
4. Marque **Sem credenciais** → listar apenas empresas sem credenciais.
5. Marque **Sem nenhum método** → listar empresas que não têm nem certificado nem credenciais.
6. Tente marcar ao mesmo tempo **Com certificado** e **Sem certificado** → API deve retornar erro 400 com mensagem clara.

---

## Resumo de Endpoints Utilizados

| Método | Endpoint | Uso |
|--------|----------|-----|
| GET | `/api/empresas?sort=&order=&sem_cert=&sem_cred=&sem_metodo=` | Listagem com filtros e ordenação |
| DELETE | `/api/empresas` (body: `{ ids: number[] }`) | Exclusão em massa |
| POST | `/api/validacoes/start` | Iniciar validação |
| GET | `/api/validacoes/:job_id` | Status do job (polling) |
| POST | `/api/validacoes/:job_id/cancel` | Cancelar job |

---

## Observações

- Backend em `http://localhost:4321` (verificar `Frontend/src/environments/environment.ts`).
- Validação de credenciais usa Playwright para teste de login no portal NFSe; pode falhar se o portal estiver indisponível ou com estrutura alterada.
- Jobs de validação são em memória; ao reiniciar o servidor, jobs ativos são perdidos.
