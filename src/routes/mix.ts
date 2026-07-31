import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createSimpleRoute, sleep } from "./../utils";

const mixRouter = new OpenAPIHono();

const SINGLE_VALUE = new Set(["s", "cd", "r", "b64", "d", "t", "slack"]);
const PAIR_VALUE = new Set(["h", "c"]);

type MixEntry = { dir: string; args: string[] };

const computeMixEntries = (c: Context): MixEntry[] | Response => {
  const url = new URL(c.req.url);
  // Path after /mix - Hono may give /mix or /mix/...
  const pathname = url.pathname;
  const pathAfter = pathname.replace(/^\/mix\/?/, "");
  let source: string;
  let itemSep: string;
  let decodePart: (s: string) => string;

  if (pathAfter !== "") {
    source = pathAfter;
    // Also strip catch-all splat if present as separate segment handling
    itemSep = "/";
    decodePart = (s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    };
  } else {
    source = url.search.startsWith("?") ? url.search.slice(1) : url.search;
    itemSep = "&";
    decodePart = (s) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s;
      }
    };
  }

  const entries: MixEntry[] = [];

  for (const part of source.split(itemSep)) {
    if (part === "") continue;
    if (part === "end") break;

    const eq = part.indexOf("=");
    const directive = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    const value = decodePart(rawValue);

    if (SINGLE_VALUE.has(directive)) {
      entries.push({ dir: directive, args: [value] });
    } else if (PAIR_VALUE.has(directive)) {
      const colon = value.indexOf(":");
      const itemName = colon === -1 ? value : value.slice(0, colon);
      const itemValue = colon === -1 ? "" : value.slice(colon + 1);
      entries.push({ dir: directive, args: [itemName, itemValue] });
    }
  }

  return entries;
};

/** Minimal template: replace {{.}} and expand {{seq N}} / {{range seq N}}...{{end}} lightly. */
const renderSimpleTemplate = (template: string): string => {
  let out = template.replaceAll("{{.}}", "");

  // {{seq N}} → space-separated 0..N
  out = out.replace(/\{\{\s*seq\s+(\d+)\s*\}\}/g, (_m, nStr: string) => {
    const n = Number.parseInt(nStr, 10);
    const items: string[] = [];
    for (let i = 0; i <= n; i++) items.push(String(i));
    return items.join(" ");
  });

  return out;
};

const mixHandler = async (c: Context) => {
  const entries = computeMixEntries(c);
  if (entries instanceof Response) return entries;

  let status = 0;
  const headers = new Headers();
  const cookies: string[] = [];
  let redirectTo = "";
  let payload: Uint8Array | null = null;
  let delaySec = 0;

  for (const entry of entries) {
    switch (entry.dir) {
      case "s": {
        const codes = (entry.args[0] ?? "").match(/\d+/g) ?? [];
        if (codes.length === 0) {
          return c.text("invalid status", 400);
        }
        const code =
          codes.length > 1 ? codes[Math.floor(Math.random() * codes.length)]! : codes[0]!;
        status = Number.parseInt(code, 10);
        break;
      }
      case "h": {
        headers.append(entry.args[0]!, entry.args[1] ?? "");
        break;
      }
      case "c": {
        cookies.push(`${entry.args[0]}=${entry.args[1] ?? ""}; Path=/`);
        break;
      }
      case "cd": {
        cookies.push(`${entry.args[0]}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`);
        break;
      }
      case "r": {
        if (redirectTo !== "") {
          return c.text("multiple redirects not allowed", 400);
        }
        try {
          redirectTo = decodeURIComponent(entry.args[0] ?? "");
        } catch {
          redirectTo = entry.args[0] ?? "";
        }
        break;
      }
      case "b64": {
        const raw = entry.args[0] ?? "";
        const errAt = (() => {
          for (let i = 0; i < raw.length; i++) {
            const ch = raw[i]!;
            if (
              (ch >= "A" && ch <= "Z") ||
              (ch >= "a" && ch <= "z") ||
              (ch >= "0" && ch <= "9") ||
              ch === "+" ||
              ch === "/"
            ) {
              continue;
            }
            if (ch === "=") {
              // padding only at end
              if (i < raw.length - 2) return i;
              continue;
            }
            return i;
          }
          if (raw.length % 4 !== 0) return raw.length;
          return -1;
        })();
        if (errAt >= 0) {
          return c.text(`illegal base64 data at input byte ${errAt}`, 400);
        }
        payload = new Uint8Array(Buffer.from(raw, "base64"));
        break;
      }
      case "d": {
        const seconds = Number.parseFloat(entry.args[0] ?? "");
        if (Number.isNaN(seconds)) {
          return c.text(`invalid delay value: '${entry.args[0]}'`, 400);
        }
        if (seconds < 0) {
          return c.text("delay must be a positive number", 400);
        }
        if (seconds > 10) {
          return c.text("delay must be less than 10 seconds", 400);
        }
        delaySec = seconds;
        break;
      }
      case "t": {
        try {
          const raw = entry.args[0] ?? "";
          const decoded = Buffer.from(raw, "base64").toString("utf8");
          const rendered = renderSimpleTemplate(decoded);
          payload = new TextEncoder().encode(rendered);
        } catch (e) {
          return c.text(String(e), 400);
        }
        break;
      }
      case "slack":
        // no-op (Slack webhook forwarding not implemented)
        break;
    }
  }

  if (redirectTo !== "") {
    if (status === 0) status = 307;
    headers.set("Location", redirectTo);
  }

  if (delaySec > 0) {
    await sleep(delaySec * 1000);
  }

  if (payload && payload.length > 0) {
    if (!headers.has("Content-Length")) {
      headers.set("Content-Length", String(payload.length));
    }
  }

  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }

  const finalStatus = (status === 0 ? 200 : status) as ContentfulStatusCode;
  return new Response(payload && payload.length > 0 ? (payload as unknown as BodyInit) : null, {
    status: finalStatus,
    headers,
  });
};

