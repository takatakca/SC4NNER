# SC4NNER sur Coolify (ou tout hôte Docker).
# Construire : docker build -t sc4nner .
# Lancer     : docker run -p 3000:3000 -v sc4nner-data:/app/data --env-file .env sc4nner
# Aucun secret dans l'image : le compte et l'adresse publique viennent des variables Coolify.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run typecheck && npm run build && npm test

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    SC4NNER_DB_PATH=/app/data/sc4nner.db
COPY --from=build /app/package.json /app/server.mjs ./
COPY --from=build /app/server ./server
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/dist ./dist
# Les étiquettes sauvegardées vivent ici : monter un stockage persistant Coolify sur /app/data,
# sinon chaque nouveau conteneur repart avec une base vide.
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
