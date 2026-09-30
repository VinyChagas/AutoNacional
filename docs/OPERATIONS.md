# Operação

## Logs

O backend usa Pino em JSON, com timestamp ISO e nível (`LOG_LEVEL`, padrão `info`). Cada logger tem o campo `module`.

Empresas concluídas geram um log de sucesso com CNPJ e contagens. Falhas geram `error` com a mensagem. A senha, o PFX e a chave do 2Captcha não devem aparecer; a chave do captcha nos relatórios de diagnóstico é mascarada.

Dentro do container:

```bash
docker compose logs -f --tail 200 backend
```

No host, os relatórios de captcha e demais arquivos de `logsPath` ficam em `/srv/data/autonacional/logs`.

## Healthcheck

`GET /health` executa `SELECT 1`.

- 200 e `"database":"ok"`: PostgreSQL acessível
- 503 e `"database":"error"`: falha de conexão; o detalhe fica só no log do processo

O campo `queue` mostra `pending`, `running` e `shuttingDown`.

O frontend tem healthcheck HTTP na raiz do nginx. Ele não testa o banco.

## Workers

Não há processo worker separado. A fila é a `PQueue` dentro do backend. `running` maior que zero significa automação em andamento. Reiniciar o backend no meio de um lote interrompe as empresas ainda abertas e marca as pendentes como falha de encerramento.

## Falhas comuns

| Sintoma | Onde olhar |
|---|---|
| health 503 | rede `vinylab_internal`, `DATABASE_URL`, container `vinylab-postgres` |
| certificado não encontrado | volume `/srv/data/autonacional/certificados` e o caminho gravado no banco |
| browser não abre | log do backend, `PLAYWRIGHT_NO_SANDBOX`, espaço de `/dev/shm` |
| captcha automático falha | saldo 2Captcha e `logs/2captcha-report` |
| download sumiu após recreate | settings apontando para fora de `/app/downloads` |

## Retenção

Na subida, e depois a cada 24 horas, o backend apaga arquivos mais antigos que `settings.logRetentionDays` (padrão 30) nestas pastas:

- logs
- temporários

Downloads de XML e PDF não entram nessa limpeza. Eles são persistentes. Apague-os só com política própria de negócio.

O timer não impede o processo de encerrar.

## Encerramento

`docker compose stop backend` envia SIGTERM. O entrypoint repassa o sinal ao Node. O Node fecha HTTP, browsers, storage e Prisma, nessa ordem. SIGINT faz o mesmo em desenvolvimento.

Não use `kill -9` como rotina: o browser e as conexões do Prisma ficam para o sistema operacional recolher, e execuções em andamento podem permanecer `em_execucao`.

## Smokes

Estes comandos só testam banco e storage. Eles não abrem o Portal NFS-e.

```bash
cd Backend
npm run test:smoke-db
npm run test:smoke-storage
```

Eles usam o `.env` local. Não os aponte para produção se o script for escrever; leia o script antes de rodá-lo contra a VPS.
