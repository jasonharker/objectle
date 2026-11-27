FROM node:26.13.1-alpine3.24 AS base
RUN npm install --global pnpm@12.23.0
WORKDIR /app
COPY . .

FROM base AS build
RUN pnpm install --frozen-lockfile \
 && pnpm build

# Only the API and the workspace packages it imports (--filter-prod, since its
# dev dependency on curation would select curation too), from a fresh install: a
# --prod reinstall over the full one prunes the links but leaves every other
# package (curation's glTF tooling, sharp, vite, playwright) in the store.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter-prod @objectle/api...

# The API is TypeScript run by Node's type stripping, so it ships as source.
FROM gcr.io/distroless/nodejs26-debian13:nonroot
WORKDIR /app
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/shared packages/shared
COPY --from=deps /app/packages/api/package.json packages/api/
COPY --from=deps /app/packages/api/node_modules packages/api/node_modules
COPY --from=deps /app/packages/api/src packages/api/src
COPY --from=build /app/packages/client/dist packages/client/dist
# Served until the curation build ships the real bundle; see content/placeholder/README.md.
COPY --from=build /app/content/placeholder content/placeholder
# OBJECTLE_SIGNING_KEY (a secret), OBJECTLE_DATABASE_URL (a secret; the Postgres
# holding the Result counters), OBJECTLE_LAUNCH_DATE and OBJECTLE_CONTENT_DIR
# (the content bundle) come from the deployment.
ENV OBJECTLE_CLIENT_DIR=/app/packages/client/dist PORT=8080
# Numeric, so a pod's runAsNonRoot can verify it.
USER 65532:65532
EXPOSE 8080
CMD ["packages/api/src/server.ts"]
