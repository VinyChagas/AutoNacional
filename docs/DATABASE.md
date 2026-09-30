# Banco de dados

A aplicação fala apenas com PostgreSQL, pela `DATABASE_URL`. O cliente é o Prisma com `@prisma/adapter-pg`. O driver `pg` fica por baixo do adapter. Não há SQLite no runtime.

## Conexão

`Backend/src/db/client.ts` cria um `PrismaClient` único. `initDb()` chama `$connect()` na subida. O healthcheck executa `SELECT 1`. No SIGTERM/SIGINT, `disconnectDb()` chama `$disconnect()`.

A senha fica somente na `DATABASE_URL` do `.env` ou do ambiente do container. Ela não entra na documentação nem na imagem.

Em produção o host esperado é `vinylab-postgres`, porta 5432, banco `autonacional`, rede Docker `vinylab_internal`. Esse container já existe. O Compose deste repositório não o recria.

No Mac, `npm run tunnel:db` abre um túnel SSH para a porta local 5433. A URL local aponta para `127.0.0.1:5433`.

## Entidades usadas pelo código

Definidas em `Backend/prisma/schema.prisma`:

| Tabela | Papel |
|---|---|
| `contabilidades` | escritório ao qual empresas e certificados se vinculam |
| `empresas` | CNPJ, razão social, regime, ativo |
| `credenciais` | login CNPJ/CPF e senha criptografada |
| `certificados_digitais` | caminho do PFX, senha criptografada, validade |
| `settings` | concorrência, pastas, retenção de log, headless |
| `execucoes` | histórico por empresa |
| `execucao_batch_log` | resumo JSON do lote |
| `execucao_log_batch` / `execucao_log_item` | painel de logs |
| `automation_execution_batches` / `automation_executions` | métricas da rentabilidade |

Relações principais: contabilidade 1—N empresas; empresa 1—N credenciais e 1—N execuções; lote de automação 1—N execuções de métrica; lote de log 1—N itens.

Na subida, se `settings` estiver vazia, `seedDefaultSettings()` insere uma linha padrão. Não há seed de empresas.

## Migrations

Existem duas migrations incrementais em `Backend/prisma/migrations`. Elas não reconstroem um banco vazio: o PostgreSQL da VPS já foi criado fora deste ciclo.

Não rode `prisma migrate` nem `prisma db push` contra a VPS como parte do deploy. O schema físico de produção é a fonte já em uso.

Para um Postgres vazio de desenvolvimento (`docker-compose.local.yml`), depois do container saudável:

```bash
cd Backend
DATABASE_URL=postgresql://autonacional:autonacional@127.0.0.1:5432/autonacional?schema=public npx prisma db push
```

Isso aplica `schema.prisma` nesse banco local. A senha acima existe só no Compose de desenvolvimento.

## Tabelas para revisão manual

O código atual não referencia as tabelas abaixo. Elas apareciam na lista de um script de migração que foi removido. Não foi feita consulta nem `DROP` no PostgreSQL de produção.

- `agendamentos_execucao`
- `lacunas_execucao_empresa`
- `nfse_job_log`
- `notas_fiscais_eventos`
- `notas_fiscais_servico`
- `notificacoes`
- `status_operacional_empresa`

Confirme no banco da VPS se ainda existem e se algum processo externo as usa antes de apagar qualquer uma.

## Backup

No host da VPS, contra o container já existente:

```bash
docker exec vinylab-postgres pg_dump -U USUARIO -d autonacional -Fc -f /tmp/autonacional.dump
docker cp vinylab-postgres:/tmp/autonacional.dump /srv/data/autonacional/backups/autonacional-$(date +%F).dump
docker exec vinylab-postgres rm /tmp/autonacional.dump
```

Troque `USUARIO` pelo role real. Guarde o dump fora do Git, em `/srv/data/autonacional/backups`.

Inclua no mesmo backup a pasta `/srv/data/autonacional/certificados` e, se os XML/PDF precisarem ser restaurados, `/srv/data/autonacional/downloads`.

## Restore

Pare o backend antes de restaurar, para ninguém escrever no meio do processo.

```bash
docker compose stop backend
docker cp /srv/data/autonacional/backups/ARQUIVO.dump vinylab-postgres:/tmp/autonacional.dump
docker exec -it vinylab-postgres pg_restore -U USUARIO -d autonacional --clean --if-exists /tmp/autonacional.dump
docker exec vinylab-postgres rm /tmp/autonacional.dump
docker compose start backend
```

`--clean` apaga objetos do banco de destino antes de recriar. Use somente no restore planejado, nunca como rotina de deploy.

## Inicialização de ambiente novo

1. Suba o Postgres de desenvolvimento com `docker-compose.local.yml`, ou crie o banco vazio na VPS se um dia for necessário um segundo ambiente.
2. Aplique `prisma db push` apontando para esse banco vazio.
3. Suba o backend. A primeira conexão cria a linha padrão de `settings` se a tabela estiver vazia.
4. Coloque os PFX no volume de certificados e cadastre empresas pela interface.

Não copie o volume `autonacional_pgdata` do Compose local para a VPS. Produção continua no `vinylab-postgres`.
