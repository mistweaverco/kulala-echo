import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { RedirectStatusCode } from "hono/utils/http-status";
import {
  canonicalHeader,
  createSimpleRoute,
  getClientOrigin,
  getDefaultResponseBody,
  getDefaultRoute,
  jsonResponse,
  registerAllMethods,
} from "../utils";

const rootRouter = new OpenAPIHono();
const MAX_REDIRECT_COUNT = 20;

const methodRoutes = [
  { path: "/post", method: "post" as const, summary: "Echo a POST request" },
  { path: "/get", method: "get" as const, summary: "Echo a GET request" },
  { path: "/put", method: "put" as const, summary: "Echo a PUT request" },
  { path: "/delete", method: "delete" as const, summary: "Echo a DELETE request" },
  { path: "/patch", method: "patch" as const, summary: "Echo a PATCH request" },
];

for (const route of methodRoutes) {
  rootRouter.openapi(
    getDefaultRoute({
      tags: ["HTTP Methods"],
      summary: route.summary,
      path: route.path,
      method: route.method,
      requestDescription: `${route.method} data to the server`,
      responseDescription: "200 OK",
    }),
    async (c) => getDefaultResponseBody(c),
  );

  // OPTIONS allowed; other wrong methods → 405
  rootRouter.openapi(
    createSimpleRoute({
      tags: ["HTTP Methods"],
      summary: `${route.summary} (OPTIONS)`,
      method: "options",
      path: route.path,
      responses: { 200: { description: "OK" } },
    }),
    (c) => {
      c.header("Allow", `${route.method.toUpperCase()}, OPTIONS`);
      return c.body(null, 200);
    },
  );

  for (const method of ["get", "post", "put", "patch", "delete", "head"] as const) {
    if (method === route.method) continue;
    rootRouter.on(method, route.path, (c) => {
      c.header("Allow", `${route.method.toUpperCase()}, OPTIONS`);
      return c.json({ error: "Method Not Allowed" }, 405);
    });
  }
}

const echoHandler = async (c: Context) => getDefaultResponseBody(c);

registerAllMethods(rootRouter, {
  tags: ["HTTP Methods"],
  summary: "Accept any HTTP method and echo the request",
  path: "/any",
  handler: echoHandler,
});

registerAllMethods(rootRouter, {
  tags: ["HTTP Methods"],
  summary: "Accept any HTTP method with an extra path segment",
  path: "/any/{path}",
  parameters: [{ name: "path", in: "path", required: true, schema: { type: "string" } }],
  handler: echoHandler,
});

registerAllMethods(rootRouter, {
  tags: ["HTTP Methods"],
  summary: "Alias for /any",
  path: "/anything",
  handler: echoHandler,
});

registerAllMethods(rootRouter, {
  tags: ["HTTP Methods"],
  summary: "Alias for /any/{path}",
  path: "/anything/{path}",
  parameters: [{ name: "path", in: "path", required: true, schema: { type: "string" } }],
  handler: echoHandler,
});

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Headers"],
    summary: "Return the request headers",
    method: "get",
    path: "/headers",
    responses: {
      200: jsonResponse({
        type: "object",
        properties: {
          headers: { type: "object", additionalProperties: { type: "string" } },
        },
      }),
    },
  }),
  (c) => c.json({ headers: c.req.header() }),
);

const responseHeadersHandler = (c: Context) => {
  const url = new URL(c.req.url);
  const data: Record<string, string | string[]> = {};

  url.searchParams.forEach((value, name) => {
    const key = canonicalHeader(name);
    const existing = data[key];
    if (existing !== undefined) {
      data[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      data[key] = value;
    }
    c.header(key, value);
  });

  if (!data["Content-Type"]) {
    c.header("Content-Type", "application/json");
    data["Content-Type"] = "application/json";
  }

  let body = "";
  for (;;) {
    body = JSON.stringify({ responseHeaders: data });
    const length = String(body.length);
    if (data["Content-Length"] === length) break;
    data["Content-Length"] = length;
    c.header("Content-Length", length);
  }

  return c.body(body);
};

const responseHeadersResponses = {
  200: jsonResponse({
    type: "object",
    properties: { responseHeaders: { type: "object" } },
  }),
};

for (const path of [
  "/response-headers",
  "/response-header",
  "/respond-with-headers",
  "/respond-with-header",
]) {
  for (const method of ["get", "post"] as const) {
    rootRouter.openapi(
      createSimpleRoute({
        tags: ["Headers"],
        summary: `Set response headers from query parameters (${path})`,
        method,
        path,
        responses: responseHeadersResponses,
      }),
      responseHeadersHandler,
    );
  }
}

const handleRedirect = (c: Context) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Need url parameter" }, 400);
  }
  let statusCode = 302;
  const statusParam = c.req.query("status_code") ?? c.req.query("status");
  if (statusParam) {
    const parsed = Number.parseInt(statusParam, 10);
    if (Number.isNaN(parsed)) {
      return c.json({ error: "status_code must be an integer" }, 400);
    }
    if (parsed >= 300 && parsed <= 399) {
      statusCode = parsed;
    } else {
      statusCode = 302;
    }
  }
  return c.redirect(url, statusCode as RedirectStatusCode);
};

