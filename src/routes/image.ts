import { OpenAPIHono } from "@hono/zod-openapi";
import { serveStatic } from "hono/bun";
import { createMiddleware } from "hono/factory";
import { createSimpleRoute } from "./../utils";

const imageRouter = new OpenAPIHono();

const imageContent = {
  "image/svg+xml": { schema: { type: "string", format: "binary" } },
  "image/png": { schema: { type: "string", format: "binary" } },
  "image/jpeg": { schema: { type: "string", format: "binary" } },
  "image/webp": { schema: { type: "string", format: "binary" } },
};

const imageRootMiddleware = createMiddleware(async (c, next) => {
  const type = c.req.header("accept");
  switch (type) {
    case "image/webp":
      c.req.path = "webp.webp";
      break;
    case "image/svg+xml":
      c.req.path = "svg.svg";
      break;
    case "image/png":
      c.req.path = "png.png";
      break;
    case "image/jpeg":
      c.req.path = "jpeg.jpeg";
      break;
    case "image/*":
    default:
      c.req.path = "svg.svg";
  }
  await next();
});

const staticHandler = serveStatic({ root: "./static/images" });

imageRouter.openapi(
  createSimpleRoute({
    tags: ["Images"],
    summary: "Serve an image based on the Accept header",
    method: "get",
    path: "/",
    responses: {
      200: {
        description: "Image content",
        content: imageContent,
      },
    },
  }),
  imageRootMiddleware,
  staticHandler,
);

imageRouter.openapi(
  createSimpleRoute({
    tags: ["Images"],
    summary: "Serve a static image by format name",
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
    },
  }),
  serveStatic({
    root: "./static/images",
    rewriteRequestPath: (path) => {
      const newPath = path.replace("/image/", "");
      return newPath + "." + newPath;
    },
  }),
);

export { imageRouter };
