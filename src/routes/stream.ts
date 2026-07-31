import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createSimpleRoute, jsonResponse, sleep } from "./../utils";

const streamRouter = new OpenAPIHono();

const parseIntQuery = (c: Context, name: string, fallback: number): number | Response => {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    return c.json({ error: `Invalid ${name} value` }, 400);
  }
  return n;
};

const dripHandler = async (c: Context, writeNewLines: boolean) => {
  const duration = parseIntQuery(c, "duration", 2);
  if (duration instanceof Response) return duration;
  const numbytes = parseIntQuery(c, "numbytes", 10);
  if (numbytes instanceof Response) return numbytes;
  const code = parseIntQuery(c, "code", 200);
  if (code instanceof Response) return code;
  const delay = parseIntQuery(c, "delay", 2);
  if (delay instanceof Response) return delay;

  if (delay > 0) {
    await sleep(delay * 1000);
  }

  const intervalMs = numbytes > 0 ? (duration * 1000) / numbytes : duration * 1000;
  let remaining = numbytes;

  const body = new ReadableStream({
    async pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }
      const part = writeNewLines ? "*\n" : "*";
      controller.enqueue(new TextEncoder().encode(part));
      remaining--;
      await sleep(intervalMs);
    },
  });

  return new Response(body, {
    status: code as ContentfulStatusCode,
    headers: {
      "Cache-Control": "no-cache",
      "Content-Type": "text/octet-stream",
    },
  });
};

const dripQueryParams = [
  {
    name: "duration",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const, default: 2 },
    description: "Total seconds over which to stream data",
  },
  {
    name: "numbytes",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const, default: 10 },
    description: "Total number of bytes (asterisks) to stream",
  },
  {
    name: "code",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const, default: 200 },
    description: "HTTP status code for the response",
  },
  {
    name: "delay",
    in: "query" as const,
    required: false,
    schema: { type: "integer" as const, default: 2 },
    description: "Initial delay in seconds before streaming starts",
  },
];

streamRouter.openapi(
  createSimpleRoute({
    tags: ["Stream"],
    summary: "Drip data over a duration as asterisks",
    method: "get",
    path: "/drip",
    parameters: dripQueryParams,
    responses: {
      200: {
        description: "Octet stream of asterisks",
        content: {
          "text/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  (c) => dripHandler(c, false),
);

streamRouter.openapi(
  createSimpleRoute({
    tags: ["Stream"],
    summary: "Drip data over a duration as asterisks with newlines",
    method: "get",
    path: "/drip-lines",
    parameters: dripQueryParams,
    responses: {
      200: {
        description: "Octet stream of asterisks with newlines",
        content: {
          "text/octet-stream": { schema: { type: "string", format: "binary" } },
        },
      },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  (c) => dripHandler(c, true),
);

streamRouter.openapi(
  createSimpleRoute({
    tags: ["Stream"],
    summary: "Server-Sent Events ping stream",
    method: "get",
    path: "/sse",
    parameters: [
      {
        name: "delay",
        in: "query",
        required: false,
        schema: { type: "integer" as const, default: 1, minimum: 1, maximum: 10 },
        description: "Delay in seconds between events (1–10)",
      },
      {
        name: "count",
        in: "query",
        required: false,
        schema: { type: "integer" as const, default: 10, minimum: 1, maximum: 100 },
        description: "Number of ping events (1–100)",
      },
    ],
    responses: {
      200: {
        description: "SSE stream",
        content: {
          "text/event-stream": { schema: { type: "string" } },
        },
      },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  async (c) => {
    const delayRaw = parseIntQuery(c, "delay", 1);
    if (delayRaw instanceof Response) return delayRaw;
    const countRaw = parseIntQuery(c, "count", 10);
    if (countRaw instanceof Response) return countRaw;

    if (delayRaw < 1) {
      return c.json({ error: "Delay must be greater than 0" }, 400);
    }
    if (delayRaw > 10) {
      return c.json({ error: "Delay must be less than or equal to 10" }, 400);
    }
    if (countRaw < 1) {
      return c.json({ error: "Count must be greater than 0" }, 400);
    }
    if (countRaw > 100) {
      return c.json({ error: "Count must be less than or equal to 100" }, 400);
    }

    const delay = delayRaw;
    const count = countRaw;
    let id = 0;

    const body = new ReadableStream({
      async pull(controller) {
        if (id >= count) {
          controller.close();
          return;
        }
        id++;
        const chunk = `event: ping\nid: ${id}\ndata: a ping event\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
        await sleep(delay * 1000);
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
      },
    });
  },
);

export { streamRouter };
