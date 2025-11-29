# Exemplo de Uso do Sistema de Downloads

Este documento explica como usar o novo sistema de gerenciamento de downloads implementado no módulo `download_manager.py`.

## Configuração Inicial

### Opção 1: Usar pasta Downloads padrão do sistema (Recomendado)

O sistema usa automaticamente a pasta Downloads do sistema operacional se nenhum caminho for configurado:

- **Windows**: `C:\Users\{usuario}\Downloads`
- **Linux**: `/home/{usuario}/Downloads`
- **macOS**: `/Users/{usuario}/Downloads`

```python
from scripts.automation.download_manager import get_download_base_path

# Não precisa configurar nada! O sistema usa a pasta Downloads padrão
base_path = get_download_base_path()
# Retorna: Path.home() / "Downloads"
```

### Opção 2: Configurar caminho personalizado

Se você quiser usar um caminho específico:

```python
from scripts.automation.download_manager import set_downloads_base_path

# Windows
set_downloads_base_path("C:\\DownloadsAutomacao")

# Linux/macOS
set_downloads_base_path("/home/usuario/DownloadsAutomacao")

# Ou usando Path (multiplataforma)
from pathlib import Path
set_downloads_base_path(str(Path.home() / "MeusDownloads" / "NFSe"))
```

## Estrutura de Pastas Criada

O sistema cria automaticamente a seguinte estrutura:

```
{base_path}/
  {competencia}/          # Ex: "10-2025"
    {empresa}/            # Ex: "Empresa XYZ"
      Emitidas/          # Notas emitidas
        arquivo.xml
        arquivo.pdf
      Recebidas/         # Notas recebidas
        arquivo.xml
        arquivo.pdf
```

## Exemplo 1: Download Simples com Interceptação

```python
from playwright.async_api import Page
from scripts.automation.download_manager import (
    salvar_download,
    get_download_base_path
)

# 1. Obtém caminho base (usa Downloads padrão se não configurado)
base_path = get_download_base_path()
# No Windows: C:\Users\{usuario}\Downloads
# No Linux: /home/{usuario}/Downloads
# No macOS: /Users/{usuario}/Downloads

# 2. Intercepta e salva download
caminho_salvo = await salvar_download(
    page=page,
    seletor='a:has-text("Download XML")',
    base_path=base_path,
    competencia="10/2025",
    empresa="Empresa XYZ",
    tipo_nota="Emitidas",
    nome_arquivo_prefixo="nota_123"  # Opcional
)

print(f"Arquivo salvo em: {caminho_salvo}")
```

## Exemplo 2: Download Direto (quando já interceptado)

```python
from playwright.async_api import Page
from scripts.automation.download_manager import (
    salvar_download_direto,
    get_download_base_path
)

# 1. Obtém caminho base (usa Downloads padrão automaticamente)
base_path = get_download_base_path()

# 2. Intercepta o download manualmente
async with page.expect_download() as download_info:
    await page.click('a:has-text("Download XML")')

download = await download_info.value

# 3. Salva usando a função direta
caminho_salvo = await salvar_download_direto(
    download=download,
    base_path=base_path,
    competencia="10/2025",
    empresa="Empresa XYZ",
    tipo_nota="Emitidas",
    nome_arquivo_prefixo="nota_123"  # Opcional
)

print(f"Arquivo salvo em: {caminho_salvo}")
```

## Exemplo 3: Uso na Automação Existente

O código em `processar_notas_competencia.py` já foi refatorado para usar o novo sistema:

```python
from scripts.automation.processar_notas_competencia import processar_notas

# Não precisa configurar nada! O sistema usa a pasta Downloads padrão
# Se quiser usar um caminho personalizado, configure antes:
# from scripts.automation.processar_notas_competencia import set_downloads_base_path
# set_downloads_base_path("/caminho/personalizado")

# Processa notas (os downloads serão salvos automaticamente na pasta Downloads)
await processar_notas(
    page=page,
    competencia_alvo="10/2025",
    nome_empresa="Empresa XYZ"
)
```

