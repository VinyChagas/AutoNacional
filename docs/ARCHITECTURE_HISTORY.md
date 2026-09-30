# Histórico arquitetural

Persistência. As primeiras versões guardavam estado em JSON e chegaram a usar SQLite. Houve uma etapa com Supabase e scripts de dump para levar os dados a um PostgreSQL na VPS. O runtime atual usa esse PostgreSQL diretamente, via Prisma e o adapter `pg`. SQLite, o cliente `postgres` solto e os scripts de dump do Supabase saíram do projeto.

Automação. O browser da automação é o Chromium do Playwright. O pacote ChromeDriver não é usado.

Interface. Cadastro de empresas, certificados e credenciais ficou na tela de Empresas. As telas antigas separadas não tinham rota ativa.

Deploy. Não havia Compose. A execução contínua na VPS passa a ser frontend e backend em Docker, ligados ao Postgres que já existia na rede `vinylab_internal`.
