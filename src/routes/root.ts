import { OpenAPIHono } from "@hono/zod-openapi";
import { getConnInfo } from "hono/bun";
import type { Context } from "hono";
import { RedirectStatusCode } from "hono/utils/http-status";
import {
  createSimpleRoute,
  getDefaultResponseBody,
  getDefaultRoute,
  jsonResponse,
  registerAllMethods,
} from "./../utils";

const rootRouter = new OpenAPIHono();

const methodRoutes = [
  {
    path: "/post",
    method: "post" as const,
    summary: "The request's POST parameters",
  },
  {
    path: "/get",
    method: "get" as const,
    summary: "The request's GET parameters",
  },
  {
    path: "/put",
    method: "put" as const,
    summary: "The request's PUT parameters",
  },
  {
    path: "/delete",
    method: "delete" as const,
    summary: "The request's DELETE parameters",
  },
  {
    path: "/patch",
    method: "patch" as const,
    summary: "The request's PATCH parameters",
  },
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
  parameters: [
    {
      name: "path",
      in: "path",
      required: true,
      schema: { type: "string" },
    },
  ],
  handler: echoHandler,
});

registerAllMethods(rootRouter, {
  tags: ["HTTP Methods"],
  summary: "Alias for /any — accept any HTTP method",
  path: "/anything",
  handler: echoHandler,
});

registerAllMethods(rootRouter, {
  tags: ["HTTP Methods"],
  summary: "Alias for /any/{path} — accept any HTTP method with extra path",
  path: "/anything/{path}",
  parameters: [
    {
      name: "path",
      in: "path",
      required: true,
      schema: { type: "string" },
    },
  ],
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
    const key = name
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("-");
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

  const body = JSON.stringify({ responseHeaders: data });
  c.header("Content-Length", String(body.length));
  data["Content-Length"] = String(body.length);

  return c.body(JSON.stringify({ responseHeaders: data }));
};

const responseHeadersResponses = {
  200: jsonResponse({
    type: "object",
    properties: {
      responseHeaders: { type: "object" },
    },
  }),
};

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Headers"],
    summary: "Set response headers from query parameters",
    method: "get",
    path: "/response-headers",
    responses: responseHeadersResponses,
  }),
  responseHeadersHandler,
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Headers"],
    summary: "Set response headers from query parameters (POST)",
    method: "post",
    path: "/response-headers",
    responses: responseHeadersResponses,
  }),
  responseHeadersHandler,
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Headers"],
    summary: "Alias for /response-headers",
    method: "get",
    path: "/respond-with-headers",
    responses: responseHeadersResponses,
  }),
  responseHeadersHandler,
);

const handleRedirect = (c: Context) => {
  const url = c.req.query("url");
  if (!url) {
    return c.json({ error: "Need url parameter" }, 400);
  }
  let statusCode = 302;
  const statusParam = c.req.query("status_code") ?? c.req.query("status");
  if (statusParam) {
    const parsed = parseInt(statusParam, 10);
    if (parsed >= 300 && parsed <= 399) {
      statusCode = parsed;
    }
  }
  return c.redirect(url, statusCode as RedirectStatusCode);
};

const redirectParameters = [
  {
    name: "url",
    in: "query" as const,
    required: true,
    schema: { type: "string" },
    description: "Target URL or path to redirect to",
  },
  {
    name: "status_code",
    in: "query" as const,
    required: false,
    schema: { type: "integer" },
    description: "HTTP redirect status code (300–399)",
  },
  {
    name: "status",
    in: "query" as const,
    required: false,
    schema: { type: "integer" },
    description: "Alias for status_code",
  },
];

const redirectResponses = {
  302: { description: "Found" },
  400: jsonResponse(
    { type: "object", properties: { error: { type: "string" } } },
    "Bad Request",
  ),
};

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Redirect"],
    summary: "Redirect to the URL given in the url query parameter",
    method: "get",
    path: "/redirect",
    parameters: redirectParameters,
    responses: redirectResponses,
  }),
  handleRedirect,
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Redirect"],
    summary: "Alias for /redirect",
    method: "get",
    path: "/redirect-to",
    parameters: redirectParameters,
    responses: redirectResponses,
  }),
  handleRedirect,
);

rootRouter.openapi(
  createSimpleRoute({
    tags: ["Client"],
    summary: "Return the User-Agent header",
    method: "get",
    path: "/user-agent",
    responses: {
      200: jsonResponse({
        type: "object",
        properties: { "user-agent": { type: "string" } },
      }),
    },
  }),
  (c) => c.json({ "user-agent": c.req.header("user-agent") }),
);

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
  (c) => c.json({ origin: getConnInfo(c).remote.address }),
);

export { rootRouter };
