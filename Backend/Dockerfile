FROM node:20-bookworm

WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_NO_SANDBOX=true
ENV PLAYWRIGHT_HEADLESS=true
ENV NODE_OPTIONS=--openssl-legacy-provider
ENV PORT=4321

COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./

# generate do Prisma no postinstall não abre conexão; a URL só satisfaz o config.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public
RUN npm ci \
  && npx playwright install --with-deps chromium \
  && apt-get update \
  && apt-get install -y --no-install-recommends xvfb \
  && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["docker-entrypoint.sh"]
