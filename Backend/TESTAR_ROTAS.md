# 🧪 Script de Teste de Rotas

Este documento explica como usar o script `testar_todas_rotas.py` para testar todas as rotas da API de uma só vez.

## 📋 Pré-requisitos

1. **Backend rodando**: Certifique-se de que o backend está rodando na porta 8000 (ou configure com `--base-url`)
2. **Biblioteca requests**: O script precisa da biblioteca `requests` do Python
   ```bash
   pip install requests
   ```

## 🚀 Como Usar

### Linux / macOS

```bash
# Método 1: Usando o script shell
./testar_todas_rotas.sh

# Método 2: Executando diretamente o Python
python3 testar_todas_rotas.py
```

### Windows

```cmd
REM Método 1: Usando o script batch
testar_todas_rotas.bat

REM Método 2: Executando diretamente o Python
python testar_todas_rotas.py
```

## 📝 Opções Disponíveis

### Opções Básicas

- `--base-url URL`: URL base da API (padrão: `http://localhost:8000`)
- `--cnpj CNPJ`: CNPJ para testes (padrão: `00363320000106`)
- `--headless`: Executar teste NFSe em modo headless (sem navegador visível)

### Opções para Testes com Certificado

- `--certificado CAMINHO`: Caminho para arquivo .pfx/.p12
- `--senha SENHA`: Senha do certificado

**Nota**: `--certificado` e `--senha` devem ser fornecidos juntos.

## 📊 Rotas Testadas

O script testa as seguintes rotas:

1. ✅ **GET /** - Health check
2. ✅ **GET /empresas** - Listar empresas
3. ✅ **POST /credenciais** - Criar/atualizar credenciais
4. ✅ **GET /api/certificados** - Listar certificados (pode não estar implementada)
5. ✅ **GET /api/certificados/{cnpj}** - Obter certificado específico (pode não estar implementada)
6. ✅ **POST /api/certificados/importar** - Importar certificado (requer `--certificado` e `--senha`)
7. ✅ **POST /api/certificados** - Upload de certificado (requer `--certificado` e `--senha`)
8. ✅ **POST /api/nfse/{cnpj}/abrir** - Abrir dashboard NFSe

## 💡 Exemplos de Uso

### Exemplo 1: Teste Básico (sem certificado)

```bash
# Testa todas as rotas básicas
python3 testar_todas_rotas.py
```

### Exemplo 2: Teste com CNPJ Específico

```bash
# Testa com um CNPJ específico
python3 testar_todas_rotas.py --cnpj 41640605000124
```

### Exemplo 3: Teste Completo com Certificado

```bash
# Testa todas as rotas incluindo upload/importação de certificado
python3 testar_todas_rotas.py \
    --certificado /caminho/para/certificado.pfx \
    --senha senha_do_certificado \
    --cnpj 00363320000106
```

### Exemplo 4: Teste NFSe em Modo Headless

```bash
# Executa o teste NFSe sem abrir navegador visível
python3 testar_todas_rotas.py --headless --cnpj 00363320000106
```

### Exemplo 5: Teste em Servidor Remoto

```bash
# Testa rotas em um servidor diferente
python3 testar_todas_rotas.py --base-url http://192.168.1.100:8000
```

## 📈 Interpretando os Resultados

O script exibe:

- ✅ **Verde**: Requisição bem-sucedida (status 2xx)
- ❌ **Vermelho**: Requisição falhou (status 4xx/5xx)
- ⚠️ **Amarelo**: Aviso (rota não implementada, dados faltando, etc.)

No final, um resumo mostra:
- Total de testes executados
- Quantidade de sucessos
- Quantidade de falhas
- Quantidade de testes pulados (quando não há dados necessários)

## 🔍 Troubleshooting

### Erro: "Não foi possível conectar ao servidor"

**Solução**: Certifique-se de que o backend está rodando:
```bash
# Linux/macOS
./iniciar_backend.sh

# Windows
iniciar_backend.bat
```

### Erro: "Biblioteca 'requests' não encontrada"

**Solução**: Instale a biblioteca:
```bash
pip install requests
```

### Erro: "Certificado não encontrado"

**Solução**: Verifique se o caminho do certificado está correto e se o arquivo existe.

### Algumas rotas retornam 404

**Normal**: Algumas rotas podem não estar implementadas ainda. Consulte `ROTAS_NECESSARIAS.md` para ver o status de cada rota.

## 📚 Arquivos Relacionados

- `ROTAS_NECESSARIAS.md` - Lista de todas as rotas necessárias e seu status
- `README.md` - Documentação geral do backend
- `testar_importacao.sh` / `testar_importacao.bat` - Script específico para testar importação de certificado

## 🎯 Próximos Passos

Após executar os testes:

1. Verifique quais rotas falharam
2. Consulte os logs do servidor para mais detalhes
3. Implemente as rotas faltantes conforme `ROTAS_NECESSARIAS.md`
4. Execute os testes novamente para validar