## Detecção de Extensão

### Regra de Negócio Importante

**Para cada nota, sempre são feitos 2 downloads na seguinte ordem:**
1. **Primeiro download** → **SEMPRE XML** (arquivo da nota fiscal)
2. **Segundo download** → **SEMPRE PDF** (DANFS-e - Documento Auxiliar da NFS-e)

O sistema usa essa ordem para determinar a extensão correta, garantindo que:
- O primeiro arquivo baixado de uma nota recebe extensão `.xml`
- O segundo arquivo baixado de uma nota recebe extensão `.pdf`

### Detecção Automática (Fallback)

Se a extensão não for fornecida explicitamente, o sistema tenta detectar automaticamente:

1. **Por URL**: Analisa a URL do download
2. **Por Conteúdo**: Lê os primeiros bytes do arquivo temporário
   - `<?xml` ou `<` → `.xml`
   - `%PDF` → `.pdf`
3. **Fallback**: Se não detectar → `.bin`

## Nomeação de Arquivos

O sistema gera nomes de arquivo seguindo estas regras:

1. Se `suggested_filename` for válido → usa ele (garantindo extensão correta)
2. Se vier vazio/inválido → gera: `nota_{timestamp}.{ext}`
3. Se `nome_arquivo_prefixo` for fornecido → usa: `{prefixo}{ext}`

## Validações e Segurança

- ✅ Sanitiza nomes de arquivo e pastas (remove caracteres inválidos)
- ✅ Cria toda a hierarquia de pastas automaticamente
- ✅ Valida tipo_nota (deve ser "Emitidas" ou "Recebidas")
- ✅ Detecta extensão correta mesmo quando o servidor não envia
- ✅ Tratamento de erros robusto com logging detalhado

## Logs

O sistema gera logs detalhados em cada etapa:

```
INFO: Caminho base não configurado. Usando padrão do sistema: /Users/usuario/Downloads
INFO: Iniciando download: competencia=10/2025, empresa=Empresa XYZ, tipo=Emitidas
DEBUG: Aguardando download do seletor: a:has-text("Download XML")
DEBUG: Download iniciado: arquivo.xml
DEBUG: Extensão detectada: .xml
DEBUG: Nome do arquivo gerado: nota_123.xml
DEBUG: Caminho completo montado: /Users/usuario/Downloads/10-2025/Empresa XYZ/Emitidas
INFO: ✅ Arquivo salvo com sucesso: /Users/usuario/Downloads/10-2025/Empresa XYZ/Emitidas/nota_123.xml
```

**Nota**: O caminho exibido varia conforme o sistema operacional:
- **Windows**: `C:\Users\{usuario}\Downloads\...`
- **Linux**: `/home/{usuario}/Downloads/...`
- **macOS**: `/Users/{usuario}/Downloads/...`

## Erros Comuns

### Erro: "Caminho base de downloads não configurado"

**Nota**: Este erro não deve mais ocorrer, pois o sistema usa automaticamente a pasta Downloads padrão do sistema operacional. Se você configurou um caminho personalizado e recebeu este erro, verifique se chamou `set_downloads_base_path()` antes de executar downloads.

### Erro: "tipo_nota deve ser 'Emitidas' ou 'Recebidas'"

**Solução**: Verifique se está passando exatamente "Emitidas" ou "Recebidas" (case-sensitive).

## Integração com Configurações do Backend

Para obter o caminho base das configurações do banco de dados:

```python
from src.db.session import get_db
from src.db.crud_settings import obter_configuracoes
from scripts.automation.download_manager import set_downloads_base_path

# Obtém configurações do banco
db = next(get_db())
configuracoes = obter_configuracoes(db)

# Configura o caminho base
set_downloads_base_path(configuracoes.downloads_base_path)
```

