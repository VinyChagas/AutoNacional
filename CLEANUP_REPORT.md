# Relatório de limpeza

Auditoria feita no código em execução, não na documentação antiga. Nada foi apagado no PostgreSQL da VPS. A automação real contra o Portal NFS-e não foi disparada.

## Arquitetura encontrada

Frontend Angular 17 e um processo Node (Express, Socket.IO e fila `PQueue`) que abre o Chromium com Playwright. O PostgreSQL é acessado por Prisma com `@prisma/adapter-pg`. Certificados ficam em disco local ou SFTP. Não havia Docker, worker separado nem cron.

O Prisma permanece: ele é o acesso atual ao banco, não um resto de migração.

## Arquivos removidos

573 arquivos saíram do Git.

| Quantidade | Caminho | Motivo |
|---|---|---|
| 412 | `Backend/dist` | build gerado |
| 87 | `Backend/logs` | relatórios de captcha e um rar de sessão |
| 18 | `Backend/docs` | documentação de Supabase e rotas antigas |
| 15 | `docs/` | documentação anterior, substituída |
| 6 | `Backend/_conversor` | conversor Python de PDF sem caller |
| 6 | componentes Angular `certificado-upload` e `credenciais` | sem rota e sem uso nos templates |
| 4 | scripts `dump-supabase`, `fase1-backup`, `export-storage-certificados`, `generate-vps-schema` | migração única já encerrada |
| 3 | `Backend/__pycache__` | bytecode Python |
| 2 | `Backend/supabase` | SQL e cache de CLI que o runtime não carrega |
| 5 | CSV de leads na raiz | dados de clientes versionados |
| 1 | `MAX INDUSTRIA - 07-05-2026.pfx` | certificado digital versionado |
| 1 | `Backend/src/infrastructure/db.ts` | cliente `postgres` sem nenhum import |
| 1 | `Backend/settings.json` | settings reais estão na tabela `settings` |
| 1 | `dummy` | notebook vazio |
| 1 | `package.json` e `package-lock.json` da raiz | manifesto vazio, sem workspace |
| vários | READMEs e notas de migração na raiz, no Backend e no Frontend | substituídos pela documentação nova |

O PFX e os CSV foram tirados do índice e continuam no disco desta máquina. Pastas locais já ignoradas (`CERTIFICADO e-CNPJ/`, `certificados digitais/`, `Backend/dumps/`, `Backend/certificados_armazenados/`) não foram apagadas.

## Dependências removidas

| Tecnologia | Motivo |
|---|---|
| `better-sqlite3`, `@prisma/adapter-better-sqlite3`, `@types/better-sqlite3` | SQLite não é mais o banco |
| `chromedriver` | a automação usa Playwright |
| `postgres` (dependência direta) | só era usado por `infrastructure/db.ts` |
| `@playwright/test` no frontend | não havia suíte Playwright no Angular |
| script `ng lint` | o `angular.json` não tem target de lint |

O lock do Prisma ainda declara `better-sqlite3` como peer opcional da CLI e aninha o pacote `postgres` dentro da própria CLI. Nenhum dos dois é dependência direta da aplicação.

Mantidos de propósito: `prisma`, `@prisma/client`, `@prisma/adapter-pg`, `pg`, `playwright`, `ssh2`, `xlsx`, `socket.io`.

## Tecnologias históricas removidas

- Supabase no runtime e nos scripts de dump. A migração para o PostgreSQL da VPS já tinha acontecido.
- SQLite / adapter better-sqlite3.
- ChromeDriver.
- Conversor Python de DANFSe.
- `package.json` vazio na raiz.

## Arquivos sensíveis encontrados

| Tipo | Localização | Ação |
|---|---|---|
| Certificado PFX | raiz do repositório, nome de cliente no arquivo | removido do Git; cópia local preservada; ignorado por `*.pfx` |
| CSV de leads | cinco arquivos na raiz | removidos do Git; cópias locais preservadas; ignorados por `*.csv` |
| `.env` | `Backend/.env` | já estava fora do índice; continua ignorado |
| dumps e PFX locais | `Backend/dumps`, pastas de certificados | já ignorados; não foram apagados do disco |
| host padrão de SSH | `Backend/scripts/ssh-tunnel-db.sh` | script mantido; o host padrão continua no arquivo |

