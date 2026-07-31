import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { createApp } from "./app";
import { startGrpcServer } from "./grpc";
import { md5, parseEchoRequestBody } from "./utils";

const app = createApp();

const request = (path: string, init?: RequestInit) => app.request(`http://localhost${path}`, init);

describe("parseEchoRequestBody", () => {
  test("parses JSON without Content-Type", () => {
    const body = '{"foo":"bar"}';
    expect(parseEchoRequestBody("", body)).toEqual({
      data: body,
      json: { foo: "bar" },
      form: {},
      files: {},
    });
  });

  test("keeps plain text without Content-Type", () => {
    expect(parseEchoRequestBody("", "hello")).toEqual({
      data: "hello",
      json: null,
      form: {},
      files: {},
    });
  });

  test("handles application/json", () => {
    const body = '{"a":1}';
    expect(parseEchoRequestBody("application/json", body)).toEqual({
      data: body,
      json: { a: 1 },
      form: {},
      files: {},
    });
  });

  test("handles form-urlencoded", () => {
    expect(parseEchoRequestBody("application/x-www-form-urlencoded", "a=1&b=2")).toEqual({
      data: "a=1&b=2",
      json: null,
      form: { a: "1", b: "2" },
      files: {},
    });
  });
});

describe("HTTP methods", () => {
  test("GET /get echoes request info", async () => {
    const res = await request("/get?foo=bar");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("GET");
    expect(body.args).toEqual({ foo: "bar" });
    expect(body.url).toContain("/get?foo=bar");
  });

  test("POST /post echoes JSON body", async () => {
    const res = await request("/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.json).toEqual({ hello: "world" });
    expect(body.data).toBe('{"hello":"world"}');
  });

  test("wrong method on /get returns 405", async () => {
    const res = await request("/get", { method: "POST" });
    expect(res.status).toBe(405);
  });

  test("/anything accepts any method", async () => {
    const res = await request("/anything/extra", { method: "PUT" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.method).toBe("PUT");
  });
});

describe("headers and client", () => {
  test("/headers", async () => {
    const res = await request("/headers", { headers: { "X-Test": "1" } });
    const body = await res.json();
    expect(body.headers["x-test"]).toBe("1");
  });

  test("/response-headers", async () => {
    const res = await request("/response-headers?X-Foo=bar");
    expect(res.headers.get("X-Foo")).toBe("bar");
    const body = await res.json();
    expect(body.responseHeaders["X-Foo"]).toBe("bar");
  });

  test("/ip.json", async () => {
    const res = await request("/ip.json");
    const body = await res.json();
    expect(typeof body.origin).toBe("string");
  });

  test("/user-agent is removed", async () => {
    const res = await request("/user-agent");
    expect(res.status).toBe(404);
  });
});

describe("auth", () => {
  test("basic-auth success", async () => {
    const credentials = Buffer.from("u:p").toString("base64");
    const res = await request("/basic-auth/u/p", {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, user: "u" });
  });

  test("bearer requires token path", async () => {
    const missing = await request("/bearer");
    expect(missing.status).toBe(404);

    const res = await request("/bearer/secret", {
      headers: { Authorization: "Bearer secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, token: "secret" });
  });

  test("digest-auth challenges then accepts", async () => {
    const path = "/digest-auth/user/pass";
    const challenge = await request(path);
    expect(challenge.status).toBe(401);
    const www = challenge.headers.get("WWW-Authenticate") ?? "";
    expect(www).toContain("Digest");
    const nonce = /nonce="([^"]+)"/.exec(www)?.[1] ?? "";
    const opaque = /opaque="([^"]+)"/.exec(www)?.[1] ?? "";
    expect(nonce).toBeTruthy();

    const ha1 = md5(`user:httpbun realm:pass`);
    const ha2 = md5(`GET:${path}`);
    const nc = "00000001";
    const cnonce = "abc";
    const response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`);
    const auth = `Digest username="user", realm="httpbun realm", nonce="${nonce}", uri="${path}", qop=auth, nc=${nc}, cnonce="${cnonce}", response="${response}", opaque="${opaque}"`;
    const ok = await request(path, { headers: { Authorization: auth } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ authenticated: true, user: "user" });
  });
});

describe("cookies", () => {
  test("set and read cookies", async () => {
    const set = await request("/cookies/set?a=1&b=2", { redirect: "manual" });
    expect(set.status).toBe(302);
    const cookies = set.headers.getSetCookie?.() ?? [];
    expect(cookies.some((c) => c.startsWith("a=1"))).toBe(true);

    const get = await request("/cookies", { headers: { Cookie: "a=1; b=2" } });
    expect(await get.json()).toEqual({ cookies: { a: "1", b: "2" } });
  });

  test("delete cookies", async () => {
    const res = await request("/cookies/delete?a", { redirect: "manual" });
    expect(res.status).toBe(302);
    const cookies = res.headers.getSetCookie?.() ?? [];
    expect(cookies.some((c) => c.includes("Max-Age=0"))).toBe(true);
  });

  test("/cookie alias works", async () => {
    const res = await request("/cookie", { headers: { Cookie: "x=y" } });
    expect(await res.json()).toEqual({ cookies: { x: "y" } });
  });
});

describe("status redirects cache", () => {
  test("/status/418", async () => {
    const res = await request("/status/418");
    expect(res.status).toBe(418);
    const body = await res.json();
    expect(body.code).toBe(418);
  });

  test("/redirect/{count}", async () => {
    const res = await request("/redirect/2", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("1");
  });

  test("/absolute-redirect/{count}", async () => {
    const res = await request("/absolute-redirect/1", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/anything");
  });

  test("/cache returns 304 with validators", async () => {
    const miss = await request("/cache", { headers: { "If-None-Match": "x" } });
    expect(miss.status).toBe(304);
    const hit = await request("/cache");
    expect(hit.status).toBe(200);
  });

  test("/etag/{etag}", async () => {
    const match = await request("/etag/abc", { headers: { "If-None-Match": "abc" } });
    expect(match.status).toBe(304);
  });
});

describe("content helpers", () => {
  test("/health", async () => {
    expect(await (await request("/health")).text()).toBe("ok");
  });

  test("/delay/0", async () => {
    const res = await request("/delay/0");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("/bytes/{n}", async () => {
    const res = await request("/bytes/8");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect((await res.arrayBuffer()).byteLength).toBe(8);
  });

  test("/base64 default", async () => {
    const res = await request("/base64");
    expect(await res.text()).toBe("HTTPBUN is awesomer!");
  });

  test("/payload", async () => {
    const res = await request("/payload", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "hi",
    });
    expect(await res.text()).toBe("hi");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  test("/svg/{seed}", async () => {
    const res = await request("/svg/ab");
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const text = await res.text();
    expect(text).toContain(`#${md5("ab").slice(0, 6)}`);
    expect(text).toContain("AB");
  });

  test("/robots.txt and /deny", async () => {
    expect((await request("/robots.txt")).status).toBe(200);
    expect((await request("/deny")).status).toBe(200);
  });
});

describe("streaming", () => {
  test("/drip with zero delay", async () => {
    const res = await request("/drip?duration=0&numbytes=3&delay=0&code=200");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("***");
  });

  test("/sse with small count", async () => {
    const res = await request("/sse?delay=1&count=2");
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("event: ping");
    expect(text).toContain("data: a ping event");
  }, 5000);
});

describe("mix", () => {
  test("path directives", async () => {
    const res = await request("/mix/s=201/b64=aGk=");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("hi");
  });

  test("query directives", async () => {
    const res = await request("/mix?s=200&h=X-A:1");
    expect(res.status).toBe(200);
    expect(res.headers.get("X-A")).toBe("1");
  });
});

describe("oauth2 and oidc", () => {
  test("authorize requires params", async () => {
    const res = await request("/oauth2/authorize");
    expect(res.status).toBe(400);
  });

  test("full code flow with openid scope", async () => {
    const authorize = await request(
      "/oauth2/authorize?client_id=c1&redirect_uri=https://example.com/cb&response_type=code&scope=openid%20email&state=s1",
    );
    expect(authorize.status).toBe(200);
    expect(await authorize.text()).toContain("Authorize application");

    const decision = await request("/oauth2/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "c1",
        redirect_uri: "https://example.com/cb",
        state: "s1",
        scope: "openid email",
        email: "a@b.co",
        decision: "approve",
      }).toString(),
      redirect: "manual",
    });
    expect(decision.status).toBe(302);
    const location = decision.headers.get("Location") ?? "";
    const code = new URL(location).searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await request("/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        client_id: "c1",
        client_secret: "secret",
        redirect_uri: "https://example.com/cb",
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const token = await tokenRes.json();
    expect(token.access_token).toBeTruthy();
    expect(token.id_token).toBeTruthy();
    expect(token.refresh_token).toBeTruthy();
    expect(token.token_type).toBe("Bearer");

    const userinfo = await request("/oauth2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    expect(await userinfo.json()).toEqual({ email: "a@b.co", sub: "a@b.co" });

    const refreshed = await request("/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        client_id: "c1",
        client_secret: "secret",
        expires_in: "120",
      }).toString(),
    });
    expect(refreshed.status).toBe(200);
    const next = await refreshed.json();
    expect(next.access_token).toBeTruthy();
    expect(next.access_token).not.toBe(token.access_token);
    expect(next.refresh_token).toBeTruthy();
    expect(next.id_token).toBeTruthy();
    expect(next.expires_in).toBe(120);

    const discovery = await (await request("/.well-known/openid-configuration")).json();
    expect(discovery.authorization_endpoint).toContain("/oauth2/authorize");
    expect(discovery.jwks_uri).toContain("/oidc/jwks");
    expect(discovery.grant_types_supported).toContain("refresh_token");
  });
});

