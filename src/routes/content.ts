import { hostname as osHostname } from "node:os";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  BYTES_SIZE_LIMIT,
  createSimpleRoute,
  jsonResponse,
  md5,
  registerAllMethods,
  sleep,
} from "./../utils";

const contentRouter = new OpenAPIHono();

const DEFAULT_BASE64 = "SFRUUEJVTiBpcyBhd2Vzb21lciE=";

const UNSET_MARKER = "___httpbun_unset_marker";
const FILTERED_ENV_KEYS = new Set(["PATH", "HOME", "HOSTNAME"]);

/** Precomputed `math/rand.New(NewSource(42)).Read` (Go) for up to 1000 bytes. */
const RANGE_SEED_42 = Buffer.from(
  "U4x/lrFkvxuXu59LtHLon1sUhPJSCcnZND6SugndnVLf15tNdkKbYXoMn58NO6VbDMDWFEyIhTWEGsvgcJsHWAg/YdN1vAK0HfT5GSnhj9qeb4LlTnSOgeeeS71v40zcuoQ+6NY+jE/+HOvqVG2PrBPdGqwEzi6ih3xVec+ix44bC6+uiBuCp1EQikLtPJA8qkNGWnhiBhaXiu0M48bE8657w+BJW1cS/v2+DBAoh+EA2s0tiF9pLLYH2gChHBxwceeWotwtwlpbdLLhKXBeJz8FySMmgo4rBW44F2WOEGFJiUf980RBDtTBFgI/qONXa2/tJ/+JdLrAyv2a0FaSsTYZ5ziWTf3Hno1TQ3NmHP1m10/sHhuJSRq3I25LdSFikM8r60LDyicyhWDxqsBnzqbov0bUqytGgEAsX7KCDohdMmDx3peCg9Sgmjb5bCCUF0bj7U2mRqmui0+ntPw6ILr6GnXtMnqGuLDDmvHP0rO1EhnqeVM6v0SNLEedMmB1M5BZFMjMHPCdo54Okp0CSry8sWk5e7c05+8KbgHxhU3rX+Qk/vesIQiR9ZdeKSqiuKoEfGHNszNz6+csJ6CYwCGX2ua3MsNR32aPh04snxzgnKhgF+fiF0gwP/QcGyPhHEjtF1OdaF928qeYvGTeDl2yhksq08Js5jgjQnZaE9aW5S33YPbDRl4poNykasOg1XATO8IVcfX1SmQxBVE/2EKbGUrhup8qg4aucrNmH+gsKsZNv0YVGCTiMFMSY3yZwrh9bfDdXvKDZxkHLWcvYfqgvob0V5Iew3wORgzw1wPQfcX1ZhpFATNAmnEramar17plIkyiaXjZpc5i/rEag48WYi61TO4+Z1UinBg8GTOpFlheGDu3CRktsObI1wm51zg7mTxpSZlFsLDP49wuwfyWENfusZ0JFqJ0I8KeRC8OMcLJU5Zg8F+zfkXNG/C8/Bo0bENPEc8AQW+mFpW5IC5oNjoceH9HhOCu2ceFZBhOEx8efIEfvYhbzGc06JM/PLLyXVL5+MdUetfh1ieMn3yHL4QPnZTZ/e2uk9sklXGPWAuMjyvsxqp2w7D5SK++YSelz9VrwRs8Lqg3ocZpqCL3aGTsKuDNa/3fIbEURHS/03zSBrUazgUKthmex7OW1hj94OGimZpvPZ+LergUn3Leulxs1P1NOSyStLIayBIDQGLfwwY6emhisP7xBSkZwqh6SZT8HkAeEcWknH6OqeZdbMQEZf01LyxC7D0+9g22l0BRfcdlK57v9RZTWqHJ8z2xPtH3rhvjhBMjKNED+HGvm80VIzw5OXj1wXCJ6PMmegzMfjm/yg==",
  "base64",
);

const goSeededBytes = (count: number): Uint8Array =>
  new Uint8Array(RANGE_SEED_42.subarray(0, count));

