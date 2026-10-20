# NFS-e nativa — etapa 22.3 — classificação fiscal

A classificação fiscal faz parte do backend do AutoNacional. Ela lê as evidências que a descoberta já capturou da coluna Situação e define `VIGENTE`, `CANCELADA` ou `INDETERMINADA`. Não abre navegador, não baixa XML ou PDF, não consulta SEFIN ou ADN e não é chamada pelo worker de execução.

Os ícones e o código abaixo foram observados no Portal Nacional. Não há quantidade fixa de notas: os totais saem dos documentos classificados.

## Módulos

```text
Backend/src/automation/nfse/classification/
  situacao.ts
  index.ts
  classification.test.ts
```

A descoberta passa a classificar no fechamento do inventário, em `discovery-validation.ts`. Navegação, filtro, paginação, extração de chave e duplicidade permanecem como na etapa 22.2.

| Arquivo | Papel |
|---|---|
| `situacao.ts` | Função pura `classificarSituacao` e montagem do documento classificado |
| `index.ts` | Entrada pública do módulo |
| `discovery-validation.ts` | Troca `INDETERMINADA` / `NAO_CLASSIFICADA` pelo resultado calculado |

A origem gravada no documento passa a ser `PORTAL`. `NAO_CLASSIFICADA` continua no contrato para documento ainda não submetido a este classificador.

## Função pública

```ts
classificarSituacao(evidencia)
```

A evidência contém apenas `dataSituacao`, texto e classe de `td.td-situacao` e os ícones dessa célula (`src`, `title`, `data-original-title`, `alt`, `aria-label`). O link de download XML não entra. Ele continua servindo só para a chave nacional.

`documentoClassificado` aplica o resultado em `DocumentoFiscalNfse`, preservando chave, CNPJ, direção, período consultado e `dCompet` quando ele já existir. `dCompet` não classifica a nota.

## Tabela de classificação

| Evidência na coluna Situação | Situação | Fonte |
|---|---|---|
| `tr[data-situacao="P104_NFSE_CANCELADA"]` | `CANCELADA` | `tr.data-situacao` |
| `tb-cancelada.svg` | `CANCELADA` | `icone.situacao` |
| `NFS-e cancelada` em title, data-original-title, alt, aria-label ou texto da coluna | `CANCELADA` | atributo que trouxe o texto |
| `tb-gerada.svg` | `VIGENTE` | `icone.situacao` |
| `NFS-e Gerada` | `VIGENTE` | atributo que trouxe o texto |
| `NFS-e emitida` | `VIGENTE` | `td.td-situacao` ou ícone |
| Código `data-situacao` diferente de `P104_NFSE_CANCELADA` | `INDETERMINADA` | `tr.data-situacao` |
| Coluna sem evidência reconhecida | `INDETERMINADA` | `nao_identificada` |
| Cancelamento atual e `NFS-e emitida` na mesma coluna | `INDETERMINADA` | `nao_identificada` |

Nenhum código `data-situacao` de vigência foi observado. A lista `CODIGOS_DATA_SITUACAO_VIGENTE` fica vazia. Palavras soltas como “ativa”, “normal” ou “autorizada” não classificam.

## Precedência

1. `tr[data-situacao]` com código conhecido.
2. Texto e classe de `td.td-situacao`.
3. Ícone dentro da coluna Situação.
4. `title`, `data-original-title`, `alt` e `aria-label` desse ícone.

`P104_NFSE_CANCELADA` define o estado atual. Ícone de geração na mesma linha fica registrado como histórico e não reabre a nota como vigente.

Um código `data-situacao` não observado bloqueia a classificação. O ícone `tb-gerada.svg` não transforma esse código em `VIGENTE`. O diagnóstico é `CODIGO_SITUACAO_DESCONHECIDO`. A nota permanece no inventário como `INDETERMINADA`.

## Conflitos

`tb-gerada.svg` e `NFS-e Gerada` indicam que a nota foi gerada. Sozinhos, classificam `VIGENTE`. Junto de cancelamento atual, são histórico de emissão: a situação fica `CANCELADA` e não há conflito.

`NFS-e emitida` descreve o estado atual. Se a mesma coluna também traz cancelamento atual, as duas evidências são incompatíveis. A situação fica `INDETERMINADA`, com `CONFLITO_SITUACAO` nas evidências e nos diagnósticos da descoberta.

O menu de ações não entra na evidência. O botão Cancelar, o ícone de cancelar ação e o texto “Cancelar” não classificam a nota.

## Canceladas e indeterminadas

A nota cancelada permanece no inventário e na descoberta. Descoberta completa pode conter canceladas. Ela não entra em `montarPlanoRecuperacao`.

A nota indeterminada também permanece. `bloqueiaProcessamentoAutomatico` continua verdadeiro e o plano de recuperação marca `BLOQUEADO`. A descoberta não é rebaixada por causa dessa nota: completude da listagem e elegibilidade de recuperação são decisões separadas.

## Totalizadores

`calcularTotaisInventario` conta, sobre os documentos que entraram no inventário:

- descobertos
- emitidas e recebidas, pela direção original
- vigentes, canceladas e indeterminadas

A soma de vigentes, canceladas e indeterminadas é o total descoberto. A classificação não altera chave nem direção. Falha de descoberta, chave ausente ou duplicidade bloqueante continuam impedindo `DISCOVERY_COMPLETE`.

## Testes

`classification.test.ts` tem 26 testes offline. Eles cobrem o código `P104_NFSE_CANCELADA`, `tb-cancelada.svg`, title e data-original-title, `tb-gerada.svg`, `NFS-e Gerada`, `NFS-e emitida`, situação desconhecida, ausência de evidência, conflito, histórico de emissão, botão Cancelar, menu de ações, emitidas e recebidas, preservação de chave, direção, período e `dCompet`, bloqueio da indeterminada, cancelada fora da fila e código `data-situacao` desconhecido.

A descoberta simulada percorre captura, classificação e inventário:

| Cenário | Resultado |
|---|---|
| 10 notas com `tb-gerada.svg` | 10 vigentes, descoberta completa |
| 8 geradas e 2 canceladas | 8 vigentes, 2 canceladas, 0 indeterminadas |
| 7 geradas, 2 canceladas e 1 código desconhecido | 7 vigentes, 2 canceladas, 1 indeterminada |
| Botão Cancelar na coluna de ações | vigente |
| Linha sem chave | inventário parcial, a nota classificada não completa a descoberta |
| Somente canceladas | descoberta completa, nenhuma vigente |

Fixtures são sintéticas. Não há Portal Nacional, certificado, SEFIN nem Chromium.

Validação desta etapa, em `Backend`:

- `npm run typecheck` — sucesso
- `npm test` — 22 arquivos, 236 testes, todos passando (26 em `classification.test.ts`)

Não foram executados `test:smoke-db`, `test:smoke-storage` nem `test:playwright`.

## Limitações

- O classificador só vê a coluna Situação já separada pela descoberta. Não reclassifica o menu de ações se ele for misturado nessa coluna com o rótulo fiscal.
- Código `data-situacao` de vigência ainda não foi observado. Enquanto a lista estiver vazia, qualquer outro código permanece indeterminado.
- `dCompet` não é lido nesta etapa. Quando a recuperação futura o trouxer, ele continua metadado.
- O worker, a fila e o download atual não chamam este módulo.

## Próxima etapa

Definir como a execução real consome o inventário classificado: vigentes elegíveis à recuperação, canceladas de fora da fila contábil e indeterminadas impedindo o fechamento automático. Essa ligação continua fora do worker até a revisão desta etapa.
