# NFS-e nativa — etapa 22.5 — checkpoint, retomada e reconciliação

O módulo grava um checkpoint local e o XML já validado, retoma uma execução interrompida e reconcilia o inventário com os arquivos. Ele faz parte do backend do AutoNacional. Não usa o NFSExplorer, não consulta a SEFIN, não abre certificado e não é chamado pelo worker de execução.

A persistência desta etapa é mínima e isolada. A raiz dos arquivos é escolhida por quem chama o módulo. Os testes usam diretório temporário do sistema. Nada é escrito na pasta operacional de downloads nem no storage de certificados (`empresa/{cnpj}/certs/`).

O documento da etapa 22.4 ainda chama de Commit 05 a adaptação do certificado cadastrado. Esta etapa redefiniu o Commit 05 como checkpoint. O Commit 06 fica com a persistência definitiva, a auditoria e a adaptação do certificado A1. O Commit 07 integra o worker operacional. Esta revisão não antecipa essas ligações.

## Arquitetura

```text
Backend/src/automation/nfse/checkpoint/
  types.ts
  checkpoint-store.ts
  xml-store.ts
  checkpoint-service.ts
  resume-service.ts
  reconciliation.ts
  checkpoint.test.ts
  index.ts
```

| Peça | Papel |
|---|---|
| `CheckpointService` | Cria o checkpoint, grava o XML e registra falha |
| `CheckpointStore` | JSON do checkpoint, com escrita atômica e trava exclusiva em disco |
| `XmlStore` | XML em arquivo próprio, fora do download operacional |
| `retomarExecucaoNfse` | Relê arquivos, devolve pendências e não consulta a SEFIN |
| `reconciliarNfse` | Função pura: inventário, checkpoint e arquivos já verificados |

Nenhum arquivo do worker, do Prisma, do frontend ou do diretório de downloads foi modificado. `montarPlanoRecuperacao` permanece como na etapa 22.1.

## Estrutura do checkpoint

Formato versão `1`. Um arquivo `checkpoint.json` por CNPJ e período de consulta do Portal Nacional.

| Campo | Conteúdo |
|---|---|
| `versaoFormato` | `1` |
| `execucaoId` | Identificador da execução que criou o checkpoint |
| `cnpj` | 14 dígitos |
| `periodoConsulta` | `PERIODO_CONSULTA_PORTAL`, início e fim |
| `fingerprintInventario` | SHA-256 da identidade do inventário |
| `createdAt` / `updatedAt` | Instante ISO |
| `documentos` | Estado de cada chave |

Cada documento guarda chave nacional, direção, situação, estado, hash SHA-256, caminho relativo, tamanho, diagnóstico, código e data de atualização. O JSON não contém senha, PFX, chave privada, XML completo nem `dCompet`.

Caminho: `{raiz}/{cnpj}/{DD-MM-AAAA_DD-MM-AAAA}/checkpoint.json`. O XML fica em outra raiz: `{raiz}/{cnpj}/{mesmo período}/{chave}.xml`.

## Fingerprint

O fingerprint é o SHA-256, em hexadecimal, desta sequência, com quebra de linha entre os campos:

1. CNPJ
2. Data inicial do período de consulta
3. Data final do período de consulta
4. Documentos ordenados pela chave, cada um como `chave:direção:situação`

A ordem de descoberta não entra. `dCompet` não entra. A mesma empresa, o mesmo período e o mesmo conjunto fiscal produzem o mesmo fingerprint.

## Estados

| Situação no inventário | Estado inicial |
|---|---|
| `VIGENTE` | `PENDENTE` |
| `CANCELADA` | `EXCLUIDA_DA_RECUPERACAO` |
| `INDETERMINADA` | `BLOQUEADO` |

Cancelada não é falha. Indeterminada preserva o inventário para auditoria e impede persistência e retomada automáticas (`SITUACAO_INDETERMINADA`).

Estados seguintes, só para vigente: `EM_PROCESSAMENTO`, `PERSISTIDO`, `FALHA_TRANSITORIA`, `FALHA_PERMANENTE`, `INCONSISTENTE`.

