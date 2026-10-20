# NFS-e nativa — etapa 22.4 — recuperação de XML pela SEFIN

Revisão 22.4.1. O módulo de recuperação faz parte do backend do AutoNacional. Ele consulta a API governamental da SEFIN Nacional para obter o XML de uma NFS-e já descoberta. Não usa o NFSExplorer, não cria serviço intermediário e não é chamado pelo worker de execução.

A SEFIN é o endpoint `https://sefin.nfse.gov.br/SefinNacional`. Uma página do Playwright autenticada não autentica o cliente HTTP.

## Auditoria do certificado A1 já existente

| Ponto | O que o AutoNacional faz hoje |
|---|---|
| Cadastro | Upload e importação em lote gravam o PFX da empresa |
| Arquivo | Caminho relativo no storage, no padrão `empresa/{cnpj}/certs/{arquivo}.pfx` |
| Senha | Campo criptografado, aberto por `decryptPassword` |
| Uso na execução | `carregarCertificadoPorCnpj` devolve o PFX e a senha em memória |
| Playwright | O contexto do Chromium recebe esse PFX para o login no portal |
| mTLS HTTP | Não existe cliente Node com certificado de cliente |
| Bibliotecas | `node-forge` lê o PKCS#12; o módulo `https` do Node está disponível; não há Axios |
| Seleção | O certificado da execução é o da empresa, pelo CNPJ |
| Expiração | O cadastro calcula validade e marca certificado vencido na operação da empresa |
| Senha inválida | O parser do PFX recusa a senha no cadastro |

O PFX do navegador não serve para a chamada SEFIN. Ligar `carregarCertificadoPorCnpj` agora puxaria banco e storage para este módulo. A etapa deixa a interface `ProvedorCredencialMtls` e recebe o PKCS#12 já em memória. A adaptação ao cadastro fica para o Commit 05. Cadastro, senha, storage e login do navegador não foram alterados.

## Arquivos

```text
Backend/src/automation/nfse/recovery/
  types.ts
  mtls-provider.ts
  sefin-client.ts
  response-parser.ts
  xml-validator.ts
  recovery-service.ts
  recovery.test.ts
  index.ts
```

Nenhum arquivo do worker, do Prisma ou do frontend foi modificado.

## Função pública

```ts
recuperarXmlNfse({
  chave,
  cnpj,
  direcao,
  credencial,
  transporte,
  periodoConsulta,
  situacao,
  baseUrl,
  limites,
})
```

`planejarRecuperacaoSefin(inventario)` decide se a recuperação automática pode começar.

A chave precisa ser exatamente 50 dígitos, sem espaço e sem sufixo. O CNPJ precisa ter 14 dígitos. Nota `CANCELADA` ou `INDETERMINADA` não gera consulta.

## Transporte mTLS

`criarTransporteHttpsMtls` abre um `https.Agent` por requisição, com o PFX e a senha só nessa chamada. `rejectUnauthorized` permanece `true`. O agente da consulta é destruído ao fim e também após timeout, erro de socket, limite de tamanho, erro no meio do corpo e exceção ao criar a requisição. Não há agente global nem alteração de TLS do processo.

Antes da rede, `inspecionarCredencialMtls` lê o PKCS#12 com `node-forge`:

- arquivo vazio: `CERTIFICADO_INDISPONIVEL`
- senha recusada: `SENHA_INVALIDA`
- validade vencida: `CERTIFICADO_EXPIRADO`

Quando o arquivo tem vários certificados, vale o certificado de cliente cuja chave pública corresponde à chave privada e que não é CA (`basicConstraints.cA`). Antes podia ser usado o primeiro `certBag`, inclusive uma CA intermediária.

A URL só é aceita em `https://sefin.nfse.gov.br/SefinNacional/nfse/{chave}`. Outro host é recusado. A chave da nota não escolhe o host.

Os testes injetam um transporte simulado. O transporte real não é acionado pela suíte.

## Consulta e resposta

A consulta é `GET /SefinNacional/nfse/{chave}`. Não há POST nem lote.

HTTP 200 não basta. O corpo precisa ser JSON com `nfseXmlGZipB64`. O campo é decodificado de Base64 e descomprimido de GZIP. HTML, JSON sem o campo, Base64 inválido, GZIP corrompido e XML vazio falham.

## Validação do XML

O XML sintético desta etapa segue a estrutura já observada na consulta nacional:

- raiz `NFSe`
- `infNFSe`
- `chNFSe` com a chave
- `emit/CNPJ` para o emitente
- `toma/CNPJ` para o tomador
- `dCompet` apenas como metadado

