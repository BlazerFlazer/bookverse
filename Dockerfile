FROM node:24-slim

# OpenSSL нужен движку Prisma, шрифт с кириллицей нужен обложкам книг.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

# Сайт собирается на Vercel, здесь нужны только сервер, бот и их пакеты.
RUN npm ci --workspace=@bookverse/server --workspace=@bookverse/bot --include=dev --no-audit --no-fund
RUN npm run db:generate --workspace=@bookverse/server

RUN mkdir -p /data
ENV NODE_ENV=production
ENV DATABASE_URL="file:/data/bookverse.db?connection_limit=1"

CMD ["node", "deploy/start.mjs"]