const redirectParameters = [
  {
    name: "url",
    in: "query" as const,
    required: true,
    schema: { type: "string" as const },
    description: "Target URL or path to redirect to",
  },
  {
    name: "status_code",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const },
    description: "HTTP redirect status code (300–399)",
  },
  {
    name: "status",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const },
    description: "Alias for status_code",
  },
];

const redirectResponses = {
  302: { description: "Found" },
  400: jsonResponse({ type: "object", properties: { error: { type: "string" } } }, "Bad Request"),
};

for (const path of ["/redirect", "/redirect-to"]) {
  rootRouter.openapi(
    createSimpleRoute({
      tags: ["Redirect"],
      summary: "Redirect to the URL given in the url query parameter",
      method: "get",
      path,
      parameters: redirectParameters,
      responses: redirectResponses,
    }),
    handleRedirect,
  );
}

const handleRedirectCount = (c: Context, mode: "relative" | "absolute" | "plain") => {
  const n = Number.parseInt(c.req.param("count") ?? "", 10);
  if (Number.isNaN(n) || n < 0) {
    return c.json({ error: "count must be a non-negative integer" }, 400);
  }
  if (n > MAX_REDIRECT_COUNT) {
    return c.json({ error: `count cannot be greater than ${MAX_REDIRECT_COUNT}` }, 400);
  }
  if (n > 1) {
    const target = mode === "absolute" ? `/absolute-redirect/${n - 1}` : String(n - 1);
    return c.redirect(target);
  }
  const target = mode === "absolute" ? "/anything" : "../anything";
  return c.redirect(target);
};

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Redirect"],
    summary: "Relative redirect chain",
    method: "get",
    path: "/redirect/{count}",
    parameters: [{ name: "count", in: "path", required: true, schema: { type: "integer" } }],
    responses: redirectResponses,
  }),
  (c) => handleRedirectCount(c, "plain"),
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Redirect"],
    summary: "Relative redirect chain",
    method: "get",
    path: "/relative-redirect/{count}",
    parameters: [{ name: "count", in: "path", required: true, schema: { type: "integer" } }],
    responses: redirectResponses,
  }),
  (c) => handleRedirectCount(c, "relative"),
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Redirect"],
    summary: "Absolute redirect chain",
    method: "get",
    path: "/absolute-redirect/{count}",
    parameters: [{ name: "count", in: "path", required: true, schema: { type: "integer" } }],
    responses: redirectResponses,
  }),
  (c) => handleRedirectCount(c, "absolute"),
);

const ipHandler = (c: Context) => {
  const origin = getClientOrigin(c);
  const format = c.req.param("format");
  if (format === "txt") {
    return c.text(origin);
  }
  return c.json({ origin });
};

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Client"],
    summary: "Return the client IP address",
    method: "get",
    path: "/ip",
    responses: {
      200: jsonResponse({
        type: "object",
        properties: { origin: { type: "string" } },
      }),
    },
  }),
  ipHandler,
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Client"],
    summary: "Return the client IP as plain text",
    method: "get",
    path: "/ip.txt",
    responses: {
      200: { description: "OK", content: { "text/plain": { schema: { type: "string" } } } },
    },
  }),
  (c) => c.text(getClientOrigin(c)),
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Client"],
    summary: "Return the client IP as JSON",
    method: "get",
    path: "/ip.json",
    responses: {
      200: jsonResponse({
        type: "object",
        properties: { origin: { type: "string" } },
      }),
    },
  }),
  (c) => c.json({ origin: getClientOrigin(c) }),
);

export { rootRouter };
