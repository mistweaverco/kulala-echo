# kulala-echo

A [httpbun.com](https://httpbun.com/)-compatible HTTP testing service built with [Bun](https://bun.sh) and [Hono](https://hono.dev).

Kulala Echo aims for httpbun parity (excluding `/run` and `/llm/*`), plus WebSocket, gRPC, and OIDC extensions used by [kulala.nvim](https://github.com/mistweaverco/kulala.nvim).

## Usage

```bash
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3002/ for Swagger UI.

| Service | Default |
|---------|---------|
| HTTP / WebSocket | `PORT` (default `3002`) |
| gRPC Echo | `GRPC_PORT` (default `50051`) |

### Scripts

```bash
bun run dev         # hot-reload server
bun test            # unit + route tests
bun run typecheck   # tsc --noEmit
bun run lint        # biome lint
bun run format      # biome format --write
bun run check       # biome check
bun run build       # bundle to dist/
```

### Extensions (beyond httpbun)

- **WebSocket** - `ws://host/ws` echoes messages; optional `?delay=` seconds; idle connections close after 60s (`?idle=` to override, max 120)
- **gRPC** - `Echo` service (`proto/echo.proto`): unary + streaming RPCs on `GRPC_PORT`, with [server reflection](https://github.com/grpc/grpc/blob/master/doc/server-reflection.md) (`grpcurl -plaintext localhost:50051 list`)
- **OIDC** - `/.well-known/openid-configuration`, `/oidc/jwks`, `id_token` + `refresh_token` when OAuth2 `scope` includes `openid` (token refresh via `grant_type=refresh_token`)
- **Images** - `/image` serves the [mistweaverco logo](https://mistweaverco.com/mistweaverco-logo.svg)

### Docker

#### Pull

```
docker run -d --restart=always \
  --name kulala-echo \
  -e PORT=3002 \
  -e GRPC_PORT=50051 \
  -p 3002:3002 \
  -p 50051:50051 \
  ghcr.io/mistweaverco/kulala-echo:latest
```

#### Build

```sh
docker buildx build --push \
  -t ghcr.io/mistweaverco/kulala-echo:latest \
  -f Dockerfile .
```
