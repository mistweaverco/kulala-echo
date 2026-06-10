import { OpenAPIHono } from "@hono/zod-openapi";
import { ContentfulStatusCode } from "hono/utils/http-status";
import { createSimpleRoute, jsonResponse } from "./../utils";
import { negotiateContentType, objectToXml } from "./../xml";
import { statusResponseXmlSchema } from "./../openapi-schemas";

const statusTexts: Record<number, string> = {
  100: "Continue",
  101: "Switching Protocols",
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  304: "Not Modified",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

const statusRouter = new OpenAPIHono();

const statusHandler = (c: {
  req: { param: (name: string) => string; header: (name: string) => string | undefined };
  json: (data: unknown, status?: ContentfulStatusCode) => Response;
  text: (body: string, status?: ContentfulStatusCode) => Response;
  body: (data: string, status?: ContentfulStatusCode, headers?: Record<string, string>) => Response;
}) => {
  const codes = c.req.param("codes").split(",");
  const code = codes[Math.floor(Math.random() * codes.length)];
  const status = parseInt(code.trim(), 10);

  if (isNaN(status)) {
    return c.json({ error: "Invalid status code" }, 400);
  }
  if (status < 100 || status > 599) {
    return c.json({ error: "Invalid status code" }, 400);
  }

  const description = statusTexts[status] ?? "Unknown";
  const contentType = negotiateContentType(c.req.header("accept"));

  if (contentType === "text/plain") {
    return c.text(description, status as ContentfulStatusCode);
  }

  if (contentType === "application/xml" || contentType === "text/xml") {
    return c.body(
      objectToXml({ code: status, description }),
      status as ContentfulStatusCode,
      { "Content-Type": `${contentType}; charset=utf-8` },
    );
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
          },
          "text/xml": {
            schema: statusResponseXmlSchema,
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
