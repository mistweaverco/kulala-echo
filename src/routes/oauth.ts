import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import * as jose from "jose";
import { createSimpleRoute, jsonResponse } from "../utils";

const oauthRouter = new OpenAPIHono();

type AuthCodePayload = {
  cid: string;
  uri: string;
  st?: string;
  email: string;
  iat: number;
  scope?: string;
};

type AccessTokenPayload = {
  email: string;
  cid: string;
  iat: number;
  jti: string;
};

type RefreshTokenPayload = {
  typ: "refresh";
  email: string;
  cid: string;
  iat: number;
  scope?: string;
};

// Deterministic test key for OIDC (not for production)
const OIDC_SECRET = new TextEncoder().encode(
  process.env.OIDC_SECRET ?? "kulala-echo-oidc-test-secret-key-32b!",
);
const OIDC_ISSUER_PATH = "";
/** Default access-token lifetime; override with form field `expires_in` (1–3600). */
const DEFAULT_EXPIRES_IN = 3600;

const encodeJson = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const decodeJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
};

const parseExpiresIn = (raw: unknown): number => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_EXPIRES_IN;
  return Math.min(Math.max(Math.floor(n), 1), DEFAULT_EXPIRES_IN);
};

const issueTokenResponse = async (opts: {
  origin: string;
  clientId: string;
  email: string;
  scope: string;
  expiresIn: number;
}): Promise<Record<string, unknown>> => {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = encodeJson({
    email: opts.email,
    cid: opts.clientId,
    iat: now,
    jti: crypto.randomUUID(),
  } satisfies AccessTokenPayload);

  const refreshToken = encodeJson({
    typ: "refresh",
    email: opts.email,
    cid: opts.clientId,
    iat: now,
    scope: opts.scope,
  } satisfies RefreshTokenPayload);

  const body: Record<string, unknown> = {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: opts.expiresIn,
    refresh_token: refreshToken,
  };

  const scopes = opts.scope.split(/\s+/).filter(Boolean);
  if (scopes.includes("openid")) {
    const issuer = `${opts.origin}${OIDC_ISSUER_PATH}`;
    body.id_token = await new jose.SignJWT({
      email: opts.email,
      sub: opts.email,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(opts.clientId)
      .setIssuedAt()
      .setExpirationTime(`${opts.expiresIn}s`)
      .sign(OIDC_SECRET);
    body.scope = opts.scope;
  }

  return body;
};

const consentHtml = (opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope: string;
}) => `<!DOCTYPE html>
<html>
<head><title>OAuth2 Consent - kulala-echo</title></head>
<body>
  <h1>Authorize application</h1>
  <p>Client: <code>${opts.clientId}</code></p>
  <p>Redirect: <code>${opts.redirectUri}</code></p>
  <p>Scope: <code>${opts.scope || "(none)"}</code></p>
  <form method="POST" action="/oauth2/authorize">
    <input type="hidden" name="client_id" value="${opts.clientId}" />
    <input type="hidden" name="redirect_uri" value="${opts.redirectUri}" />
    <input type="hidden" name="state" value="${opts.state}" />
    <input type="hidden" name="scope" value="${opts.scope}" />
    <label>Email <input name="email" type="email" value="user@example.com" required /></label>
    <button name="decision" value="approve" type="submit">Approve</button>
    <button name="decision" value="deny" type="submit">Deny</button>
  </form>
</body>
</html>`;

const oauthError = (
  c: Context,
  status: 400 | 401 | 405 | 500,
  error: string,
  description: string,
  headers?: Record<string, string>,
) => {
  if (headers) {
    for (const [k, v] of Object.entries(headers)) {
      c.header(k, v);
    }
  }
  return c.json({ error, error_description: description }, status);
};

oauthRouter.openapi(
  createSimpleRoute({
    tags: ["OAuth2"],
    summary: "OAuth2 authorization endpoint (consent page)",
    method: "get",
    path: "/authorize",
    parameters: [
      { name: "client_id", in: "query", required: true, schema: { type: "string" } },
      { name: "redirect_uri", in: "query", required: true, schema: { type: "string" } },
      { name: "response_type", in: "query", required: true, schema: { type: "string" } },
      { name: "state", in: "query", required: false, schema: { type: "string" } },
      { name: "scope", in: "query", required: false, schema: { type: "string" } },
    ],
    responses: {
      200: { description: "Consent HTML" },
      400: jsonResponse({ type: "object" }, "Bad Request"),
    },
  }),
  (c) => {
    const clientId = c.req.query("client_id");
    const redirectUri = c.req.query("redirect_uri");
    const responseType = c.req.query("response_type");
    if (!clientId) return c.text("Missing required parameter: client_id", 400);
    if (!redirectUri) return c.text("Missing required parameter: redirect_uri", 400);
    if (responseType !== "code") {
      return c.text("Invalid or missing response_type. Only 'code' is supported.", 400);
    }
    return c.html(
      consentHtml({
        clientId,
        redirectUri,
        state: c.req.query("state") ?? "",
        scope: c.req.query("scope") ?? "",
      }),
    );
  },
);

oauthRouter.openapi(
  createSimpleRoute({
    tags: ["OAuth2"],
    summary: "OAuth2 authorization decision",
    method: "post",
    path: "/authorize",
    responses: {
      302: { description: "Redirect with code or error" },
      400: jsonResponse({ type: "object" }, "Bad Request"),
    },
  }),
  async (c) => {
    const form = await c.req.parseBody();
    const clientId = String(form.client_id ?? "");
    const redirectUri = String(form.redirect_uri ?? "");
    const state = String(form.state ?? "");
    const email = String(form.email ?? "");
    const decision = String(form.decision ?? "");
    const scope = String(form.scope ?? "");

    if (!clientId) return c.text("Missing required parameter: client_id", 400);
    if (!redirectUri) return c.text("Missing required parameter: redirect_uri", 400);

    let parsed: URL;
    try {
      parsed = new URL(redirectUri);
    } catch {
      return c.text("Invalid redirect_uri", 400);
    }

    if (decision === "approve") {
      if (!email) return c.text("Missing required parameter: email", 400);
      const payload: AuthCodePayload = {
        cid: clientId,
        uri: redirectUri,
        email,
        iat: Math.floor(Date.now() / 1000),
        scope,
      };
      if (state) payload.st = state;
      parsed.searchParams.set("code", encodeJson(payload));
      if (state) parsed.searchParams.set("state", state);
    } else {
      parsed.searchParams.set("error", "access_denied");
      parsed.searchParams.set("error_description", "The user denied the authorization request");
      if (state) parsed.searchParams.set("state", state);
    }

    return c.redirect(parsed.toString(), 302);
  },
);

oauthRouter.openapi(
  createSimpleRoute({
    tags: ["OAuth2"],
    summary: "OAuth2 token endpoint",
    method: "post",
    path: "/token",
    responses: {
      200: jsonResponse({ type: "object" }),
      400: jsonResponse({ type: "object" }),
    },
  }),
  async (c) => {
    if (c.req.method !== "POST") {
      return oauthError(c, 405, "invalid_request", "Method not allowed. Use POST.");
    }
    const form = await c.req.parseBody();
    const grantType = String(form.grant_type ?? "");
    const clientId = String(form.client_id ?? "");
    const clientSecret = String(form.client_secret ?? "");
    const expiresIn = parseExpiresIn(form.expires_in);
    const origin = new URL(c.req.url).origin;

    if (!clientId) {
      return oauthError(c, 400, "invalid_request", "Missing required parameter: client_id");
    }
    if (!clientSecret) {
      return oauthError(c, 400, "invalid_request", "Missing required parameter: client_secret");
    }

    if (grantType === "refresh_token") {
      const refreshToken = String(form.refresh_token ?? "");
      if (!refreshToken) {
        return oauthError(c, 400, "invalid_request", "Missing required parameter: refresh_token");
      }
      const payload = decodeJson<RefreshTokenPayload>(refreshToken);
      if (payload?.typ !== "refresh") {
        return oauthError(c, 400, "invalid_grant", "Invalid refresh token");
      }
      if (payload.cid !== clientId) {
        return oauthError(c, 400, "invalid_grant", "client_id does not match the refresh token");
      }
      // Refresh tokens last 30 days
      if (Date.now() / 1000 - payload.iat > 30 * 24 * 3600) {
        return oauthError(c, 400, "invalid_grant", "Refresh token has expired");
      }

      const body = await issueTokenResponse({
        origin,
        clientId,
        email: payload.email,
        scope: payload.scope ?? "",
        expiresIn,
      });
      c.header("Cache-Control", "no-store");
      c.header("Pragma", "no-cache");
      return c.json(body);
    }

    if (grantType !== "authorization_code") {
      return oauthError(
        c,
        400,
        "unsupported_grant_type",
        "Supported grant types: authorization_code, refresh_token",
      );
    }

    const code = String(form.code ?? "");
    const redirectUri = String(form.redirect_uri ?? "");
    if (!code) return oauthError(c, 400, "invalid_request", "Missing required parameter: code");
    if (!redirectUri) {
      return oauthError(c, 400, "invalid_request", "Missing required parameter: redirect_uri");
    }

    const codePayload = decodeJson<AuthCodePayload>(code);
    if (!codePayload) {
      return oauthError(c, 400, "invalid_grant", "Invalid authorization code");
    }
    if (codePayload.cid !== clientId) {
      return oauthError(
        c,
        400,
        "invalid_grant",
        "client_id does not match the authorization request",
      );
    }
    if (codePayload.uri !== redirectUri) {
      return oauthError(
        c,
        400,
        "invalid_grant",
        "redirect_uri does not match the authorization request",
      );
    }
    if (Date.now() / 1000 - codePayload.iat > 600) {
      return oauthError(c, 400, "invalid_grant", "Authorization code has expired");
    }

    const body = await issueTokenResponse({
      origin,
      clientId,
      email: codePayload.email,
      scope: codePayload.scope ?? "",
      expiresIn,
    });
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
    return c.json(body);
  },
);

const handleUserinfo = async (c: Context) => {
  const authHeader = c.req.header("authorization") ?? "";
  if (!authHeader) {
    return oauthError(c, 401, "invalid_token", "Missing Authorization header", {
      "WWW-Authenticate": "Bearer",
    });
  }
  if (!authHeader.startsWith("Bearer ")) {
    return oauthError(
      c,
      401,
      "invalid_token",
      "Invalid Authorization header format. Expected: Bearer <token>",
      { "WWW-Authenticate": "Bearer" },
    );
  }
  const token = authHeader.slice(7);
  const tokenPayload = decodeJson<AccessTokenPayload>(token);
  if (!tokenPayload) {
    return oauthError(c, 401, "invalid_token", "Invalid access token", {
      "WWW-Authenticate": "Bearer",
    });
  }
  if (Date.now() / 1000 - tokenPayload.iat > 3600) {
    return oauthError(c, 401, "invalid_token", "Access token has expired", {
      "WWW-Authenticate": "Bearer",
    });
  }
  return c.json({ email: tokenPayload.email, sub: tokenPayload.email });
};

for (const method of ["get", "post"] as const) {
  oauthRouter.openapi(
    createSimpleRoute({
      tags: ["OAuth2"],
      summary: "OAuth2 userinfo",
      method,
      path: "/userinfo",
      responses: {
        200: jsonResponse({ type: "object" }),
        401: jsonResponse({ type: "object" }),
      },
    }),
    handleUserinfo,
  );
}

export { OIDC_SECRET, oauthRouter };

// OIDC extension router (mounted at /)
const oidcRouter = new OpenAPIHono();

oidcRouter.openapi(
  createSimpleRoute({
    tags: ["OIDC"],
    summary: "OpenID Connect discovery document",
    method: "get",
    path: "/.well-known/openid-configuration",
    responses: { 200: jsonResponse({ type: "object" }) },
  }),
  (c) => {
    const issuer = new URL(c.req.url).origin;
    return c.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      userinfo_endpoint: `${issuer}/oauth2/userinfo`,
      jwks_uri: `${issuer}/oidc/jwks`,
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["HS256"],
      scopes_supported: ["openid", "email", "profile", "offline_access"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      claims_supported: ["sub", "email", "iss", "aud", "exp", "iat"],
    });
  },
);

oidcRouter.openapi(
  createSimpleRoute({
    tags: ["OIDC"],
    summary: "OIDC JWKS (HMAC symmetric key metadata for tests)",
    method: "get",
    path: "/oidc/jwks",
    responses: { 200: jsonResponse({ type: "object" }) },
  }),
  (c) =>
    c.json({
      keys: [
        {
          kty: "oct",
          kid: "kulala-echo-test",
          alg: "HS256",
          use: "sig",
          // Test-only: expose key material so clients can verify HS256 id_tokens
          k: Buffer.from(OIDC_SECRET).toString("base64url"),
        },
      ],
    }),
);

oidcRouter.openapi(
  createSimpleRoute({
    tags: ["OIDC"],
    summary: "OIDC userinfo alias",
    method: "get",
    path: "/oidc/userinfo",
    responses: {
      200: jsonResponse({ type: "object" }),
      401: jsonResponse({ type: "object" }),
    },
  }),
  handleUserinfo,
);

export { oidcRouter };
