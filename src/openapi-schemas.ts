/** Shared OpenAPI response schemas and media-type examples for echo endpoints. */

export const echoResponseJsonSchema = {
  type: "object",
  properties: {
    method: { type: "string" },
    args: { type: "object" },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
    },
    origin: { type: "string" },
    url: { type: "string" },
    form: { type: "object" },
    data: { type: "string" },
    json: { type: "object", nullable: true },
    files: { type: "object" },
  },
} as const;

/**
 * Explicit XML example - Swagger UI cannot reliably generate XML samples from
 * object schemas that use additionalProperties / nested maps.
 */
export const echoResponseXmlExample = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <method>GET</method>
  <args>
    <foo>bar</foo>
  </args>
  <headers>
    <Accept>application/xml</Accept>
    <Host>echo.kulala.app</Host>
  </headers>
  <origin>127.0.0.1</origin>
  <url>https://echo.kulala.app/get?foo=bar</url>
  <form/>
  <data></data>
  <json/>
  <files/>
</response>`;

export const echoResponseXmlSchema = {
  type: "object",
  xml: { name: "response" },
  properties: {
    method: { type: "string", example: "GET", xml: { name: "method" } },
    args: {
      type: "object",
      xml: { name: "args" },
      additionalProperties: { type: "string" },
    },
    headers: {
      type: "object",
      xml: { name: "headers" },
      additionalProperties: { type: "string" },
    },
    origin: { type: "string", example: "127.0.0.1", xml: { name: "origin" } },
    url: {
      type: "string",
      example: "https://echo.kulala.app/get?foo=bar",
      xml: { name: "url" },
    },
    form: {
      type: "object",
      xml: { name: "form" },
    },
    data: { type: "string", example: "", xml: { name: "data" } },
    json: {
      type: "object",
      nullable: true,
      xml: { name: "json" },
    },
    files: {
      type: "object",
      xml: { name: "files" },
    },
  },
} as const;

export const statusResponseXmlExample = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <code>404</code>
  <description>Not Found</description>
</response>`;

export const statusResponseXmlSchema = {
  type: "object",
  xml: { name: "response" },
  properties: {
    code: { type: "integer", example: 404, xml: { name: "code" } },
    description: {
      type: "string",
      example: "Not Found",
      xml: { name: "description" },
    },
  },
} as const;

export const echoResponseContent = {
  "application/json": {
    schema: echoResponseJsonSchema,
  },
  "application/xml": {
    schema: echoResponseXmlSchema,
    example: echoResponseXmlExample,
  },
  "text/xml": {
    schema: echoResponseXmlSchema,
    example: echoResponseXmlExample,
  },
  "text/html": {
    schema: {
      type: "string",
      example: `<html>
<head>
<title>echo</title>
</head>
<body>
<h1>echo</h1>
<p data-type="method">GET</p>
<ul data-type="headers">
<li>header1: value1</li>
<li>header2: value2</li>
</ul>
<p data-type="body">
{"key1":"value1","key2":"value2"}</p>
</body>
</html>`,
    },
  },
  "text/plain": {
    schema: {
      type: "string",
      example: `method:
GET
headers:
header1: value1
header2: value2
body:
{"key1":"value1","key2":"value2"}`,
    },
  },
} as const;