const computeFgForBg = (color: string): string => {
  const rgb = Number.parseInt(color.slice(1), 16);
  if (Number.isNaN(rgb)) return "black";
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 100 ? "#222e" : "#eeee";
};

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Meta"],
    summary: "Health check",
    method: "get",
    path: "/health",
    responses: {
      200: {
        description: "OK",
        content: { "text/plain": { schema: { type: "string", example: "ok" } } },
      },
    },
  }),
  (c) => c.text("ok"),
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Meta"],
    summary: "Server hostname and environment",
    method: "get",
    path: "/info",
    responses: {
      200: jsonResponse({
        type: "object",
        properties: {
          hostname: { type: "string" },
          env: { type: "object" },
        },
      }),
    },
  }),
  (c) => {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (value === UNSET_MARKER && FILTERED_ENV_KEYS.has(name)) continue;
      env[name] = value;
    }
    return c.json({ hostname: osHostname(), env });
  },
);

const payloadHandler = async (c: Context) => {
  const body = Buffer.from(await c.req.arrayBuffer());
  const contentType = c.req.header("content-type");
  const headers: Record<string, string> = {};
  if (contentType) {
    headers["Content-Type"] = contentType;
  }
  return new Response(body, { status: 200, headers });
};

registerAllMethods(contentRouter, {
  tags: ["Content"],
  summary: "Echo the raw request body with the same Content-Type",
  path: "/payload",
  handler: payloadHandler,
  customResponses: {
    200: {
      description: "Raw request body",
      content: {
        "application/octet-stream": {
          schema: { type: "string", format: "binary" },
        },
      },
    },
  },
});

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "Delay response by a number of seconds (0–300)",
    method: "get",
    path: "/delay/{seconds}",
    parameters: [
      {
        name: "seconds",
        in: "path",
        required: true,
        schema: { type: "number" },
        description: "Delay in seconds (float, 0–300)",
      },
    ],
    responses: {
      200: {
        description: "OK after delay",
        content: { "text/plain": { schema: { type: "string", example: "OK" } } },
      },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  async (c) => {
    const secondsParam = c.req.param("seconds") ?? "";
    const n = Number.parseFloat(secondsParam);
    if (Number.isNaN(n)) {
      return c.json({ error: `Invalid delay: ${secondsParam}` }, 400);
    }
    if (n < 0 || n > 300) {
      return c.json({ error: "Delay can't be greater than 300 or less than 0" }, 400);
    }
    await sleep(n * 1000);
    return c.text("OK");
  },
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "Return N random bytes",
    method: "get",
    path: "/bytes/{count}",
    parameters: [
      {
        name: "count",
        in: "path",
        required: true,
        schema: { type: "integer" },
      },
    ],
    responses: {
      200: {
        description: "Random octets",
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  (c) => {
    const countParam = c.req.param("count") ?? "";
    const n = Number.parseInt(countParam, 10);
    if (Number.isNaN(n)) {
      return c.json({ error: `Invalid size: ${countParam}` }, 400);
    }
    if (n > BYTES_SIZE_LIMIT) {
      return c.json({ error: `Size can't be greater than ${BYTES_SIZE_LIMIT}` }, 400);
    }
    if (n < 0) {
      return c.json({ error: "Size must be non-negative" }, 400);
    }
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(n),
      },
    });
  },
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "Return N deterministic random bytes (seed 42), max 1000",
    method: "get",
    path: "/range/{count}",
    parameters: [
      {
        name: "count",
        in: "path",
        required: true,
        schema: { type: "integer" },
      },
    ],
    responses: {
      200: {
        description: "Seeded random octets",
        content: {
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
    },
  }),
  (c) => {
    let count = Number.parseInt(c.req.param("count") ?? "", 10);
    if (Number.isNaN(count) || count < 0) count = 0;
    if (count > 1000) count = 1000;
    const bytes = count > 0 ? goSeededBytes(count) : new Uint8Array(0);
    return new Response(bytes as unknown as BodyInit, {
      status: 200,
      headers: { "Content-Type": "application/octet-stream" },
    });
  },
);

const decodeStdBase64 = (encoded: string): Buffer => {
  if (encoded.length % 4 !== 0) {
    throw new Error("Incorrect Base64 data");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error("Incorrect Base64 data");
  }
  return Buffer.from(encoded, "base64");
};

const decodeBase64Handler = (c: Context) => {
  let encoded = c.req.param("encoded") ?? "";
  if (encoded === "") {
    encoded = DEFAULT_BASE64;
  }
  try {
    const decoded = decodeStdBase64(encoded);
    return new Response(decoded as unknown as BodyInit, { status: 200 });
  } catch {
    return c.text("Incorrect Base64 data try: 'SFRUUEJVTiBpcyBhd2Vzb21lciE='.", 400);
  }
};

