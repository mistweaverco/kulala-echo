import { Context } from "hono";
import { getConnInfo } from "hono/bun";
import { OpenAPIHono, createRoute, type RouteConfig } from "@hono/zod-openapi";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { negotiateContentType, objectToXml } from "./xml";
import { echoResponseContent } from "./openapi-schemas";

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
}

export const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

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

export const jsonResponse = (
  schema: Record<string, unknown>,
  description = "OK",
) => ({
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
  router: OpenAPIHono,
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
    Object.entries(opts.customResponses).forEach(([key, value]) => {
      defaultResponses[key] = value;
    });
  }
  return createRoute({
    tags: opts.tags,
    summary: opts.summary,
    method: opts.method,
    path: opts.path,
    parameters: opts.parameters,
    security: opts.security,
    request: {
      body: opts.method === "get" ? undefined : {
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
        required: false,
      },
    },
    responses: defaultResponses,
  });
};

const parseQueryArgs = (c: Context): Record<string, string | string[]> => {
  const url = new URL(c.req.url);
  const args: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, name) => {
    const existing = args[name];
    if (existing !== undefined) {
      args[name] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    } else {
      args[name] = value;
    }
  });
  return args;
};

export const getRequestInfo = async (c: Context) => {
  const contentType = c.req.header("content-type")?.split(";")[0]?.trim() ?? "";
  const form: Record<string, unknown> = {};
  let data: unknown = "";
  let json: unknown = null;
  const files: Record<string, unknown> = {};

  if (contentType === "application/x-www-form-urlencoded") {
    const body = await c.req.text();
    const params = new URLSearchParams(body);
    params.forEach((value, name) => {
      form[name] = value;
    });
    data = body;
  } else if (contentType === "application/json") {
    const body = await c.req.text();
    data = body;
    try {
      json = JSON.parse(body);
    } catch {
      json = null;
    }
  } else if (contentType === "multipart/form-data") {
    const formData = await c.req.raw.formData();
    for (const [name, value] of formData.entries()) {
      if (value instanceof File) {
        files[name] = {
          filename: value.name,
          size: value.size,
          content: await value.text(),
        };
      } else {
        form[name] = value;
      }
    }
    data = "";
  } else if (contentType) {
    data = await c.req.text();
  }

  return {
    method: c.req.method,
    args: parseQueryArgs(c),
    headers: c.req.header(),
    origin: getConnInfo(c).remote.address ?? "",
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
      Object.entries(info.headers).forEach(([key, value]) => {
        headers += `${key}: ${value}\n`;
      });
      return c.text(
        `method:\n${info.method}\n\nheaders:\n${headers}\n\ndata:\n${
          info.data !== "" ? info.data + "\n" : ""
        }`,
        fixedStatusCode,
      );
    }
    case "text/html": {
      let headers = "";
      Object.entries(info.headers).forEach(([key, value]) => {
        headers += `<li>${key}: ${value}</li>\n`;
      });
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
    case "application/json":
    default:
      return c.json(info, fixedStatusCode);
  }
};
