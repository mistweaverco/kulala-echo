FROM oven/bun AS builder
WORKDIR /usr/src/app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV GRPC_PORT=50051
USER bun
WORKDIR /app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package.json bun.lock ./
COPY src ./src
COPY static ./static
COPY proto ./proto

EXPOSE 3000
EXPOSE 50051

ENTRYPOINT [ "bun", "run", "src/index.ts" ]