| Direção | CNPJ conferido |
|---|---|
| `EMITIDA` | Prestador, pelo pai imediato `emit`, `prest` ou `prestador` |
| `RECEBIDA` | Tomador, pelo pai imediato `toma` ou `tomador` |

A identificação do CNPJ é contextual, pelo pai imediato. CNPJ dentro de intermediário (`interm` ou `intermediario`), ou `emit` aninhado nesse participante, não vale para o papel pedido.

Chave diferente ou CNPJ do papel diferente impedem `RECUPERADO`. Se `chNFSe` ou o CNPJ do papel não puderem ser lidos, a validação fica `PENDENTE` e o resultado não é sucesso. `dCompet` de outro mês não exclui o XML nem altera `periodoConsulta`.

## Plano

| Situação do inventário | Efeito |
|---|---|
| Completo, só vigentes e canceladas | Pode iniciar. Vigente entra. Cancelada fica de fora |
| Qualquer indeterminada | Não inicia. Código `SITUACAO_INDETERMINADA` |
| Completude diferente de `COMPLETO` | Não inicia. Código `DESCOBERTA_INCOMPLETA` |
| Chave inválida, duplicada ou totais incoerentes | Não inicia. Código `INCONSISTENCIA_INVENTARIO` |

O contrato `montarPlanoRecuperacao` da etapa 22.1 permanece como está.

## Erros

| Código | Classe |
|---|---|
| Timeout, falha de conexão, HTTP 429, HTTP 500/502/503 | `TRANSITORIO` |
| HTTP 400, HTTP 404, JSON, Base64, GZIP, XML, chave ou CNPJ divergente, senha inválida, certificado expirado, limite de tamanho | `PERMANENTE` |
| Certificado indisponível, handshake TLS, HTTP 401, HTTP 403, nota cancelada ou indeterminada, URL fora da SEFIN | `BLOQUEANTE` |

Não há retentativa nesta etapa. O resultado estruturado guarda código e classe para um checkpoint futuro. Senha, PFX, chave privada e XML não entram no log. A chave e o CNPJ saem mascarados.

## Limites

| Limite | Padrão |
|---|---|
| Timeout | 20 segundos |
| Resposta JSON | 2 MB |
| GZIP | 1,5 MB |
| XML descomprimido | 4 MB |

A descompressão para ao passar o limite e descarta o buffer parcial. Os limites podem ser reduzidos na chamada.

## Testes

`recovery.test.ts` tem 27 testes offline. Eles cobrem chave, CNPJ, HTTP 200, campo ausente, JSON, Base64, GZIP, XML vazio, XML malformado, HTML, outra chave, outro CNPJ, emitida, recebida, `dCompet`, certificado, senha, handshake, timeout, HTTP 401/403/404/429/500, limites, plano e ausência de segredo no log. O certificado do teste é gerado em memória. Não há PFX de cliente, senha de produção, SEFIN real nem navegador.

Validação desta etapa, em `Backend`:

- `npm run typecheck` — sucesso
- `npm test` — 23 arquivos, 263 testes, todos passando (27 em `recovery.test.ts`)

Não foram executados `test:smoke-db`, `test:smoke-storage` nem `test:playwright`.

## Limitações

- Não há testes com PFX ICP-Brasil reais.
- A compatibilidade BER não está comprovada. BER é a exportação comum do Windows. Com DER estrito, falha de leitura vira `CERTIFICADO_INDISPONIVEL`, sem rede.
- A URI do namespace XML não é conferida. Um XML com os mesmos nomes locais e outra URI seria aceito. O leitor usa o nome local da tag. Não há biblioteca de XML instalada.

## Riscos

- O PKCS#12 ainda não sai do cadastro operacional. Sem o adaptador do Commit 05, a execução real não tem de onde ler o A1.
- A confirmação do XML exige `chNFSe` e o CNPJ do papel. Um layout sem esses elementos fica pendente, não recuperado.
- O XML confirmado fica na memória do resultado. Ainda não é gravado em disco nem vira `RECUPERADO` do contrato de arquivo, porque esse contrato exige caminho e hash persistidos.

## Pendências do Commit 05

- Adaptar `ProvedorCredencialMtls` ao certificado já cadastrado, sem passar a senha por log, URL ou `.env` novo.
- Ligar o plano ao worker só quando a descoberta estiver completa e não houver indeterminada.
- Gravar o XML recuperado e preencher caminho e hash do contrato existente.
- Definir a retomada dos erros transitórios. Esta etapa não tenta de novo.
