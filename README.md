# kulala-echo

A httpbun.com clone using bun.sh and hono.dev.

## Usage

```bash
bun install --frozen-lockfile
bun run dev
```

Open http://localhost:3000/ in your browser.

### Docker

#### Pull

```
docker run -d --restart=always \
  --name kulala-echo \
  -e PORT=3002 \
  -p 3002:3002 \
  ghcr.io/mistweaverco/kulala-echo:latest
```

#### Build

```sh
docker buildx build --push \
  -t ghcr.io/mistweaverco/kulala-echo:latest \
  -f Dockerfile .
```