describe("images", () => {
  test("/image/svg returns mistweaver logo", async () => {
    const res = await request("/image/svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    const text = await res.text();
    expect(text).toContain("<svg");
  });

  test("/image negotiates Accept", async () => {
    const res = await request("/image", { headers: { Accept: "image/png" } });
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});

describe("gRPC Echo", () => {
  const port = 55051;
  let server: grpc.Server;
  let client: {
    UnaryEcho: (
      req: { message: string },
      cb: (err: Error | null, res: { message: string }) => void,
    ) => void;
    ServerStreamingEcho: (req: { message: string }) => NodeJS.EventEmitter;
    close: () => void;
  };

  beforeAll(async () => {
    server = startGrpcServer(port);
    await new Promise((r) => setTimeout(r, 200));
    const def = protoLoader.loadSync(join(import.meta.dir, "../proto/echo.proto"), {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(def) as unknown as {
      echo: {
        Echo: new (address: string, creds: grpc.ChannelCredentials) => typeof client;
      };
    };
    client = new proto.echo.Echo(`127.0.0.1:${port}`, grpc.credentials.createInsecure());
  });

  afterAll(() => {
    client?.close();
    server?.forceShutdown();
  });

  test("UnaryEcho", async () => {
    const result = await new Promise<{ message: string }>((resolve, reject) => {
      client.UnaryEcho({ message: "ping" }, (err: Error | null, res: { message: string }) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
    expect(result.message).toBe("ping");
  });

  test("ServerStreamingEcho", async () => {
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const call = client.ServerStreamingEcho({ message: "ab" });
      call.on("data", (msg: { message: string }) => chunks.push(msg.message));
      call.on("end", () => resolve());
      call.on("error", reject);
    });
    expect(chunks).toEqual(["a", "b"]);
  });

  test("server reflection lists echo.Echo", async () => {
    const reflectionProtoPath = join(
      import.meta.dir,
      "../node_modules/@grpc/reflection/build/proto/grpc/reflection/v1/reflection.proto",
    );
    const def = protoLoader.loadSync(reflectionProtoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [join(import.meta.dir, "../node_modules/@grpc/reflection/build/proto")],
    });
    const proto = grpc.loadPackageDefinition(def) as unknown as {
      grpc: {
        reflection: {
          v1: {
            ServerReflection: new (
              address: string,
              creds: grpc.ChannelCredentials,
            ) => {
              ServerReflectionInfo: () => grpc.ClientDuplexStream<
                { list_services: string },
                {
                  list_services_response?: { service?: Array<{ name?: string }> };
                }
              >;
            };
          };
        };
      };
    };
    const reflection = new proto.grpc.reflection.v1.ServerReflection(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
    );
    const services = await new Promise<string[]>((resolve, reject) => {
      const call = reflection.ServerReflectionInfo();
      const names: string[] = [];
      call.on("data", (msg) => {
        for (const svc of msg.list_services_response?.service ?? []) {
          if (svc.name) names.push(svc.name);
        }
      });
      call.on("end", () => resolve(names));
      call.on("error", reject);
      call.write({ list_services: "*" });
      call.end();
    });
    expect(services).toContain("echo.Echo");
  });
});
