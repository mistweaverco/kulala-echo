import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { basicAuth } from "hono/basic-auth";
import { createSimpleRoute, jsonResponse, md5, randomString } from "../utils";

const REALM = "httpbun realm";

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

const digestErrorSchema = {
  type: "object",
  properties: {
    authenticated: { type: "boolean" },
    token: { type: "string" },
    error: { type: "string" },
  },
} as const;

// --- Basic Auth ---

authRouter.use(
  "/basic-auth/:user/:passwd",
  basicAuth({
    realm: REALM,
    verifyUser: (username, password, c) =>
      username === c.req.param("user") && password === c.req.param("passwd"),
  }),
);

authRouter.openapi(
  createSimpleRoute({
    tags: ["Auth"],
    summary: "HTTP Basic Auth",
    method: "get",
    path: "/basic-auth/{user}/{passwd}",
    parameters: [
      { name: "user", in: "path", required: true, schema: { type: "string" } },
      { name: "passwd", in: "path", required: true, schema: { type: "string" } },
    ],
    responses: {
      200: jsonResponse(authSuccessSchema),
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const auth = c.req.header("authorization") ?? "";
    const credentials = Buffer.from(auth.slice(6), "base64").toString();
    const user = credentials.split(":")[0] ?? "";
    return c.json({ authenticated: true, user });
  },
);

// --- Bearer Auth ---

authRouter.openapi(
  createSimpleRoute({
    tags: ["Auth"],
    summary: "HTTP Bearer Auth (token required in path)",
    method: "get",
    path: "/bearer",
    responses: {
      404: { description: "Missing token in path" },
    },
  }),
  (c) => c.text("missing/non-empty token, use /bearer/<expected_token> instead", 404),
);

authRouter.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
});

authRouter.openapi(
  createSimpleRoute({
    tags: ["Auth"],
    summary: "HTTP Bearer Auth",
    method: "get",
    path: "/bearer/{token}",
    security: [{ Bearer: [] }],
    parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
    responses: {
      200: jsonResponse(bearerSuccessSchema),
      401: { description: "Unauthorized" },
    },
  }),
  (c) => {
    const expectedToken = c.req.param("token") ?? "";
    const authHeader = c.req.header("authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      c.header("WWW-Authenticate", `Bearer realm="${REALM}"`);
      return c.body(null, 401);
    }

    const token = authHeader.slice("Bearer ".length);
    return c.json({
      authenticated: token !== "" && expectedToken === token,
      token,
    });
  },
);

// --- Digest Auth ---

const parseDigestAuthHeader = (header: string): Record<string, string> => {
  const details: Record<string, string> = {};
  const re = /([a-z]+)=(?:"([^"]+)"|([^,]+))/g;
  for (const match of header.matchAll(re)) {
    details[match[1]] = match[2] || match[3] || "";
  }
  return details;
};

const computeDigestAuthResponse = (
  username: string,
  password: string,
  serverNonce: string,
  nc: string,
  clientNonce: string,
  qop: string,
  method: string,
  path: string,
  entityBody: string,
): string => {
  if (qop !== "" && qop !== "auth" && qop !== "auth-int") {
    throw new Error(`unsupported qop: ${JSON.stringify(qop)}`);
  }

  const ha1 = md5(`${username}:${REALM}:${password}`);
  const ha2 =
    qop === "" || qop === "auth"
      ? md5(`${method}:${path}`)
      : md5(`${method}:${path}:${md5(entityBody)}`);

  if (qop === "") {
    return md5(`${ha1}:${serverNonce}:${ha2}`);
  }
  return md5(`${ha1}:${serverNonce}:${nc}:${clientNonce}:${qop}:${ha2}`);
};

const unauthorizedDigest = (c: Context, expectedQop: string, setCookie: boolean, error: string) => {
  const qop = expectedQop || "auth";
  const newNonce = randomString();
  const opaque = randomString();

  c.header(
    "WWW-Authenticate",
    `Digest realm="${REALM}", qop="${qop}", nonce="${newNonce}", opaque="${opaque}", algorithm=MD5, stale=FALSE`,
  );
  if (setCookie) {
    c.header("Set-Cookie", `nonce=${newNonce}`);
  }
  return c.json({ authenticated: false, token: "", error }, 401);
};

