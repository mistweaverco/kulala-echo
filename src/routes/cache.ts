import { OpenAPIHono } from "@hono/zod-openapi";
import { echoResponseContent } from "./../openapi-schemas";
import { createSimpleRoute, getDefaultResponseBody, jsonResponse } from "./../utils";

const cacheRouter = new OpenAPIHono();

cacheRouter.openapi(
  createSimpleRoute({
    tags: ["Cache"],
    summary:
      "Return 304 if If-Modified-Since or If-None-Match is present, otherwise echo request info",
    method: "get",
    path: "/cache",
    responses: {
      200: {
        description: "Request info",
        content: echoResponseContent,
      },
      304: { description: "Not Modified" },
    },
  }),
  async (c) => {
    const ifModifiedSince = c.req.header("if-modified-since");
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifModifiedSince || ifNoneMatch) {
      return new Response(null, { status: 304 });
    }
    return getDefaultResponseBody(c);
  },
);

cacheRouter.openapi(
  createSimpleRoute({
    tags: ["Cache"],
    summary: "Set Cache-Control: public, max-age={age} and echo request info",
    method: "get",
    path: "/cache/{age}",
    parameters: [
      {
        name: "age",
        in: "path",
        required: true,
        schema: { type: "integer" },
        description: "max-age value in seconds",
      },
    ],
    responses: {
      200: {
        description: "Request info with Cache-Control",
        content: echoResponseContent,
      },
    },
  }),
  async (c) => {
    const age = c.req.param("age");
    c.header("Cache-Control", `public, max-age=${age}`);
    return getDefaultResponseBody(c);
  },
);

cacheRouter.openapi(
  createSimpleRoute({
    tags: ["Cache"],
    summary: "Respond with 304 when If-None-Match matches the given etag",
    method: "get",
    path: "/etag/{etag}",
    parameters: [
      {
        name: "etag",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "Assumed ETag of the resource",
      },
    ],
    responses: {
      200: {
        description: "Request info",
        content: echoResponseContent,
      },
      304: { description: "Not Modified" },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  async (c) => {
    const etag = c.req.param("etag");
    const ifNoneMatch = c.req.header("if-none-match");
    if (ifNoneMatch === etag) {
      return new Response(null, { status: 304 });
    }
    return getDefaultResponseBody(c);
  },
);

export { cacheRouter };
