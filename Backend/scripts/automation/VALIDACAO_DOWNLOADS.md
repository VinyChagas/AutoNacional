# Validação de Downloads

Este documento explica como verificar se os downloads foram bem-sucedidos e se estão na pasta correta.

## Validação Automática

O sistema valida automaticamente cada download após o salvamento. Você verá nos logs:

- ✅ **Sucesso**: `✅ XML baixado e validado: /caminho/arquivo.xml (1234 bytes)`
- ❌ **Falha**: `❌ XML baixado mas validação falhou: [mensagem de erro]`

## Funções de Validação

### 1. `validar_download(caminho_arquivo, tamanho_minimo=100)`

Valida um arquivo individual verificando:
- ✅ Se o arquivo existe
- ✅ Se é um arquivo (não uma pasta)
- ✅ Se tem tamanho válido (mínimo 100 bytes por padrão)
- ✅ Se a extensão está correta (.xml, .pdf ou .bin)
- ✅ Se está na pasta correta (Emitidas ou Recebidas)

**Exemplo de uso:**

```python
from pathlib import Path
from scripts.automation.processar_notas_competencia_sync import validar_download

# Valida um arquivo específico
arquivo = Path("/caminho/base/10-2025/Empresa XYZ/Emitidas/nota_123.xml")
resultado = validar_download(arquivo)

if resultado['sucesso']:
    print(f"✅ Arquivo válido: {resultado['mensagem']}")
else:
    print(f"❌ Arquivo inválido: {resultado['mensagem']}")
    print(f"   Detalhes: {resultado}")
```

**Retorno:**

```python
{
    'sucesso': True,
    'arquivo_existe': True,
    'caminho_correto': True,
    'tamanho_valido': True,
    'extensao_correta': True,
    'tamanho_bytes': 1234,
    'mensagem': '✅ Download validado com sucesso: ...',
    'caminho_completo': '/caminho/completo/arquivo.xml'
}
```

### 2. `verificar_downloads_competencia(base_path, competencia, empresa, tipo_nota=None)`

Verifica todos os downloads de uma competência específica.

**Parâmetros:**
- `base_path`: Caminho base configurado
- `competencia`: Competência no formato "MM/AAAA" (ex: "10/2025")
- `empresa`: Nome da empresa
- `tipo_nota`: "Emitidas", "Recebidas" ou `None` (verifica ambos)

**Exemplo de uso:**

```python
from scripts.automation.processar_notas_competencia_sync import verificar_downloads_competencia

resultado = verificar_downloads_competencia(
    base_path="/caminho/base",
    competencia="10/2025",
    empresa="Empresa XYZ",
    tipo_nota=None  # Verifica ambos Emitidas e Recebidas
)

print(f"Total de arquivos: {resultado['total_arquivos']}")
print(f"Válidos: {resultado['arquivos_validos']}")
print(f"Inválidos: {resultado['arquivos_invalidos']}")
print(f"Total de bytes: {resultado['total_bytes']:,}")

# Ver detalhes de cada arquivo
for detalhe in resultado['detalhes']:
    print(f"{detalhe['tipo']}: {detalhe['arquivo']}")
    print(f"  Status: {'✅ Válido' if detalhe['validacao']['sucesso'] else '❌ Inválido'}")
```

**Retorno:**

```python
{
    'total_arquivos': 10,
    'arquivos_validos': 8,
    'arquivos_invalidos': 2,
    'total_bytes': 1234567,
    'detalhes': [
        {
            'arquivo': '/caminho/arquivo1.xml',
            'tipo': 'Emitidas',
            'validacao': {...}
        },
        ...
    ],
    'resumo': '📊 Validação de Downloads - 10/2025 / Empresa XYZ\n...'
}
```

### 3. `gerar_relatorio_downloads(base_path, competencia, empresa, tipo_nota=None)`

Gera um relatório completo formatado no console/logs.

**Exemplo de uso:**

```python
from scripts.automation.processar_notas_competencia_sync import gerar_relatorio_downloads

gerar_relatorio_downloads(
    base_path="/caminho/base",
    competencia="10/2025",
    empresa="Empresa XYZ",
    tipo_nota=None  # Verifica ambos
)
```

**Saída no console:**

```
================================================================================
📊 GERANDO RELATÓRIO DE VALIDAÇÃO DE DOWNLOADS
================================================================================
📊 Validação de Downloads - 10/2025 / Empresa XYZ
   Total de arquivos: 10
   ✅ Válidos: 8
   ❌ Inválidos: 2
   📦 Total de bytes: 1,234,567

📋 DETALHES POR ARQUIVO:
--------------------------------------------------------------------------------
✅ VÁLIDO | Emitidas | /caminho/base/10-2025/Empresa XYZ/Emitidas/nota_123.xml
✅ VÁLIDO | Emitidas | /caminho/base/10-2025/Empresa XYZ/Emitidas/nota_123.pdf
❌ INVÁLIDO | Emitidas | /caminho/base/10-2025/Empresa XYZ/Emitidas/nota_456.xml
   └─ ⚠️ Arquivo muito pequeno (50 bytes). Esperado mínimo: 100 bytes
   └─ Tamanho: 50 bytes
   └─ Existe: True
   └─ Caminho correto: True
   └─ Tamanho válido: False
   └─ Extensão correta: True
================================================================================
```

## Script de Linha de Comando

Use o script `verificar_downloads.py` para verificar downloads via terminal:

### Uso Básico