const base64Responses = {
  200: {
    description: "Decoded base64 payload",
    content: { "text/plain": { schema: { type: "string" as const } } },
  },
  400: {
    description: "Invalid base64",
    content: { "text/plain": { schema: { type: "string" as const } } },
  },
};

for (const path of ["/base64", "/b64", "/base64/{encoded}", "/b64/{encoded}"]) {
  contentRouter.openapi(
    createSimpleRoute({
      tags: ["Content"],
      summary: "Decode standard base64 (default: Kulala is awesome!)",
      method: "get",
      path,
      parameters: path.includes("{encoded}")
        ? [
            {
              name: "encoded",
              in: "path" as const,
              required: true,
              schema: { type: "string" },
            },
          ]
        : undefined,
      responses: base64Responses,
    }),
    decodeBase64Handler,
  );
}

const linksHandler = (c: Context) => {
  const count = Number.parseInt(c.req.param("count") || "0", 10);
  const offset = Number.parseInt(c.req.param("offset") || "0", 10);
  const parts: string[] = ["<html><head><title>Links</title></head><body>"];
  for (let i = 0; i < count; i++) {
    if (offset === i) {
      parts.push(String(i));
    } else {
      parts.push(`<a href='/links/${count}/${i}'>${i}</a>`);
    }
    parts.push(" ");
  }
  parts.push("</body></html>");
  return c.html(parts.join(""));
};

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "HTML document with a maze of links",
    method: "get",
    path: "/links/{count}",
    parameters: [
      {
        name: "count",
        in: "path",
        required: true,
        schema: { type: "integer" },
      },
    ],
    responses: {
      200: {
        description: "HTML links",
        content: { "text/html": { schema: { type: "string" } } },
      },
    },
  }),
  linksHandler,
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "HTML document with a maze of links (with offset)",
    method: "get",
    path: "/links/{count}/{offset}",
    parameters: [
      {
        name: "count",
        in: "path",
        required: true,
        schema: { type: "integer" },
      },
      {
        name: "offset",
        in: "path",
        required: true,
        schema: { type: "integer" },
      },
    ],
    responses: {
      200: {
        description: "HTML links",
        content: { "text/html": { schema: { type: "string" } } },
      },
    },
  }),
  linksHandler,
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "Sample HTML page",
    method: "get",
    path: "/html",
    responses: {
      200: {
        description: "HTML sample",
        content: { "text/html": { schema: { type: "string" } } },
      },
    },
  }),
  (c) =>
    c.html(`<!DOCTYPE html>
<html>
<title>Httpbun sample</title>
<body>
  <h1>Some title</h1>
  <p>Some paragraph</p>
  <img src=x onerror='document.body.insertAdjacentText("beforeend", "inserted by img[onerror]")'>
  <script>document.write("inserted by script")</script>
`),
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "robots.txt rules",
    method: "get",
    path: "/robots.txt",
    responses: {
      200: {
        description: "robots.txt",
        content: { "text/plain": { schema: { type: "string" } } },
      },
    },
  }),
  (c) => c.text("User-agent: *\nDisallow: /deny\nDisallow: /mix/\nDisallow: /run/"),
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "Page denied by robots.txt",
    method: "get",
    path: "/deny",
    responses: {
      200: {
        description: "ASCII art warning",
        content: { "text/plain": { schema: { type: "string" } } },
      },
    },
  }),
  (c) =>
    c.text(`
          .-''''''-.
        .' _      _ '.
       /   O      O   \\
      :                :
      |                |
      :       __       :
       \\  .-\`\`  \`\`-.  /
        '.          .'
          '-......-'
     YOU SHOULDN'T BE HERE`),
);

contentRouter.openapi(
  createSimpleRoute({
    tags: ["Content"],
    summary: "SVG circle colored by md5(seed)",
    method: "get",
    path: "/svg/{seed}",
    parameters: [
      {
        name: "seed",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
    ],
    responses: {
      200: {
        description: "SVG image",
        content: {
          "image/svg+xml": { schema: { type: "string" } },
        },
      },
    },
  }),
  (c) => {
    const seed = c.req.param("seed") || "xx";
    const color = `#${md5(seed).slice(0, 6)}`;
    const label = seed.slice(0, 2).toUpperCase();
    const fg = computeFgForBg(color);
    const body = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg">
		<circle cx="50%" cy="50%" r="45%" fill="${color}" stroke="none" />
		<text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" font-size="36" font-family="sans-serif" fill="${fg}">${label}</text>
	</svg>`;
    return c.body(body, 200, { "Content-Type": "image/svg+xml" });
  },
);

export { contentRouter };
