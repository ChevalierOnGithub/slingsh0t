# Same base in both stages (bump both together): node_modules is built here and run in the second stage.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-trixie-slim
ENV NODE_ENV=production SLINGSH0T_DATA_DIR=/app/data
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/dist/web dist/web
COPY package.json tsconfig.json ./
COPY server server
COPY shared shared
COPY importer importer
COPY scripts scripts
# Created here so a fresh named volume inherits node's ownership.
RUN mkdir data && chown node:node data
USER node
EXPOSE 4317
CMD ["node", "--import", "tsx", "server/index.ts"]
