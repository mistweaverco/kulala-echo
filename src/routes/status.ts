import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { statusResponseXmlExample, statusResponseXmlSchema } from "../openapi-schemas";
import { createSimpleRoute, jsonResponse, statusText } from "../utils";
import { negotiateContentType, objectToXml } from "../xml";

const statusRouter = new OpenAPIHono();

const statusHandler = (c: Context) => {
  const codes = (c.req.param("codes") ?? "").split(",");
  const code = codes[Math.floor(Math.random() * codes.length)] ?? "";
  const status = Number.parseInt(code.trim(), 10);

  if (Number.isNaN(status)) {
    return c.json({ error: "Invalid status code" }, 400);
  }
  if (status < 100 || status > 599) {
    return c.json({ error: "Invalid status code" }, 400);
  }

  const description = statusText(status);
  const contentType = negotiateContentType(c.req.header("accept"));

  if (contentType === "text/plain") {
    return c.text(description, status as ContentfulStatusCode);
  }

  if (contentType === "application/xml" || contentType === "text/xml") {
    return c.body(objectToXml({ code: status, description }), status as ContentfulStatusCode, {
      "Content-Type": `${contentType}; charset=utf-8`,
    });
  }

  return c.json({ code: status, description }, status as ContentfulStatusCode);
};

statusRouter.openapi(
  createSimpleRoute({
    tags: ["Status"],
    summary: "Return a given HTTP status code (comma-separated list picks randomly)",
    method: "get",
    path: "/{codes}",
    parameters: [
      {
        name: "codes",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "HTTP status code or comma-separated list (e.g. 404 or 200,404,500)",
      },
    ],
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                code: { type: "integer" },
                description: { type: "string" },
              },
            },
          },
          "application/xml": {
            schema: statusResponseXmlSchema,
            example: statusResponseXmlExample,
          },
          "text/xml": {
            schema: statusResponseXmlSchema,
            example: statusResponseXmlExample,
          },
          "text/plain": {
            schema: { type: "string", example: "Not Found" },
          },
        },
      },
      400: jsonResponse(
        { type: "object", properties: { error: { type: "string" } } },
        "Bad Request",
      ),
    },
  }),
  statusHandler,
);

export { statusRouter };
