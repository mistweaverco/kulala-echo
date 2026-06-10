import { OpenAPIHono } from "@hono/zod-openapi";
import { basicAuth } from "hono/basic-auth";
import { bearerAuth } from "hono/bearer-auth";
import type { Context } from "hono";
import { createSimpleRoute, getDefaultRoute, jsonResponse } from "./../utils";

const authRouter = new OpenAPIHono();

const authSuccessSchema = {
  type: "object",
  properties: {
    authenticated: { type: "boolean" },
    user: { type: "string" },
  },
} as const;

const bearerSuccessSchema = {
  type: "object",
  properties: {
    authenticated: { type: "boolean" },
    token: { type: "string" },
  },
} as const;

const authErrorSchema = {
  type: "object",
  properties: {
    authenticated: { type: "boolean" },
    error: { type: "string" },
  },
} as const;

const registerBasicAuth = (path: string, summary: string) => {
  authRouter.use(
    path.replace(/\{(\w+)\}/g, ":$1"),
    basicAuth({
      verifyUser: (username, password, c) => {
        return (
          username === c.req.param("user") &&
          password === c.req.param("password")
        );
      },
    }),
  );
  authRouter.openapi(
    getDefaultRoute({
      tags: ["Auth"],
      summary,
      path,
      parameters: [
        {
          name: "user",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "password",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      method: "get",
      requestDescription: "Requires HTTP Basic Auth.",
      responseDescription: "200 OK",
      customResponses: {
        200: { description: "OK", content: { "application/json": { schema: authSuccessSchema } } },
        401: { description: "Unauthorized" },
      },
    }),
    (c) => {
      const auth = c.req.header("authorization");
      const credentials = Buffer.from(auth!.slice(6), "base64").toString();
      const username = credentials.split(":")[0];
      return c.json({ authenticated: true, user: username });
    },
  );
};

registerBasicAuth("/basic-auth/{user}/{password}", "HTTP Basic Auth (httpbun)");
registerBasicAuth("/basic/{user}/{password}", "HTTP Basic Auth (legacy /auth prefix)");
registerBasicAuth("/hidden-basic/{user}/{password}", "HTTP Basic Auth (hidden)");

authRouter.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
});

const registerBearerAuth = (
  path: string,
  summary: string,
  verifyToken: (token: string, c: Context) => boolean,
) => {
  authRouter.use(
    path.replace(/\{(\w+)\}/g, ":$1"),
    bearerAuth({ verifyToken }),
  );
  authRouter.openapi(
    getDefaultRoute({
      tags: ["Auth"],
      summary,
      path,
      security: [{ Bearer: [] }],
      method: "get",
      requestDescription: "Requires HTTP Bearer Auth.",
      responseDescription: "200 OK",
      customResponses: {
        200: { description: "OK", content: { "application/json": { schema: bearerSuccessSchema } } },
        401: { description: "Unauthorized" },
      },
    }),
    (c) => {
      const token = c.req.header("authorization")?.split(" ")[1] ?? "";
      return c.json({ authenticated: true, token });
    },
  );
};

registerBearerAuth("/bearer", "HTTP Bearer Auth — any token", (token) => !!token);
registerBearerAuth(
  "/bearer/{expectedToken}",
  "HTTP Bearer Auth — validate against expected token",
  (token, c) => !!token && token === c.req.param("expectedToken"),
);

const digestHandler = (c: Context) => {
  const auth = c.req.header("authorization");
  if (!auth) {
    return c.json({ authenticated: false, error: "missing authorization header" }, 401);
  }
  const qop = c.req.param("qop");
  if (qop && !["auth", "auth-int"].includes(qop)) {
    return c.json({ authenticated: false, error: "invalid qop" }, 401);
  }
  const algorithm = c.req.param("algorithm")?.toLowerCase();
  if (algorithm) {
    const allowedAlgorithms = ["md5", "sha-256", "sha-512"];
    if (!allowedAlgorithms.includes(algorithm)) {
      return c.json({ authenticated: false, error: "invalid algorithm" }, 401);
    }
  }
  const [type, credentials] = auth.split(" ");
  if (type !== "Digest") {
    return c.json({ authenticated: false, error: "invalid auth type" }, 401);
  }
  const [username, password] = Buffer.from(credentials, "base64")
    .toString()
    .split(":");
  if (
    username !== c.req.param("username") ||
    password !== c.req.param("password")
  ) {
    return c.json({ authenticated: false, error: "invalid credentials" }, 401);
  }
  return c.json({ authenticated: true, user: username });
};

const digestResponses = {
  200: jsonResponse(authSuccessSchema),
  401: jsonResponse(authErrorSchema, "Unauthorized"),
};

const digestRoutes = [
  {
    path: "/digest-auth/{qop}/{username}/{password}",
    summary: "Digest Auth with qop (httpbun)",
    parameters: [
      { name: "qop", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "username", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "password", in: "path" as const, required: true, schema: { type: "string" } },
    ],
  },
  {
    path: "/digest-auth/{username}/{password}",
    summary: "Digest Auth (httpbun, default qop=auth)",
    parameters: [
      { name: "username", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "password", in: "path" as const, required: true, schema: { type: "string" } },
    ],
  },
  {
    path: "/digest/{qop}/{username}/{password}",
    summary: "Digest Auth with qop (legacy /auth prefix)",
    parameters: [
      { name: "qop", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "username", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "password", in: "path" as const, required: true, schema: { type: "string" } },
    ],
  },
  {
    path: "/digest/{qop}/{username}/{password}/{algorithm}",
    summary: "Digest Auth with qop and algorithm (legacy /auth prefix)",
    parameters: [
      { name: "qop", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "username", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "password", in: "path" as const, required: true, schema: { type: "string" } },
      { name: "algorithm", in: "path" as const, required: true, schema: { type: "string" } },
    ],
  },
];

for (const route of digestRoutes) {
  authRouter.openapi(
    createSimpleRoute({
      tags: ["Auth"],
      summary: route.summary,
      method: "get",
      path: route.path,
      parameters: route.parameters,
      responses: digestResponses,
    }),
    digestHandler,
  );
}

export { authRouter };
