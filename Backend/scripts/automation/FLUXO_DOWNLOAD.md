# Fluxo Completo de Download de NFS-e

Este documento explica passo a passo o que acontece quando o sistema processa e baixa as notas fiscais.

## 📋 Visão Geral do Fluxo

```
1. ExecutionService inicia processamento
   ↓
2. Navega para página de Notas Emitidas/Recebidas
   ↓
3. processar_tabela_emitidas() ou processar_tabela_recebidas()
   ↓
4. Para cada linha da tabela:
   - Verifica se competência corresponde
   - Verifica se nota é válida
   - Chama baixar_arquivos_da_linha()
   ↓
5. baixar_arquivos_da_linha():
   - Abre menu de ações da nota
   - Localiza links de download (XML e PDF)
   - Chama baixar_arquivo_direto_sync() para cada arquivo
   ↓
6. baixar_arquivo_direto_sync():
   - Extrai href do link
   - Faz requisição HTTP direta
   - Detecta extensão
   - Cria estrutura de pastas
   - Salva arquivo
   ↓
7. Validação do download
```

## 🔍 Detalhamento Passo a Passo

### 1. Início do Processamento (`execution_service.py`)

```python
# Linha ~407-431
processar_tabela_emitidas(execucao.page, competencia_formatada, nome_empresa)
processar_tabela_recebidas(execucao.page, competencia_formatada, nome_empresa)
```

**O que acontece:**
- Recebe a página do Playwright já autenticada
- Recebe competência no formato "MM/AAAA" (ex: "10/2025")
- Recebe nome da empresa do certificado digital

---

### 2. Processamento da Tabela (`processar_tabela_emitidas/recebidas`)

**Localização:** `processar_notas_competencia_sync.py` linha ~995-1100

**Fluxo:**

```python
while True:  # Loop infinito até não ter mais páginas
    # 1. Aguarda tabela carregar
    page.wait_for_selector("table tbody tr", timeout=10000)
    
    # 2. Obtém todas as linhas
    linhas = page.locator("table tbody tr")
    total_linhas = linhas.count()
    
    # 3. Para cada linha:
    for i in range(total_linhas):
        linha = linhas.nth(i)
        celulas = linha.locator("td")
        
        # 4. Lê competência da 3ª coluna (índice 2)
        competencia_texto = celulas.nth(2).inner_text()
        
        # 5. Compara com competência alvo
        if competencia_texto == competencia_alvo:
            # 6. Verifica se nota é válida
            nota_valida = verificar_nota_valida(linha)
            
            if nota_valida:
                # 7. CHAMA DOWNLOAD ⬇️
                baixar_arquivos_da_linha(page, linha, "emitida", competencia_alvo, nome_empresa)
    
    # 8. Verifica se precisa ir para próxima página
    # Se última linha ainda tem competência alvo, continua
```

**Pontos importantes:**
- ✅ Processa todas as páginas automaticamente
- ✅ Filtra apenas notas da competência desejada
- ✅ Pula notas inválidas/canceladas
- ✅ Continua até não encontrar mais notas da competência

---

### 3. Download dos Arquivos (`baixar_arquivos_da_linha`)

**Localização:** `processar_notas_competencia_sync.py` linha ~747-992

**Fluxo:**

```python
def baixar_arquivos_da_linha(page, row_locator, tipo, competencia, nome_empresa):
    # 1. Obtém caminho base (usa Backend/downloads_teste por padrão)
    base_path = get_download_base_path()
    
    # 2. Determina coluna de ações (Emitidas: coluna 7, Recebidas: coluna 6)
    coluna_acoes_idx = 6 if tipo == "emitida" else 5
    
    # 3. Extrai competência da linha se não foi fornecida
    if not competencia:
        competencia = extrair_da_tabela()
    
    # 4. Clica no ícone de ações da nota
    icone_acoes.click()
    
    # 5. Aguarda menu suspenso aparecer
    menu_suspenso.wait_for(state='visible')
    
    # 6. Baixa XML (PRIMEIRO)
    seletor_xml = encontrar_seletor_xml()  # Tenta múltiplas estratégias
    arquivo_xml = baixar_arquivo_direto_sync(
        page, seletor_xml, base_path, competencia, empresa, "Emitidas"
    )
    
    # 7. Baixa PDF (SEGUNDO)
    seletor_pdf = encontrar_seletor_pdf()  # Tenta múltiplas estratégias
    arquivo_pdf = baixar_arquivo_direto_sync(
        page, seletor_pdf, base_path, competencia, empresa, "Emitidas"
    )
    
    # 8. Fecha menu
    icone_acoes.click()
```

**Estratégias de seleção dos links:**

1. **Por href** (mais robusto):
   ```python
   'a[href*="/EmissorNacional/Notas/Download/NFSe/"]'  # XML
   'a[href*="/EmissorNacional/Notas/Download/DANFSe/"]'  # PDF
   ```

