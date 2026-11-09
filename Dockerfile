# syntax=docker/dockerfile:1

# Node 26 LTS on Debian 13 slim, pinned by multi-arch index digest.
# To update: pull the new tag, then replace both the tag and the digest.
ARG NODE_IMAGE=docker.io/library/node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

# ---- build: install everything, build, then drop dev dependencies ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ---- runtime: production dependencies and build output only ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app

# /data is the only writable path. 568 is the TrueNAS "apps" user.
RUN mkdir /data && chown 568:568 /data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY package.json server.js ./

USER 568:568
EXPOSE 3000
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.js"]