const isTruthyRequireCookie = (value: string | undefined): boolean =>
  value === "true" || value === "1" || value === "t";

const digestHandler = async (c: Context) => {
  const expectedQop = c.req.param("qop") ?? "";
  const expectedUsername = c.req.param("user") ?? "";
  const expectedPassword = c.req.param("passwd") ?? "";
  const requireCookie = isTruthyRequireCookie(c.req.query("require-cookie"));

  if (
    expectedQop !== "" &&
    expectedQop !== "auth" &&
    expectedQop !== "auth-int" &&
    expectedQop !== "auth,auth-int"
  ) {
    return unauthorizedDigest(c, "", requireCookie, "Error: invalid qop");
  }

  const authHeader = c.req.header("authorization");
  if (!authHeader) {
    return unauthorizedDigest(c, expectedQop, requireCookie, "missing authorization header");
  }

  const givenDetails = parseDigestAuthHeader(authHeader);

  if (expectedQop !== "") {
    const supportedQops = expectedQop.split(",");
    const givenQop = givenDetails.qop ?? "";
    if (!supportedQops.includes(givenQop)) {
      return unauthorizedDigest(c, expectedQop, requireCookie, 'Error: "Unsupported QOP"\n');
    }
  }

  const givenNonce = givenDetails.nonce ?? "";

  if (requireCookie) {
    const cookieHeader = c.req.header("cookie") ?? "";
    const nonceCookie = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("nonce="));
    if (!nonceCookie) {
      return unauthorizedDigest(c, expectedQop, requireCookie, 'Error: "Missing nonce cookie"\n');
    }
    const expectedNonce = nonceCookie.slice("nonce=".length);
    if (givenNonce !== expectedNonce) {
      const msg = `Error: "Nonce mismatch"\nGiven: ${JSON.stringify(givenNonce)}\nExpected: ${JSON.stringify(expectedNonce)}`;
      return unauthorizedDigest(c, expectedQop, requireCookie, msg);
    }
  }

  const path = new URL(c.req.url).pathname;
  const entityBody = await c.req.text();

  let expectedResponseCode: string;
  try {
    expectedResponseCode = computeDigestAuthResponse(
      expectedUsername,
      expectedPassword,
      givenNonce,
      givenDetails.nc ?? "",
      givenDetails.cnonce ?? "",
      givenDetails.qop ?? "",
      c.req.method,
      path,
      entityBody,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return unauthorizedDigest(c, expectedQop, requireCookie, `Error: ${JSON.stringify(message)}\n`);
  }

  const givenResponseCode = givenDetails.response ?? "";
  if (expectedResponseCode !== givenResponseCode) {
    const msg = `Error: "Response code mismatch"\nGiven: ${JSON.stringify(givenResponseCode)}\nExpected: ${JSON.stringify(expectedResponseCode)}`;
    return unauthorizedDigest(c, expectedQop, requireCookie, msg);
  }

  return c.json({ authenticated: true, user: expectedUsername });
};

const digestResponses = {
  200: jsonResponse(authSuccessSchema),
  401: jsonResponse(digestErrorSchema, "Unauthorized"),
};

const digestRequireCookieParam = {
  name: "require-cookie",
  in: "query" as const,
  required: false,
  schema: { type: "string" as const },
  description: "When true/1/t, set and verify a nonce cookie",
};

authRouter.openapi(
  createSimpleRoute({
    tags: ["Auth"],
    summary: "Digest Auth with qop",
    method: "get",
    path: "/digest-auth/{qop}/{user}/{passwd}",
    parameters: [
      { name: "qop", in: "path", required: true, schema: { type: "string" } },
      { name: "user", in: "path", required: true, schema: { type: "string" } },
      { name: "passwd", in: "path", required: true, schema: { type: "string" } },
      digestRequireCookieParam,
    ],
    responses: digestResponses,
  }),
  digestHandler,
);

authRouter.openapi(
  createSimpleRoute({
    tags: ["Auth"],
    summary: "Digest Auth (default qop=auth)",
    method: "get",
    path: "/digest-auth/{user}/{passwd}",
    parameters: [
      { name: "user", in: "path", required: true, schema: { type: "string" } },
      { name: "passwd", in: "path", required: true, schema: { type: "string" } },
      digestRequireCookieParam,
    ],
    responses: digestResponses,
  }),
  digestHandler,
);

export { authRouter };
