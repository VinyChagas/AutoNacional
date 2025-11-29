# 🔧 Troubleshooting - Problemas Comuns no Download

Este documento lista os problemas mais comuns durante a execução da automação de downloads e suas soluções.

## 📋 Problemas Identificados e Soluções

### 1. ❌ Erro: "Link não encontrado no contexto específico"

**Sintoma:**
```
ValueError: Link não encontrado no contexto específico com seletor: a[href*="/EmissorNacional/Notas/Download/NFSe/"]
```

**Causa Possível:**
- O menu suspenso não está visível quando o código tenta buscar o link
- O seletor está incorreto ou o contexto do menu foi perdido
- O menu foi fechado antes de buscar o link

**Solução:**
1. Verificar se o menu está realmente aberto antes de buscar o link
2. Adicionar um `wait_for` para garantir que o menu está visível
3. Verificar se o seletor está correto usando o script de diagnóstico

**Código Corrigido:**
```python
# Aguarda o menu estar visível ANTES de buscar links
menu_suspenso.wait_for(state='visible', timeout=3000)

# Verifica se o menu está realmente visível
if not menu_suspenso.first.is_visible():
    raise Exception("Menu suspenso não está visível")
```

---

### 2. ❌ Erro: "Menu suspenso não está visível"

**Sintoma:**
```
ValueError: Menu suspenso não está visível. Seletor: .menu-suspenso-tabela a[href*="..."]
```

**Causa Possível:**
- O menu foi fechado antes do código tentar usá-lo
- O menu não abriu corretamente após clicar no ícone
- Há múltiplos menus abertos e o código está pegando o errado

**Solução:**
1. Garantir que apenas um menu está aberto por vez
2. Fechar menus anteriores antes de abrir um novo
3. Adicionar um delay após clicar no ícone

**Código Corrigido:**
```python
# Fecha qualquer menu aberto antes de abrir um novo
try:
    menu_aberto = page.locator('.menu-suspenso-tabela:visible').first
    if menu_aberto.count() > 0:
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
except:
    pass

# Clica no ícone
icone_acoes.click()
page.wait_for_timeout(300)  # Aguarda menu abrir

# Aguarda menu aparecer
menu_suspenso.wait_for(state='visible', timeout=3000)
```

---

### 3. ❌ Erro: "Erro na requisição HTTP. Status: 404"

**Sintoma:**
```
Exception: Erro na requisição HTTP. Status: 404, URL: http://...
```

**Causa Possível:**
- O href extraído está incorreto ou relativo
- A URL não foi montada corretamente com `urljoin`
- A sessão expirou

**Solução:**
1. Verificar se o href está completo
2. Verificar se a URL base está correta
3. Verificar se a sessão ainda está válida

**Código de Debug:**
```python
logger.debug(f"Href extraído: {href}")
logger.debug(f"URL atual da página: {current_url}")
logger.debug(f"URL completa montada: {full_url}")
```

---

### 4. ❌ Erro: "competencia é obrigatória"

**Sintoma:**
```
ValueError: competencia é obrigatória para baixar arquivos
```

**Causa Possível:**
- A competência não foi extraída corretamente da tabela
- A competência está vazia ou None

**Solução:**
1. Verificar se a competência está sendo extraída corretamente
2. Adicionar fallback para extrair da linha da tabela

**Código Corrigido:**
```python
# Se competencia não foi fornecida, tenta extrair da linha
if not competencia:
    celulas_temp = row_locator.locator("td")
    competencia_texto = celulas_temp.nth(2).inner_text()
    competencia = competencia_texto.strip()
```

---

### 5. ❌ Erro: "Arquivo não foi criado"

**Sintoma:**
```
❌ Arquivo não foi criado!
   Caminho esperado: /path/to/file.xml
```

**Causa Possível:**
- Permissões de escrita insuficientes
- Caminho muito longo (Windows)
- Disco cheio
- Pasta pai não existe

**Solução:**
1. Verificar permissões da pasta
2. Verificar espaço em disco
3. Criar pasta pai antes de salvar arquivo

**Código Corrigido:**
```python
# Cria pasta pai se não existir
pasta_final.parent.mkdir(parents=True, exist_ok=True)

# Verifica permissões
if not os.access(pasta_final.parent, os.W_OK):
    raise PermissionError(f"Sem permissão de escrita em: {pasta_final.parent}")
```

---

### 6. ⚠️ Problema: Baixa sempre a primeira nota

**Sintoma:**
- O código processa múltiplas linhas, mas sempre baixa os arquivos da primeira nota

**Causa Possível:**
- O seletor está usando `page.locator()` global em vez do contexto da linha
- O menu não está sendo fechado entre linhas

**Solução:**
1. Sempre usar o contexto do `menu_suspenso` da linha específica
2. Fechar o menu completamente antes de processar próxima linha

**Código Corrigido:**
```python
# Usa contexto específico da linha
menu_suspenso = row_locator.locator('.menu-suspenso-tabela')
link_element = menu_suspenso.locator('a[href*="..."]').first  # Dentro do contexto

# Fecha menu antes de próxima linha
page.keyboard.press("Escape")
page.wait_for_timeout(300)
```

---

## 🔍 Como Diagnosticar Problemas

### 1. Usar o Script de Diagnóstico

Execute o script de diagnóstico para identificar problemas:

```bash
cd Backend/scripts/automation
python debug_download.py <cnpj> [linha_index]
```

Exemplo:
```bash
python debug_download.py 12345678000190 0  # Primeira linha
python debug_download.py 12345678000190 1  # Segunda linha
```

### 2. Verificar Logs

Os logs detalhados mostram:
- Qual linha está sendo processada
- Se o menu está visível
- Se os links foram encontrados
- Qual URL está sendo usada
- Onde o arquivo está sendo salvo

### 3. Verificar Estrutura HTML

Use o DevTools do navegador para verificar:
- Se o menu suspenso tem a classe correta
- Se os links têm os hrefs corretos
- Se há múltiplos menus abertos

---

## 📝 Checklist de Verificação

Antes de reportar um erro, verifique:

- [ ] O menu suspenso está visível quando o código tenta buscar o link?
- [ ] O seletor CSS está correto?
- [ ] A competência está sendo extraída corretamente?
- [ ] O caminho base de downloads está configurado?
- [ ] Há permissões de escrita na pasta de destino?
- [ ] A sessão do navegador ainda está válida?
- [ ] Há espaço em disco suficiente?

---

## 🆘 Se Nada Funcionar

1. Execute o script de diagnóstico e compartilhe a saída
2. Compartilhe os logs completos da execução
3. Verifique se o problema ocorre em todas as linhas ou apenas em algumas
4. Verifique se o problema ocorre com todas as competências ou apenas algumas

---

## 📚 Referências

- [Documentação Playwright - Locators](https://playwright.dev/python/docs/locators)
- [Documentação Playwright - Selectors](https://playwright.dev/python/docs/selectors)
- [EXEMPLO_USO_DOWNLOADS.md](./EXEMPLO_USO_DOWNLOADS.md)