O checkpoint só é criado se o inventário for estruturalmente válido: CNPJ normalizado, período de consulta válido, completude `COMPLETO`, chaves de 50 dígitos, sem duplicidade, documentos do mesmo CNPJ e do mesmo período, totais coerentes. Inventário parcial ou indeterminado na completude não abre checkpoint.

## Escrita atômica

Checkpoint e XML usam o mesmo procedimento:

1. Arquivo temporário no mesmo diretório do destino, com nome imprevisível.
2. Escrita do conteúdo.
3. `fsync`.
4. `rename` para o nome final.

O `rename` no mesmo diretório é a publicação. Um temporário interrompido é removido quando a função ainda está em execução. Se o processo morrer no meio, o temporário pode ficar no disco, mas não substitui o arquivo publicado. Uma escrita seguinte usa outro nome temporário.

`PERSISTIDO` só é gravado depois que o arquivo final existe, tem tamanho maior que zero e o SHA-256 relido confere. Falha de disco antes disso não altera o checkpoint.

## Persistência do XML

A persistência inicial (`persistirXml` / `XmlStore.persistir`) e a retomada do órfão usam a mesma validação fiscal do Commit 04: `validarXmlNfse`. A chave como substring no texto não basta. O SHA-256 não prova validade fiscal.

Antes de qualquer escrita, o módulo exige:

- chave de 50 dígitos e CNPJ de 14 dígitos, antes de montar o caminho
- documento vigente deste checkpoint, com a mesma direção
- estrutura NFS-e com `infNFSe` e `chNFSe`
- chave nacional igual à do documento
- CNPJ do papel conforme a direção (`EMITIDA` no emitente, `RECEBIDA` no tomador)
- validação `CONFIRMADA`
- só então SHA-256, gravação atômica e atualização do checkpoint

Fluxo: conferir contexto fiscal, exigir `CONFIRMADA`, calcular o hash, gravar em temporário, sincronizar, renomear, reler, atualizar o checkpoint. O mesmo hash reutiliza o arquivo. Hash diferente gera `CONFLITO_HASH` e o arquivo antigo permanece. XML sem confirmação fiscal não grava arquivo e não altera o checkpoint.

O caminho rejeita segmento vazio, absoluto, barra, barra invertida e `..`. Chave e CNPJ que não passam na validação não viram nome de arquivo.

## Retomada

`retomarExecucaoNfse` valida o inventário, carrega o checkpoint e confere CNPJ, período e fingerprint. Não há consulta externa e o módulo não importa o cliente HTTP da SEFIN.

| Situação encontrada | Efeito |
|---|---|
| `PERSISTIDO` com arquivo, tamanho e hash iguais | Permanece. O arquivo não é regravado |
| `PERSISTIDO` sem arquivo | Volta a `PENDENTE` |
| `PERSISTIDO` truncado ou com hash diferente | `INCONSISTENTE`. O arquivo não é sobrescrito |
| `EM_PROCESSAMENTO` | Volta a `PENDENTE` e, se houver arquivo, segue a regra do pendente |
| Arquivo presente e hash já registrado igual | Volta a `PERSISTIDO` sem regravar |
| Arquivo presente e hash já registrado diferente | `INCONSISTENTE`. O arquivo não é sobrescrito |
| `FALHA_PERMANENTE` | Diagnóstico preservado. Sem nova tentativa |
| `FALHA_TRANSITORIA` | Diagnóstico preservado. Elegível para tentativa futura, sem retry automático |
| `EXCLUIDA_DA_RECUPERACAO` ou `BLOQUEADO` | Inalterados |

Checkpoint de outro CNPJ, de outro período, com fingerprint divergente, JSON inválido ou versão diferente é recusado. O arquivo anterior não é apagado nem reescrito por essa recusa.

## Recuperação de XML órfão

O órfão é o arquivo `{chave}.xml` no caminho seguro da execução cujo documento ainda está `PENDENTE` e sem `hashSha256`. Isso cobre a queda depois da gravação do XML e antes da atualização do checkpoint. `EM_PROCESSAMENTO` entra na mesma regra depois de voltar a pendente.

A identificação não usa o nome como prova. O caminho é recalculado com CNPJ, período e chave do checkpoint cuja identidade já foi conferida com o inventário. Em seguida a retomada:

