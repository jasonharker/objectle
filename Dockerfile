FROM node:26.13.1-alpine3.24 AS build
RUN npm install --global pnpm@12.23.0
WORKDIR /app
COPY . .
# CI=true lets the second, production-only install replace node_modules without a TTY prompt.
ENV CI=true
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm install --frozen-lockfile --prod

# The API is TypeScript run by Node's type stripping, so it ships as source.
FROM gcr.io/distroless/nodejs26-debian13:nonroot
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared packages/shared
COPY --from=build /app/packages/api/package.json packages/api/
COPY --from=build /app/packages/api/node_modules packages/api/node_modules
COPY --from=build /app/packages/api/src packages/api/src
COPY --from=build /app/packages/client/dist packages/client/dist
# Served until the curation build ships the real bundle; see content/placeholder/README.md.
COPY --from=build /app/content/placeholder content/placeholder
# OBJECTLE_SIGNING_KEY (a secret), OBJECTLE_LAUNCH_DATE and OBJECTLE_CONTENT_DIR
# (the content bundle) come from the deployment.
ENV OBJECTLE_CLIENT_DIR=/app/packages/client/dist PORT=8080
# Numeric, so a pod's runAsNonRoot can verify it.
USER 65532:65532
EXPOSE 8080
CMD ["packages/api/src/server.ts"]