O histórico do Git ainda contém o certificado e os CSV. Trate-os como expostos. Veja [docs/SECURITY.md](docs/SECURITY.md).

## Código morto removido

- Cliente SQL solto em `infrastructure/db.ts`.
- Telas Angular de upload de certificado e de credenciais, já cobertas pela tela de Empresas.
- Scripts npm `db:dump`, `db:export-storage` e `migration:fase1`.

Não foram reescritas autenticação, fila, captcha, Socket.IO, downloads nem regras de concorrência. O que entrou em volta disso foi operacional: healthcheck com `SELECT 1`, parada da fila no SIGTERM/SIGINT, `prisma.$disconnect()`, limpeza de logs e temporários por idade, e flags de Chromium só quando `PLAYWRIGHT_NO_SANDBOX=true`.

O teste `captcha-central.service.spec.ts` não compilava porque faltavam `attemptId` e `payloadFingerprint` no fixture. Os campos foram preenchidos para o teste existente voltar a rodar.

## Alterações estruturais

- `.gitignore` cobre segredos, certificados, planilhas, logs, dumps e builds.
- `docker-compose.yml` sobe frontend e backend na rede externa `vinylab_internal`, sem criar Postgres.
- `docker-compose.local.yml` sobe um Postgres só para desenvolvimento.
- Imagem do backend instala Chromium com as dependências do Playwright e usa Xvfb para o modo manual.
- Volumes de produção: certificados, downloads, logs e temporários em `/srv/data/autonacional/`.
- Documentação antiga substituída por `README.md` e `docs/`.

## Arquitetura final

Angular atrás de nginx, API Node com fila e Playwright no mesmo container, PostgreSQL externo `vinylab-postgres`, certificados e downloads em volumes do host.

## Deploy

```bash
cp Backend/.env.example Backend/.env
# editar DATABASE_URL, CRYPTO_KEY e demais segredos
sudo mkdir -p /srv/data/autonacional/{certificados,downloads,logs,temp,backups}
docker compose up -d --build
curl -fsS http://127.0.0.1:4321/health
```

O passo a passo completo está em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Validação

| Verificação | Resultado |
|---|---|
| `npm install` no backend | lock atualizado, 96 pacotes removidos |
| `npm install` no frontend | lock atualizado, `@playwright/test` removido |
| `tsc --noEmit` | ok |
| Vitest | 19 arquivos, 174 testes, ok |
| `ng build --configuration production` | ok, com os avisos de budget que já existiam |
| Karma ChromeHeadless | 4 testes, ok |
| `ng lint` | não havia target no `angular.json`; o script foi removido |
| `docker compose config` dos dois arquivos | ok |
| build das imagens | não executado: o daemon Docker desta máquina está parado |
| automação no Portal NFS-e | não executada |
| PostgreSQL de produção | não alterado |

Busca por imports dos arquivos removidos no código-fonte: sem referências restantes, fora do peer opcional do Prisma no lock.

## Revisão manual necessária

1. Rotacionar o certificado que foi commitado e avaliar rewrite do histórico se o remoto já recebeu esse blob.
2. Tratar os CSV de leads do histórico como dados expostos.
3. No PostgreSQL da VPS, confirmar se estas tabelas existem e se algo externo ainda as usa, antes de qualquer `DROP`: `agendamentos_execucao`, `lacunas_execucao_empresa`, `nfse_job_log`, `notas_fiscais_eventos`, `notas_fiscais_servico`, `notificacoes`, `status_operacional_empresa`.
4. Conferir se `settings.downloads_base_path`, `logs_path` e `temp_path` no banco de produção são `./downloads`, `./logs` e `./temp`. Caminho absoluto de outra máquina grava fora do volume.
5. Conferir se os caminhos de PFX gravados em `certificados_digitais` batem com a árvore em `/srv/data/autonacional/certificados`.
6. O script de túnel ainda tem host padrão. Prefira `VPS_HOST` e `VPS_USER` explícitos.
7. Subir o Docker Desktop (ou o daemon da VPS) e rodar `docker compose build` antes do primeiro `up`. Esta máquina não tinha o daemon ativo.
8. Não foi feito `git filter-repo` nem push.