1. Confere que o caminho relativo é `{cnpj}/{período}/{chave}.xml`, sob a raiz do `XmlStore`.
2. Lê o arquivo com o teto `LIMITES_RECUPERACAO_PADRAO.maxBytesXml` (4_000_000 bytes). Acima do teto, o conteúdo não entra na memória.
3. Valida o XML em memória com `validarXmlNfse`, o validador fiscal do Commit 04. Não há HTTP, certificado nem chamada à SEFIN.
4. Exige validação `CONFIRMADA`, situação `VIGENTE`, chave nacional igual à do documento e CNPJ do papel conforme a direção (`EMITIDA` no emitente, `RECEBIDA` no tomador). `dCompet` não exclui. O intermediário não conta como emitente nem tomador: essa regra permanece só no validador.
5. Calcula o SHA-256 dos bytes lidos.
6. Atualiza o checkpoint para `PERSISTIDO` com hash, caminho relativo e tamanho. O arquivo não é regravado.

Sem confirmação fiscal integral, o documento não é promovido.

| Conteúdo do órfão | Efeito |
|---|---|
| Fiscalmente confirmado, vigente, da mesma chave, CNPJ e direção | `PERSISTIDO`, com o SHA-256 do arquivo |
| Arquivo ausente | Continua `PENDENTE` |
| Estrutura bem formada, mas o validador não confirma | Continua `PENDENTE`, código `XML_NAO_CONFIRMADO`, arquivo intacto |
| Malformado, vazio ou HTML | `INCONSISTENTE`, arquivo intacto |
| CNPJ do papel de outra empresa | `INCONSISTENTE`, código `CNPJ_DIVERGENTE` |
| Direção incorreta (o papel conferido não é o da empresa) | `INCONSISTENTE`, código `CNPJ_DIVERGENTE` |
| `chNFSe` diferente da chave do documento | `INCONSISTENTE`, código `CHAVE_DIVERGENTE` |
| Tamanho acima de 4_000_000 bytes | `INCONSISTENTE`, código `XML_EXCEDE_LIMITE`, sem ler o corpo |
| Situação diferente de `VIGENTE` | `INCONSISTENTE`, código `SITUACAO_NAO_VIGENTE` |

`persistirXml` exige a mesma confirmação fiscal antes de gravar. O mesmo hash reutiliza o arquivo e hash diferente lança `CONFLITO_HASH`, sem sobrescrever. A promoção do órfão acontece na retomada, não numa nova consulta.

## Idempotência

A identidade é empresa, período, inventário e chave nacional. Criar o checkpoint de novo com a mesma identidade devolve o checkpoint existente, inclusive o `execucaoId` original. Persistir o mesmo XML duas vezes não cria segundo arquivo. Persistir outro XML na mesma chave não sobrescreve.

## SHA-256

O hash do XML é SHA-256 do buffer UTF-8, em hexadecimal de 64 caracteres. O fingerprint do inventário é outro SHA-256, calculado só sobre CNPJ, período e a lista ordenada de chave, direção e situação.

Um documento só conta como persistido quando o arquivo existe, o tamanho é maior que zero e o hash recalculado é igual ao metadado. Existir o arquivo ou constar `PERSISTIDO` no JSON, isoladamente, não basta.

## Reconciliação

`reconciliarNfse(inventario, checkpoint, arquivosVerificados)` não lê disco e não usa `dCompet`.

O relatório traz totais de descobertos, vigentes, canceladas e indeterminadas; persistidos íntegros; pendentes; falha transitória; falha permanente; inconsistências; cobertura; chaves faltantes, excedentes e duplicadas; divergências de hash; e a conclusão.

Cobertura = persistidos íntegros / vigentes. Cancelada não entra no denominador. Com zero vigentes e nenhuma inconsistência bloqueante, a cobertura é `1`. Com zero vigentes e inconsistência bloqueante, a cobertura é `0`. Não há divisão por zero.

XML de nota cancelada ou indeterminada, chave fora do inventário e chave repetida no checkpoint ou na lista de arquivos são excedentes ou duplicidades. Não são justificados por `dCompet`.

## Critério de conclusão

A conclusão é `RECONCILIADA` somente quando tudo isto vale ao mesmo tempo:

