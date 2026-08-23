FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:22-alpine AS production
ARG APP_VERSION=dev
LABEL org.opencontainers.image.title="Screenwriter Web" \
      org.opencontainers.image.version="${APP_VERSION}"
ENV NODE_ENV=production PORT=3000 SCREENWRITER_DATA_DIR=/data APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
VOLUME ["/data"]
CMD ["node", "server-dist/index.js"]
