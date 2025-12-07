# 🐛 Quick Start - Debug emitidas_automation.py

## Passo 1: Instalar debugpy

```bash
cd Backend
python3 -m pip install debugpy
```

Ou instale todas as dependências:
```bash
python3 -m pip install -r requirements.txt
```

**Nota**: No macOS, use `python3 -m pip` ao invés de apenas `pip`.

## Passo 2: Configurar Argumentos

Edite `.vscode/launch.json` e ajuste:

```json
"args": [
    "SEU_CNPJ_AQUI",      // Ex: "12345678000190"
    "112025",              // Competência (MMMAAA)
    "--tipo",
    "emitidas"             // ou "recebidas" ou "ambas"
]
```

## Passo 3: Adicionar Breakpoints

Clique na margem esquerda (ao lado dos números) nas linhas:

- **659**: Verificação da última linha
- **689**: Comparação de competência
- **693**: Decisão de navegar

## Passo 4: Iniciar Debug

1. Pressione **F5** ou vá em **Run > Start Debugging**
2. Selecione: `Python: Debug emitidas_automation.py (Emitidas)`

## Controles

- **F5**: Continuar
- **F10**: Próxima linha
- **F11**: Entrar na função
- **Shift+F5**: Parar

## Variáveis Importantes

No breakpoint da linha 689, inspecione:

- `competencia_normalizada` → deve ser "11/2025"
- `competencia_ultima_normalizada` → competência da última linha
- `competencia_ultima_normalizada == competencia_normalizada` → deve ser True para navegar