- completude `COMPLETO`
- CNPJ, período, versão e fingerprint conferem
- totais coerentes
- nenhuma indeterminada
- todo vigente está `PERSISTIDO` com hash verificado no arquivo
- nenhuma chave faltante
- nenhuma chave excedente
- nenhuma chave duplicada
- nenhuma inconsistência bloqueante
- cancelada, quando existe, está `EXCLUIDA_DA_RECUPERACAO`

Sucesso HTTP não entra neste critério. Arquivo ausente ou corrompido impede a conclusão.

## Falhas

| Código | Quando |
|---|---|
| `DESCOBERTA_INCOMPLETA` | Completude diferente de `COMPLETO` |
| `INCONSISTENCIA_INVENTARIO` | Chave, duplicidade, CNPJ, período ou totais |
| `SITUACAO_INDETERMINADA` | Indeterminada bloqueia persistência e retomada automáticas |
| `IDENTIDADE_DIVERGENTE` | Outro CNPJ, outro período ou outro fingerprint |
| `CHECKPOINT_CORROMPIDO` | JSON inválido ou estrutura incompleta |
| `VERSAO_INCOMPATIVEL` | `versaoFormato` diferente de `1` |
| `CONFLITO_HASH` | XML já gravado com outro conteúdo |
| `FALHA_ESCRITA` | Disco ou conferência após a gravação |
| `CAMINHO_INVALIDO` | Path traversal, CNPJ ou chave fora do formato |
| `CHECKPOINT_EM_USO` | Outra operação já segura este CNPJ e período. A segunda falha e não espera |
| `TRAVA_ORFA` | Trava em disco sem dono comprovado, ou cujo encerramento não pôde ser provado. A trava não é removida |
| `CHECKPOINT_AUSENTE` | Não há JSON para o CNPJ e o período |
| `XML_AUSENTE` / `XML_INCONSISTENTE` | Retomada sem arquivo, ou com arquivo truncado ou hash diferente |
| `XML_VAZIO` | Persistência com XML vazio. Nada é gravado |
| `XML_NAO_CONFIRMADO` | Persistência ou órfão sem validação fiscal `CONFIRMADA`. Na persistência nada é gravado; no órfão o documento permanece `PENDENTE` |
| `XML_EXCEDE_LIMITE` | Órfão maior que o teto de XML. Não é lido nem promovido |
| `CHAVE_DIVERGENTE` / `CNPJ_DIVERGENTE` / `XML_MALFORMADO` | Códigos do validador fiscal. Na persistência a gravação é recusada; no órfão o documento fica `INCONSISTENTE` |

Falha transitória e falha permanente são registradas com diagnóstico. Nenhuma das duas dispara nova consulta.

## Segurança

- Raiz injetada. Sem caminho operacional fixo.
- Segmentos validados antes de `path.resolve`.
- Temporário no mesmo diretório do destino.
- Permissão `0600` no arquivo temporário.
- XML integral não é escrito em log por este módulo.
- O checkpoint não armazena segredo.

Persistência inicial e retomada reutilizam `validarXmlNfse` sem alterar o validador e sem abrir transporte. O documento precisa ser o vigente daquele checkpoint.

## Concorrência

A trava é exclusiva por CNPJ e período, no diretório `{raiz}/.travas/{cnpj}/{período}.lock`. O `mkdir` do diretório é a aquisição. O arquivo `dono.json` guarda pid, token de 32 hex e o instante. A segunda operação falha na hora com `CHECKPOINT_EM_USO` e não espera. Um conjunto em memória da instância preserva essa falha imediata quando a mesma instância já entrou na operação.

A liberação fica no `finally` e só apaga a trava cujo pid e token são os desta aquisição. Falha ao gravar o dono remove o diretório que esta aquisição acabou de criar, antes de começar a operação de negócio.

Trava de outro processo vivo não é removida. Trava sem `dono.json` legível, com conteúdo a mais, ou cujo `process.kill(pid, 0)` não responde `ESRCH`, também não. O código nesse caso é `TRAVA_ORFA` ou `CHECKPOINT_EM_USO`. A recuperação da trava órfã só ocorre quando uma leitura vê o pid morto e uma segunda leitura repete o mesmo pid e o mesmo token. Aí o diretório é removido e a aquisição tenta de novo, uma vez.

`PQueue` e o worker não foram alterados.

