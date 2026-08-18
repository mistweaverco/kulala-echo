import { createHash } from "node:crypto";
import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import type { Context } from "hono";
import { getConnInfo } from "hono/bun";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { echoResponseContent } from "./openapi-schemas";
import { negotiateContentType, objectToXml } from "./xml";

interface GetDefaultRouteParams {
  tags: RouteConfig["tags"];
  summary: RouteConfig["summary"];
  method: RouteConfig["method"];
  path: RouteConfig["path"];
  parameters?: RouteConfig["parameters"];
  security?: RouteConfig["security"];
  requestDescription: string;
  responseDescription: string;
  customResponses?: RouteConfig["responses"];
  requiredBody?: boolean;
}

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export const BYTES_SIZE_LIMIT = Number(process.env.ENDPOINT_BYTES_SIZE_LIMIT ?? 100_000);

export const echoResponseSchema = {
  type: "object",
  properties: {
    method: { type: "string" },
    args: { type: "object" },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    origin: { type: "string" },
    url: { type: "string" },
    form: { type: "object" },
    data: { type: "string" },
    json: { type: "object" },
    files: { type: "object" },
  },
} as const;

export const jsonResponse = (schema: Record<string, unknown>, description = "OK") => ({
  description,
  content: {
    "application/json": { schema },
  },
});

export const createSimpleRoute = (opts: {
  tags: RouteConfig["tags"];
  summary: RouteConfig["summary"];
  method: RouteConfig["method"];
  path: RouteConfig["path"];
  parameters?: RouteConfig["parameters"];
  security?: RouteConfig["security"];
  responses?: RouteConfig["responses"];
}) =>
  createRoute({
    tags: opts.tags,
    summary: opts.summary,
    method: opts.method,
    path: opts.path,
    parameters: opts.parameters,
    security: opts.security,
    responses: opts.responses ?? {
      200: jsonResponse({ type: "object" }),
    },
  });

export const registerAllMethods = (
  router: import("@hono/zod-openapi").OpenAPIHono,
  opts: {
    tags: RouteConfig["tags"];
    summary: string;
    path: RouteConfig["path"];
    parameters?: RouteConfig["parameters"];
    handler: (c: Context) => Response | Promise<Response>;
    customResponses?: RouteConfig["responses"];
  },
) => {
  for (const method of HTTP_METHODS) {
    router.openapi(
      getDefaultRoute({
        tags: opts.tags,
        summary: `${opts.summary} (${method.toUpperCase()})`,
        path: opts.path,
        method,
        parameters: opts.parameters,
        requestDescription: `${method.toUpperCase()} request`,
        responseDescription: "200 OK",
        customResponses: opts.customResponses,
        requiredBody: method !== "get" && method !== "head" && method !== "options",
      }),
      opts.handler,
    );
  }
};

export const getDefaultRoute = (opts: GetDefaultRouteParams) => {
  const defaultResponses: RouteConfig["responses"] = {
    200: {
      description: "OK",
      content: echoResponseContent,
    },
  };
  if (opts.customResponses) {
    for (const [key, value] of Object.entries(opts.customResponses)) {
      defaultResponses[key] = value;
    }
  }
  return createRoute({
    tags: opts.tags,
    summary: opts.summary,
    method: opts.method,
    path: opts.path,
    parameters: opts.parameters,
    security: opts.security,
    request: {
      body:
        opts.method === "get"
          ? undefined
          : {
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
                "text/plain": {
                  schema: { type: "string", default: "hello echo" },
                },
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    default: { key1: "value1", key2: "value2" },
                  },
                },
                "application/x-www-form-urlencoded": {
                  schema: {
                    type: "object",
                    default: { key1: "value1", key2: "value2" },
                  },
                },
              },
              description: opts.requestDescription,
              required: opts.requiredBody ?? false,
            },
    },
    responses: defaultResponses,
  });
};

export const parseQueryArgs = (c: Context): Record<string, string | string[]> => {
  const url = new URL(c.req.url);
  const args: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, name) => {
    const existing = args[name];
    if (existing !== undefined) {
      args[name] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else {
      args[name] = value;
    }
  });
  return args;
};

