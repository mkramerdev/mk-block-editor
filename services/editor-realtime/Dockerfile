FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS builder
WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.22.0 --activate

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @repo/editor-realtime... build
RUN pnpm --filter @repo/editor-realtime deploy --prod --legacy /out

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder --chown=node:node /out ./

USER node
EXPOSE 4455
CMD ["node", "--enable-source-maps", "dist/index.js"]