mixRouter.openapi(
  createSimpleRoute({
    tags: ["Mix"],
    summary: "Combine response behaviours via path or query directives",
    method: "get",
    path: "/mix",
    responses: {
      200: { description: "Mixed response" },
      400: { description: "Bad Request" },
    },
  }),
  mixHandler,
);

// Catch-all path directives: /mix/s=200/h=...
mixRouter.all("/mix/*", mixHandler);
// Also accept non-GET on bare /mix
mixRouter.post("/mix", mixHandler);
mixRouter.put("/mix", mixHandler);
mixRouter.patch("/mix", mixHandler);
mixRouter.delete("/mix", mixHandler);
mixRouter.on("HEAD", "/mix", mixHandler);
mixRouter.on("OPTIONS", "/mix", mixHandler);

const MIXER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Mixer - kulala-echo</title>
<style>
body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code,pre{background:#f4f4f5;padding:.15em .35em;border-radius:4px}
pre{padding:1rem;overflow:auto}
a{color:#09f}
</style>
</head>
<body>
<h1>Mixer</h1>
<p>Build your own API endpoint by combining multiple behaviours into one URL via
<code>/mix</code> directives. See the <a href="/help/mixer">user guide</a>.</p>
<p>Examples:</p>
<ul>
<li><a href="/mix/s=401"><code>/mix/s=401</code></a> - status 401</li>
<li><a href="/mix/s=200/h=x-custom-key:some-value"><code>/mix/s=200/h=x-custom-key:some-value</code></a> - status + header</li>
<li><a href="/mix/s=200/b64=aGVsbG8="><code>/mix/s=200/b64=aGVsbG8=</code></a> - status + base64 body</li>
<li><a href="/mix?s=200&amp;d=1"><code>/mix?s=200&amp;d=1</code></a> - query form with delay</li>
</ul>
<p>Supported directives: <code>s</code>, <code>h</code>, <code>c</code>, <code>cd</code>,
<code>r</code>, <code>b64</code>, <code>d</code>, <code>t</code>, <code>end</code>.</p>
</body>
</html>`;

const MIXER_HELP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>Mix User Guide - kulala-echo</title>
<style>
body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.5}
code,pre{background:#f4f4f5;padding:.15em .35em;border-radius:4px}
pre{padding:1rem;overflow:auto}
a{color:#09f}
h3{margin-top:1.8em}
</style>
</head>
<body>
<h1>Mix User Guide</h1>
<p>The <code>/mix</code> endpoint constructs responses from directives in the path (separated by
<code>/</code>) or query string (separated by <code>&amp;</code>). Use the
<a href="/mixer">mixer UI</a> for examples.</p>
<pre><code>/mix/s=401
/mix/s=200/h=x-custom-key:some-value
/mix/s=401/h=content-type:text%2Fhtml/b64=PHNjcmlwdD5hbGVydCg0Mik8L3NjcmlwdD4=</code></pre>

<h3>Directive <code>s</code></h3>
<p>Status code. Single value or CSV for a random choice: <code>/s=200</code> or <code>/s=200,400,500</code>.</p>

<h3>Directive <code>h</code></h3>
<p>Set a response header: <code>/h=name:value</code>. Encode <code>/</code> and <code>:</code> in values.</p>

<h3>Directive <code>c</code></h3>
<p>Set a cookie: <code>/c=name:value</code> → <code>Set-Cookie: name=value; Path=/</code>.</p>

<h3>Directive <code>cd</code></h3>
<p>Delete a cookie: <code>/cd=name</code> (expires in the past, Max-Age=0).</p>

<h3>Directive <code>r</code></h3>
<p>Redirect (default 307): <code>/r=encoded-url</code>. Override status with <code>s=</code>.</p>

<h3>Directive <code>d</code></h3>
<p>Delay seconds (0–10): <code>/d=1.5</code>.</p>

<h3>Directive <code>b64</code></h3>
<p>Response body from standard base64: <code>/b64=aGVsbG8=</code>.</p>

<h3>Directive <code>t</code></h3>
<p>Base64-encoded template body. Supports simple <code>{{.}}</code> and <code>{{seq N}}</code> replacements.</p>

<h3><code>end</code></h3>
<p>Stops parsing further directives.</p>
</body>
</html>`;

mixRouter.openapi(
  createSimpleRoute({
    tags: ["Mix"],
    summary: "Mixer UI for building /mix URLs",
    method: "get",
    path: "/mixer",
    responses: {
      200: {
        description: "HTML UI",
        content: { "text/html": { schema: { type: "string" } } },
      },
    },
  }),
  (c) => c.html(MIXER_HTML),
);

mixRouter.openapi(
  createSimpleRoute({
    tags: ["Mix"],
    summary: "Help documentation for the mixer",
    method: "get",
    path: "/help/mixer",
    responses: {
      200: {
        description: "HTML help",
        content: { "text/html": { schema: { type: "string" } } },
      },
    },
  }),
  (c) => c.html(MIXER_HELP_HTML),
);

export { mixRouter };
