FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache bash tini

ENV NODE_ENV=production
ENV MONKEYS_MEMORY_CONFIG=/etc/monkeys-memory/config.yaml

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY docker ./docker

RUN chmod +x /app/docker/start.sh

EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/docker/start.sh"]