2. **Por texto** (fallback):
   ```python
   '.menu-suspenso-tabela a:has-text("XML")'
   '.menu-suspenso-tabela a:has-text("DANFS-e")'
   ```

3. **Por estrutura** (último fallback):
   ```python
   '.menu-suspenso-tabela div:nth-child(2) a:nth-child(4)'  # XML (a[4])
   '.menu-suspenso-tabela div:nth-child(2) a:nth-child(5)'  # PDF (a[5])
   ```

---

### 4. Download Direto via HTTP (`baixar_arquivo_direto_sync`)

**Localização:** `processar_notas_competencia_sync.py` linha ~269-429

**Fluxo detalhado:**

```python
def baixar_arquivo_direto_sync(page, seletor_link, base_path, competencia, empresa, tipo_nota):
    # ETAPA 1: Valida tipo_nota
    if tipo_nota not in ["Emitidas", "Recebidas"]:
        raise ValueError(...)
    
    # ETAPA 2: Localiza o link na página
    link_element = page.locator(seletor_link).first
    if link_element.count() == 0:
        raise ValueError("Link não encontrado")
    
    # ETAPA 3: Extrai o href
    href = link_element.get_attribute('href')
    # Exemplo: "/EmissorNacional/Notas/Download/NFSe/41069022200363320000106000000000002725113648930669"
    
    # ETAPA 4: Monta URL absoluta
    current_url = page.url
    full_url = urljoin(current_url, href)
    # Exemplo: "https://portal.com/EmissorNacional/Notas/Download/NFSe/41069022200363320000106000000000002725113648930669"
    
    # ETAPA 5: Extrai chave da nota do href
    nome_chave = href.split("/")[-1]
    # Exemplo: "41069022200363320000106000000000002725113648930669"
    
    # ETAPA 6: Faz requisição HTTP direta
    response = page.request.get(full_url)
    # ✅ Usa a mesma sessão autenticada automaticamente!
    
    # ETAPA 7: Verifica status
    if response.status != 200:
        raise Exception(f"Status: {response.status}")
    
    # ETAPA 8: Lê conteúdo
    content_type = response.headers.get('content-type', '').lower()
    content = response.body()  # Conteúdo binário
    
    # ETAPA 9: Detecta extensão
    if 'xml' in content_type:
        extensao = '.xml'
    elif 'pdf' in content_type:
        extensao = '.pdf'
    else:
        # Analisa conteúdo (primeiros bytes)
        if content.startswith(b'<?xml'):
            extensao = '.xml'
        elif content.startswith(b'%PDF'):
            extensao = '.pdf'
        else:
            extensao = '.bin'
    
    # ETAPA 10: Monta estrutura de pastas
    base_path_obj = Path(base_path)
    comp_folder = competencia.replace("/", "-")  # "10/2025" -> "10-2025"
    empresa_folder = sanitizar_nome_pasta(empresa)
    
    pasta_final = base_path_obj / comp_folder / empresa_folder / tipo_nota
    # Exemplo: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas
    
    pasta_final.mkdir(parents=True, exist_ok=True)  # Cria toda a hierarquia
    
    # ETAPA 11: Monta nome do arquivo
    nome_arquivo = f"{nome_chave}{extensao}"
    # Exemplo: "41069022200363320000106000000000002725113648930669.xml"
    
    caminho_final = pasta_final / nome_arquivo
    
    # ETAPA 12: Salva arquivo em disco
    with open(caminho_final, "wb") as f:
        f.write(content)
    
    # ETAPA 13: Validação automática
    validacao = validar_download(caminho_final)
    
    return caminho_final
```

---

## 🐛 Possíveis Problemas e Onde Verificar

### Problema: "Não está baixando"

**Checklist de diagnóstico:**

1. **Os links estão sendo encontrados?**
   - Verifique logs: `"✅ Seletor XML encontrado por href"`
   - Se não encontrar, verifica: `"Link XML não encontrado com nenhuma estratégia"`

2. **A requisição HTTP está funcionando?**
   - Verifique logs: `"🌐 Fazendo requisição HTTP para: ..."`
   - Verifique status: `"✅ Resposta HTTP recebida com status 200"`
   - Se status != 200, há erro na requisição

3. **O conteúdo está sendo recebido?**
   - Verifique logs: `"Conteúdo recebido: X bytes"`
   - Se 0 bytes, o servidor não retornou conteúdo

4. **A pasta está sendo criada?**
   - Verifique logs: `"📁 Estrutura de pastas criada: ..."`
   - Verifique logs: `"✅ Pasta confirmada: ..."`

5. **O arquivo está sendo salvo?**
   - Verifique logs: `"✅ Arquivo salvo com sucesso: ..."`
   - Verifique logs: `"Caminho absoluto: ..."`

6. **A validação está passando?**
   - Verifique logs: `"✅ Validação do download passou"`
   - Se falhar: `"⚠️ Validação do download falhou"`

---

## 📊 Logs Esperados (Fluxo Normal)

