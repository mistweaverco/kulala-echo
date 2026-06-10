import { OpenAPIHono } from "@hono/zod-openapi";
import { SwaggerUI } from "@hono/swagger-ui";
import { cors } from "hono/cors";
import {
  authRouter,
  cookieRouter,
  imageRouter,
  rootRouter,
  statusRouter,
} from "./routes";
import { SWAGGER_DARK_CSS } from "./swagger-theme";

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
app.route("/", rootRouter);
app.route("/", authRouter);
app.route("/auth", authRouter);
app.route("/image", imageRouter);
app.route("/status", statusRouter);
app.route("/cookies", cookieRouter);
app.doc("/openapi.json", {
  openapi: "3.0.0",
  info: {
    version: "1.0.0",
    title: "echo",
    description: "A httpbun.com-compatible HTTP testing service",
  },
  tags: [
    {
      name: "HTTP Methods",
      description: "Echo request details for standard and wildcard HTTP methods",
    },
    {
      name: "Headers",
      description: "Inspect and set response headers",
    },
    {
      name: "Redirect",
      description: "Redirect testing endpoints",
    },
    {
      name: "Client",
      description: "Client IP and User-Agent details",
    },
    {
      name: "Auth",
      description: "Basic, Bearer, and Digest authentication",
    },
    {
      name: "Cookies",
      description: "Set and inspect cookies",
    },
    {
      name: "Status",
      description: "Return arbitrary HTTP status codes",
    },
    {
      name: "Images",
      description: "Static image serving with content negotiation",
    },
  ],
});

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
