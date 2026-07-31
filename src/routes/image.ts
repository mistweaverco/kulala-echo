import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createSimpleRoute } from "../utils";

const imageRouter = new OpenAPIHono();
const imagesDir = join(import.meta.dir, "../../static/images");

const FORMATS = {
  svg: { file: "svg.svg", type: "image/svg+xml" },
  png: { file: "png.png", type: "image/png" },
  jpeg: { file: "jpeg.jpeg", type: "image/jpeg" },
  webp: { file: "webp.webp", type: "image/webp" },
} as const;

type Format = keyof typeof FORMATS;

/**
 * Structured SVG schema + object example so Swagger UI emits a real <svg> tree.
 * A string example under image/svg+xml gets wrapped/escaped (e.g. <svg>&lt;svg…),
 * because Swagger treats +xml media types as XML documents.
 */
const svgSchema = {
  type: "object" as const,
  xml: {
    name: "svg",
    namespace: "http://www.w3.org/2000/svg",
  },
  properties: {
    width: {
      type: "string" as const,
      xml: { attribute: true },
    },
    height: {
      type: "string" as const,
      xml: { attribute: true },
    },
    viewBox: {
      type: "string" as const,
      xml: { attribute: true },
    },
    rect: {
      type: "object" as const,
      properties: {
        width: { type: "string" as const, xml: { attribute: true } },
        height: { type: "string" as const, xml: { attribute: true } },
        fill: { type: "string" as const, xml: { attribute: true } },
      },
    },
    circle: {
      type: "object" as const,
      properties: {
        cx: { type: "string" as const, xml: { attribute: true } },
        cy: { type: "string" as const, xml: { attribute: true } },
        r: { type: "string" as const, xml: { attribute: true } },
        fill: { type: "string" as const, xml: { attribute: true } },
      },
    },
  },
  example: {
    width: "64",
    height: "64",
    viewBox: "0 0 64 64",
    rect: { width: "64", height: "64", fill: "#0f172a" },
    circle: { cx: "32", cy: "32", r: "20", fill: "#38bdf8" },
  },
};

const imageContent = {
  "image/svg+xml": {
    schema: svgSchema,
  },
  "image/png": {
    schema: { type: "string" as const, format: "binary" as const },
  },
  "image/jpeg": {
    schema: { type: "string" as const, format: "binary" as const },
  },
  "image/webp": {
    schema: { type: "string" as const, format: "binary" as const },
  },
};

const resolveFormat = (accept: string | undefined): Format => {
  switch (accept) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpeg";
    case "image/svg+xml":
      return "svg";
    default:
      return "svg";
  }
};

const serveFormat = (format: Format) => {
  const meta = FORMATS[format];
  const body = readFileSync(join(imagesDir, meta.file));
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": meta.type },
  });
};

imageRouter.openapi(
  createSimpleRoute({
    tags: ["Images"],
    summary: "Serve the mistweaverco logo based on the Accept header",
    method: "get",
    path: "/",
    responses: {
      200: {
        description: "Image content",
        content: imageContent,
      },
    },
  }),
  (c) => serveFormat(resolveFormat(c.req.header("accept"))),
);

imageRouter.openapi(
  createSimpleRoute({
    tags: ["Images"],
    summary: "Serve the mistweaverco logo by format name",
    method: "get",
    path: "/{format}",
    parameters: [
      {
        name: "format",
        in: "path",
        required: true,
        schema: { type: "string", enum: ["svg", "png", "jpeg", "webp"] },
      },
    ],
    responses: {
      200: {
        description: "Image content",
        content: imageContent,
      },
      404: { description: "Unknown format" },
    },
  }),
  (c) => {
    const format = c.req.param("format") as Format;
    if (!(format in FORMATS)) {
      return c.json({ error: "Unknown format" }, 404);
    }
    return serveFormat(format);
  },
);

export { imageRouter };