```bash
# Verificar todos os downloads de uma competência
python Backend/scripts/automation/verificar_downloads.py \
    --base_path "/caminho/base" \
    --competencia "10/2025" \
    --empresa "Empresa XYZ"
```

### Verificar Apenas Emitidas

```bash
python Backend/scripts/automation/verificar_downloads.py \
    --base_path "/caminho/base" \
    --competencia "10/2025" \
    --empresa "Empresa XYZ" \
    --tipo "Emitidas"
```

### Verificar Apenas Recebidas

```bash
python Backend/scripts/automation/verificar_downloads.py \
    --base_path "/caminho/base" \
    --competencia "10/2025" \
    --empresa "Empresa XYZ" \
    --tipo "Recebidas"
```

### Usar Caminho Padrão (Downloads do Sistema)

Se não informar `--base_path`, o script usa automaticamente a pasta Downloads padrão:

```bash
python Backend/scripts/automation/verificar_downloads.py \
    --competencia "10/2025" \
    --empresa "Empresa XYZ"
```

### Saída em JSON

Para usar programaticamente ou em scripts:

```bash
python Backend/scripts/automation/verificar_downloads.py \
    --base_path "/caminho/base" \
    --competencia "10/2025" \
    --empresa "Empresa XYZ" \
    --json
```

**Exit Code:**
- `0`: Sucesso (todos os arquivos válidos)
- `1`: Erro (há arquivos inválidos)

## Integração no Código

### Validar Após Processamento

```python
from scripts.automation.processar_notas_competencia_sync import (
    processar_tabela_emitidas,
    processar_tabela_recebidas,
    gerar_relatorio_downloads
)
from scripts.automation.download_manager import get_download_base_path

# Processa notas
processar_tabela_emitidas(page, competencia_alvo="10/2025", nome_empresa="Empresa XYZ")
processar_tabela_recebidas(page, competencia_alvo="10/2025", nome_empresa="Empresa XYZ")

# Gera relatório de validação
base_path = get_download_base_path()
gerar_relatorio_downloads(
    base_path=str(base_path),
    competencia="10/2025",
    empresa="Empresa XYZ"
)
```

### Validar Arquivo Específico

```python
from pathlib import Path
from scripts.automation.processar_notas_competencia_sync import validar_download

arquivo = Path("/caminho/arquivo.xml")
validacao = validar_download(arquivo)

if not validacao['sucesso']:
    print(f"Problemas encontrados:")
    print(f"  - Arquivo existe: {validacao['arquivo_existe']}")
    print(f"  - Caminho correto: {validacao['caminho_correto']}")
    print(f"  - Tamanho válido: {validacao['tamanho_valido']}")
    print(f"  - Extensão correta: {validacao['extensao_correta']}")
    print(f"  - Mensagem: {validacao['mensagem']}")
```

## O que é Verificado

### ✅ Arquivo Existe
Verifica se o arquivo foi realmente criado no sistema de arquivos.

### ✅ Caminho Correto
Verifica se o arquivo está dentro de uma pasta "Emitidas" ou "Recebidas".

### ✅ Tamanho Válido
Verifica se o arquivo tem pelo menos 100 bytes (padrão). Arquivos muito pequenos podem indicar download incompleto ou erro.

### ✅ Extensão Correta
Verifica se a extensão é `.xml`, `.pdf` ou `.bin` (fallback).

### ✅ É um Arquivo
Verifica se o caminho aponta para um arquivo, não uma pasta.

## Troubleshooting

### Arquivo não existe
- Verifique se o caminho está correto
- Verifique permissões de escrita na pasta
- Verifique se há espaço em disco

### Arquivo muito pequeno
- Pode indicar download incompleto
- Pode indicar erro na requisição HTTP
- Verifique os logs para ver se houve erro durante o download

### Caminho incorreto
- Verifique se a estrutura de pastas está sendo criada corretamente
- Verifique se `competencia` e `empresa` estão sendo passados corretamente

### Extensão incorreta
- Verifique se o `content-type` da resposta HTTP está correto
- Verifique se a detecção de extensão está funcionando
- Arquivos `.bin` indicam que não foi possível detectar o tipo

## Exemplo Completo

```python
from scripts.automation.processar_notas_competencia_sync import (
    verificar_downloads_competencia,
    gerar_relatorio_downloads
)

# Verifica downloads
resultado = verificar_downloads_competencia(
    base_path="/caminho/base",
    competencia="10/2025",
    empresa="Empresa XYZ"
)

# Se houver arquivos inválidos, investiga
if resultado['arquivos_invalidos'] > 0:
    print("⚠️ Encontrados arquivos inválidos!")
    
    for detalhe in resultado['detalhes']:
        if not detalhe['validacao']['sucesso']:
            print(f"\n❌ Problema encontrado:")
            print(f"   Arquivo: {detalhe['arquivo']}")
            print(f"   Tipo: {detalhe['tipo']}")
            print(f"   Mensagem: {detalhe['validacao']['mensagem']}")
            
            # Tenta corrigir ou reportar
            if not detalhe['validacao']['arquivo_existe']:
                print("   → Arquivo não existe. Pode ter falhado o download.")
            elif not detalhe['validacao']['tamanho_valido']:
                print("   → Arquivo muito pequeno. Download pode estar incompleto.")
            elif not detalhe['validacao']['extensao_correta']:
                print("   → Extensão incorreta. Verifique detecção de tipo.")
else:
    print("✅ Todos os arquivos estão válidos!")

# Gera relatório completo
gerar_relatorio_downloads(
    base_path="/caminho/base",
    competencia="10/2025",
    empresa="Empresa XYZ"
)
```

