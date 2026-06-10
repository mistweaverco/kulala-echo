import { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, type RouteConfig } from "@hono/zod-openapi";
import { createSimpleRoute, jsonResponse } from "./../utils";

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

export const getCookieRoute = (opts: GetDefaultRouteParams) => {
  const defaultResponses: RouteConfig["responses"] = {
    200: {
      description: "OK",
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              cookies: { type: "object" },
            },
          },
        },
      },
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
          "application/json": { schema: { type: "object" } },
        },
        description: opts.requestDescription,
        required: false,
      },
    },
    responses: defaultResponses,
  });
};

const parseCookies = (cookieHeader: string): Record<string, string> => {
  return cookieHeader.split(";").reduce(
    (acc: Record<string, string>, cookie) => {
      const [name, value] = cookie.trim().split("=");
      if (name && value) {
        acc[name] = value;
      }
      return acc;
    },
    {},
  );
};

const cookieRouter = new OpenAPIHono();

const setCookieHeader = (name: string, value: string) =>
  `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax`;

const setCookiesFromQuery = (c: {
  req: { url: string };
  header: (name: string, value: string, options?: { append?: boolean }) => void;
  json: (data: unknown, status?: number) => Response;
  redirect: (location: string) => Response;
}) => {
  const url = new URL(c.req.url);
  const cookies: string[] = [];
  url.searchParams.forEach((value, name) => {
    cookies.push(setCookieHeader(name, value));
  });
  if (cookies.length === 0) {
    return c.json({ error: "No cookies specified" }, 400);
  }
  cookies.forEach((cookie) => c.header("Set-Cookie", cookie, { append: true }));
  return c.redirect("/cookies");
};

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
        description: "Cookie name (any query param name=value pair sets a cookie)",
      },
    ],
    responses: {
      302: { description: "Redirect to /cookies" },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  setCookiesFromQuery,
);

cookieRouter.openapi(
  getCookieRoute({
    tags: ["Cookies"],
    summary: "Set a cookie with the given name and value",
    method: "get",
    path: "/set/{cookieName}/{cookieValue}",
    parameters: [
      {
        name: "cookieName",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "cookieValue",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    requestDescription: "Set a cookie with the given name and value",
    responseDescription: "302 Redirect",
    customResponses: {
      302: { description: "Redirect to /cookies" },
    },
  }),
  (c) => {
    const cookieName = c.req.param("cookieName") || "kulala";
    const cookieValue = c.req.param("cookieValue") || "family";
    c.header("Set-Cookie", setCookieHeader(cookieName, cookieValue));
    return c.redirect("/cookies");
  },
);

cookieRouter.openapi(
  getCookieRoute({
    tags: ["Cookies"],
    summary: "Get cookies sent by the client",
    method: "get",
    path: "/",
    parameters: [],
    requestDescription: "Get cookies sent by the client",
    responseDescription: "200 OK",
  }),
  (c) => {
    const cookies = c.req.header("cookie") || "";
    return c.json({ cookies: parseCookies(cookies) });
  },
);

export { cookieRouter };
