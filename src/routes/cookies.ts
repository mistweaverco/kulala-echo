import { OpenAPIHono } from "@hono/zod-openapi";
import { createSimpleRoute, jsonResponse } from "../utils";

const cookieRouter = new OpenAPIHono();

const cookiesSchema = {
  type: "object",
  properties: {
    cookies: { type: "object", additionalProperties: { type: "string" } },
  },
} as const;

const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce((acc: Record<string, string>, cookie) => {
    const eq = cookie.indexOf("=");
    if (eq === -1) return acc;
    const name = cookie.slice(0, eq).trim();
    const value = cookie.slice(eq + 1).trim();
    if (name) {
      acc[name] = value;
    }
    return acc;
  }, {});
};

const setCookieHeader = (name: string, value: string) => `${name}=${value}; Path=/`;

const deleteCookieHeader = (name: string) => `${name}=; Path=/; Max-Age=0`;

cookieRouter.openapi(
  createSimpleRoute({
    tags: ["Cookies"],
    summary: "Get cookies sent by the client",
    method: "get",
    path: "/",
    responses: {
      200: jsonResponse(cookiesSchema),
    },
  }),
  (c) => c.json({ cookies: parseCookies(c.req.header("cookie")) }),
);

cookieRouter.openapi(
  createSimpleRoute({
    tags: ["Cookies"],
    summary: "Set cookies from query parameters and redirect to /cookies",
    method: "get",
    path: "/set",
    parameters: [
      {
        name: "name",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Any query param name=value pair sets a cookie",
      },
    ],
    responses: {
      302: { description: "Redirect to /cookies" },
    },
  }),
  (c) => {
    const url = new URL(c.req.url);
    url.searchParams.forEach((value, name) => {
      c.header("Set-Cookie", setCookieHeader(name, value), { append: true });
    });
    return c.redirect("/cookies");
  },
);

cookieRouter.openapi(
  createSimpleRoute({
    tags: ["Cookies"],
    summary: "Set a cookie with the given name and value",
    method: "get",
    path: "/set/{name}/{value}",
    parameters: [
      { name: "name", in: "path", required: true, schema: { type: "string" } },
      { name: "value", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      302: { description: "Redirect to /cookies" },
    },
  }),
  (c) => {
    const name = c.req.param("name") ?? "";
    const value = c.req.param("value") ?? "";
    c.header("Set-Cookie", setCookieHeader(name, value));
    return c.redirect("/cookies");
  },
);

cookieRouter.openapi(
  createSimpleRoute({
    tags: ["Cookies"],
    summary: "Delete cookies given as query param names",
    method: "get",
    path: "/delete",
    parameters: [
      {
        name: "name",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Cookie names to delete (values ignored)",
      },
    ],
    responses: {
      302: { description: "Redirect to /cookies" },
    },
  }),
  (c) => {
    const url = new URL(c.req.url);
    for (const name of url.searchParams.keys()) {
      c.header("Set-Cookie", deleteCookieHeader(name), { append: true });
    }
    return c.redirect("/cookies");
  },
);

export { cookieRouter };
