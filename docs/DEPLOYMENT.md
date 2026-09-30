# Deploy na VPS

Produção usa o PostgreSQL que já está no ar. O comando abaixo sobe só frontend e backend e entra na rede `vinylab_internal`.

Não use `docker-compose.local.yml` na VPS. Aquele arquivo cria outro Postgres, só para desenvolvimento.

## 1. Requisitos

- Docker Engine e Docker Compose v2
- rede Docker já criada: `vinylab_internal`
- container `vinylab-postgres` nessa rede, com o banco `autonacional`
- portas locais livres: `127.0.0.1:4321` e `127.0.0.1:8080`
- espaço para a imagem do Chromium e para `/dev/shm` de 1 GB no serviço backend

Confirme a rede:

```bash
docker network inspect vinylab_internal >/dev/null
docker ps --filter name=vinylab-postgres
```

## 2. Clone

```bash
cd /srv
git clone <URL_DO_REPOSITORIO> AutoNacional
cd AutoNacional
```

## 3. Configuração

```bash
cp Backend/.env.example Backend/.env
```

Preencha no `Backend/.env`, com os valores reais só na VPS:

```bash
DATABASE_URL=postgresql://USUARIO:SENHA@vinylab-postgres:5432/autonacional?schema=public
CRYPTO_KEY=
APP_CRED_KEY=
CORS_ORIGINS=https://SEU_DOMINIO
TWOCAPTCHA_API_KEY=
CERT_STORAGE_DRIVER=local
PLAYWRIGHT_HEADLESS=true
```

O Compose força `CERT_STORAGE_PATH=/srv/data/autonacional/certificados` e `PLAYWRIGHT_NO_SANDBOX=true`. Não versione o `.env`.

Se a interface pública passar por Caddy ou outro proxy, aponte o site para `127.0.0.1:8080`. A API e o Socket.IO saem pelo mesmo nginx do frontend (`/api` e `/socket.io`).

## 4. Diretórios persistentes

```bash
sudo mkdir -p \
  /srv/data/autonacional/certificados \
  /srv/data/autonacional/downloads \
  /srv/data/autonacional/logs \
  /srv/data/autonacional/temp \
  /srv/data/autonacional/backups
sudo chown -R root:root /srv/data/autonacional
sudo chmod 750 /srv/data/autonacional /srv/data/autonacional/certificados
sudo chmod 770 /srv/data/autonacional/downloads /srv/data/autonacional/logs /srv/data/autonacional/temp
```

O processo do container escreve nesses mounts. Ajuste o dono para o usuário do container se a escrita for negada. O padrão da imagem atual é root dentro do container, porque o Chromium do Playwright é instalado nesse usuário.

No PostgreSQL, a linha `settings` deve usar caminhos compatíveis com o container:

- downloads: `./downloads` (vira `/app/downloads`)
- logs: `./logs`
- temp: `./temp`

Um caminho absoluto de macOS nessa tabela faz a automação gravar fora do volume.

## 5. Certificados

Copie os PFX para `/srv/data/autonacional/certificados` pelo mesmo layout relativo que já está na coluna de arquivo de `certificados_digitais`. Permissão recomendada do diretório: `750`. Arquivos: `640`. Não os coloque no Git.

Backup dessa pasta faz parte do backup do sistema. Sem ela, o banco ainda tem o cadastro, mas o login por certificado falha.

## 6. Banco

Não suba outro Postgres. Não rode migration neste deploy. Confira apenas a conexão:

```bash
docker exec vinylab-postgres pg_isready -d autonacional
```

## 7. Docker

Arquivo: `docker-compose.yml` na raiz.

- `backend` e `frontend` com `restart: unless-stopped`
- healthcheck do backend chama `GET /health`, que testa o PostgreSQL
- frontend só sobe depois do backend saudável
- `stop_grace_period: 40s` no backend
- `shm_size: 1gb` para o Chromium
- Xvfb no entrypoint, para o modo manual com janela

## 8. Build

```bash
docker compose build
```

A imagem do backend instala o Chromium do Playwright 1.58 e as bibliotecas do sistema (`playwright install --with-deps chromium`), além do Xvfb.

## 9. Inicialização

```bash
docker compose up -d
docker compose ps
curl -fsS http://127.0.0.1:4321/health
curl -fsS -o /dev/null http://127.0.0.1:8080/
```

Resposta esperada do health, com banco acessível:

```json
{"status":"ok","database":"ok","queue":{"pending":0,"running":0,"shuttingDown":false}}
```

## 10. Atualização

```bash
cd /srv/AutoNacional
git pull
docker compose up -d --build
```

O volume do Postgres externo e as pastas em `/srv/data/autonacional` permanecem.

## 11. Restart

```bash
docker compose restart backend
docker compose restart frontend
```

`restart: unless-stopped` religa os containers se a VPS reiniciar e o Docker subir junto. O backend só fica saudável quando o PostgreSQL responde.

## 12. Logs

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

Arquivos de diagnóstico e captcha também ficam em `/srv/data/autonacional/logs`.

## 13. Healthcheck

```bash
curl -fsS http://127.0.0.1:4321/health || echo "backend degradado"
docker inspect --format '{{.State.Health.Status}}' autonacional-backend-1
```

O nome do container pode variar. Use `docker compose ps` para o nome real.

HTTP 503 significa PostgreSQL inacessível. A fila continua descrita no JSON.

## 14. Backup

Siga [DATABASE.md](DATABASE.md). Resumo:

1. `pg_dump` do `vinylab-postgres`
2. cópia de `/srv/data/autonacional/certificados`
3. cópia de `/srv/data/autonacional/downloads` se os XML/PDF forem obrigatórios

## 15. Restore

Pare o backend, restaure o dump no `vinylab-postgres` e reponha as pastas de certificados e downloads. Depois `docker compose start backend`. Não restaure por cima de um banco em uso.

## 16. Rollback

```bash
git checkout <COMMIT_ANTERIOR>
docker compose up -d --build
```

O rollback de código não desfaz dados já gravados no Postgres nem arquivos já baixados. Se a atualização tiver mudado dados, restaure o dump feito antes dela.