/** Parse request body for echo output (mirrors JetBrains: JSON without Content-Type). */
export function parseEchoRequestBody(
  contentType: string,
  body: string,
): {
  data: unknown;
  json: unknown;
  form: Record<string, unknown>;
  files: Record<string, unknown>;
} {
  const form: Record<string, unknown> = {};
  let data: unknown = "";
  let json: unknown = null;
  const files: Record<string, unknown> = {};

  if (contentType === "application/x-www-form-urlencoded") {
    const params = new URLSearchParams(body);
    params.forEach((value, name) => {
      form[name] = value;
    });
    data = body;
  } else if (contentType === "application/json") {
    data = body;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
  } else if (contentType === "multipart/form-data") {
    return { data: "", json: null, form, files };
  } else if (contentType) {
    data = body;
  } else if (body !== "") {
    data = body;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
  }

  return { data: data ?? "", json, form, files };
}

export const getClientOrigin = (c: Context): string => {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "";
  }
  try {
    return getConnInfo(c).remote.address ?? "";
  } catch {
    return "";
  }
};

export const getRequestInfo = async (c: Context) => {
  const contentType = c.req.header("content-type")?.split(";")[0]?.trim() ?? "";
  let form: Record<string, unknown> = {};
  let data: unknown = "";
  let json: unknown = null;
  const files: Record<string, unknown> = {};

  if (contentType === "multipart/form-data") {
    const formData = await c.req.raw.formData();
    for (const [name, value] of formData.entries()) {
      if (typeof value === "object" && value !== null && "arrayBuffer" in value) {
        const file = value as File;
        const content = await file.text();
        const headers: Record<string, string> = {
          "Content-Type": file.type || "application/octet-stream",
        };
        files[name] = {
          filename: file.name,
          size: file.size,
          headers,
          content,
        };
      } else {
        form[name] = value;
      }
    }
    data = "";
  } else {
    const body = await c.req.text();
    const parsed = parseEchoRequestBody(contentType, body);
    form = parsed.form;
    data = parsed.data;
    json = parsed.json;
    Object.assign(files, parsed.files);
  }

  const headers = c.req.header();
  // Join repeated headers with comma like httpbun
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key] = Array.isArray(value) ? value.join(",") : String(value);
  }

  return {
    method: c.req.method,
    args: parseQueryArgs(c),
    headers: normalizedHeaders,
    origin: getClientOrigin(c),
    url: c.req.url,
    form,
    data: data ?? "",
    json,
    files,
  };
};

export const getDefaultResponseBody = async (
  c: Context,
  fixedStatusCode: ContentfulStatusCode = 200,
) => {
  const info = await getRequestInfo(c);
  const contentType = negotiateContentType(c.req.header("accept"));

  switch (contentType) {
    case "text/plain": {
      let headers = "";
      for (const [key, value] of Object.entries(info.headers)) {
        headers += `${key}: ${value}\n`;
      }
      return c.text(
        `method:\n${info.method}\n\nheaders:\n${headers}\n\ndata:\n${
          info.data !== "" ? `${info.data}\n` : ""
        }`,
        fixedStatusCode,
      );
    }
    case "text/html": {
      let headers = "";
      for (const [key, value] of Object.entries(info.headers)) {
        headers += `<li>${key}: ${value}</li>\n`;
      }
      return c.html(
        `<html>
<head>
<title>echo</title>
</head>
<body>
<h1>echo</h1>
<p data-type="method">${info.method}</p>
<ul data-type="headers">
${headers}
</ul>
<p data-type="body">
${info.data !== "" ? info.data : ""}
</p>
</body>
</html>`,
        fixedStatusCode,
      );
    }
    case "application/xml":
    case "text/xml":
      return c.body(objectToXml(info), fixedStatusCode, {
        "Content-Type": `${contentType}; charset=utf-8`,
      });
    default:
      return c.json(info, fixedStatusCode);
  }
};

export const md5 = (input: string): string => createHash("md5").update(input).digest("hex");

export const randomString = (length = 16): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (const b of bytes) {
    out += chars[b % chars.length];
  }
  return out;
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const canonicalHeader = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("-");

export const statusText = (code: number): string => {
  const texts: Record<number, string> = {
    100: "Continue",
    101: "Switching Protocols",
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    408: "Request Timeout",
    409: "Conflict",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return texts[code] ?? "Unknown";
};
