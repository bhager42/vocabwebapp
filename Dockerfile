# syntax=docker/dockerfile:1

# The image the app is built in: Node 26 LTS on Debian 13 slim, pinned by multi-arch index digest.
# To update: pull the new tag, then replace both the tag and the digest.
ARG NODE_IMAGE=docker.io/library/node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
# The image the app runs in, pinned the same way. It must carry the same major version
# of Node as the build image, because better-sqlite3 is compiled code.
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs26-debian13@sha256:80631bd2f0e7ef192138a7409013b47d92fd11b8ff3bb35f5c0a65be3ecaea4c

# ---- build: install everything, build, then drop dev dependencies ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev && mkdir /empty

# ---- runtime: production dependencies and build output only ----
# A "distroless" image: Node and the libraries it needs, with no shell, no package manager
# and no npm, so there is far less in it to keep patched. Same Node version as above.
FROM ${RUNTIME_IMAGE} AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app

# /data is the only writable path. 568 is the TrueNAS "apps" user. There is no shell in
# this image to run mkdir with, so the empty folder is copied in from the build stage.
COPY --from=build --chown=568:568 /empty /data

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/content ./content
COPY package.json server.js ./

USER 568:568
EXPOSE 3000
VOLUME /data

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# The image's entry point is node itself.
CMD ["server.js"]
