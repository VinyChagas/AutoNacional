# Segurança

## O que não entra no Git

O `.gitignore` cobre `.env`, certificados (`*.pfx`, `*.p12`, `*.pem`, `*.key`), planilhas, CSV, ZIP, dumps, logs, downloads e temporários.

O `.env.example` fica versionado só com placeholders.

## Certificados na VPS

Diretório: `/srv/data/autonacional/certificados`

| Item | Recomendação |
|---|---|
| Permissão do diretório | `750` |
| Permissão dos PFX | `640` |
| Dono | o usuário que o container usa para ler o volume |
| Montagem | bind mount no serviço `backend` |
| Como a aplicação acha o arquivo | caminho relativo gravado em `certificados_digitais`, resolvido dentro de `CERT_STORAGE_PATH` |
| Backup | copiar a pasta junto com o `pg_dump` |
| Transporte | `scp` ou `rsync` por SSH, nunca commit |

A senha do certificado fica criptografada no PostgreSQL (`CRYPTO_KEY` / `APP_CRED_KEY`). Sem a chave, o arquivo sozinho não autentica. Sem o arquivo, a chave sozinha também não.

Não documente senha, nome de arquivo real de cliente nem conteúdo de PFX.

## Segredos de runtime

Ficam no `Backend/.env` da VPS ou em variáveis do Compose:

- `DATABASE_URL`
- `CRYPTO_KEY`, `APP_CRED_KEY`, `FERNET_KEY` se ainda houver dado legado cifrado com ela
- `INTERNAL_API_KEY`
- `TWOCAPTCHA_API_KEY`
- chave privada SFTP, se o driver for `sftp`

Trate qualquer segredo que já tenha passado pelo Git como comprometido, mesmo depois de removido do branch atual. O histórico antigo continua com o blob até um rewrite explícito, que esta limpeza não fez.

Ações manuais:

1. Revogar e emitir novamente o certificado que chegou a ser commitado.
2. Considerar os CSV de leads que estavam na raiz como dados já expostos no histórico, e apagá-los do disco local se não forem mais necessários.
3. Rotacionar senha do PostgreSQL e chaves de criptografia se este repositório já foi público ou compartilhado com alguém que não deveria lê-las.
4. Não rode `git filter-repo` nem force-push sem uma janela combinada: isso reescreve história e exige coordenação com todo clone.

## Rede

O backend e o frontend de produção escutam em `127.0.0.1`. A exposição pública deve passar pelo proxy que já existe na VPS. O PostgreSQL permanece só na rede Docker.

O Compose local publica Postgres em `127.0.0.1:5432` com usuário e senha `autonacional`. Essa senha é exclusiva daquele arquivo de desenvolvimento.

## Script de túnel

`Backend/scripts/ssh-tunnel-db.sh` tem host e usuário padrão. Prefira exportar `VPS_HOST` e `VPS_USER` e, quando puder, retire o padrão do script. O script não deve receber senha de banco.
