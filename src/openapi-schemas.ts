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

export const echoResponseXmlSchema = {
  type: "object",
  xml: { name: "response" },
  properties: {
    method: { type: "string", example: "GET" },
    args: {
      type: "object",
      xml: { name: "args" },
      additionalProperties: { type: "string" },
      example: { foo: "bar" },
    },
    headers: {
      type: "object",
      xml: { name: "headers" },
      additionalProperties: { type: "string" },
      example: { Accept: "application/xml", Host: "echo.kulala.app" },
    },
    origin: { type: "string", example: "127.0.0.1" },
    url: { type: "string", example: "https://echo.kulala.app/get?foo=bar" },
    form: {
      type: "object",
      xml: { name: "form" },
    },
    data: { type: "string", example: "" },
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

export const statusResponseXmlSchema = {
  type: "object",
  xml: { name: "response" },
  properties: {
    code: { type: "integer", example: 404 },
    description: { type: "string", example: "Not Found" },
  },
} as const;

export const echoResponseContent = {
  "application/json": {
    schema: echoResponseJsonSchema,
  },
  "application/xml": {
    schema: echoResponseXmlSchema,
  },
  "text/xml": {
    schema: echoResponseXmlSchema,
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