## Limitações

- A raiz isolada não está ligada ao storage da empresa nem ao worker.
- Não há retry automático nem consulta SEFIN.
- Reuso de pid: se o pid do dono morto for reaproveitado por outro processo, `kill` responde como processo vivo e a trava fica até esse pid terminar ou alguém remover o diretório. A trava não é roubada.
- Trava deixada por esta mesma instância de processo (pid igual ao atual) não é recuperada, porque o processo ainda está vivo. Outra instância no mesmo processo recebe `CHECKPOINT_EM_USO`.
- Queda entre o `mkdir` e o `dono.json` deixa trava sem dono. A operação seguinte responde `TRAVA_ORFA` e não apaga o diretório.
- `process.kill(pid, 0)` não atravessa namespace de pid. Dois processos em namespaces diferentes não provam morte um do outro por esse meio.
- A suíte cobre duas instâncias no mesmo processo e o pid vivo ou morto. Não sobe dois processos de checkpoint ao mesmo tempo, para não introduzir teste instável.
- Temporário órfão após queda do processo não é varrido na abertura.
- Checkpoints antigos não são apagados.

## Testes

`checkpoint.test.ts` cobre 63 comportamentos offline, em diretório temporário. Os 40 iniciais seguem: criação, identidade, fingerprint, ordem, outra empresa, outro período, inventário divergente, JSON corrompido, versão, XML, hash, arquivo ausente, truncado, hash divergente, reutilização, duplicidade de gravação, conflito, interrupção antes do rename, depois do XML e antes do checkpoint, retomada de pendente e de `EM_PROCESSAMENTO`, falha transitória e permanente, cancelada, indeterminada, reconciliação completa, parcial e inconsistente, cobertura total, parcial e zero vigentes, chave excedente, faltante e duplicada, path traversal, falha de escrita, checkpoint de outra empresa, execução repetida e concorrência na mesma instância.

O teste 19 grava XML fiscal válido e interrompe o checkpoint: a retomada promove o órfão a `PERSISTIDO`. O teste 22 grava XML sem `infNFSe` e permanece `PENDENTE` com `XML_NAO_CONFIRMADO`.

A revisão 22.5.1 acrescenta os testes 41 a 54: XML gravado sem checkpoint, promoção do órfão válido (pendente e `EM_PROCESSAMENTO`) com SHA-256, outra empresa (inclusive CNPJ só no intermediário), chave divergente, XML malformado e acima do limite, direção incorreta, hash do órfão conferido com o arquivo, ausência de cliente HTTP no módulo, `PERSISTIDO` íntegro sem regravação, duas instâncias, duas atualizações concorrentes, falha na aquisição, liberação depois de erro e trava órfã de pid encerrado sem roubar trava do pid atual.

A correção 22.5.2 acrescenta os testes 55 a 63: XML fiscal válido na persistência, recusa sem `infNFSe`, malformado, chave divergente, CNPJ divergente, direção divergente, XML válido persistido e retomado sem regravação, XML inválido sem arquivo e sem atualização do checkpoint. `persistirXml` e a retomada exigem `CONFIRMADA`.

Não há arquivo de cliente, certificado, SEFIN nem Chromium.

Validação desta correção, em `Backend`:

- `npm run typecheck` — sucesso
- `npm test` — 24 arquivos, 326 testes, todos passando (63 em `checkpoint.test.ts`)

Não foram executados `test:smoke-db`, `test:smoke-storage` nem `test:playwright`.

## Pendências

Commit 06, ainda não feito:

- Persistência definitiva na raiz operacional da empresa, com auditoria.
- Adaptar o certificado A1 cadastrado ao transporte mTLS, sem logar senha ou PFX.

Commit 07, ainda não feito:

- Integrar este checkpoint ao worker operacional, somente com descoberta completa e sem indeterminada.
- Gravar o XML recuperado nesta raiz, sem misturar com os downloads atuais.
- Tratar falha transitória com tentativa controlada. Esta etapa não tenta de novo.

Antes da integração operacional, a trava entre processos precisa ser aceita com as limitações desta revisão: reuso de pid, trava sem dono e namespace de pid não são resolvidos aqui. Execução paralela sobre o mesmo CNPJ e período continua proibida até essa decisão.
