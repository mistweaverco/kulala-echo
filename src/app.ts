import { SwaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { ServerWebSocket } from "bun";
import { createBunWebSocket } from "hono/bun";
import { cors } from "hono/cors";
import {
  authRouter,
  cacheRouter,
  contentRouter,
  cookieRouter,
  imageRouter,
  mixRouter,
  oauthRouter,
  oidcRouter,
  rootRouter,
  statusRouter,
  streamRouter,
} from "./routes";
import { SWAGGER_DARK_CSS } from "./swagger-theme";

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

export function createApp() {
  const app = new OpenAPIHono();

  app.use("*", cors());

  app.get("/", (c) => {
    return c.html(`
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="Kulala Echo API documentation" />
        <meta name="color-scheme" content="light dark" />
        <title>echo</title>
        <style>${SWAGGER_DARK_CSS}</style>
      </head>
      <body>
        ${SwaggerUI({
          url: "/openapi.json",
          deepLinking: true,
          syntaxHighlight: {
            activated: true,
            theme: ["agate", "obsidian", "monokai", "nord"],
          },
        })}
      </body>
    </html>
  `);
  });

  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const delayMs = Number(c.req.query("delay") ?? "0") * 1000;
      // Idle timeout in seconds (default 60, hard-capped at 120).
      const IDLE_DEFAULT_SECONDS = 60;
      const IDLE_MAX_SECONDS = 120;
      const idleRaw = c.req.query("idle");
      const requested =
        idleRaw === undefined || idleRaw === "" ? IDLE_DEFAULT_SECONDS : Number(idleRaw);
      const idleSeconds = Number.isFinite(requested)
        ? Math.min(Math.max(requested, 0), IDLE_MAX_SECONDS)
        : IDLE_DEFAULT_SECONDS;
      const idleMs = idleSeconds > 0 ? idleSeconds * 1000 : 0;

      let idleTimer: ReturnType<typeof setTimeout> | undefined;

      const clearIdle = () => {
        if (idleTimer !== undefined) {
          clearTimeout(idleTimer);
          idleTimer = undefined;
        }
      };

      const armIdle = (ws: { close: (code?: number, reason?: string) => void }) => {
        clearIdle();
        if (idleMs <= 0) return;
        idleTimer = setTimeout(() => {
          ws.close(1000, "idle timeout");
        }, idleMs);
      };

      return {
        onOpen(_event, ws) {
          armIdle(ws);
        },
        async onMessage(event, ws) {
          armIdle(ws);
          if (delayMs > 0) {
            await new Promise((r) => setTimeout(r, delayMs));
          }
          if (typeof event.data === "string") {
            ws.send(event.data);
          } else if (event.data instanceof ArrayBuffer) {
            ws.send(event.data);
          } else if (ArrayBuffer.isView(event.data)) {
            const view = event.data;
            const copy = new Uint8Array(view.byteLength);
            copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
            ws.send(copy);
          }
        },
        onClose() {
          clearIdle();
        },
      };
    }),
  );

  // Document WebSocket in OpenAPI as informational GET
  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/ws",
    tags: ["WebSocket"],
    summary: "WebSocket echo endpoint (upgrade required)",
    description:
      "Upgrade to WebSocket. Messages are echoed back. Optional query `delay` (seconds) delays each echo. " +
      "Connections are closed after `idle` seconds without a client message (default 60, max 120).",
    responses: {
      101: { description: "Switching Protocols" },
    },
  });

  app.route("/", rootRouter);
  app.route("/", authRouter);
  app.route("/image", imageRouter);
  app.route("/status", statusRouter);
  app.route("/cookies", cookieRouter);
  app.route("/cookie", cookieRouter);
  app.route("/oauth2", oauthRouter);
  app.route("/", oidcRouter);
  app.route("/", streamRouter);
  app.route("/", cacheRouter);
  app.route("/", contentRouter);
  app.route("/", mixRouter);

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "echo",
      description:
        "A httpbun.com-compatible HTTP testing service with WebSocket, gRPC, and OIDC extensions. " +
        "gRPC Echo service listens on GRPC_PORT (default 50051) with server reflection. WebSocket echo at /ws.",
    },
    tags: [
      {
        name: "HTTP Methods",
        description: "Echo request details for standard and wildcard HTTP methods",
      },
      { name: "Headers", description: "Inspect and set response headers" },
      { name: "Redirect", description: "Redirect testing endpoints" },
      { name: "Client", description: "Client IP details" },
      { name: "Auth", description: "Basic, Bearer, and Digest authentication" },
      { name: "Cookies", description: "Set, delete, and inspect cookies" },
      { name: "Status", description: "Return arbitrary HTTP status codes" },
      { name: "Images", description: "Mistweaver logo images with content negotiation" },
      { name: "Stream", description: "Drip and Server-Sent Events streaming" },
      { name: "Cache", description: "Cache-Control and ETag testing" },
      { name: "Meta", description: "Health and server info" },
      { name: "Content", description: "Payload, bytes, delay, HTML, and other content helpers" },
      { name: "Mix", description: "Combine multiple response behaviours in one URL" },
      { name: "OAuth2", description: "OAuth2 authorization code flow (httpbun-compatible)" },
      { name: "OIDC", description: "OpenID Connect extension (discovery, JWKS, id_token)" },
      { name: "WebSocket", description: "WebSocket echo testing" },
    ],
  });

  return app;
}

export { websocket };
