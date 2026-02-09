FROM oven/bun:latest AS build

ARG VITE_BACKEND_URL
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GITHUB_CLIENT_ID

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM caddy

WORKDIR /app
COPY Caddyfile ./
RUN caddy fmt Caddyfile --overwrite
COPY --from=build /app/dist ./dist

CMD ["caddy", "run", "--config", "Caddyfile", "--adapter", "caddyfile"]