```
INFO: Iniciando processamento de Notas Emitidas para competência 10/2025
INFO: Processando 10 linhas na página atual (Emitidas)
INFO: Nota encontrada na linha 1 com competência 10/2025
INFO: Nota válida confirmada. Baixando arquivos...
INFO: 🔍 Parâmetros recebidos:
INFO:    competencia: 10/2025
INFO:    nome_empresa: Empresa XYZ
INFO:    empresa_para_pasta: Empresa XYZ
INFO:    base_path: Backend/downloads_teste
INFO: Menu de ações aberto para nota emitida
INFO: Baixando XML da nota emitida...
DEBUG: ✅ Seletor XML encontrado por href
INFO: 📥 Iniciando download direto via HTTP: tipo=Emitidas, competencia=10/2025, empresa=Empresa XYZ
DEBUG: Buscando link com seletor: a[href*="/EmissorNacional/Notas/Download/NFSe/"]
DEBUG: Href extraído: /EmissorNacional/Notas/Download/NFSe/41069022200363320000106000000000002725113648930669
DEBUG: URL completa montada: https://portal.com/EmissorNacional/Notas/Download/NFSe/41069022200363320000106000000000002725113648930669
DEBUG: Chave da nota extraída: 41069022200363320000106000000000002725113648930669
INFO: 🌐 Fazendo requisição HTTP para: https://portal.com/...
DEBUG: ✅ Resposta HTTP recebida com status 200
DEBUG: Content-Type recebido: application/xml
INFO: ✅ Extensão detectada pelo content-type (XML): .xml
INFO: 🔧 Montando estrutura de pastas:
INFO:    base_path: Backend/downloads_teste
INFO:    competencia: 10/2025
INFO:    empresa: Empresa XYZ
INFO:    tipo_nota: Emitidas
INFO:    comp_folder formatado: 10-2025
INFO:    empresa_folder sanitizado: Empresa XYZ
INFO: 📁 Caminho completo da pasta: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas
INFO: 📁 Criando estrutura de pastas...
INFO: ✅ Estrutura de pastas criada com sucesso: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas
INFO: ✅ Pasta confirmada: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas
INFO: 💾 Salvando arquivo em: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas/41069022200363320000106000000000002725113648930669.xml
INFO: ✅ Arquivo salvo com sucesso!
INFO:    Caminho relativo: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas/41069022200363320000106000000000002725113648930669.xml
INFO:    Caminho absoluto: /caminho/absoluto/Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas/41069022200363320000106000000000002725113648930669.xml
INFO:    Tamanho: 1234 bytes
INFO: ✅ Validação do download passou: ✅ Download validado com sucesso
INFO: ✅ XML baixado e validado: Backend/downloads_teste/10-2025/Empresa XYZ/Emitidas/41069022200363320000106000000000002725113648930669.xml (1234 bytes)
```

---

## 🔧 Como Debugar

### 1. Adicionar breakpoints

Coloque breakpoints em:
- `baixar_arquivos_da_linha()` - linha ~747
- `baixar_arquivo_direto_sync()` - linha ~269
- Após `response = page.request.get()` - linha ~346
- Após `with open(caminho_final, "wb")` - linha ~409

### 2. Verificar variáveis importantes

```python
# Em baixar_arquivo_direto_sync:
print(f"seletor_link: {seletor_link}")
print(f"href: {href}")
print(f"full_url: {full_url}")
print(f"response.status: {response.status}")
print(f"content_type: {content_type}")
print(f"len(content): {len(content)}")
print(f"extensao: {extensao}")
print(f"pasta_final: {pasta_final}")
print(f"caminho_final: {caminho_final}")
```

### 3. Verificar se arquivo existe

```python
# Após salvar
import os
print(f"Arquivo existe? {os.path.exists(caminho_final)}")
print(f"Pasta existe? {os.path.exists(pasta_final)}")
print(f"Caminho absoluto: {os.path.abspath(caminho_final)}")
```

---

## ❓ Perguntas Frequentes

**Q: Por que não está baixando?**
- Verifique se os links estão sendo encontrados (logs)
- Verifique se a requisição HTTP retorna status 200
- Verifique se o conteúdo tem tamanho > 0

**Q: Onde os arquivos são salvos?**
- Por padrão: `Backend/downloads_teste/{competencia}/{empresa}/{tipo}/`
- Pode ser configurado via `set_downloads_base_path()`

**Q: Como saber se o download funcionou?**
- Verifique os logs: `"✅ Arquivo salvo com sucesso"`
- Verifique a validação: `"✅ Validação do download passou"`
- Verifique a pasta: `Backend/downloads_teste/...`

**Q: O que fazer se o link não for encontrado?**
- Verifique se o menu suspenso está visível
- Verifique se o seletor está correto
- Tente usar o seletor por estrutura (fallback)

**Q: Por que a requisição HTTP falha?**
- Verifique se a sessão está autenticada
- Verifique se a URL está correta
- Verifique se o servidor está respondendo

